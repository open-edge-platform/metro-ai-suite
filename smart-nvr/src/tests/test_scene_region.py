# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests

from service import scene_region as sr


class DummyResponse:
    def __init__(self, status_code=200, json_data=None, content=b"1"):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}
        self.content = content

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class DummySession:
    def __init__(self, get_responses=None, post_response=None):
        self.get_responses = list(get_responses or [])
        self.post_response = post_response or DummyResponse()
        self.get_calls = []
        self.post_calls = []

    def get(self, url, params=None, timeout=None, verify=None, headers=None):
        self.get_calls.append(
            {
                "url": url,
                "params": params,
                "timeout": timeout,
                "verify": verify,
                "headers": headers or {},
            }
        )
        return self.get_responses.pop(0)

    def post(self, url, json=None, timeout=None, verify=None):
        self.post_calls.append(
            {
                "url": url,
                "json": json,
                "timeout": timeout,
                "verify": verify,
            }
        )
        return self.post_response


def _target(**overrides):
    target = {
        "broker_id": "si1",
        "base_url": "https://10.0.0.1",
        "user": "user",
        "password": "pass",
    }
    target.update(overrides)
    return target


def test_new_direct_session_disables_env_proxy():
    session = sr._new_direct_session()
    assert session.trust_env is False


def test_scenescape_login_without_credentials_returns_none():
    token = sr._scenescape_login(DummySession(), _target(user="", password=""))
    assert token is None


def test_scenescape_login_success_returns_token():
    session = DummySession(post_response=DummyResponse(json_data={"token": "abc123"}))
    token = sr._scenescape_login(session, _target(base_url="https://scene"))

    assert token == "abc123"
    assert session.post_calls[0]["url"] == "https://scene/api/v1/auth"
    assert session.post_calls[0]["verify"] is False


def test_scenescape_api_get_uses_existing_token_header(monkeypatch):
    session = DummySession(get_responses=[DummyResponse(json_data={"ok": True})])
    monkeypatch.setattr(sr, "_new_direct_session", lambda: session)
    sr._scenescape_tokens = {"https://scene|user": "cached-token"}

    data = sr._scenescape_api_get(
        "/api/v1/scenes", params={"k": "v"}, target=_target(base_url="https://scene")
    )

    assert data == {"ok": True}
    assert session.get_calls[0]["headers"]["Authorization"] == "Token cached-token"
    assert session.get_calls[0]["verify"] is False


def test_scenescape_api_get_retries_after_401_and_login(monkeypatch):
    session = DummySession(
        get_responses=[
            DummyResponse(status_code=401, json_data={"detail": "unauthorized"}),
            DummyResponse(status_code=200, json_data={"results": []}),
        ]
    )
    monkeypatch.setattr(sr, "_new_direct_session", lambda: session)
    monkeypatch.setattr(sr, "_scenescape_login", lambda _session, _target: "fresh-token")
    sr._scenescape_tokens = {}

    data = sr._scenescape_api_get("/api/v1/regions", target=_target(base_url="https://scene"))

    assert data == {"results": []}
    assert len(session.get_calls) == 2
    assert session.get_calls[1]["headers"]["Authorization"] == "Token fresh-token"
    assert sr._scenescape_tokens["https://scene|user"] == "fresh-token"


def test_scenescape_api_get_401_retry_without_token_header(monkeypatch):
    session = DummySession(
        get_responses=[
            DummyResponse(status_code=401, json_data={"detail": "unauthorized"}),
            DummyResponse(status_code=200, json_data={"ok": True}),
        ]
    )
    monkeypatch.setattr(sr, "_new_direct_session", lambda: session)
    monkeypatch.setattr(sr, "_scenescape_login", lambda _session, _target: None)
    sr._scenescape_tokens = {}

    data = sr._scenescape_api_get("/api/v1/scenes", target=_target(base_url="https://scene"))

    assert data == {"ok": True}
    assert session.get_calls[1]["headers"] == {}


def test_fetch_scenescape_scenes_once_parses_results(monkeypatch):
    monkeypatch.setattr(
        sr,
        "_scenescape_api_get",
        lambda _path, params=None, target=None: {
            "results": [
                {"uid": "scene-1", "name": "Main"},
                {"id": "scene-2"},
                {"name": "no-id"},
                "invalid",
            ]
        },
    )

    scenes = sr._fetch_scenescape_scenes_once(target=_target())

    assert scenes == [
        {"id": "scene-1", "name": "Main", "broker_id": "si1"},
        {"id": "scene-2", "name": "scene-2", "broker_id": "si1"},
    ]


def test_fetch_scenescape_regions_once_parses_and_filters(monkeypatch):
    monkeypatch.setattr(
        sr,
        "_scenescape_api_get",
        lambda _path, params=None, target=None: {
            "results": [
                "invalid",
                {
                    "uuid": "r1",
                    "name": "Crosswalk",
                    "scene": {"uid": "s1", "name": "Scene One"},
                },
                {
                    "id": "r2",
                    "title": "Road",
                    "scene": "s2",
                    "scene_name": "Scene Two",
                },
            ]
        },
    )

    all_regions = sr._fetch_scenescape_regions_once(target=_target())
    only_s1 = sr._fetch_scenescape_regions_once(scene_id="s1", target=_target())

    assert len(all_regions) == 2
    assert all_regions[0]["region_id"] == "r1"
    assert all_regions[1]["scene_id"] == "s2"
    assert only_s1 == [
        {
            "region_id": "r1",
            "region_name": "Crosswalk",
            "scene_id": "s1",
            "scene_name": "Scene One",
            "broker_id": "si1",
        }
    ]


def test_retry_fetch_retries_and_sleeps(monkeypatch):
    monkeypatch.setattr(sr, "SCENESCAPE_API_RETRY_COUNT", 3)
    monkeypatch.setattr(sr, "SCENESCAPE_API_RETRY_DELAY_SEC", 0)

    sleep_calls = []
    monkeypatch.setattr(sr.time, "sleep", lambda seconds: sleep_calls.append(seconds))

    state = {"count": 0}

    def flaky_fetch():
        state["count"] += 1
        if state["count"] == 1:
            raise RuntimeError("temporary")
        return [{"ok": True}]

    rows = sr._retry_scenescape_fetch(flaky_fetch)

    assert rows == [{"ok": True}]
    assert sleep_calls == [0]


def test_resolve_targets_builds_from_brokers_without_fallback():
    brokers = [
        {
            "id": "si1",
            "enabled": True,
            "type": "scenescape",
            "host": "10.0.0.1",
            "scenescape_api_user": "u1",
            "scenescape_api_password": "p1",
        },
        {
            "id": "si2",
            "enabled": True,
            "type": "scenescape",
            "host": "10.0.0.2",
            "scenescape_api_user": "u2",
            "scenescape_api_password": "p2",
        },
    ]

    targets = sr._resolve_scenescape_targets(brokers)

    assert targets == [
        {
            "broker_id": "si1",
            "base_url": "https://10.0.0.1",
            "user": "u1",
            "password": "p1",
        },
        {
            "broker_id": "si2",
            "base_url": "https://10.0.0.2",
            "user": "u2",
            "password": "p2",
        },
    ]


def test_resolve_targets_returns_empty_without_brokers():
    assert sr._resolve_scenescape_targets(None) == []
    assert sr._resolve_scenescape_targets([]) == []


def test_public_retry_wrappers_delegate_correctly(monkeypatch):
    monkeypatch.setattr(
        sr,
        "_resolve_scenescape_targets",
        lambda brokers=None: [{"base_url": "x", "broker_id": "si1"}],
    )
    monkeypatch.setattr(
        sr,
        "_fetch_scenescape_scenes_once",
        lambda target=None: [{"id": target["base_url"], "broker_id": target.get("broker_id")}],
    )

    captured = {}

    def fake_fetch_regions(scene_id=None, target=None):
        captured["scene_id"] = scene_id
        return [{"region_id": target["base_url"], "broker_id": target.get("broker_id")}]

    monkeypatch.setattr(sr, "_fetch_scenescape_regions_once", fake_fetch_regions)
    monkeypatch.setattr(sr, "_retry_scenescape_fetch", lambda fetch_fn: fetch_fn())

    scenes = sr.fetch_scenes_with_retry(brokers=[{"id": "si1"}])
    regions = sr.fetch_regions_with_retry(scene_id="s-1", brokers=[{"id": "si1"}], broker_id="si1")

    assert scenes == [{"id": "x", "broker_id": "si1"}]
    assert regions == [{"region_id": "x", "broker_id": "si1"}]
    assert captured["scene_id"] == "s-1"
