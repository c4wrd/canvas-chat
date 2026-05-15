"""In-memory task registry and lifecycle helpers for /api/agents/*.

Mirrors the ``_deep_research_tasks`` pattern in app.py: a single dict
keyed by task_id stores per-run state, an asyncio task does the work
and pushes SSE events into a queue, and ``/stream`` drains the queue —
which survives browser reconnects as long as the server process lives.

There is no checkpointer in v1, so a server restart loses in-flight
runs. v3 adds a LangGraph checkpointer for true resumability.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from canvas_chat.agents.builder import build_agent
from canvas_chat.agents.event_bridge import astream_events_to_sse
from canvas_chat.agents.models import AgentRunRequest

logger = logging.getLogger(__name__)


# task_id -> dict
_agent_tasks: dict[str, dict[str, Any]] = {}

# A terminal "done" sentinel pushed into the queue so /stream knows to
# stop iterating once the producer has finished.
_QUEUE_DONE = object()


def _build_initial_messages(request: AgentRunRequest) -> list[dict[str, str]]:
    """Convert parent_messages + input into the LangGraph state input.

    Parent messages flow first (chronological), then the new user input.
    """
    messages: list[dict[str, str]] = []
    for pm in request.parent_messages:
        messages.append({"role": pm.role, "content": pm.content})
    messages.append({"role": "user", "content": request.input})
    return messages


async def _run_agent(task_id: str, request: AgentRunRequest) -> None:
    """Background worker: drive the agent and push SSE events into queue."""
    state = _agent_tasks[task_id]
    queue: asyncio.Queue = state["queue"]

    state["status"] = "in_progress"
    try:
        graph = build_agent(request)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[agents.runtime] Failed to build agent")
        state["status"] = "failed"
        state["error"] = f"Failed to build agent: {exc}"
        state["finished_at"] = time.time()
        await queue.put({"event": "error", "data": str(exc)})
        await queue.put(_QUEUE_DONE)
        return

    graph_input = {"messages": _build_initial_messages(request)}

    try:
        async for sse_event in astream_events_to_sse(graph, graph_input, state):
            await queue.put(sse_event)
            if sse_event["event"] == "error":
                state["status"] = "failed"
                state["error"] = sse_event["data"]
    except asyncio.CancelledError:
        state["status"] = "stopped"
        state["error"] = "Run cancelled"
        await queue.put({"event": "error", "data": "Run cancelled"})
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("[agents.runtime] Run failed")
        state["status"] = "failed"
        state["error"] = str(exc)
        await queue.put({"event": "error", "data": str(exc)})
    else:
        if state["status"] == "in_progress":
            state["status"] = "completed"
    finally:
        state["finished_at"] = time.time()
        await queue.put(_QUEUE_DONE)


def start_run(request: AgentRunRequest) -> str:
    """Kick off an agent run; return the new task_id."""
    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()

    state: dict[str, Any] = {
        "task_id": task_id,
        "status": "pending",
        "agent": request.agent.model_dump(),
        "input": request.input,
        "started_at": time.time(),
        "finished_at": None,
        "error": None,
        "todos": [],
        "files": {},
        "tool_calls": [],
        "queue": queue,
        "async_task": None,
    }
    _agent_tasks[task_id] = state

    state["async_task"] = asyncio.create_task(_run_agent(task_id, request))
    logger.info(
        "[agents.runtime] Started run task_id=%s slug=%s", task_id, request.agent.slug
    )
    return task_id


async def stream_events(task_id: str):
    """Yield SSE events for a running task, terminating when the task does."""
    state = _agent_tasks.get(task_id)
    if state is None:
        yield {"event": "error", "data": "Task not found"}
        return

    queue: asyncio.Queue = state["queue"]
    while True:
        item = await queue.get()
        if item is _QUEUE_DONE:
            return
        yield item


def stop_run(task_id: str) -> bool:
    """Cancel an in-flight run. Returns True if a task was cancelled."""
    state = _agent_tasks.get(task_id)
    if state is None:
        return False
    async_task: asyncio.Task | None = state.get("async_task")
    if async_task is None or async_task.done():
        return False
    async_task.cancel()
    return True


def get_status(task_id: str) -> dict[str, Any] | None:
    """Return a lightweight status dict for /status polls."""
    state = _agent_tasks.get(task_id)
    if state is None:
        return None
    return {
        "task_id": task_id,
        "status": state["status"],
        "error": state.get("error"),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
    }


__all__ = [
    "_agent_tasks",
    "get_status",
    "start_run",
    "stop_run",
    "stream_events",
]
