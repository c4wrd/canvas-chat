"""Map MCP CallToolResult content blocks onto canvas-chat's tool-result shape.

The chat loop (app.py) JSON-dumps whatever a ToolPlugin.execute() returns
into a role:"tool" message, by convention a dict with either a "result" key
or an "error" key. This module bridges MCP's richer content-block model
(text/image/audio/resource, plus a structured-content field) onto that
convention.
"""

from __future__ import annotations

from typing import Any

import mcp.types as types


def _describe_binary_block(kind: str, mime_type: str, data: str) -> str:
    """Placeholder for binary content we don't inline into the tool message.

    Base64 payloads are kept out of the LLM context (and out of the SSE
    tool_result event) to avoid context blowup; image/audio passthrough as
    actual multimodal content is a Phase 2 item.
    """
    approx_bytes = (len(data) * 3) // 4
    return f"[{kind} {mime_type}, {approx_bytes} bytes base64 omitted]"


def _content_block_to_text(block: types.ContentBlock) -> str:
    """Render a single MCP content block as text for the tool message."""
    if isinstance(block, types.TextContent):
        return block.text
    if isinstance(block, types.ImageContent):
        return _describe_binary_block("image", block.mimeType, block.data)
    if isinstance(block, types.AudioContent):
        return _describe_binary_block("audio", block.mimeType, block.data)
    if isinstance(block, types.ResourceLink):
        return f"[resource link {block.uri}]"
    if isinstance(block, types.EmbeddedResource):
        resource = block.resource
        if isinstance(resource, types.TextResourceContents):
            return resource.text
        mime_type = resource.mimeType or "application/octet-stream"
        return f"[resource {resource.uri} ({mime_type})]"
    return str(block)


def call_tool_result_to_dict(result: types.CallToolResult) -> dict[str, Any]:
    """Convert an MCP CallToolResult into canvas-chat's {"result"}/{"error"} shape.

    Args:
        result: The result of an MCP `tools/call` request.

    Returns:
        {"error": str} if the server reported an error, otherwise
        {"result": ...} where the value is the tool's structuredContent
        if present, else the joined text of its content blocks.
    """
    texts = [_content_block_to_text(block) for block in result.content]

    if result.isError:
        message = "\n\n".join(t for t in texts if t) or "Tool reported an error"
        return {"error": message}

    if result.structuredContent is not None:
        return {"result": result.structuredContent}

    if not texts:
        return {"result": ""}
    return {"result": texts[0] if len(texts) == 1 else "\n\n".join(texts)}


__all__ = ["call_tool_result_to_dict"]
