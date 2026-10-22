# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Any, Dict, List, Optional
import logging
import time

import requests
from config import (
    SCENESCAPE_API_AUTH_PATH,
    SCENESCAPE_API_TIMEOUT_SEC,
    SCENESCAPE_API_RETRY_COUNT,
    SCENESCAPE_API_RETRY_DELAY_SEC,
)

logger = logging.getLogger(__name__)

_scenescape_tokens: dict[str, str] = {}


def _token_cache_key(target: Dict[str, Any]) -> str:
    return f"{target.get('base_url', '')}|{target.get('user', '')}"


def _new_direct_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    return session


def _scenescape_login(session: requests.Session, target: Dict[str, Any]) -> Optional[str]:
    user = target.get("user")
    password = target.get("password")
    if not user or not password:
        logger.warning(
            "SceneScape credentials are not configured for broker %s; trying unauthenticated API access.",
            target.get("broker_id", "unknown"),
        )
        return None

    auth_url = f"{str(target.get('base_url', '')).rstrip('/')}{SCENESCAPE_API_AUTH_PATH}"
    response = session.post(
        auth_url,
        json={"username": user, "password": password},
        timeout=SCENESCAPE_API_TIMEOUT_SEC,
        verify=False,
    )
    response.raise_for_status()

    data = response.json() if response.content else {}
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise ValueError("SceneScape auth succeeded but no token was returned")
    return token


def _scenescape_api_get(path: str, params: Optional[Dict] = None, target: Optional[Dict[str, Any]] = None) -> Dict:
    if not target:
        raise ValueError("SceneScape target is required")

    url = f"{str(target.get('base_url', '')).rstrip('/')}{path}"
    session = _new_direct_session()
    token_key = _token_cache_key(target)
    token = _scenescape_tokens.get(token_key)

    headers = {}
    if token:
        headers["Authorization"] = f"Token {token}"

    response = session.get(
        url,
        params=params,
        timeout=SCENESCAPE_API_TIMEOUT_SEC,
        verify=False,
        headers=headers,
    )

    if response.status_code == 401:
        try:
            token = _scenescape_login(session, target)
            if token:
                _scenescape_tokens[token_key] = token
            else:
                _scenescape_tokens.pop(token_key, None)
        except Exception as auth_err:
            logger.warning("SceneScape auth failed for broker %s: %s", target.get("broker_id"), auth_err)
            response.raise_for_status()

        retry_headers = {}
        if token:
            retry_headers["Authorization"] = f"Token {token}"
        response = session.get(
            url,
            params=params,
            timeout=SCENESCAPE_API_TIMEOUT_SEC,
            verify=False,
            headers=retry_headers,
        )

    response.raise_for_status()
    return response.json()


def _fetch_scenescape_scenes_once(target: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
    data = _scenescape_api_get("/api/v1/scenes", target=target)
    rows = data.get("results", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    scenes = []
    if isinstance(rows, list):
        for scene in rows:
            if not isinstance(scene, dict):
                continue
            scene_id = scene.get("uid") or scene.get("id") or scene.get("pk")
            scene_name = scene.get("name") or scene_id
            if scene_id:
                scenes.append(
                    {
                        "id": str(scene_id),
                        "name": str(scene_name),
                        "broker_id": str(target.get("broker_id") or ""),
                    }
                )
    return scenes


def _fetch_scenescape_regions_once(
    scene_id: Optional[str] = None, target: Optional[Dict[str, Any]] = None
) -> List[Dict[str, str]]:
    data = _scenescape_api_get("/api/v1/regions", target=target)
    rows = data.get("results", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    regions = []
    if isinstance(rows, list):
        for region in rows:
            if not isinstance(region, dict):
                continue

            region_id = region.get("uuid") or region.get("uid") or region.get("id")
            region_name = region.get("name") or region.get("title") or region_id

            scene_ref = region.get("scene")
            if isinstance(scene_ref, dict):
                reg_scene_id = (
                    scene_ref.get("uid") or scene_ref.get("id") or scene_ref.get("pk")
                )
                reg_scene_name = scene_ref.get("name") or reg_scene_id
            else:
                reg_scene_id = scene_ref
                reg_scene_name = region.get("scene_name") or reg_scene_id

            if not region_id:
                continue

            if scene_id and str(reg_scene_id) != str(scene_id):
                continue

            regions.append(
                {
                    "region_id": str(region_id),
                    "region_name": str(region_name),
                    "scene_id": str(reg_scene_id) if reg_scene_id else "",
                    "scene_name": str(reg_scene_name) if reg_scene_name else "",
                    "broker_id": str(target.get("broker_id") or ""),
                }
            )

    return regions


def _retry_scenescape_fetch(fetch_fn):
    for attempt in range(SCENESCAPE_API_RETRY_COUNT):
        try:
            rows = fetch_fn()
            if rows:
                return rows
        except Exception as err:
            logger.warning("SceneScape fetch attempt %s failed: %s", attempt + 1, err)

        if attempt < SCENESCAPE_API_RETRY_COUNT - 1:
            time.sleep(SCENESCAPE_API_RETRY_DELAY_SEC)
    return []


def _build_target_from_broker(broker: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not broker.get("enabled", True):
        return None
    if broker.get("type", "scenescape") != "scenescape":
        return None

    host = str(broker.get("host") or "").strip()
    if not host:
        return None

    return {
        "broker_id": broker.get("id"),
        "base_url": f"https://{host}",
        "user": broker.get("scenescape_api_user"),
        "password": broker.get("scenescape_api_password"),
    }


def _resolve_scenescape_targets(brokers: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    if not brokers:
        return []

    targets: List[Dict[str, Any]] = []
    dedupe_keys = set()
    for broker in brokers:
        target = _build_target_from_broker(broker)
        if not target:
            continue
        dedupe_key = (
            target.get("broker_id"),
            target["base_url"],
            target.get("user"),
            target.get("password"),
        )
        if dedupe_key in dedupe_keys:
            continue
        dedupe_keys.add(dedupe_key)
        targets.append(target)
    return targets


def _dedupe_rows(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    output = []
    for row in rows:
        key = tuple(sorted(row.items()))
        if key in seen:
            continue
        seen.add(key)
        output.append(row)
    return output


def fetch_scenes_with_retry(brokers: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, str]]:
    targets = _resolve_scenescape_targets(brokers)
    aggregated: List[Dict[str, str]] = []
    for target in targets:
        rows = _retry_scenescape_fetch(
            lambda target_cfg=target: _fetch_scenescape_scenes_once(target=target_cfg)
        )
        aggregated.extend(rows)
    return _dedupe_rows(aggregated)


def fetch_regions_with_retry(
    scene_id: Optional[str] = None,
    brokers: Optional[List[Dict[str, Any]]] = None,
    broker_id: Optional[str] = None,
) -> List[Dict[str, str]]:
    targets = _resolve_scenescape_targets(brokers)
    if broker_id:
        targets = [t for t in targets if str(t.get("broker_id")) == str(broker_id)]
    aggregated: List[Dict[str, str]] = []
    for target in targets:
        rows = _retry_scenescape_fetch(
            lambda target_cfg=target: _fetch_scenescape_regions_once(
                scene_id=scene_id, target=target_cfg
            )
        )
        aggregated.extend(rows)
    return _dedupe_rows(aggregated)
