"""Assemble a deepagents CompiledStateGraph from an AgentConfigModel."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from deepagents import create_deep_agent

from canvas_chat.agents.llm_bridge import build_chat_model
from canvas_chat.agents.tool_bridge import get_langchain_tools

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph

    from canvas_chat.agents.models import AgentRunRequest

logger = logging.getLogger(__name__)


def build_agent(request: AgentRunRequest) -> CompiledStateGraph:
    """Build a deep agent graph from a run request.

    v1 only wires the flat (no-subagent) form. The agent config's
    ``subagents`` field is preserved on disk so v2 can light it up
    without a schema migration.
    """
    config = request.agent
    chat_model = build_chat_model(request)
    tools = get_langchain_tools(config.tools)

    logger.info(
        "[agents.builder] Building agent slug=%s model=%s tools=%s",
        config.slug,
        request.effective_model,
        [t.name for t in tools],
    )

    graph = create_deep_agent(
        model=chat_model,
        tools=tools,
        system_prompt=config.system_prompt or None,
        name=config.slug,
    )
    return graph


__all__ = ["build_agent"]
