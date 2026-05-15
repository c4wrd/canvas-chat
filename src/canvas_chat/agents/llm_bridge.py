"""Build a LangChain ChatLiteLLM from an AgentRunRequest.

This keeps a single source of truth for credentials, base URLs, and
GitHub Copilot headers — we route through the same helpers that
/api/chat uses (``inject_admin_credentials`` and
``prepare_copilot_openai_request``), then map the resulting kwargs onto
the names that ChatLiteLLM expects.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_litellm import ChatLiteLLM

from canvas_chat.agents.models import AgentRunRequest

logger = logging.getLogger(__name__)


def build_chat_model(request: AgentRunRequest) -> ChatLiteLLM:
    """Construct a ChatLiteLLM instance with admin/Copilot credentials applied.

    The function is intentionally pure — it doesn't mutate the request
    itself. Admin-mode credential injection happens at the endpoint
    layer (before this is called) so callers can choose whether to apply
    it.
    """
    # Import lazily to avoid a circular dep when app.py imports from this
    # package during module-load.
    from canvas_chat.app import prepare_copilot_openai_request

    model = request.effective_model

    # Start from the same kwargs shape /api/chat builds for litellm, so
    # Copilot transformations apply identically.
    kwargs: dict[str, Any] = {
        "model": model,
        "temperature": request.agent.temperature,
        "streaming": True,
    }
    if request.api_key:
        kwargs["api_key"] = request.api_key
    if request.base_url:
        # litellm/copilot helper writes ``base_url``; ChatLiteLLM reads
        # ``api_base``. We translate after the Copilot transform.
        kwargs["base_url"] = request.base_url

    # Copilot rewrites model + base_url + headers (extra_headers).
    kwargs = prepare_copilot_openai_request(kwargs, model, request.api_key)

    # ChatLiteLLM uses ``api_base`` instead of ``base_url``.
    if "base_url" in kwargs:
        kwargs["api_base"] = kwargs.pop("base_url")

    logger.debug(
        "[agents.llm_bridge] Building ChatLiteLLM model=%s api_base=%s",
        kwargs.get("model"),
        kwargs.get("api_base"),
    )
    return ChatLiteLLM(**kwargs)


__all__ = ["build_chat_model"]
