# Canvas Chat

A visual, non-linear chat interface where conversations are nodes on an infinite canvas. Built with FastAPI (Python) and vanilla JavaScript.

## Quick Start

```bash
mise run install    # Install dependencies (uv sync && npm install)
mise run dev        # Start dev server at http://127.0.0.1:7865
mise run test       # Run Python tests
mise run test-js    # Run JavaScript tests
```

## Project Structure

```
src/canvas_chat/
├── app.py                 # FastAPI application (core backend)
├── __main__.py            # CLI entry point (Typer)
├── config.py              # Configuration management
├── file_upload_registry.py    # Plugin registry for file handlers
├── url_fetch_registry.py      # Plugin registry for URL handlers
├── tool_plugin.py         # Base class for LLM tools
├── tool_registry.py       # Tool registration and execution
├── plugins/               # Built-in backend plugins
│   ├── pdf_handler.py         # PDF upload handling
│   ├── youtube_handler.py     # YouTube transcript extraction
│   ├── git_repo_handler.py    # Git repository analysis
│   ├── calculator_tool.py     # Calculator tool for LLM
│   └── web_search_tool.py     # Web search tool for LLM
└── static/
    ├── index.html         # Single-page application
    ├── css/               # Stylesheets
    └── js/
        ├── app.js         # Main application class
        ├── canvas.js      # SVG canvas visualization
        ├── chat.js        # Chat interaction logic
        ├── crdt-graph.js  # CRDT-based collaborative graph
        ├── storage.js     # IndexedDB persistence
        └── plugins/       # 33+ frontend plugins
```

## Tech Stack

**Backend:** FastAPI, LiteLLM (unified LLM interface), Pydantic, SSE for streaming

**Frontend:** Vanilla JavaScript (ES6 modules), SVG canvas, IndexedDB, Yjs (CRDT)

**LLM Providers:** OpenAI, Anthropic, Google, Groq, GitHub Models, Ollama (via LiteLLM)

## Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/chat` | Send message, get LLM response (SSE streaming) |
| `POST /api/committee` | Query multiple LLMs and synthesize |
| `POST /api/fetch-url` | Fetch and process URL content |
| `POST /api/upload-file` | Upload file with handler detection |
| `GET /api/models` | List available models |
| `GET /api/config` | Get server configuration |
| `GET /api/tools` | List available LLM tools |
| `POST /api/deep-research/start` | Start Google Deep Research task |
| `GET /api/deep-research/status/{task_id}` | Check research status |
| `GET /api/deep-research/stream/{task_id}` | Stream research results (SSE) |
| `GET /api/deep-research/resume/{id}` | Resume interrupted research |
| `GET /api/deep-research/finalize/{id}` | Fetch completed report |

## Architecture

### Data Flow
1. User types message → `chat.js` builds context from selected nodes
2. `POST /api/chat` with context and model selection
3. `app.py` routes to LiteLLM → correct provider API
4. SSE streams response back → `StreamingManager` receives chunks (content, thinking, tool_call, tool_result)
5. `canvas.js` renders node with content
6. `storage.js` saves to IndexedDB

### Plugin System (3 levels)

**Features** - Global slash commands (`/matrix`, `/research`, `/committee`, `/deep-research`, `/branch`, `/image`)
```javascript
class MyFeature extends FeaturePlugin {
    getSlashCommand() { return '/myfeature'; }
    async execute(text, context) { /* ... */ }
}
```

**Nodes** - Custom node types (AI, Note, Code, CSV, Image, etc.)
```javascript
class MyNode extends NodePlugin {
    getNodeType() { return 'my-node'; }
    render() { return html; }
}
```

**External** - Load via config.yaml (JS frontend, Python backend, or paired)

### Backend Plugin Registries

**File Upload Registry** (`file_upload_registry.py`):
- Registers handlers by MIME type and file extension
- Priority system: BUILTIN(100) > OFFICIAL(50) > COMMUNITY(10)

**URL Fetch Registry** (`url_fetch_registry.py`):
- Registers handlers by URL regex patterns
- Used for YouTube, PDF URLs, etc.

### LLM Tool System

**Backend** (`tool_plugin.py`, `tool_registry.py`):
- Abstract `ToolPlugin` base class with `execute()` method
- Registry with priority system and OpenAI format conversion
- Agentic loop: LLM calls tools, results fed back, repeats until completion

**Built-in Tools:**
- Calculator: Safe math evaluation (arithmetic, functions, constants)
- Web Search: DuckDuckGo integration (no API key required)

**Frontend** (`chat.js`, UI controls):
- Tools toggle with dropdown menu
- Master enable/disable switch
- Per-tool selection checkboxes
- Tool call/result event streaming

### Extended Thinking/Reasoning

**Models:** OpenAI o1/o3/GPT-5, Anthropic Claude, Google Gemini

**Backend:** `reasoning_effort` parameter ("none", "low", "medium", "high")

**Frontend:** Reasoning picker dropdown, collapsible thinking display in nodes

**UI:** Animated thinking indicator with pulse effect

### Google Deep Research

**Slash command:** `/deep-research [query]`

**Architecture:**
- Backend: 5 SSE endpoints, resume support, task tracking
- Model: `deep-research-pro-preview-12-2025`
- Frontend: Modal UI, progress streaming, citations

**Node type:** `deep_research` (700x600, shows thinking summaries + sources)

**Features:** Multimodal support (images), resumable sessions, auto-recovery

### Branch Feature

**Slash command:** `/branch [parsing instructions]`

**Functionality:**
- Parse lists from selected nodes (numbered, bullet, line-by-line)
- Configure command template with `{item}` placeholder
- Execute all branches in parallel
- Modal command capture for batch image generation

**Use cases:** Parallel research, bulk image generation, multi-perspective analysis

## Configuration Modes

**No config (default):** Users configure via settings UI

**Normal mode:** `--config config.yaml` - Pre-loaded models, users provide API keys

**Admin mode:** `--admin-mode --config config.yaml` - Server-side API keys, settings UI hidden

## Testing

```bash
mise run test        # Python tests (pytest)
mise run test-js     # JavaScript tests (node tests/run_tests.js)
mise run typecheck   # TypeScript type checking
```

Tests are in `/tests/`:
- Python: pytest (tool_registry, calculator_tool, web_search_tool)
- JavaScript: Node.js test framework (branch_plugin, existing tests)

## Key Files

| File | Purpose |
|------|---------|
| `src/canvas_chat/app.py` | All API endpoints and business logic |
| `src/canvas_chat/config.py` | Configuration dataclasses and validation |
| `src/canvas_chat/tool_plugin.py` | Base class for LLM tools |
| `src/canvas_chat/tool_registry.py` | Tool registration system |
| `src/canvas_chat/static/js/app.js` | Frontend application orchestration |
| `src/canvas_chat/static/js/canvas.js` | SVG rendering and interaction |
| `src/canvas_chat/static/js/crdt-graph.js` | Graph data structure with CRDT |
| `src/canvas_chat/static/js/plugins/branch.js` | Branch feature plugin |
| `src/canvas_chat/static/js/plugins/deep-research.js` | Deep research feature |
| `src/canvas_chat/static/js/plugins/deep-research-node.js` | Deep research node renderer |
| `mise.toml` | Task runner configuration |
| `config.example.yaml` | Configuration template |

## Development Notes

- Local-first architecture: all data stored in browser (IndexedDB)
- CRDT-based graph enables collaborative editing
- SSE streaming for real-time LLM responses (includes thinking, tool calls, and tool results)
- Semantic zoom: shows summaries when zoomed out
- Graph is a DAG (directed acyclic graph) - nodes have parent references
- Agentic loop supports up to 10 tool iterations (configurable)
- Deep research supports session resume after disconnection
- Branch feature enables parallel command execution for performance
