#!/usr/bin/env python3
"""Compare identical old/new event conversations from JSONL traces.

Required: scenario (add_event/remove_event/edit_event_condition), flow (old/new),
success, active_elapsed_ms (request-to-preview + approval-to-verified-result).
Successful new rows: confirmations, author_generations, vlm_writes, schema_ddl,
pipeline_restarts, registration_calls, monitor_rebinds. Record model/tool calls,
tokens and phase timings for diagnosis. Do not use mocked timings as real data.
"""
import argparse
import json
import math
import statistics
from pathlib import Path

SCENARIOS = ("add_event", "remove_event", "edit_event_condition")


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def evaluate(rows):
    reports = []
    for scenario in SCENARIOS:
        groups = {flow: [r for r in rows if r.get("scenario") == scenario and r.get("flow") == flow] for flow in ("old", "new")}
        samples = {flow: [r["active_elapsed_ms"] for r in group if r.get("success")] for flow, group in groups.items()}
        if any(len(values) < 20 for values in samples.values()):
            reports.append({"scenario": scenario, "passed": False, "error": "need >=20 successful samples per flow"})
            continue
        old, new = samples["old"], samples["new"]
        checks = [statistics.median(new) < statistics.median(old), percentile(new, .95) <= percentile(old, .95)]
        violations = []
        for row in groups["new"]:
            if not row.get("success"):
                continue
            valid = (row.get("confirmations") in (0, 1)
                     and row.get("author_generations", math.inf) <= 1
                     and row.get("vlm_writes", math.inf) <= 1
                     and all(row.get(key) == 0 for key in ("schema_ddl", "pipeline_restarts", "registration_calls", "monitor_rebinds")))
            checks.append(valid)
            if not valid:
                violations.append(row.get("request_id", "missing request_id"))
        rates = {flow: sum(bool(r.get("success")) for r in group) / len(group) for flow, group in groups.items()}
        checks.append(rates["new"] >= rates["old"])
        reports.append({"scenario": scenario, "passed": all(checks),
                        "p50_reduction": 1 - statistics.median(new) / statistics.median(old),
                        "p50_ms": {k: statistics.median(v) for k, v in samples.items()},
                        "p95_ms": {k: percentile(v, .95) for k, v in samples.items()},
                        "success_rates": rates, "failures": {k: [r for r in v if not r.get("success")] for k, v in groups.items()},
                        "call_constraint_violations": violations})
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("traces", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.traces.read_text().splitlines() if line.strip()]
    for row in rows:
        elapsed = row.get("active_elapsed_ms")
        if row.get("scenario") not in SCENARIOS or row.get("flow") not in ("old", "new") or not isinstance(row.get("success"), bool) or isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed <= 0:
            parser.error("each row requires a supported scenario/flow, boolean success and positive finite active_elapsed_ms")
    reports = evaluate(rows)
    for report in reports:
        print(json.dumps(report))
    return int(not all(r["passed"] for r in reports))


if __name__ == "__main__":
    raise SystemExit(main())
