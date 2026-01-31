"""Simple example of Perplexity AsyncPerplexity with responses.create for fast-search."""

import asyncio
import logging
import os
import sys

import httpx

# Enable trace-level logging for httpx and perplexity SDK
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)

# Set specific loggers to DEBUG
logging.getLogger("httpx").setLevel(logging.DEBUG)
logging.getLogger("httpcore").setLevel(logging.DEBUG)
logging.getLogger("perplexity").setLevel(logging.DEBUG)

logger = logging.getLogger(__name__)

from perplexity import AsyncPerplexity


async def raw_sse_test(query: str):
    """Test with raw httpx to see actual SSE response."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")

    print("\n" + "=" * 60)
    print("RAW HTTPX SSE TEST")
    print("=" * 60 + "\n")

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
            print(f"Status: {response.status_code}")
            print(f"Headers: {dict(response.headers)}\n")
            print("Raw SSE body:")
            print("-" * 40)

            async for line in response.aiter_lines():
                print(f"LINE: {line!r}")

            print("-" * 40)


async def fast_search(query: str):
    """Perform a fast search using Perplexity responses API."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        print("Error: Set PERPLEXITY_API_KEY environment variable")
        return

    logger.debug("API key found, length=%d", len(api_key))
    logger.debug("Creating AsyncPerplexity client...")

    try:
        async with AsyncPerplexity(api_key=api_key) as client:
            logger.debug("Client created, calling responses.create...")
            logger.debug("Request params: input=%r, preset='fast-search', stream=True", query)

            stream = await client.responses.create(
                input=query,
                preset="fast-search",
                stream=True,
            )

            logger.debug("Stream object received: %s (type=%s)", stream, type(stream))

            print(f"Query: {query}\n")
            print("Response:")
            print("-" * 40)

            chunk_count = 0
            async for chunk in stream:
                chunk_count += 1
                logger.debug("Chunk #%d: type=%s, chunk=%r", chunk_count, getattr(chunk, 'type', None), chunk)
                print(f"[{chunk.type}]", end=" ", flush=True)

                if chunk.type == "response.content.delta":
                    # Content text chunk
                    if hasattr(chunk, "delta") and hasattr(chunk.delta, "text"):
                        print(chunk.delta.text, end="", flush=True)
                    else:
                        print(chunk)

                elif chunk.type == "response.completed":
                    print("\n" + "-" * 40)
                    print("Done!")
                    # Print citations if available
                    if hasattr(chunk, "response") and hasattr(chunk.response, "citations"):
                        print("\nCitations:")
                        for i, cite in enumerate(chunk.response.citations or [], 1):
                            print(f"  [{i}] {cite}")

                else:
                    # Log other event types for debugging
                    print(chunk)

            logger.debug("Stream exhausted after %d chunks", chunk_count)

    except Exception as e:
        logger.exception("Error during fast_search: %s", e)
        raise


if __name__ == "__main__":
    query = "What is the capital of France?"

    # First, test with raw httpx to see actual response
    asyncio.run(raw_sse_test(query))

    # Then test with SDK
    print("\n" + "=" * 60)
    print("PERPLEXITY SDK TEST")
    print("=" * 60 + "\n")
    logger.info("Starting fast_search with query: %r", query)
    asyncio.run(fast_search(query))
    logger.info("fast_search completed")
