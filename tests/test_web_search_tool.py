"""Tests for the web search tool plugin."""

import asyncio
from unittest.mock import MagicMock, patch

from canvas_chat.plugins.web_search_tool import WebSearchTool


class TestWebSearchTool:
    """Tests for the WebSearchTool class."""

    def setup_method(self):
        """Set up web search tool instance."""
        self.tool = WebSearchTool()

    def test_get_name(self):
        """Test tool name."""
        assert self.tool.get_name() == "web_search"

    def test_get_description(self):
        """Test tool description."""
        desc = self.tool.get_description()
        assert "search" in desc.lower()
        assert "web" in desc.lower()

    def test_get_parameters(self):
        """Test parameter schema."""
        params = self.tool.get_parameters()
        assert params["type"] == "object"
        assert "query" in params["properties"]
        assert "max_results" in params["properties"]
        assert "query" in params["required"]

    def test_to_openai_tool(self):
        """Test OpenAI tool format."""
        tool = self.tool.to_openai_tool()
        assert tool["type"] == "function"
        assert tool["function"]["name"] == "web_search"
        assert "parameters" in tool["function"]

    def test_execute_empty_query(self):
        """Test empty query."""
        result = asyncio.run(self.tool.execute(query=""))
        assert "error" in result
        assert result["results"] == []

    def test_execute_no_query(self):
        """Test missing query."""
        result = asyncio.run(self.tool.execute())
        assert "error" in result

    def test_execute_success(self):
        """Test successful search with mocked DDGS."""
        mock_results = [
            {
                "title": "Test Result 1",
                "href": "https://example.com/1",
                "body": "This is a test result snippet.",
            },
            {
                "title": "Test Result 2",
                "href": "https://example.com/2",
                "body": "Another test result.",
            },
        ]

        with patch("ddgs.DDGS") as MockDDGS:
            mock_instance = MagicMock()
            mock_instance.text.return_value = mock_results
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            MockDDGS.return_value = mock_instance

            result = asyncio.run(self.tool.execute(query="test query", max_results=5))

            assert result["query"] == "test query"
            assert result["result_count"] == 2
            assert len(result["results"]) == 2
            assert result["results"][0]["title"] == "Test Result 1"
            assert result["results"][0]["url"] == "https://example.com/1"
            assert result["results"][0]["snippet"] == "This is a test result snippet."

    def test_execute_default_max_results(self):
        """Test that default max_results is 5."""
        with patch("ddgs.DDGS") as MockDDGS:
            mock_instance = MagicMock()
            mock_instance.text.return_value = []
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            MockDDGS.return_value = mock_instance

            asyncio.run(self.tool.execute(query="test"))

            # Check that text was called with max_results=5 (default)
            mock_instance.text.assert_called_once_with("test", max_results=5)

    def test_execute_custom_max_results(self):
        """Test custom max_results parameter."""
        with patch("ddgs.DDGS") as MockDDGS:
            mock_instance = MagicMock()
            mock_instance.text.return_value = []
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            MockDDGS.return_value = mock_instance

            asyncio.run(self.tool.execute(query="test", max_results=10))

            mock_instance.text.assert_called_once_with("test", max_results=10)

    def test_execute_error_handling(self):
        """Test error handling when DDGS fails."""
        with patch("ddgs.DDGS") as MockDDGS:
            mock_instance = MagicMock()
            mock_instance.text.side_effect = Exception("Network error")
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            MockDDGS.return_value = mock_instance

            result = asyncio.run(self.tool.execute(query="test"))

            assert "error" in result
            assert "Network error" in result["error"]
            assert result["results"] == []

    def test_execute_handles_missing_fields(self):
        """Test handling of results with missing fields."""
        mock_results = [
            {
                "title": "Complete Result",
                "href": "https://example.com/1",
                "body": "Has all fields",
            },
            {
                # Missing title, href, body - should use defaults
            },
        ]

        with patch("ddgs.DDGS") as MockDDGS:
            mock_instance = MagicMock()
            mock_instance.text.return_value = mock_results
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            MockDDGS.return_value = mock_instance

            result = asyncio.run(self.tool.execute(query="test"))

            assert len(result["results"]) == 2
            # First result should have all fields
            assert result["results"][0]["title"] == "Complete Result"
            # Second result should have default values
            assert result["results"][1]["title"] == "Untitled"
            assert result["results"][1]["url"] == ""
            assert result["results"][1]["snippet"] == ""
