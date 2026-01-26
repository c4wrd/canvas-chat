"""Web Search Tool Plugin

Provides web search capability using DuckDuckGo (no API key required).
"""

import logging
from typing import Any

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry

logger = logging.getLogger(__name__)


class WebSearchTool(ToolPlugin):
    """Web search tool using DuckDuckGo."""

    def get_name(self) -> str:
        return "web_search"

    def get_description(self) -> str:
        return (
            "Search the web for current information. Use this when you need "
            "up-to-date information, facts, news, or data that might not be "
            "in your training data."
        )

    def get_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to look up on the web",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5)",
                    "default": 5,
                },
            },
            "required": ["query"],
        }

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Execute a web search using DuckDuckGo.

        Args:
            query: Search query string
            max_results: Maximum results to return (default: 5)

        Returns:
            Dictionary with search results
        """
        query = kwargs.get("query", "")
        max_results = kwargs.get("max_results", 5)

        if not query:
            return {"error": "No search query provided", "results": []}

        logger.info(f"[WebSearchTool] Searching for: {query}")

        try:
            from ddgs import DDGS

            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))

            formatted_results = []
            for result in results:
                formatted_results.append({
                    "title": result.get("title", "Untitled"),
                    "url": result.get("href", ""),
                    "snippet": result.get("body", ""),
                })

            return {
                "query": query,
                "results": formatted_results,
                "result_count": len(formatted_results),
            }

        except Exception as e:
            logger.error(f"[WebSearchTool] Search failed: {e}")
            return {
                "error": f"Search failed: {str(e)}",
                "query": query,
                "results": [],
            }


# Register the web search tool
ToolRegistry.register(
    id="web_search",
    handler=WebSearchTool,
    priority=PRIORITY["BUILTIN"],
    enabled=True,
)

logger.info("Web search tool plugin loaded")
