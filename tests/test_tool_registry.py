"""Tests for the tool registry and tool plugin system."""

import asyncio

import pytest

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry


class MockTool(ToolPlugin):
    """Mock tool for testing."""

    def get_name(self) -> str:
        return "mock_tool"

    def get_description(self) -> str:
        return "A mock tool for testing"

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "input": {"type": "string", "description": "Test input"},
            },
            "required": ["input"],
        }

    async def execute(self, **kwargs) -> dict:
        return {"result": f"processed: {kwargs.get('input', '')}"}


class TestToolRegistry:
    """Tests for ToolRegistry."""

    def setup_method(self):
        """Clear registry before each test."""
        ToolRegistry._tools.clear()
        ToolRegistry._instances.clear()

    def test_register_tool(self):
        """Test registering a tool."""
        ToolRegistry.register(
            id="mock_tool",
            handler=MockTool,
            priority=PRIORITY["BUILTIN"],
        )

        assert "mock_tool" in ToolRegistry._tools
        tool_config = ToolRegistry._tools["mock_tool"]
        assert tool_config["id"] == "mock_tool"
        assert tool_config["handler"] == MockTool
        assert tool_config["priority"] == PRIORITY["BUILTIN"]
        assert tool_config["enabled"] is True

    def test_register_requires_id(self):
        """Test that registration requires an id."""
        with pytest.raises(ValueError, match="id is required"):
            ToolRegistry.register(id="", handler=MockTool)

    def test_register_requires_handler(self):
        """Test that registration requires a handler."""
        with pytest.raises(ValueError, match="handler is required"):
            ToolRegistry.register(id="test", handler=None)

    def test_register_requires_class(self):
        """Test that handler must be a class."""
        with pytest.raises(ValueError, match="must be a class"):
            ToolRegistry.register(id="test", handler="not a class")

    def test_register_requires_tool_plugin(self):
        """Test that handler must extend ToolPlugin."""

        class NotAToolPlugin:
            pass

        with pytest.raises(ValueError, match="must extend ToolPlugin"):
            ToolRegistry.register(id="test", handler=NotAToolPlugin)

    def test_get_instance(self):
        """Test getting a tool instance."""
        ToolRegistry.register(id="mock_tool", handler=MockTool)

        instance = ToolRegistry.get_instance("mock_tool")
        assert instance is not None
        assert isinstance(instance, MockTool)

        # Should return same instance (cached)
        instance2 = ToolRegistry.get_instance("mock_tool")
        assert instance is instance2

    def test_get_instance_not_found(self):
        """Test getting a non-existent tool."""
        instance = ToolRegistry.get_instance("nonexistent")
        assert instance is None

    def test_get_openai_tools(self):
        """Test getting tools in OpenAI format."""
        ToolRegistry.register(id="mock_tool", handler=MockTool)

        tools = ToolRegistry.get_openai_tools()
        assert len(tools) == 1
        assert tools[0]["type"] == "function"
        assert tools[0]["function"]["name"] == "mock_tool"
        assert tools[0]["function"]["description"] == "A mock tool for testing"
        assert "properties" in tools[0]["function"]["parameters"]

    def test_get_openai_tools_specific(self):
        """Test getting specific tools by ID."""

        class OtherTool(ToolPlugin):
            def get_name(self):
                return "other_tool"

            def get_description(self):
                return "Another tool"

            def get_parameters(self):
                return {"type": "object", "properties": {}}

            async def execute(self, **kwargs):
                return {}

        ToolRegistry.register(id="mock_tool", handler=MockTool)
        ToolRegistry.register(id="other_tool", handler=OtherTool)

        # Get only mock_tool
        tools = ToolRegistry.get_openai_tools(["mock_tool"])
        assert len(tools) == 1
        assert tools[0]["function"]["name"] == "mock_tool"

    def test_execute_tool(self):
        """Test executing a tool."""
        ToolRegistry.register(id="mock_tool", handler=MockTool)

        result = asyncio.run(ToolRegistry.execute_tool("mock_tool", {"input": "test"}))
        assert result == {"result": "processed: test"}

    def test_execute_tool_not_found(self):
        """Test executing a non-existent tool."""
        with pytest.raises(ValueError, match="Tool not found"):
            asyncio.run(ToolRegistry.execute_tool("nonexistent", {}))

    def test_set_tool_enabled(self):
        """Test enabling/disabling a tool."""
        ToolRegistry.register(id="mock_tool", handler=MockTool)

        # Disable
        result = ToolRegistry.set_tool_enabled("mock_tool", False)
        assert result is True
        assert ToolRegistry._tools["mock_tool"]["enabled"] is False

        # Enable
        result = ToolRegistry.set_tool_enabled("mock_tool", True)
        assert result is True
        assert ToolRegistry._tools["mock_tool"]["enabled"] is True

        # Non-existent tool
        result = ToolRegistry.set_tool_enabled("nonexistent", True)
        assert result is False

    def test_get_enabled_tools(self):
        """Test getting only enabled tools."""

        class DisabledTool(ToolPlugin):
            def get_name(self):
                return "disabled_tool"

            def get_description(self):
                return "Disabled tool"

            def get_parameters(self):
                return {"type": "object", "properties": {}}

            async def execute(self, **kwargs):
                return {}

        ToolRegistry.register(id="mock_tool", handler=MockTool, enabled=True)
        ToolRegistry.register(id="disabled_tool", handler=DisabledTool, enabled=False)

        enabled = ToolRegistry.get_enabled_tools()
        assert len(enabled) == 1
        assert enabled[0]["id"] == "mock_tool"

    def test_list_tools_info(self):
        """Test listing tool info for API responses."""
        ToolRegistry.register(id="mock_tool", handler=MockTool)

        info = ToolRegistry.list_tools_info()
        assert len(info) == 1
        assert info[0]["id"] == "mock_tool"
        assert info[0]["name"] == "mock_tool"
        assert info[0]["description"] == "A mock tool for testing"
        assert info[0]["enabled"] is True
