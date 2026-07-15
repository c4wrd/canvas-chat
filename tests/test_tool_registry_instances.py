"""Tests for ToolRegistry.register_instance/unregister (used by MCP tools)."""

import asyncio

import pytest

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry


class MockInstanceTool(ToolPlugin):
    """A tool that must be constructed with args, unlike no-arg registry handlers."""

    def __init__(self, label: str = "default"):
        self.label = label

    def get_name(self) -> str:
        return "mock_instance_tool"

    def get_description(self) -> str:
        return f"Mock instance tool ({self.label})"

    def get_parameters(self) -> dict:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs) -> dict:
        return {"result": self.label}


class TestRegisterInstance:
    """Tests for ToolRegistry.register_instance."""

    def setup_method(self):
        """Clear registry before each test."""
        ToolRegistry._tools.clear()
        ToolRegistry._instances.clear()

    def test_register_instance_seeds_instances(self):
        """The exact instance passed in should be cached, not reconstructed."""
        tool = MockInstanceTool(label="from-mcp")
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool)

        assert "mock_instance_tool" in ToolRegistry._tools
        assert ToolRegistry._instances["mock_instance_tool"] is tool

    def test_get_instance_returns_same_object(self):
        """get_instance must never call handler_class() for instance-registered
        tools."""
        tool = MockInstanceTool(label="from-mcp")
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool)

        fetched = ToolRegistry.get_instance("mock_instance_tool")
        assert fetched is tool

    def test_register_instance_default_priority(self):
        """Default priority for instance-registered tools is PRIORITY['MCP']."""
        tool = MockInstanceTool()
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool)

        assert ToolRegistry._tools["mock_instance_tool"]["priority"] == PRIORITY["MCP"]

    def test_register_instance_with_metadata(self):
        """Metadata is stored and surfaced via list_tools_info."""
        tool = MockInstanceTool()
        ToolRegistry.register_instance(
            id="mock_instance_tool",
            instance=tool,
            metadata={"source": "mcp", "server": "github"},
        )

        info = ToolRegistry.list_tools_info()
        assert len(info) == 1
        assert info[0]["source"] == "mcp"
        assert info[0]["server"] == "github"

    def test_list_tools_info_defaults_source_to_builtin(self):
        """Tools registered via the classic register() path report source=builtin."""

        class PlainTool(ToolPlugin):
            def get_name(self):
                return "plain_tool"

            def get_description(self):
                return "Plain tool"

            def get_parameters(self):
                return {"type": "object", "properties": {}}

            async def execute(self, **kwargs):
                return {}

        ToolRegistry.register(id="plain_tool", handler=PlainTool)

        info = ToolRegistry.list_tools_info()
        assert info[0]["source"] == "builtin"
        assert info[0]["server"] is None

    def test_register_instance_requires_id(self):
        with pytest.raises(ValueError, match="id is required"):
            ToolRegistry.register_instance(id="", instance=MockInstanceTool())

    def test_register_instance_requires_tool_plugin(self):
        with pytest.raises(ValueError, match="must be a ToolPlugin"):
            ToolRegistry.register_instance(id="test", instance=object())

    def test_execute_tool_via_instance(self):
        """execute_tool works end-to-end for instance-registered tools."""
        tool = MockInstanceTool(label="hello")
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool)

        result = asyncio.run(ToolRegistry.execute_tool("mock_instance_tool", {}))
        assert result == {"result": "hello"}

    def test_unregister_removes_tool_and_instance(self):
        tool = MockInstanceTool()
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool)

        removed = ToolRegistry.unregister("mock_instance_tool")
        assert removed is True
        assert "mock_instance_tool" not in ToolRegistry._tools
        assert "mock_instance_tool" not in ToolRegistry._instances
        assert ToolRegistry.get_instance("mock_instance_tool") is None

    def test_unregister_nonexistent_returns_false(self):
        assert ToolRegistry.unregister("nonexistent") is False

    def test_register_instance_overwrites_existing(self):
        """Re-registering the same id (e.g. after MCP reconnect) replaces the
        instance."""
        tool1 = MockInstanceTool(label="v1")
        tool2 = MockInstanceTool(label="v2")

        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool1)
        ToolRegistry.register_instance(id="mock_instance_tool", instance=tool2)

        assert ToolRegistry.get_instance("mock_instance_tool") is tool2

    def test_legacy_register_still_works_unmodified(self):
        """register() (class-based) behavior is unchanged by the new metadata
        field."""

        class PlainTool(ToolPlugin):
            def get_name(self):
                return "plain_tool"

            def get_description(self):
                return "Plain tool"

            def get_parameters(self):
                return {"type": "object", "properties": {}}

            async def execute(self, **kwargs):
                return {}

        ToolRegistry.register(
            id="plain_tool", handler=PlainTool, priority=PRIORITY["BUILTIN"]
        )

        instance = ToolRegistry.get_instance("plain_tool")
        assert isinstance(instance, PlainTool)
        assert ToolRegistry._tools["plain_tool"]["metadata"] == {}
