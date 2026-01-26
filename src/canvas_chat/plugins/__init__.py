"""Backend plugins for canvas-chat.

This package contains backend file upload handler plugins, URL fetch handler plugins,
and LLM tool plugins.
"""

# Import built-in URL fetch handler plugins (registers them)
from canvas_chat.plugins import (
    git_repo_handler,  # noqa: F401
    pdf_url_handler,  # noqa: F401
    youtube_handler,  # noqa: F401
)

# Import built-in tool plugins (registers them)
from canvas_chat.plugins import (
    calculator_tool,  # noqa: F401
    web_search_tool,  # noqa: F401
)
