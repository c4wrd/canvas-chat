"""Tool Plugin Base Class

Base class for LLM tool plugins. Tools are functions that LLMs can call during
conversation to gather information or perform actions.

Example:
    class CalculatorTool(ToolPlugin):
        def get_name(self) -> str:
            return "calculator"

        def get_description(self) -> str:
            return "Evaluate mathematical expressions"

        def get_parameters(self) -> dict:
            return {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Mathematical expression to evaluate"
                    }
                },
                "required": ["expression"]
            }

        async def execute(self, **kwargs) -> dict:
            result = eval_safe(kwargs["expression"])
            return {"result": result}

    ToolRegistry.register(
        id="calculator",
        handler=CalculatorTool,
        priority=PRIORITY["BUILTIN"],
    )
"""

import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class ToolPlugin(ABC):
    """Base class for LLM tool plugins."""

    @abstractmethod
    def get_name(self) -> str:
        """Get the unique name for this tool.

        This name is used by the LLM to invoke the tool.

        Returns:
            Tool name (e.g., "web_search", "calculator")
        """
        raise NotImplementedError("ToolPlugin.get_name() must be implemented")

    @abstractmethod
    def get_description(self) -> str:
        """Get a description of what this tool does.

        This description is shown to the LLM to help it decide when to use the tool.

        Returns:
            Human-readable description
        """
        raise NotImplementedError("ToolPlugin.get_description() must be implemented")

    @abstractmethod
    def get_parameters(self) -> dict[str, Any]:
        """Get the JSON Schema for this tool's parameters.

        Returns:
            JSON Schema object describing the tool's parameters.
            Example:
            {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    }
                },
                "required": ["query"]
            }
        """
        raise NotImplementedError("ToolPlugin.get_parameters() must be implemented")

    @abstractmethod
    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Execute the tool with the given arguments.

        Args:
            **kwargs: Arguments matching the parameter schema

        Returns:
            Dictionary with tool execution results.
            Should include a "result" key with the main output.

        Raises:
            Exception: If tool execution fails
        """
        raise NotImplementedError("ToolPlugin.execute() must be implemented")

    def to_openai_tool(self) -> dict[str, Any]:
        """Convert this tool to OpenAI/LiteLLM tool format.

        Returns:
            Tool definition in OpenAI function calling format:
            {
                "type": "function",
                "function": {
                    "name": "tool_name",
                    "description": "Tool description",
                    "parameters": { ... JSON Schema ... }
                }
            }
        """
        return {
            "type": "function",
            "function": {
                "name": self.get_name(),
                "description": self.get_description(),
                "parameters": self.get_parameters(),
            },
        }
