import { SchemaManager, type SchemaDefinition } from "@smart-community-video/db";

export interface UseCaseValidateParams {
  use_case: string;
  /** Update-only: verify the task actually contains the submitted prompt. */
  expected_prompt_content?: string;
}

export interface UseCaseValidateDeps {
  /**
   * Loaded use_case_dict from config.yaml. `video_summary_task` and the use
   * case's own `schema` (extension columns for required-field discovery) are
   * read here — schema is owned per use case, not globally.
   */
  useCaseDict: Record<string, { video_summary_task: string; schema?: SchemaDefinition }>;
  /** multilevel-video-understanding service base URL (e.g. http://localhost:8192). */
  summaryServiceUrl: string;
}

export interface UseCaseValidateResult {
  valid: boolean;
  use_case: string;
  video_summary_task?: string;
  checks: {
    use_case_known: boolean;
    task_registered: boolean;
    schema_consistent: boolean;
  };
  required_fields?: string[];
  optional_fields?: string[];
  missing_required_in_prompt?: string[];
  missing_optional_in_prompt?: string[];
  prompt_tail?: string;
  suggestion?: string;
  error?: string;
}

/**
 * One-stop validation of a use_case: existence, summary-service task registration,
 * and prompt ↔ schema consistency.
 *
 * Three sequential checks; the first failure short-circuits the rest.
 * Caller may rely on `valid` for a single yes/no, or read `checks` to know
 * which stage failed.
 */
export async function useCaseValidate(
  params: UseCaseValidateParams,
  deps: UseCaseValidateDeps,
): Promise<UseCaseValidateResult> {
  const checks = {
    use_case_known: false,
    task_registered: false,
    schema_consistent: false,
  };

  // 1. use_case existence
  const ucCfg = deps.useCaseDict[params.use_case];
  if (!ucCfg) {
    return {
      valid: false,
      use_case: params.use_case,
      checks,
      error: `unknown use_case "${params.use_case}". Known: [${Object.keys(deps.useCaseDict).join(", ")}]`,
    };
  }
  checks.use_case_known = true;
  const taskName = ucCfg.video_summary_task;

  // 2. summary-service connectivity + task existence
  let taskBody: any;
  try {
    const resp = await fetch(`${deps.summaryServiceUrl}/v1/tasks/${taskName}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status === 404) {
      return {
        valid: false, use_case: params.use_case, video_summary_task: taskName, checks,
        error: `task "${taskName}" not registered in multilevel-video-understanding (${deps.summaryServiceUrl}). Register first: POST /v1/tasks`,
      };
    }
    if (!resp.ok) {
      return {
        valid: false, use_case: params.use_case, video_summary_task: taskName, checks,
        error: `failed to verify task "${taskName}": HTTP ${resp.status}`,
      };
    }
    taskBody = await resp.json();
  } catch (err: any) {
    return {
      valid: false, use_case: params.use_case, video_summary_task: taskName, checks,
      error: `summary service unreachable (${deps.summaryServiceUrl}): ${err.message}`,
    };
  }
  checks.task_registered = true;
  if (params.expected_prompt_content !== undefined) {
    const expected = params.expected_prompt_content;
    // The summary service may return task content either as an object
    // (`content: { text }`) or as a plain string (`content: "GLOBAL_PROMPT = '''...'''"`).
    const contentNode = taskBody.content;
    const actual = typeof contentNode === "string" ? contentNode : contentNode?.text;
    let matches = typeof actual === "string" && actual.trim() === expected.trim();
    if (!matches) {
      // Compare section by section. The service's smart_autofill appends
      // scaffold placeholders and can wrap T_MINUS_1 in an envelope, so both
      // sides are normalized (scaffold/blank lines stripped) before comparing.
      // Missing, duplicated or unparseable sections reject: only known
      // service-added scaffold lines are ignored, never business text.
      const parseSections = (text: string) => {
        const sections = new Map<string, { count: number; body: string }>();
        for (const m of text.matchAll(/(GLOBAL_PROMPT|MACRO_CHUNK_PROMPT|LOCAL_PROMPT|T_MINUS_1_PROMPT)\s*=\s*(['"]{3})([\s\S]*?)\2/g)) {
          const prev = sections.get(m[1]);
          sections.set(m[1], { count: (prev?.count ?? 0) + 1, body: m[3] });
        }
        return sections;
      };
      const expectedSections = parseSections(expected);
      const actualSections = typeof actual === "string" ? parseSections(actual) : new Map<string, { count: number; body: string }>();
      const source = taskBody.prompts ?? taskBody;
      matches = expectedSections.size === 4 && [...expectedSections].every(([name, { count, body }]) => {
        if (count !== 1) return false;
        if (typeof source[name] === "string") return normalizeSection(source[name]) === normalizeSection(body);
        const actualSection = actualSections.get(name);
        return actualSection?.count === 1 && normalizeSection(actualSection.body) === normalizeSection(body);
      });
    }
    if (!matches) return { valid: false, use_case: params.use_case, video_summary_task: taskName, checks,
      error: "VLM task readback does not match the submitted prompt; update has not been verified" };
  }


  // 3. schema consistency: this use case's own required schema fields must appear
  // in LOCAL_PROMPT. Schema is owned per use case, so other use cases' fields
  // never enter this check.
  const extensions = ucCfg.schema?.video_summary_tasks?.extensions ?? [];
  const localPrompt = extractLocalPrompt(taskBody);
  const check = SchemaManager.validatePromptSchema(extensions, localPrompt);
  checks.schema_consistent = check.valid;

  const base = {
    use_case: params.use_case,
    video_summary_task: taskName,
    checks,
    required_fields: check.requiredFields,
    optional_fields: check.optionalFields,
    missing_required_in_prompt: check.missingRequired,
    missing_optional_in_prompt: check.missingOptional,
  };

  if (!checks.schema_consistent) {
    return {
      ...base,
      valid: false,
      prompt_tail: localPrompt.slice(-200),
      suggestion: `Append the following required fields to LOCAL_PROMPT of "${taskName}": ${check.missingRequired.join(", ")}`,
    };
  }

  return { ...base, valid: true };
}

/**
 * Pull LOCAL_PROMPT from the task body. The summary service may expose it under
 * several key paths depending on version; try the common ones and fall back to
 * stringifying the body so substring search still works.
 */
// Lines the summary service's smart_autofill may append to (or wrap around)
// submitted prompt sections. Stripped - together with blank lines - from both
// candidate and readback sections before comparison, so autofill does not cause
// false mismatches. Whole-section default templates are intentionally NOT
// stripped: a candidate relying on them differs from the service default and
// must fail readback honestly.
const AUTOFILL_SCAFFOLD_LINES = new Set([
  "##Subtitles:", "{chunk_subtitle}", "User prompt: {question}",
  "Start time: {st_tm} sec", "End time: {end_tm} sec",
  "##Context:", "{past_summary}", "[", "]",
  "The summary of the previous {dur} seconds is in brackets []. Use it as",
  "context for the current segment; do not copy it into your output.",
]);

function normalizeSection(body: string): string {
  return body.split("\n").map(line => line.trim())
    .filter(line => line !== "" && !AUTOFILL_SCAFFOLD_LINES.has(line)).join("\n");
}

function extractLocalPrompt(taskBody: any): string {  if (!taskBody || typeof taskBody !== "object") return "";
  const contentNode = taskBody.content;
  if (typeof contentNode === "string") {
    const section = contentNode.match(/LOCAL_PROMPT\s*=\s*(['"]{3})([\s\S]*?)\1/);
    if (section) return section[2];
  }
  return (
    taskBody.LOCAL_PROMPT ??
    taskBody.local_prompt ??
    taskBody.prompts?.LOCAL_PROMPT ??
    taskBody.prompts?.local_prompt ??
    JSON.stringify(taskBody)
  );
}
