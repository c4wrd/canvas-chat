"""Adapt canvas-chat ToolPlugin instances to LangChain StructuredTool.

We don't redefine tool metadata — every tool already exists in
ToolRegistry with its name, description, and JSON-schema parameters.
This module reads the existing ToolPlugin and produces an equivalent
StructuredTool that the deepagents framework can consume.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import StructuredTool

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import ToolRegistry

logger = logging.getLogger(__name__)


def plugin_to_langchain_tool(plugin: ToolPlugin) -> StructuredTool:
    """Wrap a ToolPlugin as a LangChain StructuredTool.

    The JSON-schema returned by ``plugin.get_parameters()`` is passed
    directly to StructuredTool as its args_schema (LangChain accepts
    either a Pydantic model or a JSON-schema dict).

    Args:
        plugin: A ToolPlugin instance.

    Returns:
        A StructuredTool routing calls back to ``plugin.execute``.
    """
    name = plugin.get_name()
    description = plugin.get_description()
    schema = plugin.get_parameters() or {"type": "object", "properties": {}}

    async def _run(**kwargs: Any) -> Any:
        result = await plugin.execute(**kwargs)
        return result

    return StructuredTool.from_function(
        coroutine=_run,
        name=name,
        description=description,
        args_schema=schema,
    )


def get_langchain_tools(tool_ids: list[str] | None = None) -> list[StructuredTool]:
    """Return LangChain-compatible tools mirroring ToolRegistry.get_openai_tools.

    Args:
        tool_ids: Specific tool IDs to include, or None for all enabled tools.

    Returns:
        List of StructuredTool instances. Tool IDs that resolve to nothing
        are silently skipped (matching the behaviour of get_openai_tools).
    """
    tools: list[StructuredTool] = []

    if tool_ids is not None:
        for tool_id in tool_ids:
            instance = ToolRegistry.get_instance(tool_id)
            if instance is None:
                logger.warning("[agents] Tool not found, skipping: %s", tool_id)
                continue
            tools.append(plugin_to_langchain_tool(instance))
        return tools

    for tool_config in ToolRegistry.get_enabled_tools():
        instance = ToolRegistry.get_instance(tool_config["id"])
        if instance is not None:
            tools.append(plugin_to_langchain_tool(instance))
    return tools


__all__ = ["plugin_to_langchain_tool", "get_langchain_tools"]
