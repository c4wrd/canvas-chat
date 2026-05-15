"""Translate LangGraph astream_events("v2") into canvas-chat SSE events.

The frontend already understands ``thinking``, ``message``, ``tool_call``,
``tool_result``, ``done``, and ``error``. We add exactly one new event in
v1: ``todo_update`` (the planning signature of deepagents — when the
agent invokes the built-in ``write_todos`` tool).

Filtering is aggressive: LangGraph emits chain-start/chain-end events
for every node in the underlying graph; we forward only the events the
UI knows what to do with.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger(__name__)


def _extract_content_delta(chunk: Any) -> tuple[str, str]:
    """Extract (content, reasoning) text deltas from a chat model chunk.

    Handles both LangChain AIMessageChunk shapes and provider-specific
    additional_kwargs. Returns empty strings when neither is present.
    """
    content_text = ""
    reasoning_text = ""

    raw_content = getattr(chunk, "content", "") or ""
    if isinstance(raw_content, str):
        content_text = raw_content
    elif isinstance(raw_content, list):
        # LangChain content-block style: list of dicts with "type" and value.
        for block in raw_content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype in ("text", "output_text"):
                content_text += block.get("text", "") or ""
            elif btype in ("reasoning", "thinking"):
                reasoning_text += block.get("text", block.get("reasoning", "")) or ""

    additional = getattr(chunk, "additional_kwargs", None) or {}
    # Anthropic/OpenAI extended-thinking surfacing.
    rc = additional.get("reasoning_content")
    if isinstance(rc, str) and rc:
        reasoning_text += rc

    return content_text, reasoning_text


def _safe_jsonify(value: Any) -> Any:
    """Coerce arbitrary tool inputs/outputs into JSON-serialisable shape."""
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


async def astream_events_to_sse(
    graph: Any,
    input: dict[str, Any],
    task_state: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, str]]:
    """Run ``graph.astream_events(input, version="v2")`` and yield SSE events.

    Each yielded dict has the shape ``{"event": <name>, "data": <str>}``
    suitable for sse-starlette's ``EventSourceResponse``.

    Args:
        graph: A compiled deepagents graph (from ``build_agent``).
        input: The LangGraph state input — typically ``{"messages": [...]}``.
        task_state: Optional dict to record live agent state (todos, files,
            counts). Mutated in-place; the endpoint layer can read this
            for ``/status`` polls or to persist final state.

    Yields:
        SSE event dicts (``event``/``data`` keys).
    """
    state = task_state if task_state is not None else {}
    state.setdefault("todos", [])
    state.setdefault("files", {})
    state.setdefault("tool_calls", [])

    try:
        async for event in graph.astream_events(input, version="v2"):
            etype = event.get("event")
            name = event.get("name", "")
            data = event.get("data", {}) or {}

            if etype == "on_chat_model_stream":
                chunk = data.get("chunk")
                if chunk is None:
                    continue
                content_text, reasoning_text = _extract_content_delta(chunk)
                if reasoning_text:
                    yield {"event": "thinking", "data": reasoning_text}
                if content_text:
                    yield {"event": "message", "data": content_text}
                continue

            if etype == "on_tool_start":
                tool_input = _safe_jsonify(data.get("input") or {})
                run_id = event.get("run_id", "")
                if name == "write_todos":
                    todos = []
                    if isinstance(tool_input, dict):
                        todos = tool_input.get("todos") or []
                    state["todos"] = todos
                    yield {
                        "event": "todo_update",
                        "data": json.dumps({"todos": todos}),
                    }
                    continue
                state["tool_calls"].append(
                    {"id": run_id, "name": name, "input": tool_input}
                )
                yield {
                    "event": "tool_call",
                    "data": json.dumps(
                        {"id": run_id, "name": name, "arguments": tool_input}
                    ),
                }
                continue

            if etype == "on_tool_end":
                if name == "write_todos":
                    # We already surfaced todos at on_tool_start; the end
                    # event carries the same payload back as output.
                    continue
                run_id = event.get("run_id", "")
                output = _safe_jsonify(data.get("output"))
                yield {
                    "event": "tool_result",
                    "data": json.dumps({"id": run_id, "name": name, "result": output}),
                }
                continue

            # Everything else (chain start/end, retriever, etc.) is dropped.
            continue

    except Exception as exc:  # noqa: BLE001 — surface to client as SSE error.
        logger.exception("[agents.event_bridge] astream_events failed")
        yield {"event": "error", "data": json.dumps({"message": str(exc)})}
        return

    yield {"event": "done", "data": ""}


__all__ = ["astream_events_to_sse"]
