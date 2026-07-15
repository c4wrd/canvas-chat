"""Tests for mcp_client.manager (MCPServerConnection, MCPManager).

Uses an in-process FastMCP server connected via mcp's in-memory transport
(no subprocesses spawned), injected through MCPServerConnection's
transport_factory seam.
"""

import asyncio
from contextlib import asynccontextmanager

import anyio
import pytest
from mcp.server.fastmcp import FastMCP
from mcp.shared.memory import create_client_server_memory_streams

from canvas_chat.config import MCPServerConfig
from canvas_chat.mcp_client.manager import MCPManager, MCPServerConnection
from canvas_chat.tool_registry import ToolRegistry


def _make_test_server() -> FastMCP:
    server = FastMCP("test-server")

    @server.tool()
    def echo(message: str) -> str:
        """Echo the message back."""
        return f"echo: {message}"

    @server.tool()
    def boom() -> str:
        """Always raises."""
        raise ValueError("kaboom")

    return server


def _memory_transport_factory(fastmcp_server: FastMCP):
    """Build a transport_factory for MCPServerConnection backed by an
    in-memory FastMCP server (no subprocess, no network)."""

    @asynccontextmanager
    async def _transport():
        async with create_client_server_memory_streams() as (
            client_streams,
            server_streams,
        ):
            server_read, server_write = server_streams
            async with anyio.create_task_group() as tg:
                mcp_server = fastmcp_server._mcp_server
                tg.start_soon(
                    lambda: mcp_server.run(
                        server_read,
                        server_write,
                        mcp_server.create_initialization_options(),
                    )
                )
                try:
                    yield client_streams
                finally:
                    tg.cancel_scope.cancel()

    return _transport


class TestMCPServerConnection:
    def setup_method(self):
        ToolRegistry._tools.clear()
        ToolRegistry._instances.clear()

    def test_connects_and_discovers_tools(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            conn = MCPServerConnection(
                config, transport_factory=_memory_transport_factory(fastmcp_server)
            )

            await conn.start()
            try:
                assert conn.connected is True
                tool_names = sorted(t.name for t in conn.tools)
                assert tool_names == ["boom", "echo"]
                assert conn.status["connected"] is True
                assert conn.status["tool_count"] == 2
                assert conn.status["error"] is None
            finally:
                await conn.stop()

        asyncio.run(run())

    def test_call_tool_success(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            conn = MCPServerConnection(
                config, transport_factory=_memory_transport_factory(fastmcp_server)
            )
            await conn.start()
            try:
                result = await conn.call_tool("echo", {"message": "hi"})
                assert result.isError is False
            finally:
                await conn.stop()

        asyncio.run(run())

    def test_call_tool_error_is_reported_not_raised(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            conn = MCPServerConnection(
                config, transport_factory=_memory_transport_factory(fastmcp_server)
            )
            await conn.start()
            try:
                result = await conn.call_tool("boom", {})
                assert result.isError is True
            finally:
                await conn.stop()

        asyncio.run(run())

    def test_call_tool_while_disconnected_raises(self):
        async def run():
            config = MCPServerConfig(name="testsrv", command="unused")
            conn = MCPServerConnection(config)
            with pytest.raises(RuntimeError, match="not connected"):
                await conn.call_tool("echo", {"message": "hi"})

        asyncio.run(run())

    def test_stop_marks_disconnected(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            conn = MCPServerConnection(
                config, transport_factory=_memory_transport_factory(fastmcp_server)
            )
            await conn.start()
            assert conn.connected is True

            await conn.stop()
            assert conn.connected is False
            assert conn.tools == []

        asyncio.run(run())


class TestMCPManager:
    def setup_method(self):
        ToolRegistry._tools.clear()
        ToolRegistry._instances.clear()

    def test_start_registers_tools_in_registry(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            manager = MCPManager([config])
            manager._connections[0]._transport_factory = _memory_transport_factory(
                fastmcp_server
            )

            await manager.start()
            try:
                tool_ids = {t["id"] for t in ToolRegistry.list_tools_info()}
                assert tool_ids == {"mcp__testsrv__echo", "mcp__testsrv__boom"}

                info = {t["id"]: t for t in ToolRegistry.list_tools_info()}
                assert info["mcp__testsrv__echo"]["source"] == "mcp"
                assert info["mcp__testsrv__echo"]["server"] == "testsrv"
            finally:
                await manager.stop()

        asyncio.run(run())

    def test_execute_tool_end_to_end_through_registry(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            manager = MCPManager([config])
            manager._connections[0]._transport_factory = _memory_transport_factory(
                fastmcp_server
            )

            await manager.start()
            try:
                result = await ToolRegistry.execute_tool(
                    "mcp__testsrv__echo", {"message": "hello"}
                )
                assert "result" in result
                assert "hello" in str(result["result"])
            finally:
                await manager.stop()

        asyncio.run(run())

    def test_execute_erroring_tool_returns_error_dict(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            manager = MCPManager([config])
            manager._connections[0]._transport_factory = _memory_transport_factory(
                fastmcp_server
            )

            await manager.start()
            try:
                result = await ToolRegistry.execute_tool("mcp__testsrv__boom", {})
                assert "error" in result
            finally:
                await manager.stop()

        asyncio.run(run())

    def test_stop_unregisters_all_tools(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            manager = MCPManager([config])
            manager._connections[0]._transport_factory = _memory_transport_factory(
                fastmcp_server
            )

            await manager.start()
            assert len(ToolRegistry.list_tools_info()) == 2

            await manager.stop()
            assert ToolRegistry.list_tools_info() == []

        asyncio.run(run())

    def test_disabled_server_is_not_connected(self):
        async def run():
            config = MCPServerConfig(name="testsrv", command="unused", enabled=False)
            manager = MCPManager([config])

            assert manager._connections == []
            await manager.start()  # should be a no-op, not raise
            assert ToolRegistry.list_tools_info() == []

        asyncio.run(run())

    def test_get_status_reports_all_servers(self):
        async def run():
            fastmcp_server = _make_test_server()
            config = MCPServerConfig(name="testsrv", command="unused")
            manager = MCPManager([config])
            manager._connections[0]._transport_factory = _memory_transport_factory(
                fastmcp_server
            )

            await manager.start()
            try:
                status = manager.get_status()
                assert len(status) == 1
                assert status[0]["name"] == "testsrv"
                assert status[0]["connected"] is True
            finally:
                await manager.stop()

        asyncio.run(run())
