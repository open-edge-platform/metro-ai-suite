# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Friendly startup errors for invalid config.yaml / missing environment values."""

import pytest

from plugin.core import config as config_module
from plugin.core.config import load_config

_YAML = """
analytics_apps:
  - type: object_detection
    app_id: dls_vision
    base_url: "https://${DLS_HOST:-localhost}"
    pipeline:
      cpu: ${DLS_PIPELINE_CPU:-}
      gpu: ${DLS_PIPELINE_GPU:-}
  - type: live_captioning
    base_url: "http://${LVC_HOST:-lvc}:4173"
    mediamtx_url: "http://${MEDIAMTX_HOST:-mtx}:8889"
"""


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    path = tmp_path / "config.yaml"
    path.write_text(_YAML)
    monkeypatch.setattr(config_module, "_reported_config_error", None)
    # load_config() reads ./.env; run from an empty dir so a developer's real .env can't leak in.
    monkeypatch.chdir(tmp_path)
    for name in ("DLS_PIPELINE_CPU", "DLS_PIPELINE_GPU"):
        monkeypatch.delenv(name, raising=False)
    return path


def test_missing_pipeline_env_exits_with_friendly_message(config_file, capsys):
    with pytest.raises(SystemExit) as exc:
        load_config(config_file)

    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "invalid configuration" in err
    assert "at least one configured pipeline" in err
    assert "Value error" not in err
    assert "DLS_PIPELINE_CPU, DLS_PIPELINE_GPU" in err
    assert ".env" in err and "force-recreate" in err
    # Variables from unrelated sections are not blamed
    assert "LVC_HOST" not in err and "DLS_HOST" not in err


def test_empty_string_env_is_reported(config_file, monkeypatch, capsys):
    monkeypatch.setenv("DLS_PIPELINE_CPU", "")
    with pytest.raises(SystemExit):
        load_config(config_file)
    assert "DLS_PIPELINE_CPU" in capsys.readouterr().err


def test_error_is_printed_once_per_process(config_file, capsys):
    for _ in range(3):
        with pytest.raises(SystemExit):
            load_config(config_file)
    assert capsys.readouterr().err.count("invalid configuration") == 1


def test_valid_config_loads_when_env_set(config_file, monkeypatch):
    monkeypatch.setenv("DLS_PIPELINE_CPU", "object_tracking_cpu")
    cfg = load_config(config_file)
    assert cfg.analytics_apps[0].pipeline == {"CPU": "object_tracking_cpu"}


def test_invalid_config_raises_dedicated_exit(config_file):
    from plugin.core.config import InvalidConfigError

    with pytest.raises(InvalidConfigError) as exc:
        load_config(config_file)
    assert exc.value.code == 1
    assert exc.value.__cause__ is None and exc.value.__suppress_context__


def test_create_app_fails_fast_on_invalid_config(config_file, monkeypatch, capsys):
    from plugin.core import main as main_module
    from plugin.core.config import InvalidConfigError

    monkeypatch.setenv("VMS_PLUGIN_CONFIG_PATH", str(config_file))
    with pytest.raises(InvalidConfigError):
        main_module.create_app()
    assert "invalid configuration" in capsys.readouterr().err


def test_create_app_still_tolerates_missing_config_file(tmp_path, monkeypatch):
    from plugin.core import main as main_module

    monkeypatch.setenv("VMS_PLUGIN_CONFIG_PATH", str(tmp_path / "absent.yaml"))
    assert main_module.create_app() is not None
