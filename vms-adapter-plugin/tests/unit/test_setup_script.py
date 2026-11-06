# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""setup.sh generates a valid config.yaml from the selected shim fragments."""

import subprocess
from pathlib import Path

import pytest

from plugin.core import config as config_module
from plugin.core.config import load_config

ROOT = Path(__file__).resolve().parents[2]
SETUP = ROOT / "setup.sh"

_ENV = {
    "NX_HOST": "nx", "NX_USERNAME": "admin", "NX_PASSWORD": "pw",
    "AIB_HOST": "aib", "AIB_APP_HOSTNAME": "vap",
    "DLS_PIPELINE_CPU": "loiter_detect_roi_cpu",
}


def _run(*args):
    return subprocess.run(["bash", str(SETUP), *args], capture_output=True, text=True, check=False)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "_reported_config_error", None)
    monkeypatch.chdir(tmp_path)
    for name, value in _ENV.items():
        monkeypatch.setenv(name, value)


@pytest.mark.parametrize(
    ("vms", "apps", "vendors", "app_types"),
    [
        ("nx", "ld", ["nx_witness"], ["object_detection"]),
        ("milestone", "lvc", ["milestone"], ["live_captioning"]),
        ("nx,milestone", "ld,lvc", ["nx_witness", "milestone"], ["object_detection", "live_captioning"]),
        ("nxwitness,nx", "object_detection, ld", ["nx_witness"], ["object_detection"]),
    ],
)
def test_generated_config_loads(env, tmp_path, vms, apps, vendors, app_types):
    out = tmp_path / "config.yaml"
    result = _run("--vms", vms, "--apps", apps, "--output", str(out))
    assert result.returncode == 0, result.stderr

    config = load_config(out)
    assert [v.vendor for v in config.vms_instances] == vendors
    assert [a.type for a in config.analytics_apps] == app_types
    assert config.api.port == 8080


def test_lvc_broker_comes_from_mqtt_broker_env(env, tmp_path, monkeypatch):
    monkeypatch.setenv("MQTT_BROKER_HOST", "lvc-broker")
    monkeypatch.setenv("MQTT_BROKER_PORT", "8883")
    monkeypatch.setenv("MQTT_HOST", "ld-broker")
    out = tmp_path / "config.yaml"
    assert _run("--vms", "nx", "--apps", "ld,lvc", "--output", str(out)).returncode == 0

    ld, lvc = load_config(out).analytics_apps
    assert (lvc.mqtt_host, lvc.mqtt_port) == ("lvc-broker", 8883)
    assert ld.mqtt_host == "ld-broker"


@pytest.mark.parametrize("args", [["--apps", "ld"], ["--vms", "nx"], []])
def test_vms_and_apps_are_required(tmp_path, args):
    result = _run(*args, "--output", str(tmp_path / "config.yaml"))
    assert result.returncode != 0
    assert "both --vms and --apps are required" in result.stderr
    assert not (tmp_path / "config.yaml").exists()


@pytest.mark.parametrize("vms", ["frigate", "genetec", "../vms_shim/nxwitness", "nx;id"])
def test_unknown_vms_is_rejected(tmp_path, vms):
    result = _run("--vms", vms, "--apps", "ld", "--output", str(tmp_path / "config.yaml"))
    assert result.returncode != 0
    assert "unknown VMS" in result.stderr


def test_hand_edited_config_needs_force(tmp_path):
    out = tmp_path / "config.yaml"
    out.write_text("vms_instances: []\n")

    result = _run("--vms", "nx", "--apps", "ld", "--output", str(out))
    assert result.returncode != 0
    assert out.read_text() == "vms_instances: []\n"

    result = _run("--vms", "nx", "--apps", "ld", "--output", str(out), "--force")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "config.yaml.bak").read_text() == "vms_instances: []\n"

    # A generated file is replaced without --force.
    result = _run("--vms", "milestone", "--apps", "ld", "--output", str(out))
    assert result.returncode == 0, result.stderr
    assert "vendor: milestone" in out.read_text()
    assert "vendor: nx_witness" not in out.read_text()
