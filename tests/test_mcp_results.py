"""Tests for mcp_client.results.call_tool_result_to_dict."""

import mcp.types as types

from canvas_chat.mcp_client.results import call_tool_result_to_dict


def _result(content, is_error=False, structured_content=None):
    return types.CallToolResult(
        content=content,
        isError=is_error,
        structuredContent=structured_content,
    )


def test_single_text_block():
    result = _result([types.TextContent(type="text", text="hello world")])
    assert call_tool_result_to_dict(result) == {"result": "hello world"}


def test_multiple_text_blocks_joined():
    result = _result(
        [
            types.TextContent(type="text", text="first"),
            types.TextContent(type="text", text="second"),
        ]
    )
    assert call_tool_result_to_dict(result) == {"result": "first\n\nsecond"}


def test_no_content_blocks():
    result = _result([])
    assert call_tool_result_to_dict(result) == {"result": ""}


def test_structured_content_preferred_over_text():
    result = _result(
        [types.TextContent(type="text", text="ignored")],
        structured_content={"answer": 42},
    )
    assert call_tool_result_to_dict(result) == {"result": {"answer": 42}}


def test_is_error_returns_error_key():
    result = _result(
        [types.TextContent(type="text", text="something went wrong")],
        is_error=True,
    )
    assert call_tool_result_to_dict(result) == {"error": "something went wrong"}


def test_is_error_with_no_text_uses_default_message():
    result = _result([], is_error=True)
    assert call_tool_result_to_dict(result) == {"error": "Tool reported an error"}


def test_image_content_becomes_placeholder():
    result = _result(
        [types.ImageContent(type="image", data="QUJD", mimeType="image/png")]
    )
    out = call_tool_result_to_dict(result)
    assert "result" in out
    assert "image/png" in out["result"]
    assert "bytes base64 omitted" in out["result"]
    assert "QUJD" not in out["result"]


def test_audio_content_becomes_placeholder():
    result = _result(
        [types.AudioContent(type="audio", data="QUJD", mimeType="audio/wav")]
    )
    out = call_tool_result_to_dict(result)
    assert "audio/wav" in out["result"]
    assert "QUJD" not in out["result"]


def test_embedded_text_resource_inlined():
    resource = types.TextResourceContents(uri="file:///tmp/x.txt", text="resource text")
    result = _result([types.EmbeddedResource(type="resource", resource=resource)])
    assert call_tool_result_to_dict(result) == {"result": "resource text"}


def test_embedded_blob_resource_becomes_placeholder():
    resource = types.BlobResourceContents(
        uri="file:///tmp/x.bin", blob="QUJD", mimeType="application/octet-stream"
    )
    result = _result([types.EmbeddedResource(type="resource", resource=resource)])
    out = call_tool_result_to_dict(result)
    assert "application/octet-stream" in out["result"]
    assert "file:///tmp/x.bin" in out["result"]


def test_resource_link_becomes_placeholder():
    result = _result(
        [types.ResourceLink(type="resource_link", uri="file:///tmp/y.txt", name="y")]
    )
    out = call_tool_result_to_dict(result)
    assert "file:///tmp/y.txt" in out["result"]


def test_mixed_text_and_image_blocks():
    result = _result(
        [
            types.TextContent(type="text", text="here's the chart"),
            types.ImageContent(type="image", data="QUJD", mimeType="image/png"),
        ]
    )
    out = call_tool_result_to_dict(result)
    assert "here's the chart" in out["result"]
    assert "image/png" in out["result"]
