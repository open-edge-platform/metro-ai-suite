import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse, stringify } from "yaml";
import { SmartCommunityDB } from "@smart-community-video/db";
import { monitorCtl } from "@smart-community-video/tools";

async function environment(run: (env: any) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pipeline-update-"));
  const db = new SmartCommunityDB(join(dir, "test.db")); db.initialize();
  db.createMonitor({ id: "cam_pet", name: "Pets", sourceUrl: "rtsp://cam/pet", status: "online", useCase: "pet_safety", videoSummaryTask: "pet_task" });
  const path = join(dir, "monitors.yaml");
  const pipeline = { prefilter: { enabled: true, target_classes: ["cat", "dog"], min_confidence: 0.4 }, roi: { enabled: true, expand: 0.25 } };
  await writeFile(path, stringify({ monitors: { cam_pet: { enabled: true, source_url: "rtsp://cam/pet", use_case: "pet_safety", pipeline_config: pipeline }, cam_other: { enabled: false } } }));
  const worker = { workers: new Map([["cam_pet", {}]]), start() { throw new Error("worker must remain running"); }, async stop() { throw new Error("worker must remain running"); } };
  try { await run({ db, path, pipeline, worker }); } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
}

test("running pipeline threshold update previews, applies once and preserves unrelated configuration", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (_url.endsWith("/pipeline/validate")) return new Response(JSON.stringify({ valid: true }));
      if (options?.method === "PUT") { puts++; Object.assign(pipeline.prefilter, JSON.parse(options.body).pipeline.prefilter); return new Response("{}"); }
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: pipeline.prefilter.enabled ? "ready" : "disabled", error: null } }));
    });
    const patch: any = { action: "update_pipeline", monitor_id: "cam_pet", pipeline_config: { prefilter: { min_confidence: 0.65 } }, persist: true, monitors_path: path };
    const preview: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
    assert.equal(puts, 0); assert.equal(preview.diff.after.prefilter.min_confidence, 0.65);
    const result: any = await monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash });
    assert.equal(result.status, "updated"); assert.equal(puts, 1);
    const yaml = parse(await readFile(path, "utf8"));
    assert.deepEqual(yaml.monitors.cam_pet.pipeline_config.prefilter.target_classes, ["cat", "dog"]);
    assert.equal(yaml.monitors.cam_pet.pipeline_config.prefilter.min_confidence, 0.65);
    assert.deepEqual(yaml.monitors.cam_other, { enabled: false });
    const again: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
    await monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: again.revision, candidate_hash: again.candidate_hash });
    assert.equal(puts, 1);
  });
});

test("register_source upsert updates running pipeline instead of returning already_running", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      if (_url.endsWith("/pipeline/validate")) return new Response(JSON.stringify({ valid: true }));
      if (options?.method === "PUT") { puts++; Object.assign(pipeline.prefilter, JSON.parse(options.body).pipeline.prefilter); return new Response("{}"); }
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: pipeline.prefilter.enabled ? "ready" : "disabled", error: null } }));
    });
    const result: any = await monitorCtl(db, "http://analytics", worker, { action: "register_source", monitor_id: "cam_pet", source_url: "rtsp://cam/pet", video_summary_task: "pet_task", use_case: "pet_safety", webhook_url: "http://localhost/events", data_dir: "/tmp/segments", pipeline_config: { prefilter: { min_confidence: 0.65 } }, monitors_path: path, persist: true });
    assert.equal(result.status, "updated"); assert.equal(puts, 1);
  });
});

test("invalid confidence rejected before contacting or stopping analytics", async t => {
  await environment(async ({ db, worker }) => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
    await assert.rejects(monitorCtl(db, "http://analytics", worker, { action: "update_pipeline", monitor_id: "cam_pet", pipeline_config: { prefilter: { min_confidence: 65 } } }), /between 0 and 1/);
  });
});

for (const prefilter of [{ min_frames_hit: 0 }, { min_frames_hit: 1.5 }, { detect_fps: 0 }, { long_side: -1 }, { enabled: "false" }, { target_classes: [] }, { nms_iou: 0.5 }]) {
  test(`invalid prefilter delta rejected during preview: ${JSON.stringify(prefilter)}`, async t => {
    await environment(async ({ db, worker }) => {
      t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
      await assert.rejects(monitorCtl(db, "http://analytics", worker, { action: "update_pipeline", monitor_id: "cam_pet", dry_run: true, pipeline_config: { prefilter } }));
    });
  });
}

test("multiple parameters and explicit zero/false persist without changing other monitors", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (url: string, options: any) => {
      if (url.endsWith("/pipeline/validate")) return new Response('{"valid":true}');
      if (options?.method === "PUT") {
        puts++; const delta = JSON.parse(options.body).pipeline;
        Object.assign(pipeline.prefilter, delta.prefilter); Object.assign(pipeline.roi, delta.roi);
      }
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: pipeline.prefilter.enabled ? "ready" : "disabled", error: null } }));
    });
    const patch: any = { action: "update_pipeline", monitor_id: "cam_pet", persist: true, monitors_path: path,
      pipeline_config: { prefilter: { enabled: false, long_side: 0, min_frames_hit: 3, detect_fps: 4, min_confidence: 0, target_classes: ["cat"] }, roi: { enabled: false } } };
    const preview: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
    assert.equal(puts, 0);
    const result: any = await monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash });
    assert.equal(result.success, true); assert.equal(puts, 1);
    const saved = parse(await readFile(path, "utf8"));
    for (const [key, value] of Object.entries(patch.pipeline_config.prefilter)) assert.deepEqual(saved.monitors.cam_pet.pipeline_config.prefilter[key], value);
    assert.equal(saved.monitors.cam_pet.pipeline_config.roi.expand, .25);
    assert.deepEqual(saved.monitors.cam_other, { enabled: false });
  });
});

test("server-side prefilter rejection prevents preview and any runtime write", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    const methods: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, options: any) => {
      methods.push(options?.method ?? "GET");
      if (url.endsWith("/pipeline/validate")) return new Response("unknown class", { status: 422 });
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: pipeline.prefilter.enabled ? "ready" : "disabled", error: null } }));
    });
    await assert.rejects(monitorCtl(db, "http://analytics", worker, { action: "update_pipeline", monitor_id: "cam_pet", dry_run: true, pipeline_config: { prefilter: { target_classes: ["unknown"] } }, monitors_path: path }), /validation failed/);
    assert.deepEqual(methods, ["GET", "POST"]);
  });
});

for (const restoreFails of [false, true]) {
  test(`detector initialization failure keeps YAML unchanged; restore failure=${restoreFails}`, async t => {
    await environment(async ({ db, path, pipeline, worker }) => {
      const originalYaml = await readFile(path, "utf8");
      let puts = 0;
      t.mock.method(globalThis, "fetch", async (url: string, options: any) => {
        if (url.endsWith("/pipeline/validate")) return new Response('{"valid":true}');
        if (options?.method === "PUT") { puts++; Object.assign(pipeline.prefilter, JSON.parse(options.body).pipeline.prefilter); }
        const failed = puts === 1 || (restoreFails && puts === 2);
        return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: failed ? "failed" : "ready", error: failed ? "compile failed" : null } }));
      });
      const patch: any = { action: "update_pipeline", monitor_id: "cam_pet", pipeline_config: { prefilter: { min_confidence: .65 } }, persist: true, monitors_path: path };
      const preview: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
      const commit = () => monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash });
      if (restoreFails) {
        const result: any = await commit();
        assert.equal(result.success, false); assert.equal(result.degraded, true);
        assert.match(result.restore_error, /compile failed/);
      } else await assert.rejects(commit(), /compile failed/);
      assert.equal(puts, 2);
      assert.equal(await readFile(path, "utf8"), originalYaml);
      assert.equal(pipeline.prefilter.min_confidence, .4);
    });
  });
}

test("disabled prefilter stores numeric settings without requiring detector readiness", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    pipeline.prefilter.enabled = false;
    pipeline.roi.enabled = false;
    t.mock.method(globalThis, "fetch", async (url: string, options: any) => {
      if (url.endsWith("/pipeline/validate")) return new Response('{"valid":true}');
      if (options?.method === "PUT") Object.assign(pipeline.prefilter, JSON.parse(options.body).pipeline.prefilter);
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: "disabled", error: null } }));
    });
    const patch: any = { action: "update_pipeline", monitor_id: "cam_pet", pipeline_config: { prefilter: { detect_fps: 4 } }, persist: true, monitors_path: path };
    const preview: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
    const result: any = await monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash });
    assert.equal(result.success, true);
    assert.equal(pipeline.prefilter.enabled, false);
    assert.equal(parse(await readFile(path, "utf8")).monitors.cam_pet.pipeline_config.prefilter.detect_fps, 4);
  });
});

test("unchanged enabled configuration cannot claim success for a failed detector", async t => {
  await environment(async ({ db, path, pipeline, worker }) => {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (url: string, options: any) => {
      if (url.endsWith("/pipeline/validate")) return new Response('{"valid":true}');
      if (options?.method === "PUT") puts++;
      return new Response(JSON.stringify({ pipeline_config: pipeline, prefilter_status: { status: "failed", error: "compile failed" } }));
    });
    const patch: any = { action: "update_pipeline", monitor_id: "cam_pet", pipeline_config: { prefilter: { min_confidence: .4 } }, persist: true, monitors_path: path };
    const preview: any = await monitorCtl(db, "http://analytics", worker, { ...patch, dry_run: true });
    await assert.rejects(monitorCtl(db, "http://analytics", worker, { ...patch, expected_revision: preview.revision, candidate_hash: preview.candidate_hash }), /compile failed/);
    assert.equal(puts, 0);
  });
});
