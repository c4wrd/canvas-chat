"""Pydantic schemas for the /api/agents/* endpoints."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class SubAgentModel(BaseModel):
    """A sub-agent specification. Stored in v1 configs but ignored by the
    backend builder; wired in v2."""

    name: str
    description: str
    system_prompt: str
    tools: list[str] = Field(default_factory=list)
    model: str | None = None


class AgentConfigModel(BaseModel):
    """A user-defined agent configuration sent in full on every /start.

    The server treats configs as ephemeral payloads — there is no
    server-side catalog of user configs in v1. Admin-mode presets are a
    separate code path.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    version: int = 1
    name: str
    icon: str = "🤖"
    slug: str
    description: str = ""
    system_prompt: str
    model: str
    temperature: float = 0.7
    tools: list[str] = Field(default_factory=list)
    filesystem_enabled: bool = True
    max_iterations: int = 25
    subagents: list[SubAgentModel] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class ParentMessage(BaseModel):
    """A message from the user's selected parent nodes, passed as context."""

    role: Literal["user", "assistant", "system"]
    content: str


class AgentRunRequest(BaseModel):
    """Request body for POST /api/agents/start."""

    agent: AgentConfigModel
    input: str
    parent_messages: list[ParentMessage] = Field(default_factory=list)
    api_key: str | None = None
    base_url: str | None = None
    # Allow overriding the config's model at run time (e.g., user picked a
    # different model in the toolbar before invoking). Optional.
    model: str | None = None

    @property
    def effective_model(self) -> str:
        return self.model or self.agent.model


class AgentRunResponse(BaseModel):
    """Response body for POST /api/agents/start."""

    task_id: str
    status: Literal["pending", "in_progress", "completed", "failed", "stopped"]


class AgentStatusResponse(BaseModel):
    """Response body for GET /api/agents/status/{task_id}."""

    task_id: str
    status: Literal[
        "pending",
        "in_progress",
        "completed",
        "failed",
        "stopped",
        "not_found",
    ]
    error: str | None = None
    started_at: float | None = None
    finished_at: float | None = None


class AgentConfigsResponse(BaseModel):
    """Response body for GET /api/agents/configs (admin-mode presets)."""

    configs: list[AgentConfigModel]


__all__ = [
    "AgentConfigModel",
    "AgentConfigsResponse",
    "AgentRunRequest",
    "AgentRunResponse",
    "AgentStatusResponse",
    "ParentMessage",
    "SubAgentModel",
    "Any",  # re-export for downstream typing convenience
]
