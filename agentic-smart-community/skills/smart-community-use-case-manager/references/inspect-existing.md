# Inspect an existing use case

Use action=get for the complete live entry, prompt/rules, internal schema,
bindings and revision. Do not reconstruct from list summaries or local client
files. For event additions/removals/condition edits read update-use-case.md:
get → draft → dry_run → one business difference approval → update → verify.
Preserve unspecified configuration, task, schema metadata and monitor bindings.
Never unregister/re-register or use overwrite=true for simple event updates.
Missing originals must be reported instead of guessed. Schema is internal.
