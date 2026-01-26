"""Tool Registry - Plugin System for LLM Tool Handlers

Enables dynamic registration of LLM tools on the Python backend.
Both built-in tools and third-party plugins use this same registration API.

Usage:
    from canvas_chat.tool_registry import ToolRegistry, PRIORITY
    from canvas_chat.tool_plugin import ToolPlugin

    class WeatherTool(ToolPlugin):
        def get_name(self) -> str:
            return "weather"

        def get_description(self) -> str:
            return "Get current weather for a location"

        def get_parameters(self) -> dict:
            return {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"}
                },
                "required": ["location"]
            }

        async def execute(self, **kwargs) -> dict:
            # Fetch weather data
            return {"result": "Sunny, 72F"}

    ToolRegistry.register(
        id="weather",
        handler=WeatherTool,
        priority=PRIORITY["BUILTIN"],
    )
"""

import logging
from typing import Any, ClassVar

from canvas_chat.tool_plugin import ToolPlugin

logger = logging.getLogger(__name__)

# Priority levels for tools (higher priority = preferred)
PRIORITY = {
    "BUILTIN": 100,
    "OFFICIAL": 50,
    "COMMUNITY": 10,
}


class ToolRegistry:
    """Registry for LLM tool plugins."""

    _tools: ClassVar[dict[str, dict[str, Any]]] = {}
    _instances: ClassVar[dict[str, ToolPlugin]] = {}

    @classmethod
    def register(
        cls,
        id: str,
        handler: type[ToolPlugin] | None = None,
        priority: int = PRIORITY["COMMUNITY"],
        enabled: bool = True,
    ) -> None:
        """Register a tool plugin.

        Args:
            id: Unique tool identifier (should match handler.get_name())
            handler: Tool class (must extend ToolPlugin)
            priority: Priority level (higher = preferred)
            enabled: Whether the tool is enabled by default

        Raises:
            ValueError: If config is invalid
        """
        if not id:
            raise ValueError("ToolRegistry.register: id is required")
        if not handler:
            raise ValueError(f'ToolRegistry.register: handler is required for "{id}"')
        if not isinstance(handler, type):
            raise ValueError(
                f'ToolRegistry.register: handler must be a class for "{id}"'
            )
        if not issubclass(handler, ToolPlugin):
            raise ValueError(
                f'ToolRegistry.register: handler must extend ToolPlugin for "{id}"'
            )

        # Check for duplicate registration
        if id in cls._tools:
            logger.warning(f'ToolRegistry: Overwriting existing tool "{id}"')

        # Store the config
        cls._tools[id] = {
            "id": id,
            "handler": handler,
            "priority": priority,
            "enabled": enabled,
        }

        # Clear cached instance
        if id in cls._instances:
            del cls._instances[id]

        logger.info(f"[ToolRegistry] Registered tool: {id}")

    @classmethod
    def get_instance(cls, tool_id: str) -> ToolPlugin | None:
        """Get or create a tool instance by ID.

        Args:
            tool_id: Tool ID

        Returns:
            Tool instance, or None if not found
        """
        if tool_id not in cls._tools:
            return None

        # Lazy instantiation
        if tool_id not in cls._instances:
            handler_class = cls._tools[tool_id]["handler"]
            cls._instances[tool_id] = handler_class()

        return cls._instances[tool_id]

    @classmethod
    def get_tool_by_id(cls, tool_id: str) -> dict[str, Any] | None:
        """Get a tool config by ID.

        Args:
            tool_id: Tool ID

        Returns:
            Tool config dict, or None if not found
        """
        return cls._tools.get(tool_id)

    @classmethod
    def get_all_tools(cls) -> list[dict[str, Any]]:
        """Get all registered tools.

        Returns:
            List of tool config dicts
        """
        return list(cls._tools.values())

    @classmethod
    def get_enabled_tools(cls) -> list[dict[str, Any]]:
        """Get all enabled tools.

        Returns:
            List of enabled tool config dicts, sorted by priority
        """
        enabled = [t for t in cls._tools.values() if t["enabled"]]
        return sorted(enabled, key=lambda t: t["priority"], reverse=True)

    @classmethod
    def get_openai_tools(cls, tool_ids: list[str] | None = None) -> list[dict[str, Any]]:
        """Get tools in OpenAI/LiteLLM format.

        Args:
            tool_ids: Specific tool IDs to include, or None for all enabled tools

        Returns:
            List of tool definitions in OpenAI function calling format
        """
        if tool_ids is not None:
            # Get specific tools
            tools = []
            for tool_id in tool_ids:
                instance = cls.get_instance(tool_id)
                if instance:
                    tools.append(instance.to_openai_tool())
            return tools
        else:
            # Get all enabled tools
            tools = []
            for tool_config in cls.get_enabled_tools():
                instance = cls.get_instance(tool_config["id"])
                if instance:
                    tools.append(instance.to_openai_tool())
            return tools

    @classmethod
    async def execute_tool(cls, tool_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool with the given arguments.

        Args:
            tool_id: Tool ID to execute
            arguments: Arguments to pass to the tool

        Returns:
            Tool execution result

        Raises:
            ValueError: If tool not found
            Exception: If tool execution fails
        """
        instance = cls.get_instance(tool_id)
        if not instance:
            raise ValueError(f"Tool not found: {tool_id}")

        return await instance.execute(**arguments)

    @classmethod
    def set_tool_enabled(cls, tool_id: str, enabled: bool) -> bool:
        """Enable or disable a tool.

        Args:
            tool_id: Tool ID
            enabled: Whether to enable or disable

        Returns:
            True if tool was found and updated, False otherwise
        """
        if tool_id not in cls._tools:
            return False
        cls._tools[tool_id]["enabled"] = enabled
        return True

    @classmethod
    def list_tools_info(cls) -> list[dict[str, Any]]:
        """Get info about all registered tools for API responses.

        Returns:
            List of tool info dicts with id, name, description, enabled
        """
        tools_info = []
        for tool_config in cls._tools.values():
            instance = cls.get_instance(tool_config["id"])
            if instance:
                tools_info.append({
                    "id": tool_config["id"],
                    "name": instance.get_name(),
                    "description": instance.get_description(),
                    "enabled": tool_config["enabled"],
                    "priority": tool_config["priority"],
                })
        return sorted(tools_info, key=lambda t: t["priority"], reverse=True)
