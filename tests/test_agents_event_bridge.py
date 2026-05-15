"""Tests for the DeepAgents event bridge — astream_events("v2") -> SSE."""

import asyncio
import json
from collections.abc import AsyncIterator
from types import SimpleNamespace

from canvas_chat.agents.event_bridge import astream_events_to_sse


class _FakeGraph:
    """Stand-in for a CompiledStateGraph; replays a canned event stream."""

    def __init__(self, events):
        self._events = events

    async def astream_events(self, _input, version: str = "v2") -> AsyncIterator[dict]:
        assert version == "v2"
        for ev in self._events:
            yield ev


def _collect(graph, input=None):
    """Drain the SSE stream synchronously for assertion."""

    async def run():
        out = []
        state = {}
        async for sse in astream_events_to_sse(graph, input or {}, state):
            out.append(sse)
        return out, state

    return asyncio.run(run())


def test_chat_model_stream_emits_message():
    chunk = SimpleNamespace(content="Hello", additional_kwargs={})
    graph = _FakeGraph([{"event": "on_chat_model_stream", "data": {"chunk": chunk}}])
    out, _ = _collect(graph)
    assert out[0] == {"event": "message", "data": "Hello"}
    assert out[-1]["event"] == "done"


def test_reasoning_chunk_emits_thinking():
    chunk = SimpleNamespace(content="", additional_kwargs={"reasoning_content": "Hmm"})
    graph = _FakeGraph([{"event": "on_chat_model_stream", "data": {"chunk": chunk}}])
    out, _ = _collect(graph)
    types = [e["event"] for e in out]
    assert "thinking" in types
    thinking = next(e for e in out if e["event"] == "thinking")
    assert thinking["data"] == "Hmm"


def test_write_todos_emits_todo_update_and_updates_state():
    todos = [{"task": "Step 1", "status": "pending"}]
    graph = _FakeGraph(
        [
            {
                "event": "on_tool_start",
                "name": "write_todos",
                "run_id": "r1",
                "data": {"input": {"todos": todos}},
            },
            {
                "event": "on_tool_end",
                "name": "write_todos",
                "run_id": "r1",
                "data": {"output": {"todos": todos}},
            },
        ]
    )
    out, state = _collect(graph)
    todo_events = [e for e in out if e["event"] == "todo_update"]
    assert len(todo_events) == 1
    payload = json.loads(todo_events[0]["data"])
    assert payload["todos"] == todos
    assert state["todos"] == todos
    # write_todos should not produce a tool_call/tool_result.
    assert not any(e["event"] in ("tool_call", "tool_result") for e in out)


def test_regular_tool_emits_call_and_result():
    graph = _FakeGraph(
        [
            {
                "event": "on_tool_start",
                "name": "calculator",
                "run_id": "r2",
                "data": {"input": {"expression": "2+2"}},
            },
            {
                "event": "on_tool_end",
                "name": "calculator",
                "run_id": "r2",
                "data": {"output": {"result": 4}},
            },
        ]
    )
    out, state = _collect(graph)
    calls = [e for e in out if e["event"] == "tool_call"]
    results = [e for e in out if e["event"] == "tool_result"]
    assert len(calls) == 1
    assert len(results) == 1
    call_payload = json.loads(calls[0]["data"])
    assert call_payload["name"] == "calculator"
    assert call_payload["arguments"] == {"expression": "2+2"}
    result_payload = json.loads(results[0]["data"])
    assert result_payload["result"] == {"result": 4}
    assert state["tool_calls"][0]["name"] == "calculator"


def test_unknown_event_types_dropped():
    graph = _FakeGraph(
        [
            {"event": "on_chain_start", "name": "agent"},
            {"event": "on_retriever_start", "name": "x"},
        ]
    )
    out, _ = _collect(graph)
    # Only the terminal done event survives.
    assert out == [{"event": "done", "data": ""}]


def test_exception_surfaces_as_error_event():
    class _ExplodingGraph:
        async def astream_events(self, _input, version: str = "v2"):
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": SimpleNamespace(content="warming up", additional_kwargs={})
                },
            }
            raise RuntimeError("boom")

    out, _ = _collect(_ExplodingGraph())
    events = [e["event"] for e in out]
    assert "error" in events
    err = next(e for e in out if e["event"] == "error")
    payload = json.loads(err["data"])
    assert "boom" in payload["message"]
