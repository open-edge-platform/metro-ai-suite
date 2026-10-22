"""Verify acceptance checks; synthetic data is never a measured speed report."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("update_performance", Path(__file__).resolve().parents[3] / "scripts/helpers/check_update_performance.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def traces():
    return [dict(scenario=scenario, flow=flow, success=True, active_elapsed_ms=elapsed,
                 confirmations=1, author_generations=1, vlm_writes=1, schema_ddl=0,
                 pipeline_restarts=0, registration_calls=0, monitor_rebinds=0)
            for scenario in module.SCENARIOS for flow, elapsed in (("old", 100), ("new", 70)) for _ in range(20)]


def test_speed_improvement_and_call_constraints():
    rows = traces()
    assert all(report["passed"] for report in module.evaluate(rows))
    rows[-1]["registration_calls"] = 1
    assert not module.evaluate(rows)[-1]["passed"]


def test_no_improvement_and_missing_metrics_fail():
    rows = traces()
    for row in rows:
        row["active_elapsed_ms"] = 100
    assert not any(report["passed"] for report in module.evaluate(rows))
    rows = traces()
    del rows[-1]["schema_ddl"]
    assert not module.evaluate(rows)[-1]["passed"]


def test_missing_samples_and_failure_rate_regression_fail():
    assert not any(report["passed"] for report in module.evaluate([]))
    rows = traces()
    rows.append(dict(scenario="add_event", flow="new", success=False, active_elapsed_ms=120))
    report = module.evaluate(rows)[0]
    assert not report["passed"]
    assert len(report["failures"]["new"]) == 1
