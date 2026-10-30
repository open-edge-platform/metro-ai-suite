# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Tests for endpoints returning rule summary and search responses."""
import pytest
import json
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_rule_summaries_endpoint(client):
    async def fake_get_rules(request):
        return [{"id": "r1", "action": "summarize", "camera": "cam"}]
    async def fake_get_summary_ids(request, rule_id):
        return ["s1", "s2"]
    with patch("api.router.get_rules", fake_get_rules), \
         patch("api.router.get_summary_ids", fake_get_summary_ids), \
         patch("api.router.vms_service.summary", return_value={"status": "completed"}):
        resp = client.get("/rules/responses/")
        assert resp.status_code == 200
        data = resp.json()
        assert "r1" in data
        assert len(data["r1"]) == 2

@pytest.mark.asyncio
async def test_rule_search_responses_endpoint(client):
    async def fake_get_rules(request):
        return [{"id": "r2", "action": "add to search", "camera": "cam"}]
    async def fake_get_search_results(rule_id, request=None):
        return [{"video_id": "v1", "message": "done"}]
    with patch("api.router.get_rules", fake_get_rules), \
         patch("api.router.get_search_results_by_rule", fake_get_search_results):
        resp = client.get("/rules/search-responses/")
        assert resp.status_code == 200
        data = resp.json()
        assert "r2" in data
        assert data["r2"][0]["video_id"] == "v1"


@pytest.mark.asyncio
async def test_rule_search_responses_falls_back_to_rule_responses(client):
    async def fake_get_rules(request):
        return [{"id": "r3", "action": "add to search", "camera": "cam"}]

    async def fake_get_search_results(rule_id, request=None):
        return []

    async def fake_get_responses(request, rule_id):
        return [json.dumps({"status": 200, "video_id": "vid-123", "message": "Pending"})]

    with patch("api.router.get_rules", fake_get_rules), \
         patch("api.router.get_search_results_by_rule", fake_get_search_results), \
         patch("api.router.get_responses", fake_get_responses):
        resp = client.get("/rules/search-responses/")
        assert resp.status_code == 200
        data = resp.json()
        assert "r3" in data
        assert data["r3"][0]["video_id"] == "vid-123"
        assert data["r3"][0]["message"] == "Pending"
