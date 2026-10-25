import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { parse, stringify } from "yaml";
import { useCaseRegister } from "@smart-community-video/tools";
import { buildPromptContent } from "../../packages/tools/src/use-case-register.js";

const prompt = "## LOCAL_PROMPT\n- Event resting\nSEVERITY: info\nEVENT: resting\nDESC: visible\nCOUNT: 2\n";
const rule = 'import json,sys\nf=json.loads(sys.argv[1])\nf.get("count")\nprint("null")\n';
async function environment(run: (env: any) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "uc-update-"));
  const db = new Database(":memory:"); db.exec("CREATE TABLE video_summary_tasks(id INTEGER PRIMARY KEY, severity TEXT, event TEXT, desc TEXT, count INTEGER)");
  const dir = join(baseDir, "use-cases", "pet_safety"); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "prompt.md"), prompt); await writeFile(join(dir, "evaluate_rules.py"), rule);
  const entry = { video_summary_task: "custom_pet_task", description: "original", evaluate_rules_path: join(dir, "evaluate_rules.py"),
    reports: { default_type: "weekly", filter: { zone: "kitchen" } }, summarize: { method: "USE_LLM_T-1", processor_kwargs: { levels: 2 } },
    custom_setting: { retained: true }, schema: { video_summary_tasks: { extensions: [
      { name: "severity", type: "text", required: false }, { name: "event", type: "text", required: true },
      { name: "desc", type: "text", required: true }, { name: "count", type: "integer", required: false },
    ] }, custom_tables: [] } };
  const configPath = join(baseDir, "config.yaml"); await writeFile(configPath, stringify({ use_case_dict: { pet_safety: entry } }));
  const deps: any = { baseDir, db, configPath, useCaseDict: { pet_safety: entry }, summaryServiceUrl: "http://vlm", pauseWorkers: async () => () => {} };
  try { await run({ deps, dir }); } finally { db.close(); await rm(baseDir, { recursive: true, force: true }); }
}

test("prompt update preserves all original metadata, previews without writes, patches once", async t => {
  await environment(async ({ deps, dir }) => {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      calls.push(options?.method ?? "GET");
      return new Response(JSON.stringify({ content: { text: buildPromptContent(prompt.replace("resting", "escape_attempt")) } }), { status: 200 });
    });
    const old = structuredClone(deps.useCaseDict.pet_safety);
    const changed = prompt.replace("resting", "escape_attempt");
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: changed, detection_events: ["escape_attempt"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    assert.equal(preview.ok, true, JSON.stringify(preview)); assert.equal(calls.length, 0);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), prompt);
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(calls, ["PATCH", "GET"]);
    const { detection_events, ...entry } = deps.useCaseDict.pet_safety;
    assert.deepEqual(entry, old);
    assert.deepEqual(detection_events, ["escape_attempt"]);
    const persisted = parse(await readFile(deps.configPath, "utf8")).use_case_dict.pet_safety;
    const { detection_events: persistedEvents, ...persistedEntry } = persisted;
    assert.deepEqual(persistedEntry, old);
    assert.deepEqual(persistedEvents, ["escape_attempt"]);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), changed);
  });
});

test("readback accepts task content returned as a plain string", async t => {
  await environment(async ({ deps, dir }) => {
    // multilevel-video-understanding returns content as a string, not { text },
    // and smart_autofill appends scaffold lines to sections.
    const autofilled = buildPromptContent(prompt.replace("resting", "escape_attempt"))
      .replace(/(GLOBAL_PROMPT = '''[\s\S]*?[^\n])(''')/, "$1\n##Subtitles:\n{chunk_subtitle}\n$2")
      .replace(/(MACRO_CHUNK_PROMPT = '''[\s\S]*?[^\n])(''')/, "$1\n##Subtitles:\n{chunk_subtitle}\n$2")
      .replace(/(LOCAL_PROMPT = '''[\s\S]*?[^\n])(''')/, "$1\nUser prompt: {question}\n##Subtitles:\n{chunk_subtitle}\n$2");
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (options?.method === "PATCH") return new Response("{}");
      return new Response(JSON.stringify({ name: "custom_pet_task", source: "dynamic", content: autofilled }));
    });
    const changed = prompt.replace("resting", "escape_attempt");
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: changed, detection_events: ["escape_attempt"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.steps.validate?.valid, true);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), changed);
  });
});

test("schema addition keeps integer metadata and adds only missing columns", async t => {
  await environment(async ({ deps }) => {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ content: { text: buildPromptContent(prompt + "RISK_AREA: unknown\n") } })));
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: prompt + "RISK_AREA: unknown\n", detection_events: ["resting"],
      schema_additions: [{ name: "risk_area", type: "text", required: false }], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.steps.schema?.added, ["video_summary_tasks.risk_area"]);
    assert.equal(deps.useCaseDict.pet_safety.schema.video_summary_tasks.extensions.find((f: any) => f.name === "count").type, "integer");
  });
});

test("conflicts, invalid rules and changed candidates fail before VLM writes", async t => {
  await environment(async ({ deps }) => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
    const conflict = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, schema_additions: [{ name: "count", type: "real", required: false }] }, deps);
    assert.equal(conflict.ok, false); assert.match(conflict.errors.join(), /conflict/);
    const invalid = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, evaluate_rules_content: "raise RuntimeError('broken')" }, deps);
    assert.equal(invalid.ok, false); assert.match(invalid.errors.join(), /smoke/);
    const preview = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: prompt.replace("resting", "escape"), detection_events: ["escape"] }, deps);
    const commit = await useCaseRegister({ action: "update", use_case: "pet_safety", expected_revision: preview.revision, candidate_hash: preview.candidate_hash, prompt_text: prompt.replace("resting", "aggression"), detection_events: ["aggression"] }, deps);
    assert.equal(commit.ok, false); assert.match(commit.errors.join(), /candidate_hash/);
  });
});

test("post-update failure restores prompt, rules, configuration and VLM", async t => {
  await environment(async ({ deps, dir }) => {
    let patches = 0;
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (options?.method === "PATCH") { patches++; return new Response("{}"); }
      return new Response("{}", { status: 503 });
    });
    const original = await readFile(deps.configPath, "utf8");
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: prompt.replace("resting", "escape"), detection_events: ["escape"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, false); assert.equal(patches, 2);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), prompt);
    assert.equal(await readFile(deps.configPath, "utf8"), original);
  });
});

test("get exposes full state and stale revision cannot commit", async () => {
  await environment(async ({ deps }) => {
    const state = await useCaseRegister({ action: "get", use_case: "pet_safety" }, deps);
    assert.equal(state.ok, true); assert.equal(state.snapshot?.entry.custom_setting.retained, true);
    assert.equal(state.snapshot?.evaluate_rules_content, rule);
    const preview = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: prompt + "new evidence" }, deps);
    deps.useCaseDict.pet_safety.description = "concurrent edit";
    const result = await useCaseRegister({ action: "update", use_case: "pet_safety", expected_revision: preview.revision, candidate_hash: preview.candidate_hash, prompt_text: prompt + "new evidence" }, deps);
    assert.equal(result.ok, false); assert.match(result.errors.join(), /revision mismatch/);
  });
});

test("startup recovery restores interrupted configuration without overwriting other entries", async t => {
  const { recoverUseCaseUpdates } = await import("@smart-community-video/tools");
  await environment(async ({ deps, dir }) => {
    const original = structuredClone(deps.useCaseDict.pet_safety);
    await writeFile(join(dir, "prompt.md"), "interrupted candidate");
    await writeFile(deps.configPath, stringify({ use_case_dict: { pet_safety: { ...original, description: "interrupted" }, another: { video_summary_task: "another_task" } } }));
    const journalDir = join(deps.baseDir, "use-cases", ".updates"); await mkdir(journalDir);
    await writeFile(join(journalDir, "pet_safety.json"), JSON.stringify({ name: "pet_safety", before: { entry: original, prompt_text: prompt }, taskName: original.video_summary_task,
      vlmChanged: true, configPath: deps.configPath, files: [{ path: join(dir, "prompt.md"), content: prompt }] }));
    t.mock.method(globalThis, "fetch", async () => new Response("{}"));
    await recoverUseCaseUpdates(deps);
    const config = parse(await readFile(deps.configPath, "utf8"));
    assert.deepEqual(config.use_case_dict.pet_safety, original); assert.equal(config.use_case_dict.another.video_summary_task, "another_task");
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), prompt);
  });
});

test("event additions, removals and condition edits use one PATCH, preserve columns/history and reuse rules", async t => {
  await environment(async ({ deps, dir }) => {
    let activePrompt = prompt;
    const methods: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      methods.push(options?.method ?? "GET");
      if (options?.method === "PATCH") return new Response("{}");
      return new Response(JSON.stringify({ content: { text: buildPromptContent(activePrompt) } }));
    });
    deps.db.exec("INSERT INTO video_summary_tasks(event,count) VALUES('trapped',2)");
    const columns = deps.db.prepare("PRAGMA table_info(video_summary_tasks)").all();
    const original = structuredClone(deps.useCaseDict.pet_safety);
    const withoutResting = prompt.replace("- Event resting\n", "");
    const blocks = (events: readonly string[]) => events.map(e => `- Event ${e}\n  - Fixed severity: warn\n`).join("");
    for (const [events, contract] of [
      [["escape", "trapped", "stove"], blocks(["escape", "trapped", "stove"])],
      [["escape", "stove"], blocks(["escape", "stove"])],
      [["escape", "stove"], `- Event escape\n  - Fixed severity: warn\n- Event stove\n  - Fixed severity: warn\n  - condition: jumping onto the stove only\n`],
    ] as const) {
      activePrompt = withoutResting + contract;
      const patch: any = { action: "update", use_case: "pet_safety", prompt_text: activePrompt, detection_events: [...events], persist: true };
      const beforeCalls = methods.length;
      const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
      assert.equal(preview.ok, true, JSON.stringify(preview));
      const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(methods.slice(beforeCalls), ["PATCH", "GET"]);
      assert.equal(result.steps.schema, undefined);
      assert.deepEqual(deps.db.prepare("PRAGMA table_info(video_summary_tasks)").all(), columns);
      const { detection_events, ...entry } = deps.useCaseDict.pet_safety;
      assert.deepEqual(entry, original);
      assert.deepEqual(detection_events, [...events].sort());
      assert.equal(await readFile(join(dir, "evaluate_rules.py"), "utf8"), rule);
    }
    assert.equal(deps.db.prepare("SELECT event FROM video_summary_tasks").get().event, "trapped");
    const current = await readFile(join(dir, "prompt.md"), "utf8");
    const unchanged = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: current, detection_events: ["stove", "escape"] }, deps);
    assert.equal(unchanged.unchanged, true);
    const invalid = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: prompt, detection_events: [] }, deps);
    assert.equal(invalid.ok, false); assert.match(invalid.errors.join(), /last detection event/);
  });
});

test("successful PATCH with stale prompt readback rolls back instead of claiming event applied", async t => {
  await environment(async ({ deps, dir }) => {
    let patches = 0;
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (options?.method === "PATCH") { patches++; return new Response("{}"); }
      return new Response(JSON.stringify({ content: { text: buildPromptContent(prompt) } }));
    });
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: prompt.replace("resting", "stove") + "Detect approaching stove\n", detection_events: ["stove"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, false); assert.equal(patches, 2);
    assert.match(result.errors.join(), /readback does not match/);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), prompt);
  });
});

test("detection-event guard rejects missing field, state-only sets and stale declarations before VLM writes", async t => {
  await environment(async ({ deps }) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("{}"); });
    const changed = prompt.replace("resting", "escape");
    // prompt changed without declaring the final event set
    const missing = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: changed }, deps);
    assert.equal(missing.ok, false); assert.match(missing.errors.join(), /detection_events/);
    // final set containing only an info-severity baseline/uncertainty state
    const statePrompt = "## LOCAL_PROMPT\n- Event pet_safe\n  - Fixed severity: info\nSEVERITY: info\nEVENT: pet_safe\nDESC: visible\nCOUNT: 2\n";
    const stateOnly = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: statePrompt, detection_events: ["pet_safe"] }, deps);
    assert.equal(stateOnly.ok, false); assert.match(stateOnly.errors.join(), /not detection targets/);
    // non-empty declaration but the candidate prompt declares no event blocks at all
    const emptied = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: prompt.replace("- Event resting\n", ""), detection_events: ["resting"] }, deps);
    assert.equal(emptied.ok, false); assert.match(emptied.errors.join(), /event contract/);
    // declared event that the prompt no longer detects (stale name with a valid block elsewhere)
    const stale = await useCaseRegister({ action: "update", use_case: "pet_safety", dry_run: true, prompt_text: changed, detection_events: ["resting"] }, deps);
    assert.equal(stale.ok, false); assert.match(stale.errors.join(), /event contract/);
    assert.equal(calls, 0);
  });
});

test("detection-event guard allows mixed last-event removal with addition and skips baseline states", async t => {
  await environment(async ({ deps, dir }) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (options?.method === "PATCH") return new Response("{}");
      return new Response(JSON.stringify({ content: { text: buildPromptContent(activePrompt) } }));
    });
    // remove the only existing target (resting) while adding stove; pet_safe is an
    // info-severity state that stays in the prompt but outside detection_events.
    const activePrompt = "## LOCAL_PROMPT\n- Event stove\n  - Fixed severity: warn\n- Event pet_safe\n  - Fixed severity: info\nSEVERITY: warn\nEVENT: stove\nDESC: visible\nCOUNT: 2\n";
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: activePrompt, detection_events: ["stove"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(deps.useCaseDict.pet_safety.detection_events, ["stove"]);
    assert.equal(await readFile(join(dir, "prompt.md"), "utf8"), activePrompt);
  });
});

test("readback rejects stale residue, edited conditions, deleted-event examples and malformed sections", async t => {
  await environment(async ({ deps }) => {
    const { useCaseValidate } = await import("@smart-community-video/tools");
    const candidate = prompt.replaceAll("resting", "escape");
    const expected = buildPromptContent(candidate);
    const autofill = (text: string) => text.replace(/(LOCAL_PROMPT = '''[\s\S]*?COUNT: 2)(''')/, "$1\nUser prompt: {question}\n##Subtitles:\n{chunk_subtitle}\n$2");
    const cases: Array<[string, string, boolean]> = [
      ["exact string content", expected, true],
      ["autofilled scaffold lines", autofill(expected), true],
      ["stale event residue inside section", expected.replace(/(LOCAL_PROMPT = '''[\s\S]*?COUNT: 2)(''')/, "$1\nEVENT: resting\n$2"), false],
      ["condition line edited", expected.replace("DESC: visible", "DESC: altered evidence"), false],
      ["output example keeps deleted event", expected.replace("EVENT: escape", "EVENT: resting"), false],
      ["missing section", buildPromptContent(candidate).replace(/T_MINUS_1_PROMPT = '''[\s\S]*$/, ""), false],
      ["duplicated section anchor", buildPromptContent(candidate) + "LOCAL_PROMPT = '''x'''\n", false],
      ["unparseable content", "not a prompt at all", false],
    ];
    for (const [label, content, shouldPass] of cases) {
      t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ name: "custom_pet_task", source: "dynamic", content })), { times: 1 });
      const result = await useCaseValidate({ use_case: "pet_safety", expected_prompt_content: expected }, deps as any);
      assert.equal(result.valid, shouldPass, `${label}: ${result.error ?? "valid"}`);
    }
  });
});

test("missing local prompt reads string task content and completes an update", async t => {
  await environment(async ({ deps, dir }) => {
    await rm(join(dir, "prompt.md"));
    let content = buildPromptContent(prompt);
    let patches = 0;
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (options?.method === "PATCH") { patches++; content = JSON.parse(options.body).content.text; }
      return new Response(JSON.stringify({ content }));
    });
    const current = await useCaseRegister({ action: "get", use_case: "pet_safety" }, deps);
    assert.equal(current.ok, true, JSON.stringify(current));
    assert.equal(current.snapshot!.prompt_text, content);
    const patch: any = { action: "update", use_case: "pet_safety", prompt_text: prompt.replace("resting", "escape"), detection_events: ["escape"], persist: true };
    const preview = await useCaseRegister({ ...patch, dry_run: true }, deps);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const result = await useCaseRegister({ ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(patches, 1);
  });
});
