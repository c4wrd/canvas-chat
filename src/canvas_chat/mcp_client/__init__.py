"""MCP (Model Context Protocol) client integration.

Connects to configured MCP servers and registers their tools into
ToolRegistry, so they flow through the existing /api/chat tool loop and
the deepagents harness with no changes to either.
"""

from canvas_chat.mcp_client.manager import MCPManager, MCPServerConnection

_manager: MCPManager | None = None


def get_mcp_manager() -> MCPManager | None:
    """Return the process-wide MCPManager, or None if MCP isn't configured."""
    return _manager


def set_mcp_manager(manager: MCPManager | None) -> None:
    """Set the process-wide MCPManager (used by the FastAPI lifespan hook)."""
    global _manager
    _manager = manager


__all__ = [
    "MCPManager",
    "MCPServerConnection",
    "get_mcp_manager",
    "set_mcp_manager",
]
