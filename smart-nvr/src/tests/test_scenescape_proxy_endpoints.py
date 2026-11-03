# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0


def test_get_scenescape_scenes_proxy(client, monkeypatch):
    import api.router as router_module

    expected = [{"id": "scene-1", "name": "Intersection-Demo", "broker_id": "si1"}]
    captured = {"brokers": None}

    async def fake_get_brokers(_request):
        return [{"id": "si1"}]

    monkeypatch.setattr(
        router_module,
        "fetch_scenes_with_retry",
        lambda brokers=None: captured.__setitem__("brokers", brokers) or expected,
    )
    monkeypatch.setattr(router_module.redis_store, "get_brokers", fake_get_brokers)

    resp = client.get("/scenes")
    assert resp.status_code == 200
    assert resp.json() == expected
    assert captured["brokers"] == [{"id": "si1"}]


def test_get_scenescape_regions_proxy_passes_scene_id(client, monkeypatch):
    import api.router as router_module

    captured = {"scene_id": None, "broker_id": None, "brokers": None}

    async def fake_get_brokers(_request):
        return [{"id": "si1"}]

    def fake_fetch_regions_with_retry(scene_id=None, brokers=None, broker_id=None):
        captured["scene_id"] = scene_id
        captured["broker_id"] = broker_id
        captured["brokers"] = brokers
        return [
            {
                "region_id": "region-1",
                "region_name": "WCWLK",
                "scene_id": scene_id or "",
                "scene_name": "Intersection-Demo",
                "broker_id": broker_id or "si1",
            }
        ]

    monkeypatch.setattr(
        router_module,
        "fetch_regions_with_retry",
        fake_fetch_regions_with_retry,
    )
    monkeypatch.setattr(router_module.redis_store, "get_brokers", fake_get_brokers)

    resp = client.get("/regions", params={"scene_id": "scene-1", "broker_id": "si1"})
    assert resp.status_code == 200
    assert captured["scene_id"] == "scene-1"
    assert captured["broker_id"] == "si1"
    assert captured["brokers"] == [{"id": "si1"}]
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["region_id"] == "region-1"
