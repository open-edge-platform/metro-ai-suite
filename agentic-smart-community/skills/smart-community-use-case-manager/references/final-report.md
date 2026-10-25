# Final Report and System Inventory

Read this when composing the final response after a registration. The
mandatory `New Use Case` block is defined in `SKILL.md`; this file holds the
system-inventory rendering rules.

Report system inventory as ONE grouped view — use cases as headers, their
monitors nested underneath — not two flat lists:

- Fetch both sources: `smart_community_use_case_register action=list` (no other
  arguments; reads the server's live in-memory `use_case_dict`, one entry per
  use case with `video_summary_task`, `schema_fields`, `rule_path`,
  `report_source`) and `smart_community_monitor_ctl action=list`.
- Render every use case on one line with its VLM task and rule path; nest each
  monitor bound to it (ID, source URL, online/offline) below. A use case with
  no monitor gets `(no camera bound yet)` — that is expected right after a
  registration without a stream URL, not an error.

```text
System Inventory
  pet_safety     task: pet_safety_monitor   rules: evaluate_rules.py
    cam_pet_safety -> rtsp://...   (online)
  child_safety   task: child_safety_monitor rules: defaultRuleEvaluator
    cam_child_01 -> rtsp://...     (offline)
  fridge         task: fridge_monitor       rules: none
    (no camera bound yet)
```

- If one inventory source is unavailable, report the other and state the gap.
  If the MCP server itself is unavailable, state that the inventory cannot be
  fetched; there is no config-file fallback.

## Existing update report

Use “Use Case Updated” / “Monitor Updated” with changed fields/events/threshold,
affected cameras, validation, persistence and elapsed timings. Never claim a
measured speedup from interface call counts; record real timing samples. Surface
errors, partial application and recovery results. An unchanged result needs no
new confirmation or writes.

## Fast update result

Show added/removed/changed and retained detection events, affected monitors,
prefilter parameter changes if requested, persistence, applied steps, timings
and recovery/errors. Do not ask for schema or rule-path approval. Distinguish
structural validation from detection accuracy on representative footage.
Historical records remain; saved unbound preferences are not running changes.
