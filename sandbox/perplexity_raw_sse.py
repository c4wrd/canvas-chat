"""Perplexity fast-search using raw httpx with manual SSE parsing (SDK workaround)."""

import asyncio
import json
import os

import httpx


async def parse_sse_line(line: str) -> tuple[str | None, str | None]:
    """Parse a single SSE line into (event_type, data)."""
    if line.startswith("event: "):
        return ("event", line[7:])
    elif line.startswith("data: "):
        return ("data", line[6:])
    return (None, None)


async def fast_search(query: str):
    """Perform a fast search using raw httpx with SSE parsing."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        print("Error: Set PERPLEXITY_API_KEY environment variable")
        return

    print(f"Query: {query}\n")

    current_event = None
    full_text = ""

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            "https://api.perplexity.ai/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "input": query,
                "preset": "fast-search",
                "stream": True,
            },
            timeout=60.0,
        ) as response:
            if response.status_code != 200:
                print(f"Error: {response.status_code}")
                return

            async for line in response.aiter_lines():
                if not line:
                    continue

                field, value = await parse_sse_line(line)

                if field == "event":
                    current_event = value
                elif field == "data" and value:
                    try:
                        data = json.loads(value)
                    except json.JSONDecodeError:
                        continue

                    # Handle different event types
                    if current_event == "response.output_text.delta":
                        delta = data.get("delta", "")
                        print(delta, end="", flush=True)
                        full_text += delta

                    elif current_event == "response.reasoning.started":
                        thought = data.get("thought", "")
                        print(f"[Thinking: {thought}]")

                    elif current_event == "response.reasoning.search_queries":
                        queries = data.get("queries", [])
                        print(f"[Searching: {', '.join(queries)}]")

                    elif current_event == "response.completed":
                        print("\n\n--- Done ---")
                        # Extract citations from completed response
                        resp = data.get("response", {})
                        output = resp.get("output", [])
                        for item in output:
                            if item.get("type") == "search_results":
                                results = item.get("results", [])
                                if results:
                                    print("\nSources:")
                                    for i, r in enumerate(results[:5], 1):
                                        print(f"  [{i}] {r.get('title', 'Untitled')}")
                                        print(f"      {r.get('url', '')}")

    print(f"\n\nFull response:\n{full_text}")


if __name__ == "__main__":
    query = "What is the capital of France?"
    asyncio.run(fast_search(query))
