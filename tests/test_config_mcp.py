"""Unit tests for MCPServerConfig and AppConfig MCP server wiring."""

import pytest

from canvas_chat.config import AppConfig, MCPServerConfig

# --- MCPServerConfig.from_dict tests ---


def test_mcp_server_config_stdio_valid():
    data = {
        "name": "everything",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-everything"],
        "envPassthrough": ["GITHUB_TOKEN"],
    }
    server = MCPServerConfig.from_dict(data, 0)

    assert server.name == "everything"
    assert server.command == "npx"
    assert server.args == ["-y", "@modelcontextprotocol/server-everything"]
    assert server.env_passthrough == ["GITHUB_TOKEN"]
    assert server.transport == "stdio"
    assert server.enabled is True
    assert server.tool_timeout_seconds == 60.0
    assert server.connect_timeout_seconds == 30.0


def test_mcp_server_config_http_valid():
    data = {
        "name": "remote-example",
        "url": "https://mcp.example.com/mcp",
        "headersEnvVars": {"Authorization": "MCP_REMOTE_AUTH_HEADER"},
        "toolTimeoutSeconds": 90,
        "connectTimeoutSeconds": 10,
    }
    server = MCPServerConfig.from_dict(data, 0)

    assert server.url == "https://mcp.example.com/mcp"
    assert server.headers_env_vars == {"Authorization": "MCP_REMOTE_AUTH_HEADER"}
    assert server.transport == "http"
    assert server.tool_timeout_seconds == 90
    assert server.connect_timeout_seconds == 10


def test_mcp_server_config_missing_name():
    with pytest.raises(ValueError, match="missing 'name' field"):
        MCPServerConfig.from_dict({"command": "npx"}, 0)


def test_mcp_server_config_invalid_name_chars():
    with pytest.raises(ValueError, match="must match"):
        MCPServerConfig.from_dict({"name": "bad name!", "command": "npx"}, 0)


def test_mcp_server_config_requires_exactly_one_transport():
    with pytest.raises(ValueError, match="exactly one of"):
        MCPServerConfig.from_dict({"name": "both"}, 0)


def test_mcp_server_config_rejects_both_transports():
    data = {"name": "both", "command": "npx", "url": "https://example.com/mcp"}
    with pytest.raises(ValueError, match="exactly one of"):
        MCPServerConfig.from_dict(data, 0)


def test_mcp_server_config_invalid_args_type():
    data = {"name": "bad-args", "command": "npx", "args": "not-a-list"}
    with pytest.raises(ValueError, match="'args' must be a list of strings"):
        MCPServerConfig.from_dict(data, 0)


# --- resolve_env / resolve_headers / missing_header_env_vars ---


def test_resolve_env_merges_literal_and_passthrough(monkeypatch):
    monkeypatch.setenv("MY_PASSTHROUGH_VAR", "hello")
    server = MCPServerConfig(
        name="s",
        command="npx",
        env={"LITERAL": "value"},
        env_passthrough=["MY_PASSTHROUGH_VAR", "UNSET_VAR"],
    )

    resolved = server.resolve_env()
    assert resolved == {"LITERAL": "value", "MY_PASSTHROUGH_VAR": "hello"}


def test_resolve_headers_merges_literal_and_env(monkeypatch):
    monkeypatch.setenv("MCP_AUTH", "Bearer xyz")
    server = MCPServerConfig(
        name="s",
        url="https://example.com/mcp",
        headers={"X-Literal": "1"},
        headers_env_vars={"Authorization": "MCP_AUTH"},
    )

    resolved = server.resolve_headers()
    assert resolved == {"X-Literal": "1", "Authorization": "Bearer xyz"}


def test_resolve_headers_omits_unset_env_var():
    server = MCPServerConfig(
        name="s",
        url="https://example.com/mcp",
        headers_env_vars={"Authorization": "TOTALLY_UNSET_VAR"},
    )

    assert server.resolve_headers() == {}


def test_missing_header_env_vars(monkeypatch):
    monkeypatch.delenv("SOME_UNSET_MCP_VAR", raising=False)
    server = MCPServerConfig(
        name="s",
        url="https://example.com/mcp",
        headers_env_vars={"Authorization": "SOME_UNSET_MCP_VAR"},
    )

    assert server.missing_header_env_vars() == ["SOME_UNSET_MCP_VAR"]


# --- AppConfig.load wiring ---


def test_app_config_load_with_mcp_servers(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
models:
  - id: openai/gpt-4o
    name: GPT-4o
mcp_servers:
  - name: everything
    command: npx
    args: ['-y', '@modelcontextprotocol/server-everything']
  - name: remote-example
    url: https://mcp.example.com/mcp
"""
    )
    config = AppConfig.load(config_file, admin_mode=False)

    assert len(config.mcp_servers) == 2
    assert config.mcp_servers[0].name == "everything"
    assert config.mcp_servers[0].transport == "stdio"
    assert config.mcp_servers[1].name == "remote-example"
    assert config.mcp_servers[1].transport == "http"


def test_app_config_load_with_camel_case_mcp_servers_key(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
models:
  - id: openai/gpt-4o
    name: GPT-4o
mcpServers:
  - name: everything
    command: npx
"""
    )
    config = AppConfig.load(config_file, admin_mode=False)

    assert len(config.mcp_servers) == 1
    assert config.mcp_servers[0].name == "everything"


def test_app_config_load_without_mcp_servers_defaults_empty(tmp_path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
models:
  - id: openai/gpt-4o
    name: GPT-4o
"""
    )
    config = AppConfig.load(config_file, admin_mode=False)

    assert config.mcp_servers == []


def test_app_config_empty_has_no_mcp_servers():
    config = AppConfig.empty()
    assert config.mcp_servers == []


# --- validate_environment integration ---


def test_validate_environment_mcp_missing_header_env_var(tmp_path, monkeypatch):
    monkeypatch.delenv("MCP_REMOTE_AUTH_HEADER", raising=False)
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
models:
  - id: openai/gpt-4o
    name: GPT-4o
mcp_servers:
  - name: remote-example
    url: https://mcp.example.com/mcp
    headersEnvVars:
      Authorization: MCP_REMOTE_AUTH_HEADER
"""
    )
    config = AppConfig.load(config_file, admin_mode=False)

    with pytest.raises(ValueError, match="Missing environment variables"):
        config.validate_environment()


def test_validate_environment_mcp_header_env_var_set(tmp_path, monkeypatch):
    monkeypatch.setenv("MCP_REMOTE_AUTH_HEADER", "Bearer xyz")
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
models:
  - id: openai/gpt-4o
    name: GPT-4o
mcp_servers:
  - name: remote-example
    url: https://mcp.example.com/mcp
    headersEnvVars:
      Authorization: MCP_REMOTE_AUTH_HEADER
"""
    )
    config = AppConfig.load(config_file, admin_mode=False)

    config.validate_environment()  # should not raise
