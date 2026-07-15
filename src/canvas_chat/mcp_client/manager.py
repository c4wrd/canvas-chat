"""MCP server session lifecycle management.

The mcp SDK's transports (stdio_client, streamablehttp_client) and
ClientSession are async context managers backed by anyio task groups, and
anyio cancel scopes must be entered and exited in the same task. So each
configured server gets one dedicated background task (MCPServerConnection)
that owns its entire transport + session context stack for the life of the
connection — entering it once in _run_once() and holding it open (awaiting a
shutdown event) until told to stop, then exiting in that same task.

Cross-task tool calls are safe without a command queue: ClientSession's
request/response plumbing writes to anyio memory streams and awaits a
per-request future keyed by request id, which the SDK supports being awaited
from any task on the same event loop. Only entering/exiting the context
managers is task-affine, not sending requests through an open session. If
this assumption ever needs revisiting, the fallback is a queue of
(name, args, future) drained inside _run_once between "ready" and
"shutdown" — not built here since it isn't needed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import get_default_environment, stdio_client
from mcp.client.streamable_http import streamablehttp_client

from canvas_chat.mcp_client.tool_adapter import MCPToolPlugin, make_tool_id
from canvas_chat.tool_registry import PRIORITY, ToolRegistry

if TYPE_CHECKING:
    import mcp.types as types

    from canvas_chat.config import MCPServerConfig

logger = logging.getLogger(__name__)

_INITIAL_BACKOFF_SECONDS = 1.0
_MAX_BACKOFF_SECONDS = 60.0
_STOP_TIMEOUT_SECONDS = 10.0

TransportFactory = Callable[[], "contextlib.AbstractAsyncContextManager[Any]"]
OnToolsChanged = Callable[["MCPServerConnection"], None]


class MCPServerConnection:
    """Owns one MCP server's transport + session for its entire lifetime.

    ``start()``/``stop()`` are the only cross-task entry points besides
    ``call_tool()``. Everything else runs inside the single background task
    spawned by ``start()``.
    """

    def __init__(
        self,
        config: MCPServerConfig,
        transport_factory: TransportFactory | None = None,
        on_tools_changed: OnToolsChanged | None = None,
    ):
        self.config = config
        self._transport_factory = transport_factory
        self._on_tools_changed = on_tools_changed

        self._session: ClientSession | None = None
        self._tools: list[types.Tool] = []
        self._connected = False
        self._last_error: str | None = None

        self._ready = asyncio.Event()
        self._shutdown = asyncio.Event()
        self._task: asyncio.Task | None = None

    @property
    def tools(self) -> list[types.Tool]:
        return self._tools

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def status(self) -> dict[str, Any]:
        return {
            "name": self.config.name,
            "transport": self.config.transport,
            "connected": self._connected,
            "tool_count": len(self._tools),
            "error": self._last_error,
        }

    async def start(self) -> None:
        """Spawn the owner task and wait briefly for a first connection.

        Never raises: if the server doesn't come up within
        ``connect_timeout_seconds``, this returns anyway and the owner task
        keeps retrying in the background. One misbehaving server can't block
        startup of the others.
        """
        self._task = asyncio.create_task(self._run_forever())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(
                self._ready.wait(), timeout=self.config.connect_timeout_seconds
            )

    async def stop(self) -> None:
        """Signal shutdown and wait for the owner task to exit cleanly."""
        self._shutdown.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(
                asyncio.shield(self._task), timeout=_STOP_TIMEOUT_SECONDS
            )
        except TimeoutError:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def call_tool(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> types.CallToolResult:
        """Invoke a tool on the live session. Safe to call from any task."""
        session = self._session
        if session is None:
            raise RuntimeError(f"MCP server '{self.config.name}' is not connected")
        return await session.call_tool(
            tool_name,
            arguments,
            read_timeout_seconds=timedelta(seconds=self.config.tool_timeout_seconds),
        )

    def _transport_context(self) -> contextlib.AbstractAsyncContextManager[Any]:
        if self._transport_factory is not None:
            return self._transport_factory()
        if self.config.transport == "stdio":
            return stdio_client(
                StdioServerParameters(
                    command=self.config.command,
                    args=self.config.args,
                    env={**get_default_environment(), **self.config.resolve_env()},
                )
            )
        return streamablehttp_client(
            self.config.url, headers=self.config.resolve_headers()
        )

    def _mark_disconnected(self, error: str | None) -> None:
        self._connected = False
        self._session = None
        self._tools = []
        self._last_error = error
        if self._on_tools_changed:
            self._on_tools_changed(self)

    async def _run_once(self) -> None:
        """Connect once, hold the session open until shutdown, then exit.

        Entering and exiting every context manager here happens in this one
        task — the owner task — for the whole life of the connection.
        """
        self._ready.clear()
        async with self._transport_context() as streams:
            read_stream, write_stream = streams[0], streams[1]
            async with ClientSession(read_stream, write_stream) as session:
                await asyncio.wait_for(
                    session.initialize(), timeout=self.config.connect_timeout_seconds
                )
                list_result = await session.list_tools()

                self._tools = list_result.tools
                self._session = session
                self._connected = True
                self._last_error = None
                self._ready.set()
                if self._on_tools_changed:
                    self._on_tools_changed(self)

                logger.info(
                    "[mcp_client] server '%s' connected (%d tool(s))",
                    self.config.name,
                    len(self._tools),
                )

                await self._shutdown.wait()

    async def _run_forever(self) -> None:
        """Supervise _run_once with exponential backoff until stop() is called."""
        backoff = _INITIAL_BACKOFF_SECONDS
        while not self._shutdown.is_set():
            try:
                await self._run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — one bad server can't crash startup
                logger.warning(
                    "[mcp_client] server '%s' connection failed: %s",
                    self.config.name,
                    exc,
                )
                self._mark_disconnected(str(exc))
            else:
                # _run_once only returns normally when shutdown was requested.
                break

            if self._shutdown.is_set():
                break

            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._shutdown.wait(), timeout=backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)

        self._mark_disconnected(self._last_error)


class MCPManager:
    """Owns all configured MCP server connections and syncs ToolRegistry."""

    def __init__(self, configs: list[MCPServerConfig]):
        self._registered_ids: dict[str, set[str]] = {}
        self._connections: list[MCPServerConnection] = [
            MCPServerConnection(config, on_tools_changed=self._sync_registry)
            for config in configs
            if config.enabled
        ]

    async def start(self) -> None:
        """Connect to all configured servers in parallel."""
        if not self._connections:
            return
        await asyncio.gather(*(conn.start() for conn in self._connections))

    async def stop(self) -> None:
        """Disconnect all servers and unregister every MCP-sourced tool."""
        for conn in self._connections:
            await conn.stop()
        for tool_ids in self._registered_ids.values():
            for tool_id in tool_ids:
                ToolRegistry.unregister(tool_id)
        self._registered_ids.clear()

    def get_status(self) -> list[dict[str, Any]]:
        return [conn.status for conn in self._connections]

    def _sync_registry(self, conn: MCPServerConnection) -> None:
        """Re-register a server's tools in ToolRegistry after (re)connect/disconnect."""
        server = conn.config.name
        for tool_id in self._registered_ids.pop(server, set()):
            ToolRegistry.unregister(tool_id)

        if not conn.connected:
            return

        new_ids: set[str] = set()
        for tool in conn.tools:
            tool_id = make_tool_id(server, tool.name)
            ToolRegistry.register_instance(
                tool_id,
                MCPToolPlugin(conn, tool, tool_id),
                priority=PRIORITY["MCP"],
                metadata={"source": "mcp", "server": server},
            )
            new_ids.add(tool_id)

        self._registered_ids[server] = new_ids
        logger.info(
            "[mcp_client] server '%s': registered %d tool(s) in ToolRegistry",
            server,
            len(new_ids),
        )


__all__ = ["MCPManager", "MCPServerConnection"]
