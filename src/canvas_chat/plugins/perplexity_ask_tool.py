"""Perplexity Ask Tool Plugin

Provides web-grounded Q&A capability using Perplexity AI.
Returns answers with citations from web sources.
"""

import logging
import os
from typing import Any

from perplexity import AsyncPerplexity

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry

logger = logging.getLogger(__name__)


class PerplexityAskTool(ToolPlugin):
    """Ask questions with web-grounded answers and citations using Perplexity AI."""

    def get_name(self) -> str:
        return "perplexity_ask"

    def get_description(self) -> str:
        return (
            "Ask Perplexity AI for web-grounded answers with citations. "
            "Use this when you need current, factual information from the web "
            "with source verification. Returns an answer with cited sources."
        )

    def get_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to ask Perplexity",
                },
                "recency_filter": {
                    "type": "string",
                    "description": "Filter results by recency: 'day', 'week', 'month', 'year', or null for no filter",
                    "enum": ["day", "week", "month", "year"],
                },
            },
            "required": ["question"],
        }

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Execute a Perplexity ask request.

        Args:
            question: The question to ask
            recency_filter: Optional recency filter
            _api_keys: API keys passed from request context (injected by tool runner)

        Returns:
            Dictionary with answer and citations
        """
        question = kwargs.get("question", "")
        recency_filter = kwargs.get("recency_filter")

        if not question:
            return {"error": "No question provided", "answer": "", "citations": []}

        # Get API key: first check kwargs (passed from frontend), then env var
        api_keys = kwargs.get("_api_keys", {})
        api_key = api_keys.get("perplexity") or os.environ.get("PERPLEXITY_API_KEY")

        if not api_key:
            return {
                "error": "Perplexity API key not configured. Add it in Settings or set PERPLEXITY_API_KEY environment variable.",
                "answer": "",
                "citations": [],
            }

        logger.info(f"[PerplexityAskTool] Asking: {question[:100]}...")

        try:
            async with AsyncPerplexity(api_key=api_key) as client:
                # Build web_search_options
                web_search_options = {}
                if recency_filter:
                    web_search_options["search_recency_filter"] = recency_filter

                response = await client.chat.completions.create(
                    messages=[{"role": "user", "content": question}],
                    model="sonar",  # Fast model for tool use
                    web_search_options=web_search_options if web_search_options else None,
                )

                answer = response.choices[0].message.content
                citations = (
                    getattr(response, 'citations', [])
                    or response.model_extra.get('citations', [])
                )

                # Format citations for display
                formatted_citations = []
                for citation in citations:
                    if isinstance(citation, str):
                        formatted_citations.append({"url": citation, "title": citation})
                    elif isinstance(citation, dict):
                        formatted_citations.append({
                            "url": citation.get("url", ""),
                            "title": citation.get("title", citation.get("url", "")),
                        })

                return {
                    "question": question,
                    "answer": answer,
                    "citations": formatted_citations,
                    "citation_count": len(formatted_citations),
                }

        except Exception as e:
            logger.error(f"[PerplexityAskTool] Failed: {e}")
            return {
                "error": f"Failed: {str(e)}",
                "answer": "",
                "citations": [],
            }


# Register the Perplexity ask tool
ToolRegistry.register(
    id="perplexity_ask",
    handler=PerplexityAskTool,
    priority=PRIORITY["BUILTIN"],
    enabled=True,
)

logger.info("Perplexity ask tool plugin loaded")
