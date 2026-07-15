"""Tests for mcp_client.tool_adapter (make_tool_id, sanitize_schema, MCPToolPlugin)."""

import asyncio
import re

import mcp.types as types

from canvas_chat.mcp_client.tool_adapter import (
    MCPToolPlugin,
    make_tool_id,
    sanitize_schema,
)

_VALID_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


# --- make_tool_id ---


def test_make_tool_id_basic_format():
    tool_id = make_tool_id("github", "search_issues")
    assert tool_id == "mcp__github__search_issues"
    assert _VALID_NAME_RE.match(tool_id)


def test_make_tool_id_sanitizes_invalid_chars():
    tool_id = make_tool_id("my server!", "do thing.now")
    assert _VALID_NAME_RE.match(tool_id)
    assert " " not in tool_id
    assert "!" not in tool_id
    assert "." not in tool_id


def test_make_tool_id_truncates_long_names():
    server = "a" * 40
    tool = "b" * 40
    tool_id = make_tool_id(server, tool)
    assert len(tool_id) <= 64
    assert _VALID_NAME_RE.match(tool_id)


def test_make_tool_id_truncation_is_deterministic():
    server = "a" * 40
    tool = "b" * 40
    assert make_tool_id(server, tool) == make_tool_id(server, tool)


def test_make_tool_id_different_long_names_dont_collide():
    id1 = make_tool_id("a" * 40, "b" * 40)
    id2 = make_tool_id("a" * 40, "c" * 40)
    assert id1 != id2


# --- sanitize_schema ---


def test_sanitize_schema_none_defaults_to_empty_object():
    assert sanitize_schema(None) == {"type": "object", "properties": {}}


def test_sanitize_schema_empty_dict_defaults():
    assert sanitize_schema({}) == {"type": "object", "properties": {}}


def test_sanitize_schema_adds_missing_type():
    schema = {"properties": {"q": {"type": "string"}}}
    result = sanitize_schema(schema)
    assert result["type"] == "object"
    assert result["properties"] == {"q": {"type": "string"}}


def test_sanitize_schema_preserves_existing_type():
    schema = {"type": "object", "properties": {"q": {"type": "string"}}}
    result = sanitize_schema(schema)
    assert result["type"] == "object"


def test_sanitize_schema_strips_schema_and_id_keys_recursively():
    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "https://example.com/schema.json",
        "type": "object",
        "properties": {
            "nested": {
                "$schema": "should be stripped",
                "type": "object",
                "properties": {},
            }
        },
    }
    result = sanitize_schema(schema)
    assert "$schema" not in result
    assert "$id" not in result
    assert "$schema" not in result["properties"]["nested"]


# --- MCPToolPlugin ---


class _FakeServerConfig:
    def __init__(self, name):
        self.name = name


class _FakeConnection:
    """Stands in for MCPServerConnection until manager.py exists."""

    def __init__(self, name="testserver", call_tool_result=None, call_tool_exc=None):
        self.config = _FakeServerConfig(name)
        self._result = call_tool_result
        self._exc = call_tool_exc
        self.calls = []

    async def call_tool(self, tool_name, arguments):
        self.calls.append((tool_name, arguments))
        if self._exc is not None:
            raise self._exc
        return self._result


def _make_tool(name="echo", description="Echo input", input_schema=None):
    return types.Tool(
        name=name,
        description=description,
        inputSchema=input_schema or {"type": "object", "properties": {}},
    )


def test_get_name_returns_tool_id():
    conn = _FakeConnection()
    plugin = MCPToolPlugin(conn, _make_tool(), "mcp__testserver__echo")
    assert plugin.get_name() == "mcp__testserver__echo"


def test_get_description_includes_server_name():
    conn = _FakeConnection(name="github")
    tool = _make_tool(description="Search issues")
    plugin = MCPToolPlugin(conn, tool, "mcp__github__echo")
    description = plugin.get_description()
    assert "github" in description
    assert "Search issues" in description


def test_get_parameters_sanitized():
    conn = _FakeConnection()
    tool = _make_tool(input_schema={"properties": {"q": {"type": "string"}}})
    plugin = MCPToolPlugin(conn, tool, "mcp__testserver__echo")
    params = plugin.get_parameters()
    assert params["type"] == "object"
    assert params["properties"] == {"q": {"type": "string"}}


def test_execute_success_maps_result():
    result = types.CallToolResult(
        content=[types.TextContent(type="text", text="hi there")]
    )
    conn = _FakeConnection(call_tool_result=result)
    plugin = MCPToolPlugin(conn, _make_tool(), "mcp__testserver__echo")

    output = asyncio.run(plugin.execute(message="hello"))
    assert output == {"result": "hi there"}
    assert conn.calls == [("echo", {"message": "hello"})]


def test_execute_exception_returns_error_dict_not_raise():
    conn = _FakeConnection(call_tool_exc=RuntimeError("connection dropped"))
    plugin = MCPToolPlugin(conn, _make_tool(), "mcp__testserver__echo")

    output = asyncio.run(plugin.execute())
    assert "error" in output
    assert "connection dropped" in output["error"]
    assert "mcp__testserver__echo" in output["error"]


def test_execute_tool_reported_error_maps_to_error_dict():
    result = types.CallToolResult(
        content=[types.TextContent(type="text", text="bad input")],
        isError=True,
    )
    conn = _FakeConnection(call_tool_result=result)
    plugin = MCPToolPlugin(conn, _make_tool(), "mcp__testserver__echo")

    output = asyncio.run(plugin.execute())
    assert output == {"error": "bad input"}
