"""Adapt MCP server tools into canvas-chat ToolPlugin instances.

Each discovered MCP tool becomes one MCPToolPlugin, registered into
ToolRegistry via register_instance(). From there it flows through the
existing /api/chat tool loop and deepagents harness unmodified.
"""

from __future__ import annotations

import hashlib
import re
from typing import TYPE_CHECKING, Any

from canvas_chat.mcp_client.results import call_tool_result_to_dict
from canvas_chat.tool_plugin import ToolPlugin

if TYPE_CHECKING:
    import mcp.types as types

    from canvas_chat.mcp_client.manager import MCPServerConnection

# OpenAI/LiteLLM function-calling names must match this pattern.
_VALID_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_INVALID_NAME_CHARS_RE = re.compile(r"[^a-zA-Z0-9_-]")
_MAX_NAME_LENGTH = 64


def make_tool_id(server: str, tool: str) -> str:
    """Build a namespaced, OpenAI-safe tool id for an MCP tool.

    Format: ``mcp__<server>__<tool>``, with any character outside
    ``[a-zA-Z0-9_-]`` replaced by ``_``. If the result exceeds the 64-char
    limit OpenAI/LiteLLM impose on function names, it's truncated to 55
    chars plus an 8-char hash of the full (untruncated) id so distinct
    long names don't collide.

    Args:
        server: The configured MCP server name.
        tool: The tool name as reported by the MCP server.

    Returns:
        A tool id matching ``^[a-zA-Z0-9_-]{1,64}$``.
    """
    raw = f"mcp__{server}__{tool}"
    sanitized = _INVALID_NAME_CHARS_RE.sub("_", raw)
    if len(sanitized) <= _MAX_NAME_LENGTH:
        return sanitized
    digest = hashlib.sha1(sanitized.encode("utf-8")).hexdigest()[:8]
    return f"{sanitized[:55]}_{digest}"


def sanitize_schema(schema: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize an MCP tool's inputSchema for OpenAI/LiteLLM function calling.

    MCP servers sometimes omit "type": "object", or include JSON-Schema
    metadata keys ("$schema", "$id") that some providers reject when routed
    through litellm. This produces a schema safe to hand to
    ``to_openai_tool()``.

    Args:
        schema: The raw JSON Schema from the MCP tool's inputSchema, or None.

    Returns:
        A JSON Schema dict guaranteed to have "type": "object" and a
        "properties" key, with "$schema"/"$id" stripped recursively.
    """
    if not schema:
        return {"type": "object", "properties": {}}

    cleaned = _strip_meta_keys(schema)
    if not isinstance(cleaned, dict):
        return {"type": "object", "properties": {}}

    cleaned.setdefault("type", "object")
    cleaned.setdefault("properties", {})
    return cleaned


def _strip_meta_keys(value: Any) -> Any:
    """Recursively strip "$schema"/"$id" keys from a JSON-Schema-like value."""
    if isinstance(value, dict):
        return {
            k: _strip_meta_keys(v)
            for k, v in value.items()
            if k not in ("$schema", "$id")
        }
    if isinstance(value, list):
        return [_strip_meta_keys(v) for v in value]
    return value


class MCPToolPlugin(ToolPlugin):
    """A ToolPlugin that proxies execution to a live MCP server connection."""

    def __init__(
        self,
        connection: MCPServerConnection,
        tool: types.Tool,
        tool_id: str,
    ):
        self._connection = connection
        self._tool = tool
        self._tool_id = tool_id
        self._parameters = sanitize_schema(tool.inputSchema)

    def get_name(self) -> str:
        # Must equal the ToolRegistry id: the chat loop executes tools by
        # the name the LLM emits, which comes from to_openai_tool()'s name.
        return self._tool_id

    def get_description(self) -> str:
        description = self._tool.description or self._tool.name
        return f"[MCP: {self._connection.config.name}] {description}"

    def get_parameters(self) -> dict[str, Any]:
        return self._parameters

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        try:
            result = await self._connection.call_tool(self._tool.name, kwargs)
        except Exception as exc:  # noqa: BLE001 — never raise, always report
            return {"error": f"MCP tool call failed ({self._tool_id}): {exc}"}
        return call_tool_result_to_dict(result)


__all__ = ["MCPToolPlugin", "make_tool_id", "sanitize_schema"]
