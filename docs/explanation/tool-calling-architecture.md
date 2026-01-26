# Tool calling architecture

This document explains the design decisions behind Canvas-Chat's LLM tool calling system and how it enables agentic interactions.

## The problem

Traditional chat interfaces are limited to text-only responses. When users ask questions requiring real-time information, calculations, or external data, the LLM can only provide potentially outdated or fabricated responses.

**Limitations of text-only chat:**

1. **Stale information** - LLMs have knowledge cutoffs and cannot access current data
2. **No external actions** - Cannot search the web, perform calculations, or interact with APIs
3. **Hallucination risk** - May fabricate information when asked about facts
4. **Limited capabilities** - Cannot perform tasks that require external systems

## The solution

We implemented an **agentic tool calling system** that allows LLMs to invoke tools during conversation:

```
User: "What's the latest news about SpaceX?"
       │
       ▼
LLM decides to use web_search tool
       │
       ▼
Tool executes: web_search("SpaceX latest news")
       │
       ▼
Results returned to LLM
       │
       ▼
LLM synthesizes response with real data
       │
       ▼
User: "SpaceX announced Starship Flight 5..."
```

### Agentic loop

The key innovation is the **agentic loop** - the LLM can call multiple tools in sequence until it has enough information to respond:

```python
while iterations < max_iterations:
    response = await llm.generate(messages, tools=tools)

    if response.finish_reason == "tool_calls":
        # LLM wants to call tools
        for tool_call in response.tool_calls:
            result = await ToolRegistry.execute_tool(tool_call.name, tool_call.args)
            messages.append(tool_result_message(tool_call.id, result))
        # Loop continues - LLM sees results and decides next action
    else:
        # LLM is done, return response
        break
```

This enables complex multi-step reasoning:

1. Search for information
2. Calculate results
3. Search for more context based on findings
4. Synthesize final answer

## Architecture

### Three-layer design

```
┌─────────────────────────────────────────────────────────────┐
│                      Chat Endpoint                          │
│  - Receives chat request with enable_tools flag             │
│  - Implements agentic loop                                  │
│  - Streams tool_call and tool_result SSE events             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ToolRegistry                           │
│  - Maintains tool registry                                  │
│  - Provides OpenAI-format tool definitions                  │
│  - Executes tools by ID                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ToolPlugin (Abstract)                  │
│  - Base class for all tools                                 │
│  - Defines interface: name, description, parameters, execute│
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         WebSearchTool   CalculatorTool   CustomTool...
```

### Tool format

Tools use the OpenAI function calling format (also supported by LiteLLM):

```json
{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for current information",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                }
            },
            "required": ["query"]
        }
    }
}
```

This format is understood by OpenAI, Anthropic, Google, and other providers via LiteLLM.

## Design decisions

### Why a registry pattern?

**Problem**: We need to manage multiple tools with consistent interfaces, enable/disable individual tools, and support third-party tools.

**Solution**: The `ToolRegistry` pattern (matching `FileUploadRegistry` and `UrlFetchRegistry`) provides:

- **Centralized management** - Single source of truth for all tools
- **Lazy instantiation** - Tools created only when first used
- **Enable/disable** - Tools can be toggled without code changes
- **Priority system** - Built-in tools take precedence over community tools

### Why abstract base class?

**Problem**: Tools need a consistent interface for the LLM to understand and for the system to execute.

**Solution**: `ToolPlugin` abstract base class ensures all tools implement:

```python
def get_name(self) -> str           # Tool identifier
def get_description(self) -> str    # Shown to LLM
def get_parameters(self) -> dict    # JSON Schema
async def execute(self, **kwargs)   # Tool logic
```

The `to_openai_tool()` method automatically converts these to LiteLLM format.

### Why SSE events for tools?

**Problem**: Users should see tool executions happening in real-time, not just wait for the final response.

**Solution**: Two new SSE event types:

- `tool_call` - LLM is invoking a tool (shows tool name and arguments)
- `tool_result` - Tool execution completed (shows results)

Frontend displays these inline with the streaming response:

```
[Searching web for "SpaceX news"...]
[Found 5 results]
Based on the search results, SpaceX recently announced...
```

### Why max iterations limit?

**Problem**: A buggy tool or adversarial prompt could cause infinite tool loops.

**Solution**: `max_tool_iterations` parameter (default: 10) limits the agentic loop. After reaching the limit, the response is returned as-is with a warning.

### Why async execution?

**Problem**: Tools like web search involve network I/O that would block the server.

**Solution**: All tool `execute()` methods are async:

```python
async def execute(self, **kwargs) -> dict:
    async with aiohttp.ClientSession() as session:
        response = await session.get(url)
        return {"result": await response.json()}
```

This allows concurrent tool executions and keeps the server responsive.

## Security considerations

### Tool parameter validation

Tools receive parameters from the LLM, which could be influenced by user input. Each tool must validate its inputs:

```python
async def execute(self, query: str = "", **kwargs) -> dict:
    if not query or not query.strip():
        return {"error": "Query is required", "results": []}

    # Proceed with validated input
```

### Safe evaluation

The calculator tool demonstrates safe code evaluation using AST parsing instead of `eval()`:

```python
def safe_eval(expression: str) -> float:
    """Safely evaluate mathematical expression using AST."""
    node = ast.parse(expression, mode='eval').body
    return _eval_node(node)  # Only allows safe operations
```

This prevents code injection while still supporting mathematical expressions.

### No arbitrary code execution

Tools should never execute arbitrary code from user input. Always use allowlists and explicit operation handling.

## Built-in tools

### web_search

Searches the web using DuckDuckGo (no API key required):

```python
await ToolRegistry.execute_tool("web_search", {
    "query": "Python asyncio tutorial",
    "max_results": 5
})
# Returns: {"query": "...", "results": [...], "result_count": 5}
```

### calculator

Evaluates mathematical expressions safely:

```python
await ToolRegistry.execute_tool("calculator", {
    "expression": "sqrt(144) + pi * 2"
})
# Returns: {"expression": "...", "result": 18.283...}
```

## Frontend integration

### Chat request options

```javascript
const response = await sendMessage({
    text: "What's the weather in NYC?",
    enableTools: true,           // Enable tool calling
    tools: ["web_search"],       // Optional: specific tools
    maxToolIterations: 10,       // Max agentic loops
    onToolCall: (data) => {      // Tool invocation callback
        console.log(`Calling ${data.name}`, data.arguments);
    },
    onToolResult: (data) => {    // Tool result callback
        console.log(`Result from ${data.name}`, data.result);
    }
});
```

### UI display

Tool executions appear as collapsible details in the response:

```html
<details class="tool-execution">
    <summary>web_search("NYC weather")</summary>
    <pre>{"results": [...]}</pre>
</details>
```

Users can expand to see full tool arguments and results.

## Future directions

### Additional built-in tools

- **URL fetch** - Retrieve and parse web pages
- **Code execution** - Run Python/JavaScript in sandbox
- **File operations** - Read/write files in workspace
- **API integrations** - Weather, stocks, etc.

### Custom tool plugins

External Python plugins can register tools:

```python
# my_plugin/tools.py
from canvas_chat.tool_registry import ToolRegistry, PRIORITY
from canvas_chat.tool_plugin import ToolPlugin

class MyCustomTool(ToolPlugin):
    ...

ToolRegistry.register(
    id="my_custom_tool",
    handler=MyCustomTool,
    priority=PRIORITY["COMMUNITY"]
)
```

### Tool approval workflow

Future enhancement: require user approval before executing certain tools:

```
LLM wants to use: web_search("sensitive query")
[Allow] [Deny] [Allow all web_search]
```

## Related documentation

- [How to Create Tool Plugins](../how-to/create-tool-plugins.md) - Step-by-step guide
- [Tool Registry API Reference](../reference/tool-registry-api.md) - Complete API docs
- [Plugin Architecture](plugin-architecture.md) - Overview of plugin systems
