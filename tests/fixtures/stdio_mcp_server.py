"""A minimal real MCP stdio server, used by test_app_mcp_lifespan.py.

Spawned as an actual subprocess (not the in-memory transport) to exercise
the real stdio_client/MCPServerConnection path end-to-end.
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("stdio-test-server")


@mcp.tool()
def ping() -> str:
    """Reply pong."""
    return "pong"


if __name__ == "__main__":
    mcp.run(transport="stdio")
