"""Tests for GET /api/mcp/status."""

from fastapi.testclient import TestClient

import canvas_chat.mcp_client as mcp_client_module
from canvas_chat.app import app


def test_mcp_status_empty_when_no_manager(monkeypatch):
    monkeypatch.setattr(mcp_client_module, "_manager", None)

    client = TestClient(app)
    response = client.get("/api/mcp/status")

    assert response.status_code == 200
    assert response.json() == []


def test_mcp_status_reports_manager_status(monkeypatch):
    class _FakeManager:
        def get_status(self):
            return [
                {
                    "name": "testsrv",
                    "transport": "stdio",
                    "connected": True,
                    "tool_count": 2,
                    "error": None,
                }
            ]

    monkeypatch.setattr(mcp_client_module, "_manager", _FakeManager())

    client = TestClient(app)
    response = client.get("/api/mcp/status")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "testsrv"
    assert data[0]["connected"] is True
    # never expose secrets/config in the status payload
    assert "command" not in data[0]
    assert "headers" not in data[0]
    assert "url" not in data[0]
