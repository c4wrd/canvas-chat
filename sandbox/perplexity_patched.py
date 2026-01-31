"""Perplexity SDK with monkey-patch to fix the streaming bug."""

import asyncio
import os
from typing import Any, AsyncIterator, cast

# Patch BEFORE importing the client
import perplexity._streaming as streaming_module


async def _patched_stream(self) -> AsyncIterator[Any]:
    """Fixed __stream__ that yields events WITH event types (not just None)."""
    cast_to = cast(Any, self._cast_to)
    response = self.response
    process_data = self._client._process_response_data
    iterator = self._iter_events()

    try:
        async for sse in iterator:
            if sse.data.startswith("[DONE]"):
                break

            if sse.event == "error":
                body = sse.data
                try:
                    body = sse.json()
                    err_msg = f"{body}"
                except Exception:
                    err_msg = sse.data or f"Error code: {response.status_code}"

                raise self._client._make_status_error(
                    err_msg,
                    body=body,
                    response=self.response,
                )

            # BUG FIX: Changed from "if sse.event is None:" to yield all events
            if sse.event is not None:
                data = sse.json()
                # Add the event type to the data for easier handling
                data["type"] = sse.event
                yield process_data(data=data, cast_to=cast_to, response=response)
    finally:
        await response.aclose()


# Apply the patch
streaming_module.AsyncStream._AsyncStream__stream__ = _patched_stream  # type: ignore

# Now import the client (after patching)
from perplexity import AsyncPerplexity


async def fast_search(query: str):
    """Perform a fast search using the patched Perplexity SDK."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        print("Error: Set PERPLEXITY_API_KEY environment variable")
        return

    print(f"Query: {query}\n")

    async with AsyncPerplexity(api_key=api_key) as client:
        stream = await client.responses.create(
            input=query,
            preset="fast-search",
            stream=True,
        )

        async for chunk in stream:
            event_type = getattr(chunk, "type", None)

            if event_type == "response.output_text.delta":
                delta = getattr(chunk, "delta", "")
                print(delta, end="", flush=True)

            elif event_type == "response.reasoning.started":
                thought = getattr(chunk, "thought", "")
                print(f"\n[Thinking: {thought}]")

            elif event_type == "response.reasoning.search_queries":
                queries = getattr(chunk, "queries", [])
                print(f"\n[Searching: {', '.join(queries)}]")

            elif event_type == "response.completed":
                print("\n\n--- Done ---")

    print()


if __name__ == "__main__":
    query = "What is the capital of France?"
    asyncio.run(fast_search(query))
