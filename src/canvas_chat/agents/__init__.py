"""DeepAgents integration for canvas-chat.

Wraps LangChain's `deepagents` framework so users can build named
agent configurations (system prompt + model + tools + future subagents)
from the GUI and run them via /api/agents/* endpoints.

The package layout follows a thin-adapter design:
    models.py        Pydantic schemas exchanged with the frontend.
    llm_bridge.py    Maps an `AgentRunRequest` to a LangChain ChatLiteLLM,
                     reusing the same credential plumbing as /api/chat.
    tool_bridge.py   Adapts existing canvas_chat.tool_plugin.ToolPlugin
                     instances into LangChain StructuredTool objects.
    builder.py       Assembles a CompiledStateGraph from an agent config.
    event_bridge.py  Translates LangGraph astream_events("v2") into the
                     SSE events the frontend already understands.
    runtime.py       In-memory task registry and lifecycle helpers.
"""
