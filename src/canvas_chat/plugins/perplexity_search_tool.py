"""Perplexity Search Tool Plugin

Provides web search capability using Perplexity AI.
Returns ranked search results with titles, URLs, and snippets.
"""

import json
import logging
import os
import re
from typing import Any

from perplexity import AsyncPerplexity

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry

logger = logging.getLogger(__name__)


class PerplexitySearchTool(ToolPlugin):
    """Search the web using Perplexity AI for ranked results."""

    def get_name(self) -> str:
        return "perplexity_search"

    def get_description(self) -> str:
        return (
            "Search the web using Perplexity AI for ranked results. "
            "Use this when you need to find relevant web pages, articles, "
            "or resources on a topic. Returns a list of search results "
            "with titles, URLs, and snippets."
        )

    def get_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                },
                "num_results": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5, max: 10)",
                    "default": 5,
                },
                "domain_filter": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of domains to search within (e.g., ['wikipedia.org', 'github.com'])",
                },
            },
            "required": ["query"],
        }

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Execute a Perplexity search request.

        Args:
            query: Search query string
            num_results: Maximum results to return (default: 5)
            domain_filter: Optional list of domains to filter
            _api_keys: API keys passed from request context (injected by tool runner)

        Returns:
            Dictionary with search results
        """
        query = kwargs.get("query", "")
        num_results = min(kwargs.get("num_results", 5), 10)
        domain_filter = kwargs.get("domain_filter")

        if not query:
            return {"error": "No search query provided", "results": []}

        # Get API key: first check kwargs (passed from frontend), then env var
        api_keys = kwargs.get("_api_keys", {})
        api_key = api_keys.get("perplexity") or os.environ.get("PERPLEXITY_API_KEY")

        if not api_key:
            return {
                "error": "Perplexity API key not configured. Add it in Settings or set PERPLEXITY_API_KEY environment variable.",
                "results": [],
            }

        logger.info(f"[PerplexitySearchTool] Searching for: {query}")

        try:
            async with AsyncPerplexity(api_key=api_key) as client:
                # Use chat completion with a search-focused prompt
                system_prompt = (
                    f"You are a search assistant. Find the top {num_results} "
                    "most relevant web pages for the query. For each result, provide:\n"
                    "1. Title\n2. URL\n3. Brief description (1-2 sentences)\n\n"
                    "Format your response as a JSON array with objects containing "
                    "'title', 'url', and 'snippet' fields. Only output the JSON array, no other text."
                )

                # Build web_search_options
                web_search_options = {}
                if domain_filter:
                    web_search_options["search_domain_filter"] = domain_filter

                response = await client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Search query: {query}"},
                    ],
                    model="sonar",  # Fast model for search
                    web_search_options=web_search_options if web_search_options else None,
                )

                content = response.choices[0].message.content
                citations = (
                    getattr(response, 'citations', [])
                    or response.model_extra.get('citations', [])
                )

                # Try to parse JSON results from response
                results = []
                try:
                    # Find JSON array in response
                    json_match = re.search(r'\[[\s\S]*\]', content)
                    if json_match:
                        parsed = json.loads(json_match.group())
                        for item in parsed[:num_results]:
                            results.append({
                                "title": item.get("title", "Untitled"),
                                "url": item.get("url", ""),
                                "snippet": item.get("snippet", item.get("description", "")),
                            })
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"[PerplexitySearchTool] Failed to parse JSON: {e}")
                    # Fall back to using citations if available
                    for citation in citations[:num_results]:
                        if isinstance(citation, str):
                            results.append({
                                "title": citation,
                                "url": citation,
                                "snippet": "",
                            })
                        elif isinstance(citation, dict):
                            results.append({
                                "title": citation.get("title", "Untitled"),
                                "url": citation.get("url", ""),
                                "snippet": citation.get("snippet", ""),
                            })

                return {
                    "query": query,
                    "results": results,
                    "result_count": len(results),
                }

        except Exception as e:
            logger.error(f"[PerplexitySearchTool] Search failed: {e}")
            return {
                "error": f"Search failed: {str(e)}",
                "query": query,
                "results": [],
            }


# Register the Perplexity search tool
ToolRegistry.register(
    id="perplexity_search",
    handler=PerplexitySearchTool,
    priority=PRIORITY["BUILTIN"],
    enabled=True,
)

logger.info("Perplexity search tool plugin loaded")
