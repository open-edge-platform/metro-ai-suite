import { validatePrefilterConfig } from "./prefilter-config.js";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { SchemaManager, type SchemaExtension } from "@smart-community-video/db";
import { buildPromptContent, checkUseCaseConsistency, validateEvaluateRulesOverride,
  type UseCaseRegisterParams, type UseCaseRegisterDeps, type UseCaseRegisterResult } from "./use-case-register.js";
import { useCaseValidate } from "./use-case-validate.js";
import { fingerprint, mergePatch } from "./config-patch.js";

const locks = new WeakMap<object, Promise<void>>();
const validatedCandidates = new Set<string>();
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temporary, content); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

async function snapshot(name: string, deps: UseCaseRegisterDeps): Promise<any> {
  const entry = deps.useCaseDict[name];
  if (!entry) throw new Error(`use_case "${name}" not found`);
  const path = join(deps.baseDir ?? process.cwd(), "use-cases", name, "prompt.md");
  let prompt = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (prompt === undefined) {
    const response = await fetch(`${deps.summaryServiceUrl}/v1/tasks/${encodeURIComponent(entry.video_summary_task)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`cannot read original VLM task: HTTP ${response.status}`);
    const task: any = await response.json();
    prompt = typeof task.content === "string" ? task.content : task.content?.text;
    if (typeof prompt !== "string") {
      const sections = ["GLOBAL_PROMPT", "MACRO_CHUNK_PROMPT", "LOCAL_PROMPT", "T_MINUS_1_PROMPT"];
      const source = task.prompts ?? task;
      if (!sections.every(k => typeof source[k] === "string")) throw new Error("original four-section prompt unavailable; restore server artifacts before updating");
      prompt = sections.map(k => `## ${k}\n${source[k]}`).join("\n\n");
    }
  }
  const rules = entry.evaluate_rules_path ? readFileSync(entry.evaluate_rules_path, "utf8") : undefined;
  return { entry: structuredClone(entry), prompt_text: prompt, evaluate_rules_content: rules,
    prompt_source: existsSync(path) ? path : "vlm_task", bound_monitors: deps.boundMonitors?.(name) ?? [] };
}

// Event contract block marker from the prompt authoring template ("- <U+4E8B U+4EF6>
// <name>", escaped here to keep this file ASCII-only; English "- Event <name>" also
// accepted), capturing the block body so its declared severity can be read.
const EVENT_BLOCK_RE = /^- (?:\u4e8b\u4ef6|Event) ([a-z][a-z0-9_]*)\n((?: +- .*(?:\n|$))*)/gm;
// "\u56fa\u5b9a\u4e25\u91cd\u7a0b\u5ea6" (U+56FA U+5B9A U+4E25 U+91CD U+7A0B U+5EA6), escaped to stay ASCII-only.
const BLOCK_SEVERITY_RE = /- (?:\u56fa\u5b9a\u4e25\u91cd\u7a0b\u5ea6|Fixed severity):\s*(critical|warn|info)/;
// Per the authoring rules, info means a non-alerting baseline/absence/uncertainty
// state; warn/critical (or an unparsable severity) stays a detection target.
function statusEventsOf(prompt: string): { targets: Set<string>; states: Set<string> } {
  const targets = new Set<string>(), states = new Set<string>();
  for (const m of prompt.matchAll(EVENT_BLOCK_RE)) {
    if (m[2].match(BLOCK_SEVERITY_RE)?.[1] === "info") states.add(m[1]); else targets.add(m[1]);
  }
  return { targets, states };
}

export async function useCaseUpdate(params: UseCaseRegisterParams, deps: UseCaseRegisterDeps): Promise<UseCaseRegisterResult> {
  // Serialize all updates sharing the dictionary: tasks and SQL columns may be shared.
  const previous = locks.get(deps.useCaseDict) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(deps.useCaseDict, previous.then(() => current));
  await previous;
  const started = performance.now();
  const result: UseCaseRegisterResult = { action: params.action, use_case: params.use_case ?? "", ok: false, steps: {}, warnings: [], errors: [] };
  try {
    const name = params.use_case;
    if (!name || !/^[a-z][a-z0-9_]{1,63}$/.test(name)) throw new Error("valid use_case is required");
    const before = await snapshot(name, deps);
    const revision = fingerprint(before);
    result.revision = revision;
    if (params.action === "get") { result.snapshot = before; result.ok = true; return result; }
    if (!params.dry_run && params.expected_revision !== revision) throw new Error("expected_revision mismatch; get and preview the current use case again");
    if (params.expected_revision && params.expected_revision !== revision) throw new Error("expected_revision mismatch");
    if (params.schema_extensions !== undefined) throw new Error("update accepts schema_additions, not schema_extensions replacement");
    if (params.video_summary_task && params.video_summary_task !== before.entry.video_summary_task) throw new Error("update cannot change video_summary_task");
    if (params.evaluate_rules_path !== undefined && params.evaluate_rules_content !== undefined) throw new Error("provide either evaluate_rules_path or evaluate_rules_content");
    validatePrefilterConfig(params.monitor_defaults);
    const entry = structuredClone(before.entry);
    if (params.detection_events !== undefined) {
      if (!Array.isArray(params.detection_events) || !params.detection_events.length) throw new Error("cannot remove the last detection event; request use-case disable separately");
      if (params.detection_events.some(event => typeof event !== "string" || !/^[a-z][a-z0-9_]*$/.test(event)) || new Set(params.detection_events).size !== params.detection_events.length) throw new Error("detection_events must contain unique event identifiers");
      entry.detection_events = [...params.detection_events].sort();
      if (fingerprint(entry.detection_events) !== fingerprint([...(before.entry.detection_events ?? [])].sort()) && params.prompt_text === undefined) throw new Error("event changes require the complete updated prompt");
    }
    for (const key of ["description", "reports", "summarize", "monitor_defaults"] as const) {
      if (params[key] !== undefined) entry[key] = typeof params[key] === "object" ? mergePatch(entry[key], params[key]) : params[key];
    }
    const schema: SchemaExtension[] = structuredClone(entry.schema?.video_summary_tasks?.extensions ?? []);
    for (const addition of params.schema_additions ?? []) {
      if (!/^[a-z][a-z0-9_]*$/.test(addition.name) || !["text", "integer", "real"].includes(addition.type) || typeof addition.required !== "boolean") throw new Error("invalid schema addition");
      const old = schema.find(e => e.name.toLowerCase() === addition.name);
      if (old && fingerprint(old) !== fingerprint(addition)) throw new Error(`schema conflict: ${addition.name}`);
      if (!old) schema.push(addition);
    }
    if ((params.schema_additions?.length ?? 0) && !before.entry.schema?.video_summary_tasks?.extensions?.length) throw new Error("report-only mode changes require a separate migration");
    if (schema.length) entry.schema = mergePatch(entry.schema, { video_summary_tasks: { extensions: schema } });
    const prompt = params.prompt_text ?? before.prompt_text;
    const rules = params.evaluate_rules_content ?? (params.evaluate_rules_path ? readFileSync(params.evaluate_rules_path, "utf8") : before.evaluate_rules_content);
    const rulesPath = rules === undefined ? undefined : (before.entry.evaluate_rules_path ?? join(deps.baseDir ?? process.cwd(), "use-cases", name, "evaluate_rules.py"));
    if (rulesPath) entry.evaluate_rules_path = rulesPath;
    const after = { ...before, entry, prompt_text: prompt, evaluate_rules_content: rules };
    // Detection-event guard: submitting an empty detection configuration is never
    // allowed (disabling a use case is a separate operation). Any prompt change
    // must declare the final detection event set, and the declared set must match
    // the candidate prompt's event contract: declaring a stale event name while
    // the prompt no longer detects it must not slip through. Prefilter-only and
    // other prompt-free updates do not require the field.
    const promptChanged = prompt !== before.prompt_text;
    if (promptChanged && params.detection_events === undefined) throw new Error(
      "prompt changes require detection_events: the final detection event set inferred from the candidate prompt " +
      "(system-maintained, exclude baseline/uncertainty states; never asked from the user)");
    if (params.detection_events !== undefined) {
      const { targets, states } = statusEventsOf(prompt);
      const declaredStates = params.detection_events.filter(event => states.has(event));
      if (declaredStates.length) throw new Error(
        `detection_events must not contain baseline/uncertainty states (${declaredStates.join(", ")}); those are info-severity states, not detection targets`);
      const notInPrompt = params.detection_events.filter(event => !targets.has(event) && !states.has(event));
      if (notInPrompt.length) throw new Error(
        `detection_events not declared in the candidate prompt's event contract: ${notInPrompt.join(", ")}; declare the final set matching the prompt`);
      const undeclared = [...targets].filter(event => !params.detection_events!.includes(event));
      if (undeclared.length) throw new Error(
        `candidate prompt declares detection events missing from detection_events: ${undeclared.join(", ")}`);
    }
    result.diff = { before, after };
    const hash = fingerprint({ revision, entry, prompt, rules });
    result.candidate_hash = hash;
    if (!params.dry_run && params.candidate_hash !== hash) throw new Error("candidate_hash mismatch; commit the exact dry_run candidate");
    if (fingerprint(before) === fingerprint(after)) { result.ok = true; result.unchanged = true; return result; }
    const taskName = entry.video_summary_task;
    const vlmChanged = prompt !== before.prompt_text || entry.description !== before.entry.description;
    if (vlmChanged && (["summary", "summary_zh"].includes(taskName) || Object.entries(deps.useCaseDict).some(([k, v]) => k !== name && v.video_summary_task === taskName))) throw new Error("builtin/shared VLM task cannot be modified");
    const consistency = checkUseCaseConsistency({ promptText: prompt, schemaExtensions: schema, evaluateRulesText: rules });
    result.steps.consistency = consistency;
    if (!consistency.consistent) throw new Error(`consistency check failed: ${JSON.stringify(consistency)}`);
    const columns = deps.db.prepare("PRAGMA table_info(video_summary_tasks)").all() as any[];
    for (const field of schema) {
      const existing = columns.find(c => c.name.toLowerCase() === field.name.toLowerCase());
      if (existing && existing.type.toLowerCase() !== field.type) throw new Error(`schema type conflict: ${field.name}`);
    }
    const rulesHash = fingerprint({ rules, schema });
    if (rules !== undefined && !validatedCandidates.has(rulesHash)) {
      const dir = mkdtempSync(join(tmpdir(), "uc-rules-"));
      try {
        const path = join(dir, "evaluate_rules.py"); writeFileSync(path, rules);
        const error = await validateEvaluateRulesOverride(name, path, schema);
        if (error) throw new Error(error);
        validatedCandidates.add(rulesHash);
        if (validatedCandidates.size > 256) validatedCandidates.delete(validatedCandidates.values().next().value!);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const promptPath = join(deps.baseDir ?? process.cwd(), "use-cases", name, "prompt.md");
    let oldConfig: string | undefined, nextConfig: string | undefined;
    if (params.persist) {
      if (!deps.configPath) throw new Error("persist requires configPath");
      oldConfig = readFileSync(deps.configPath, "utf8");
      const doc = parseDocument(oldConfig); if (doc.errors.length) throw new Error("invalid config YAML");
      doc.setIn(["use_case_dict", name], entry); nextConfig = doc.toString();
    }
    result.timings = { preflight_ms: performance.now() - started };
    if (params.dry_run) { result.ok = true; return result; }
    const pauseStarted = performance.now();
    const resume = await deps.pauseWorkers?.(name);
    result.timings.worker_wait_ms = performance.now() - pauseStarted;
    const journalPath = join(deps.baseDir ?? process.cwd(), "use-cases", ".updates", `${name}.json`);
    let patched = false;
    const oldFiles = new Map<string, string | undefined>();
    const remember = (path: string) => oldFiles.set(path, existsSync(path) ? readFileSync(path, "utf8") : undefined);
    try {
      if (fingerprint(await snapshot(name, deps)) !== revision) throw new Error("revision changed while waiting for workers");
      if (deps.configPath && oldConfig !== undefined && readFileSync(deps.configPath, "utf8") !== oldConfig) throw new Error("config changed during preview");
      const recoveryFiles = [promptPath, ...(rulesPath ? [rulesPath] : [])];
      atomicWrite(journalPath, JSON.stringify({ name, before, taskName, vlmChanged, configPath: params.persist ? deps.configPath : undefined,
        files: recoveryFiles.map(path => ({ path, content: existsSync(path) ? readFileSync(path, "utf8") : null })) }));
      const additions = schema.filter(field => !columns.some(c => c.name.toLowerCase() === field.name.toLowerCase()));
      if (additions.length) result.steps.schema = new SchemaManager(deps.db).applySchema({ video_summary_tasks: { extensions: additions } });
      if (vlmChanged) {
        patched = true; // A transport failure may still have applied the patch remotely.
        const patchStarted = performance.now();
        await patchTask(deps, taskName, prompt, entry.description);
        result.timings!.vlm_patch_ms = performance.now() - patchStarted;
        result.steps.vlm_task = "updated";
      }
      if (prompt !== before.prompt_text || !existsSync(promptPath)) { remember(promptPath); atomicWrite(promptPath, prompt); }
      if (rulesPath && rules !== before.evaluate_rules_content) { remember(rulesPath); atomicWrite(rulesPath, rules!); }
      if (nextConfig !== undefined) {
        if (nextConfig !== oldConfig) { remember(deps.configPath!); atomicWrite(deps.configPath!, nextConfig); }
        result.steps.config_yaml = "written";
      }
      deps.useCaseDict[name] = entry;
      if (vlmChanged) {
        result.steps.validate = await useCaseValidate({ use_case: name, expected_prompt_content: buildPromptContent(prompt) }, deps as any);
        if (!result.steps.validate.valid) throw new Error(`post-update validation failed: ${result.steps.validate.error ?? result.steps.validate.suggestion}`);
      }
      result.steps.use_case_dict = "updated";
      result.revision = fingerprint(await snapshot(name, deps));
      result.ok = true;
      rmSync(journalPath, { force: true });
    } catch (error) {
      deps.useCaseDict[name] = before.entry;
      for (const [path, content] of oldFiles) {
        try { if (content === undefined) rmSync(path, { force: true }); else atomicWrite(path, content); }
        catch (e: any) { result.degraded = true; result.warnings.push(`file restore failed: ${e.message}`); }
      }
      if (patched) {
        try { await patchTask(deps, taskName, before.prompt_text, before.entry.description); }
        catch (e: any) { result.degraded = true; result.warnings.push(`VLM restore failed: ${e.message}`); }
      }
      if (!result.degraded) rmSync(journalPath, { force: true });
      if (result.steps.schema?.added.length) result.warnings.push("new SQL columns remain unused after rollback");
      throw error;
    } finally { resume?.(); }
  } catch (error: any) { result.errors.push(error.message); }
  finally { result.timings = { ...result.timings, total_ms: performance.now() - started }; release(); }
  return result;
}

async function patchTask(deps: UseCaseRegisterDeps, name: string, prompt: string, description?: string): Promise<void> {
  const response = await fetch(`${deps.summaryServiceUrl}/v1/tasks/${encodeURIComponent(name)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "full", description, content: { text: buildPromptContent(prompt) } }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`VLM PATCH failed: HTTP ${response.status}`);
}


/** Recover interrupted updates before workers start; unrelated YAML entries survive. */
export async function recoverUseCaseUpdates(deps: UseCaseRegisterDeps): Promise<void> {
  const dir = join(deps.baseDir ?? process.cwd(), "use-cases", ".updates");
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter(name => name.endsWith(".json"))) {
    const path = join(dir, file);
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (journal.vlmChanged) await patchTask(deps, journal.taskName, journal.before.prompt_text, journal.before.entry.description);
    for (const artifact of journal.files) {
      if (artifact.content === null) rmSync(artifact.path, { force: true });
      else atomicWrite(artifact.path, artifact.content);
    }
    if (journal.configPath) {
      const doc = parseDocument(readFileSync(journal.configPath, "utf8"));
      if (doc.errors.length) throw new Error("cannot recover invalid config YAML");
      doc.setIn(["use_case_dict", journal.name], journal.before.entry);
      atomicWrite(journal.configPath, doc.toString());
    }
    deps.useCaseDict[journal.name] = journal.before.entry;
    rmSync(path, { force: true });
  }
}
