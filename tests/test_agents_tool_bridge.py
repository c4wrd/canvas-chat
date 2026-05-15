"""Tests for the DeepAgents tool bridge — ToolPlugin -> LangChain StructuredTool."""

import asyncio

import pytest
from langchain_core.tools import StructuredTool

from canvas_chat.agents.tool_bridge import (
    get_langchain_tools,
    plugin_to_langchain_tool,
)
from canvas_chat.plugins.calculator_tool import CalculatorTool


@pytest.fixture
def calculator():
    return CalculatorTool()


class TestPluginToLangchainTool:
    """plugin_to_langchain_tool preserves name, description, and schema."""

    def test_returns_structured_tool(self, calculator):
        tool = plugin_to_langchain_tool(calculator)
        assert isinstance(tool, StructuredTool)

    def test_preserves_name(self, calculator):
        tool = plugin_to_langchain_tool(calculator)
        assert tool.name == "calculator"

    def test_preserves_description(self, calculator):
        tool = plugin_to_langchain_tool(calculator)
        assert tool.description == calculator.get_description()

    def test_preserves_schema(self, calculator):
        tool = plugin_to_langchain_tool(calculator)
        schema = tool.args_schema
        # args_schema is the JSON-schema dict we passed in.
        assert isinstance(schema, dict)
        assert schema["type"] == "object"
        assert "expression" in schema["properties"]
        assert schema["required"] == ["expression"]

    def test_executes_via_coroutine(self, calculator):
        tool = plugin_to_langchain_tool(calculator)
        result = asyncio.run(tool.ainvoke({"expression": "2 + 2"}))
        assert result["expression"] == "2 + 2"
        assert result["result"] == 4


class TestGetLangchainTools:
    """get_langchain_tools mirrors get_openai_tools's id-filtering."""

    def test_specific_ids(self):
        tools = get_langchain_tools(["calculator"])
        assert len(tools) == 1
        assert tools[0].name == "calculator"

    def test_unknown_id_skipped(self):
        tools = get_langchain_tools(["calculator", "this-does-not-exist"])
        assert len(tools) == 1
        assert tools[0].name == "calculator"

    def test_all_enabled_when_no_filter(self):
        tools = get_langchain_tools(None)
        names = [t.name for t in tools]
        # calculator + web_search are registered as BUILTIN at import time.
        assert "calculator" in names
        assert "web_search" in names
