"""End-to-end test of the FastAPI MCP lifespan wiring using a real stdio subprocess.

Unlike test_mcp_manager.py (which injects an in-memory transport_factory),
this spawns tests/fixtures/stdio_mcp_server.py as an actual subprocess via
the app's real startup path (AppConfig -> _lifespan -> MCPManager ->
MCPServerConnection -> stdio_client), confirming the whole wiring works
without any test seams.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

import canvas_chat.app as app_module
from canvas_chat.app import app
from canvas_chat.config import AppConfig, MCPServerConfig
from canvas_chat.tool_registry import ToolRegistry

_FIXTURE_SERVER = Path(__file__).parent / "fixtures" / "stdio_mcp_server.py"


def test_mcp_server_connects_over_real_stdio_subprocess(monkeypatch):
    ToolRegistry._tools.clear()
    ToolRegistry._instances.clear()

    config = AppConfig(
        models=[],
        plugins=[],
        mcp_servers=[
            MCPServerConfig(
                name="stdiotest",
                command=sys.executable,
                args=[str(_FIXTURE_SERVER)],
                connect_timeout_seconds=15,
            )
        ],
        admin_mode=False,
    )
    monkeypatch.setattr(app_module, "get_admin_config", lambda: config)

    with TestClient(app) as client:
        tools_response = client.get("/api/tools")
        assert tools_response.status_code == 200
        tool_ids = {t["id"] for t in tools_response.json()}
        assert "mcp__stdiotest__ping" in tool_ids

        status_response = client.get("/api/mcp/status")
        assert status_response.status_code == 200
        status = status_response.json()
        assert len(status) == 1
        assert status[0]["name"] == "stdiotest"
        assert status[0]["connected"] is True
        assert status[0]["tool_count"] == 1

    # After the TestClient context exits, the lifespan shutdown ran and
    # disconnected the server — tools should be unregistered.
    remaining_ids = {t["id"] for t in ToolRegistry.list_tools_info()}
    assert "mcp__stdiotest__ping" not in remaining_ids
