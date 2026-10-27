// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = join(repoRoot, "skills", "smart-community-use-case-manager");

async function readSkillFile(relativePath: string): Promise<string> {
  return readFile(join(skillDir, relativePath), "utf-8");
}

function outputKeys(text: string): string[] {
  return [...text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((match) => match[1]);
}

test("main Skill stays slim and links every conditional reference", async () => {
  const skill = await readSkillFile("SKILL.md");
  assert.match(skill, /^---\n[\s\S]*?name: smart-community-use-case-manager[\s\S]*?\n---\n/);
  assert.ok(skill.split("\n").length <= 600, "SKILL.md should remain decision-oriented");

  for (const relativePath of [
    "references/prompt-authoring.md",
    "references/evaluate-rules.md",
    "references/inspect-existing.md",
    "references/delete-use-case.md",
    "references/final-report.md",
    "references/curl-fallback.md",
  ]) {
    assert.match(skill, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await access(join(skillDir, relativePath));
  }
});

test("schema stays internal and business approval preserves mode invariants", async () => {
  const skill = await readSkillFile("SKILL.md");
  assert.match(skill, /Report-only \| none \| factual narrative; multiple findings allowed \| none/);
  assert.match(skill, /Base alerting \| `severity, event, desc` \| one primary EVENT \| `defaultRuleEvaluator`/);
  assert.match(skill, /base \+ internally derived extensions/);
  assert.match(skill, /Any extended schema \*\*must\*\* have `evaluate_rules\.py`/);
  assert.match(skill, /Never ask Q2, field names\/types\/required flags or user schema approval/);
  assert.match(skill, /existing event changes must use[\s\S]*?get\/update, never full registration/);
  assert.match(skill, /explicit final approval after the proposed design was displayed/);
});

test("authoring reference keeps output modes and final approval aligned", async () => {
  const authoring = await readSkillFile("references/prompt-authoring.md");
  const structuredStart = authoring.indexOf("## Structured alerting template");
  const reportOnlyStart = authoring.indexOf("## Report-only LOCAL variant");
  const lintStart = authoring.indexOf("## Semantic lint");
  assert.ok(structuredStart >= 0 && reportOnlyStart > structuredStart && lintStart > reportOnlyStart);

  const structuredTemplate = authoring.slice(structuredStart, reportOnlyStart);
  assert.deepEqual(outputKeys(structuredTemplate), ["SEVERITY", "EVENT", "DESC"]);

  const reportOnly = authoring.slice(reportOnlyStart, lintStart);
  assert.deepEqual(outputKeys(reportOnly), []);
  assert.match(reportOnly, /multiple simultaneous visible findings/);
  assert.match(authoring, /Realtime clip, default `SIMPLE`, `levels=1` \| `LOCAL_PROMPT` only/);
  assert.match(authoring, /The registration consistency gate proves structural alignment only/);
  assert.match(authoring, /wait for the mandatory final approval described in `SKILL\.md`/);
  assert.match(authoring, /`resolved` means derived for the proposal; `approved` means/);
  assert.doesNotMatch(authoring, /Do not request\s+a separate user confirmation/);
  assert.doesNotMatch(authoring, /never requires another\s+approval turn/i);
});

test("existing modifications use one difference confirmation and preserve creation gates", async () => {
  const skill = await readSkillFile("SKILL.md");
  const update = await readSkillFile("references/update-use-case.md");
  assert.match(skill, /This flow takes precedence over new-case Q1\/Q2/);
  assert.match(update, /ONE explicit confirmation/);
  assert.match(update, /expected_revision and candidate_hash/);
  assert.match(update, /No dedicated prompt\/rule generation or VLM CRUD/);
});
