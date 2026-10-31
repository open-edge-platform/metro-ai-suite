# Fast detection event updates

Keep the existing mode, schema metadata, task name and monitor bindings. This
flow overrides creation questions and monitor gates for unchanged bindings.
This exception applies only to active targets and local edits, not new creation,
recreation after deletion, explicit full overwrite, mode/schema redesign,
source rebinds, ROI edits or full pipeline replacement. Those retain the release
flows in SKILL.md. Never treat a failed get or backup directory as permission to
create. Reuse the approved schema; do not ask users for column names, types or
required flags during incremental updates.

1. Read `smart_community_use_case_register action=get,use_case=<name>` once for
   the complete entry, prompt/rules, bound monitors and revision. State is under
   `snapshot.entry`, `snapshot.prompt_text`, `snapshot.evaluate_rules_content`
   and `snapshot.bound_monitors`; revision is top-level.
2. Resolve the requested additions, removals or local condition edits from the
   existing prompt. Preserve all unaffected events and evidence requirements.
   Maintain final `detection_events` identifiers internally (infer original
   targets from the prompt if absent; exclude baseline/uncertainty outputs).
   An absent removal target or identical request is unchanged; do not author or
   submit writes. Clarify ambiguous targets only. Never submit an empty target
   list: removing the last event needs clarification about disabling the use
   case, not implicit unregister. Evaluate mixed additions/removals together.
3. Read prompt/rule authoring references under this update exception. Modify
   the complete four-section prompt coherently. Event values are not columns.
   For removal delete its criteria, examples, output choices and dedicated rule
   branches; preserve shared rules. For condition edits change only the target
   event. Author prompt and necessary rules together in at most one generation.
   Reuse unchanged rules and schema; do not send schema_additions/extensions.
4. Preview `action=update,dry_run=true,expected_revision=<revision>` with the
   modified prompt_text, final detection_events and only necessary rule changes.
   The tool rejects any prompt change submitted without detection_events, empty
   sets, baseline/uncertainty states (info severity), and declarations that do
   not match the candidate prompt's event contract; derive the set from the
   complete candidate yourself, never from user answers.
   Show added/removed/changed events, retained detections, alert changes and
   affected cameras. Do not show schema/rule-path design questions. Ask for
   ONE explicit confirmation of this business difference. Reuse unchanged
   decisions; clarify only missing data.
5. Commit the exact patch with dry_run=false, expected_revision and candidate_hash
   from preview, persist=true. Do not regenerate after approval. Conflict means
   read/preview again. Never fall back to generate_task, register (including
   overwrite=true), unregister, camera rebinding or schema DDL.
6. Verify persistence and structural validation; representative footage verifies
   new/retained detections and removed events no longer firing after the update
   boundary. Historical summaries/alerts stay unchanged. Structural checks alone
   do not establish detection accuracy. Report updated/unchanged, event changes,
   applied steps, errors/degraded recovery and timings; not “New Use Case”.

A full four-section VLM PATCH is compatible with incremental configuration
semantics. Event-only changes never restart analytics or alter prefilter.

## Explicit prefilter updates

Read effective monitor status and identify the scope; clarify multiple cameras
only when unspecified. Extract every explicit supported field: enabled,
target_classes, min_confidence, min_frames_hit, detect_fps, device, model,
long_side. Normalize explicit 65% confidence to 0.65. Preserve false and zero.
No dedicated prompt/rule generation or VLM CRUD. Unsupported IoU/NMS fields
must not be silently mapped or ignored. Validate confidence in 0..1, min_frames_hit as integer >=1, detect_fps >0,
long_side as integer >=0, and enabled as boolean. Validate classes against the
selected model and device against server constraints. Select `model` from
`prefilter_options`; never pass `model_path` in a pipeline patch. Disabling
prefilter while ROI remains enabled is a dependency conflict: report it and
resolve the separate ROI change through the original monitor gates; never
silently change ROI.

Preview monitor_ctl action=update_pipeline,dry_run=true,monitor_id=<existing>,
pipeline_config={prefilter:{<explicit delta>}},persist=true. Unspecified values
are preserved. Show target and changed parameters, obtain one business difference
confirmation, then commit the same patch with expected_revision/candidate_hash.
Validation happens before stopping. Python briefly restarts only the affected
analysis pipeline; bindings remain. Identical values do not restart it.

Disabled prefilter may save numeric preferences without enabling detection;
state that they are inactive. Do not implicitly enable or alter ROI. No existing
monitor: report that this monitor update cannot proceed; new binding retains
the release gates, not implicit creation or saved binding preferences.
For mixed event/parameter requests show both changes in one confirmation,
commit separately and report each result; the operations are not atomic together.
