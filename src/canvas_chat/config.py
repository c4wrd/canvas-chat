"""Configuration module for canvas-chat.

This module provides configuration management for:
1. Model definitions (pre-populate model picker in UI)
2. Custom plugins (node types)
3. Admin mode (server-side API key management)

Two modes:
- Normal mode: Config defines models + plugins, users provide their own API keys via UI
- Admin mode: Config + server-side API keys, users cannot configure keys (enterprise)

Key design principles:
- Config is optional (can run without config.yaml)
- Plugins work with or without admin mode
- API keys are NEVER sent to the frontend in admin mode
- Environment variables are used for secrets in admin mode
- Validation happens at startup to fail fast with clear errors
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ruamel.yaml import YAML

logger = logging.getLogger(__name__)

_MCP_SERVER_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


@dataclass
class ModelConfig:
    """Configuration for a single model.

    In normal mode: Just defines what models are available (users add their own keys)
    In admin mode: Also specifies which env var contains the API key
    """

    id: str  # LiteLLM-compatible model ID (provider/model-name)
    name: str  # Display name shown in UI
    api_key_env_var: str | None = None  # Environment variable name (admin mode only)
    context_window: int = 128000  # Token limit for context building
    endpoint_env_var: str | None = None  # Optional env var for custom endpoint

    @classmethod
    def from_dict(
        cls, data: dict, index: int, admin_mode: bool = False
    ) -> "ModelConfig":
        """Create ModelConfig from YAML dict with validation.

        Args:
            data: YAML dictionary
            index: Index in models list (for error messages)
            admin_mode: Whether running in admin mode (requires apiKeyEnvVar)
        """
        # Validate required fields
        if "id" not in data:
            raise ValueError(f"Model at index {index} missing 'id' field")

        model_id = data["id"]

        # In admin mode, apiKeyEnvVar is required
        if admin_mode and "apiKeyEnvVar" not in data:
            raise ValueError(
                f"Model {model_id} missing 'apiKeyEnvVar' field "
                f"(required in admin mode)"
            )

        return cls(
            id=model_id,
            name=data.get("name", model_id),
            api_key_env_var=data.get("apiKeyEnvVar"),
            context_window=data.get("contextWindow", 128000),
            endpoint_env_var=data.get("endpointEnvVar"),
        )


@dataclass
class PluginConfig:
    """Configuration for a plugin (JavaScript, Python, or both).

    Supports three formats:
    1. JavaScript-only: js_path set, py_path None
    2. Python-only: py_path set, js_path None
    3. Paired: Both js_path and py_path set (same plugin_id)
    """

    js_path: Path | None = None
    py_path: Path | None = None
    id: str | None = None  # Explicit plugin ID (for pairing JS and PY)

    @property
    def plugin_id(self) -> str:
        """Get plugin identifier (for pairing JS and PY).

        Uses explicit id if provided, otherwise derives from filename.
        """
        if self.id:
            return self.id
        # Derive from JS or PY filename
        if self.js_path:
            return self.js_path.stem
        if self.py_path:
            return self.py_path.stem
        raise ValueError("Plugin must have at least js_path or py_path")

    @classmethod
    def from_dict(cls, data: dict | str, config_dir: Path) -> "PluginConfig | None":
        """Create PluginConfig from YAML entry.

        Supports:
        - String: "./plugins/my-plugin.js" (JS-only, backwards compatible)
        - Dict with "path": {"path": "./plugins/my-plugin.js"}
          (JS-only, backwards compatible)
        - Dict with "js"/"py": {"js": "./plugins/my-plugin.js",
          "py": "./plugins/my_plugin.py", "id": "my-plugin"}

        Args:
            data: Plugin entry from YAML (string or dict)
            config_dir: Directory containing config.yaml (for resolving relative paths)

        Returns:
            PluginConfig if valid, None if invalid/not found
        """
        js_path = None
        py_path = None
        plugin_id = None

        # Handle string format (backwards compatible)
        if isinstance(data, str):
            plugin_path = Path(data)
            if not plugin_path.is_absolute():
                plugin_path = config_dir / plugin_path
            if not plugin_path.exists():
                logger.warning(f"Plugin file not found: {plugin_path}")
                return None
            # Determine if it's JS or PY by extension
            if plugin_path.suffix == ".js":
                js_path = plugin_path.resolve()
            elif plugin_path.suffix == ".py":
                py_path = plugin_path.resolve()
            else:
                logger.warning(f"Plugin file must be .js or .py: {plugin_path}")
                return None

        # Handle dict format
        elif isinstance(data, dict):
            # Backwards compatible: "path" field
            if "path" in data:
                plugin_path = Path(data["path"])
                if not plugin_path.is_absolute():
                    plugin_path = config_dir / plugin_path
                if not plugin_path.exists():
                    logger.warning(f"Plugin file not found: {plugin_path}")
                    return None
                if plugin_path.suffix == ".js":
                    js_path = plugin_path.resolve()
                elif plugin_path.suffix == ".py":
                    py_path = plugin_path.resolve()
                else:
                    logger.warning(f"Plugin file must be .js or .py: {plugin_path}")
                    return None

            # New format: "js" and/or "py" fields
            if "js" in data:
                js_plugin_path = Path(data["js"])
                if not js_plugin_path.is_absolute():
                    js_plugin_path = config_dir / js_plugin_path
                if not js_plugin_path.exists():
                    logger.warning(f"Plugin JS file not found: {js_plugin_path}")
                    return None
                js_path = js_plugin_path.resolve()

            if "py" in data:
                py_plugin_path = Path(data["py"])
                if not py_plugin_path.is_absolute():
                    py_plugin_path = config_dir / py_plugin_path
                if not py_plugin_path.exists():
                    logger.warning(f"Plugin Python file not found: {py_plugin_path}")
                    return None
                py_path = py_plugin_path.resolve()

            # Explicit plugin ID (for pairing)
            if "id" in data:
                plugin_id = data["id"]

            # Must have at least one path
            if not js_path and not py_path:
                logger.warning(f"Plugin entry must have 'js' or 'py' field: {data}")
                return None

        else:
            logger.warning(f"Invalid plugin entry: {data}")
            return None

        return cls(js_path=js_path, py_path=py_path, id=plugin_id)


@dataclass
class MCPServerConfig:
    """Configuration for a single MCP (Model Context Protocol) server.

    Exactly one transport must be configured:
    - stdio: set `command` (and optionally `args`/`env`/`env_passthrough`) to
      spawn a local subprocess speaking MCP over stdio.
    - streamable HTTP: set `url` (and optionally `headers`/`headers_env_vars`)
      to connect to a remote MCP server.

    Secrets follow the same env-var-indirection convention as ModelConfig's
    `api_key_env_var`: literal `headers`/`env` values are for non-secret
    config, while `headers_env_vars`/`env_passthrough` pull values from the
    server process's environment at connect time so secrets never live in
    config.yaml.
    """

    name: str
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    env_passthrough: list[str] = field(default_factory=list)
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    headers_env_vars: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    tool_timeout_seconds: float = 60.0
    connect_timeout_seconds: float = 30.0

    @property
    def transport(self) -> str:
        """Return "stdio" or "http" based on which transport fields are set."""
        return "stdio" if self.command else "http"

    @classmethod
    def from_dict(cls, data: dict, index: int) -> "MCPServerConfig":
        """Create MCPServerConfig from a YAML dict with validation.

        Args:
            data: YAML dictionary for one mcp_servers entry
            index: Index in mcp_servers list (for error messages)

        Raises:
            ValueError: If the entry is invalid
        """
        if not isinstance(data, dict):
            raise ValueError(f"mcp_servers[{index}] must be a mapping")

        name = data.get("name")
        if not name:
            raise ValueError(f"mcp_servers[{index}] missing 'name' field")
        if not _MCP_SERVER_NAME_RE.match(name):
            raise ValueError(
                f"mcp_servers[{index}] name '{name}' must match "
                f"^[a-zA-Z0-9_-]{{1,32}}$ (it becomes part of tool ids)"
            )

        command = data.get("command")
        url = data.get("url")
        if bool(command) == bool(url):
            raise ValueError(
                f"mcp_servers[{index}] ('{name}') must set exactly one of "
                f"'command' (stdio transport) or 'url' (HTTP transport)"
            )

        args = data.get("args", [])
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise ValueError(
                f"mcp_servers[{index}] ('{name}') 'args' must be a list of strings"
            )

        return cls(
            name=name,
            command=command,
            args=list(args),
            env=dict(data.get("env", {})),
            env_passthrough=list(data.get("envPassthrough", [])),
            url=url,
            headers=dict(data.get("headers", {})),
            headers_env_vars=dict(data.get("headersEnvVars", {})),
            enabled=data.get("enabled", True),
            tool_timeout_seconds=data.get("toolTimeoutSeconds", 60.0),
            connect_timeout_seconds=data.get("connectTimeoutSeconds", 30.0),
        )

    def resolve_env(self) -> dict[str, str]:
        """Resolve subprocess environment: literal `env` plus passthrough vars.

        Passthrough entries that aren't set in the host environment are
        silently skipped (not a fatal misconfiguration).
        """
        resolved = dict(self.env)
        for var_name in self.env_passthrough:
            value = os.environ.get(var_name)
            if value is not None:
                resolved[var_name] = value
        return resolved

    def resolve_headers(self) -> dict[str, str]:
        """Resolve HTTP headers: literal `headers` plus env-indirected ones.

        Returns:
            Merged headers dict. Env-indirected headers are omitted (not
            emitted with an empty value) if their source env var is unset.
        """
        resolved = dict(self.headers)
        for header_name, var_name in self.headers_env_vars.items():
            value = os.environ.get(var_name)
            if value is not None:
                resolved[header_name] = value
        return resolved

    def missing_header_env_vars(self) -> list[str]:
        """Return env var names referenced by headers_env_vars that aren't set."""
        return [
            var_name
            for var_name in self.headers_env_vars.values()
            if not os.environ.get(var_name)
        ]


@dataclass
class AppConfig:
    """Application configuration for models, plugins, and admin mode.

    When loaded with admin_mode=False:
    - Models are pre-populated in UI, users add their own API keys via settings
    - Plugins are loaded and available
    - API key settings UI is shown

    When loaded with admin_mode=True:
    - Models use server-side API keys from environment variables
    - Plugins are loaded and available
    - API key settings UI is hidden (users can't configure keys)
    """

    models: list[ModelConfig] = field(default_factory=list)
    plugins: list[PluginConfig] = field(default_factory=list)
    mcp_servers: list[MCPServerConfig] = field(default_factory=list)
    admin_mode: bool = False
    _config_path: Path | None = None

    @classmethod
    def load(
        cls, config_path: Path | None = None, admin_mode: bool = False
    ) -> "AppConfig":
        """Load configuration from config.yaml.

        Args:
            config_path: Path to config.yaml. Defaults to ./config.yaml
            admin_mode: Whether to enable admin mode (server-side API keys)

        Returns:
            AppConfig with models and plugins loaded

        Raises:
            FileNotFoundError: If config.yaml doesn't exist
            ValueError: If config is invalid
        """
        if config_path is None:
            config_path = Path.cwd() / "config.yaml"

        if not config_path.exists():
            raise FileNotFoundError(
                f"Config file not found: {config_path}. "
                f"See config.example.yaml for format."
            )

        yaml = YAML(typ="safe")
        with config_path.open() as f:
            data = yaml.load(f)

        if not data:
            raise ValueError(f"Config file {config_path} is empty or invalid YAML")

        if "models" not in data or not data["models"]:
            raise ValueError("Config requires at least one model in 'models' section")

        models = []
        for i, model_data in enumerate(data["models"]):
            model = ModelConfig.from_dict(model_data, i, admin_mode=admin_mode)
            models.append(model)

        # Load plugins (optional)
        plugins = []
        if "plugins" in data and data["plugins"]:
            config_dir = config_path.parent
            for plugin_entry in data["plugins"]:
                plugin_config = PluginConfig.from_dict(plugin_entry, config_dir)
                if plugin_config:
                    plugins.append(plugin_config)
                    if plugin_config.js_path and plugin_config.py_path:
                        logger.info(
                            f"Registered paired plugin: {plugin_config.plugin_id} "
                            f"(JS: {plugin_config.js_path.name}, "
                            f"PY: {plugin_config.py_path.name})"
                        )
                    elif plugin_config.js_path:
                        logger.info(
                            f"Registered JS plugin: {plugin_config.js_path.name}"
                        )
                    elif plugin_config.py_path:
                        logger.info(
                            f"Registered Python plugin: {plugin_config.py_path.name}"
                        )

        # Load MCP servers (optional). Accept both snake_case and the
        # camelCase "mcpServers" key used by the wider MCP ecosystem.
        mcp_servers = []
        mcp_servers_data = data.get("mcp_servers") or data.get("mcpServers")
        if mcp_servers_data:
            for i, server_data in enumerate(mcp_servers_data):
                mcp_servers.append(MCPServerConfig.from_dict(server_data, i))
                logger.info(
                    f"Registered MCP server: {mcp_servers[-1].name} "
                    f"({mcp_servers[-1].transport})"
                )

        config = cls(
            models=models,
            plugins=plugins,
            mcp_servers=mcp_servers,
            admin_mode=admin_mode,
            _config_path=config_path,
        )

        mode_str = "admin mode" if admin_mode else "normal mode"
        logger.info(
            f"Loaded config ({mode_str}) with {len(models)} models from {config_path}"
        )
        if plugins:
            logger.info(f"Loaded {len(plugins)} plugin(s)")
        if mcp_servers:
            logger.info(f"Loaded {len(mcp_servers)} MCP server(s)")

        return config

    @classmethod
    def empty(cls) -> "AppConfig":
        """Create empty config (no models, plugins, or MCP servers)."""
        return cls(models=[], plugins=[], mcp_servers=[], admin_mode=False)

    def validate_environment(self) -> None:
        """Validate that all required environment variables are set.

        Model API key validation only applies in admin mode (in normal mode,
        users provide their own keys). MCP server header env-var validation
        applies regardless of mode, since mcp_servers is always a server-side
        config concern.

        Call this at startup to fail fast with clear error messages.

        Raises:
            ValueError: If any required environment variable is not set
        """
        missing = []

        if self.admin_mode:
            for model in self.models:
                if model.api_key_env_var and not os.environ.get(model.api_key_env_var):
                    missing.append((model.id, model.api_key_env_var))

        for server in self.mcp_servers:
            for env_var in server.missing_header_env_vars():
                missing.append((f"mcp_servers.{server.name}", env_var))

        if missing:
            error_lines = [
                f"  - {source}: {env_var} not set" for source, env_var in missing
            ]
            raise ValueError(
                "Missing environment variables:\n" + "\n".join(error_lines)
            )

    def get_model_config(self, model_id: str) -> ModelConfig | None:
        """Get configuration for a specific model by ID.

        Args:
            model_id: The model ID (e.g., "openai/gpt-4o")

        Returns:
            ModelConfig if found, None otherwise
        """
        for model in self.models:
            if model.id == model_id:
                return model
        return None

    def resolve_credentials(self, model_id: str) -> tuple[str | None, str | None]:
        """Resolve API key and endpoint for a model.

        Only works in admin mode. Returns (None, None) in normal mode.

        Args:
            model_id: The model ID to look up

        Returns:
            Tuple of (api_key, base_url). Both may be None.
        """
        if not self.admin_mode:
            return (None, None)

        model = self.get_model_config(model_id)
        if model is None:
            return (None, None)

        api_key = None
        if model.api_key_env_var:
            api_key = os.environ.get(model.api_key_env_var)

        endpoint = None
        if model.endpoint_env_var:
            endpoint = os.environ.get(model.endpoint_env_var)

        return (api_key, endpoint)

    def get_frontend_models(self) -> list[dict]:
        """Get a safe model list for the frontend (no secrets).

        Returns a list of model info dicts with:
        - id: Model ID
        - name: Display name
        - provider: Extracted from ID
        - context_window: Token limit

        No API keys or environment variable names are included.
        """
        result = []
        for model in self.models:
            # Extract provider from model ID (first part before /)
            provider = model.id.split("/")[0] if "/" in model.id else "Unknown"
            # Capitalize provider for display
            provider = provider.capitalize()

            result.append(
                {
                    "id": model.id,
                    "name": model.name,
                    "provider": provider,
                    "context_window": model.context_window,
                }
            )
        return result


def is_github_copilot_enabled() -> bool:
    """
    Check if GitHub Copilot is enabled via environment variable.

    Enabled by default (returns True). Set CANVAS_CHAT_ENABLE_GITHUB_COPILOT=false
    to disable (e.g., in containerized environments where LiteLLM's file-based
    auth doesn't work).

    Returns:
        True if GitHub Copilot is enabled, False otherwise.
    """
    env_value = os.getenv("CANVAS_CHAT_ENABLE_GITHUB_COPILOT", "true").lower()
    return env_value in ("true", "1", "yes")
