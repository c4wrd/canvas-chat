import asyncio

import litellm
from fastapi.testclient import TestClient

import canvas_chat.app as app_module
from canvas_chat.app import app
from canvas_chat.config import AppConfig


def test_provider_models_copilot_without_api_key(monkeypatch):
    """Copilot models should be available without api_key in request."""
    monkeypatch.setattr(
        litellm,
        "github_copilot_models",
        {"github_copilot/gpt-4o", "github_copilot/gpt-4o-mini"},
    )

    client = TestClient(app)
    response = client.post("/api/provider-models", json={"provider": "github_copilot"})

    assert response.status_code == 200
    data = response.json()
    assert data, "Expected copilot models in response"
    ids = {model["id"] for model in data}
    assert "github_copilot/gpt-4o" in ids
    assert all(model["provider"] == "GitHub Copilot" for model in data)


def test_provider_models_copilot_blocked_in_admin_mode(monkeypatch):
    """Copilot models should be blocked in admin mode."""
    admin_config = AppConfig(models=[], plugins=[], admin_mode=True)
    monkeypatch.setattr(app_module, "get_admin_config", lambda: admin_config)

    client = TestClient(app)
    response = client.post("/api/provider-models", json={"provider": "github_copilot"})

    assert response.status_code == 400
    assert "admin mode" in response.json()["detail"].lower()


# --- OpenRouter tests ---


class _FakeResponse:
    """Minimal fake httpx.Response for testing fetch functions."""

    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    """Fake httpx.AsyncClient that returns a canned OpenRouter models response.

    Usage: monkeypatch httpx.AsyncClient in the app module to this class.
    """

    def __init__(self, *args, **kwargs):
        self._headers = kwargs.get("headers", {})

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None):
        # Return text chat, vision, and non-text image-only models.
        payload = {
            "data": [
                {
                    "id": "openai/gpt-4o",
                    "name": "OpenAI: GPT-4o",
                    "context_length": 128000,
                    "modality": "text+image->text",
                    "architecture": {
                        "input_modalities": ["text", "image"],
                        "output_modalities": ["text"],
                    },
                },
                {
                    "id": "meta-llama/llama-3.3-70b-instruct",
                    "name": "Meta: Llama 3.3 70B Instruct",
                    "context_length": 128000,
                    "modality": "text->text",
                    "architecture": {
                        "input_modalities": ["text"],
                        "output_modalities": ["text"],
                    },
                },
                {
                    # Image-only output model: should be filtered out.
                    "id": "openai/dall-e-3",
                    "name": "OpenAI: DALL-E 3",
                    "context_length": 4096,
                    "modality": "text->image",
                    "architecture": {
                        "input_modalities": ["text"],
                        "output_modalities": ["image"],
                    },
                },
            ]
        }
        return _FakeResponse(200, payload)


def test_fetch_openrouter_models_parses_and_filters(monkeypatch):
    """fetch_openrouter_models should prefix IDs and filter non-text models."""
    monkeypatch.setattr(app_module.httpx, "AsyncClient", _FakeAsyncClient)

    models = asyncio.run(app_module.fetch_openrouter_models("sk-or-test"))

    # DALL-E (image-only output) should be filtered out.
    ids = {m["id"] for m in models}
    assert "openrouter/openai/gpt-4o" in ids
    assert "openrouter/meta-llama/llama-3.3-70b-instruct" in ids
    assert "openrouter/openai/dall-e-3" not in ids, (
        "Image-only model should be filtered"
    )

    # All models should be tagged with the OpenRouter provider.
    assert all(m["provider"] == "OpenRouter" for m in models)

    # Vision capability should be derived from input_modalities/modality.
    by_id = {m["id"]: m for m in models}
    assert by_id["openrouter/openai/gpt-4o"]["supports_vision"] is True
    assert (
        by_id["openrouter/meta-llama/llama-3.3-70b-instruct"]["supports_vision"]
        is False
    )

    # Context window should be passed through from OpenRouter's response.
    assert by_id["openrouter/openai/gpt-4o"]["context_window"] == 128000


def test_provider_models_openrouter_routes_and_merges_registry(monkeypatch):
    """The /api/provider-models endpoint should merge OpenRouter registry entries."""

    async def fake_fetch(api_key):
        return [
            {
                "id": "openrouter/openai/gpt-4o",
                "name": "OpenAI: GPT-4o",
                "provider": "OpenRouter",
                "context_window": 128000,
                "supports_vision": True,
            }
        ]

    monkeypatch.setattr(app_module, "fetch_openrouter_models", fake_fetch)

    client = TestClient(app)
    response = client.post(
        "/api/provider-models",
        json={"provider": "openrouter", "api_key": "sk-or-test"},
    )

    assert response.status_code == 200
    data = response.json()
    ids = {m["id"] for m in data}

    # Dynamically-fetched model is present.
    assert "openrouter/openai/gpt-4o" in ids
    # Static registry models for OpenRouter should be merged in (not duplicated).
    assert "openrouter/openai/gpt-4o-mini" in ids
    assert "openrouter/anthropic/claude-3.5-sonnet" in ids
    # All merged entries share the OpenRouter provider name.
    assert all(m["provider"] == "OpenRouter" for m in data)


def test_provider_models_openrouter_requires_api_key(monkeypatch):
    """OpenRouter should require an API key (unlike the public models endpoint)."""
    client = TestClient(app)
    response = client.post("/api/provider-models", json={"provider": "openrouter"})

    assert response.status_code == 400
    assert "api key" in response.json()["detail"].lower()


def test_provider_registry_name_covers_openrouter():
    """PROVIDER_REGISTRY_NAME should map openrouter -> OpenRouter for the merge step.

    This guards against the latent str.capitalize() bug that produced "Openrouter"
    (and "Openai" for openai), which would have skipped registry merging.
    """
    assert app_module.PROVIDER_REGISTRY_NAME["openrouter"] == "OpenRouter"
    assert app_module.PROVIDER_REGISTRY_NAME["openai"] == "OpenAI"
    assert app_module.PROVIDER_REGISTRY_NAME["github_copilot"] == "GitHub Copilot"


def test_model_registry_includes_current_openai_gpt5_models():
    """Static registry should expose current OpenAI GPT-5 models."""
    by_id = {model["id"]: model for model in app_module.MODEL_REGISTRY}

    for model_id, name in [
        ("openai/gpt-5.6-sol-pro", "GPT-5.6 Sol Pro"),
        ("openai/gpt-5.6-sol", "GPT-5.6 Sol"),
        ("openai/gpt-5.6-terra", "GPT-5.6 Terra"),
        ("openai/gpt-5.6-luna", "GPT-5.6 Luna"),
        ("openai/gpt-5.5-pro", "GPT-5.5 Pro"),
        ("openai/gpt-5.5", "GPT-5.5"),
        ("openai/gpt-5.4", "GPT-5.4"),
    ]:
        assert by_id[model_id]["name"] == name
        assert by_id[model_id]["provider"] == "OpenAI"
        assert by_id[model_id]["context_window"] == 1050000
        assert by_id[model_id]["supports_reasoning"] is True
        assert by_id[model_id]["supports_xhigh_reasoning"] is True
        assert by_id[model_id]["supports_vision"] is True


def test_model_registry_includes_current_anthropic_and_gemini_models():
    """Static registry should expose current Anthropic and Gemini models."""
    by_id = {model["id"]: model for model in app_module.MODEL_REGISTRY}

    assert by_id["anthropic/claude-opus-4-8"]["name"] == "Claude Opus 4.8"
    assert by_id["anthropic/claude-opus-4-8"]["provider"] == "Anthropic"
    assert by_id["anthropic/claude-opus-4-8"]["context_window"] == 1000000
    assert by_id["anthropic/claude-opus-4-8"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-opus-4-8"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-opus-4-8"]["supports_vision"] is True

    assert by_id["anthropic/claude-fable-5"]["name"] == "Claude Fable 5"
    assert by_id["anthropic/claude-fable-5"]["provider"] == "Anthropic"
    assert by_id["anthropic/claude-fable-5"]["context_window"] == 1000000
    assert by_id["anthropic/claude-fable-5"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-fable-5"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-fable-5"]["supports_vision"] is True

    assert by_id["anthropic/claude-sonnet-5"]["name"] == "Claude Sonnet 5"
    assert by_id["anthropic/claude-sonnet-5"]["provider"] == "Anthropic"
    assert by_id["anthropic/claude-sonnet-5"]["context_window"] == 1000000
    assert by_id["anthropic/claude-sonnet-5"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-sonnet-5"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-sonnet-5"]["supports_vision"] is True

    assert by_id["gemini/gemini-3.5-flash"]["name"] == "Gemini 3.5 Flash"
    assert by_id["gemini/gemini-3.5-flash"]["provider"] == "Google"
    assert by_id["gemini/gemini-3.5-flash"]["context_window"] == 1048576
    assert by_id["gemini/gemini-3.5-flash"]["supports_reasoning"] is True
    assert by_id["gemini/gemini-3.5-flash"]["supports_vision"] is True


def test_anthropic_static_provider_models_include_opus_4_8():
    """Anthropic provider fetch list should include Claude Opus 4.8."""
    by_id = {model["id"]: model for model in app_module.ANTHROPIC_MODELS}

    assert by_id["anthropic/claude-opus-4-8"]["name"] == "Claude Opus 4.8"
    assert by_id["anthropic/claude-opus-4-8"]["context_window"] == 1000000
    assert by_id["anthropic/claude-opus-4-8"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-opus-4-8"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-opus-4-8"]["supports_vision"] is True

    assert by_id["anthropic/claude-fable-5"]["name"] == "Claude Fable 5"
    assert by_id["anthropic/claude-fable-5"]["context_window"] == 1000000
    assert by_id["anthropic/claude-fable-5"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-fable-5"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-fable-5"]["supports_vision"] is True

    assert by_id["anthropic/claude-sonnet-5"]["name"] == "Claude Sonnet 5"
    assert by_id["anthropic/claude-sonnet-5"]["context_window"] == 1000000
    assert by_id["anthropic/claude-sonnet-5"]["supports_reasoning"] is True
    assert by_id["anthropic/claude-sonnet-5"]["supports_xhigh_reasoning"] is True
    assert by_id["anthropic/claude-sonnet-5"]["supports_vision"] is True
