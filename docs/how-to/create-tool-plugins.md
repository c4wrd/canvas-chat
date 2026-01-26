# How to create tool plugins

This guide walks you through creating custom tools that LLMs can invoke during conversations.

## Prerequisites

- Understanding of Python async/await
- Familiarity with JSON Schema
- Canvas-Chat development environment set up

## Quick start

Create a minimal tool in three steps:

### 1. Create the tool class

```python
# src/canvas_chat/plugins/my_tool.py
from canvas_chat.tool_plugin import ToolPlugin


class MyTool(ToolPlugin):
    """A simple greeting tool."""

    def get_name(self) -> str:
        return "greet"

    def get_description(self) -> str:
        return "Generate a friendly greeting for someone"

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the person to greet"
                }
            },
            "required": ["name"]
        }

    async def execute(self, name: str = "", **kwargs) -> dict:
        if not name:
            return {"error": "Name is required"}
        return {"greeting": f"Hello, {name}! Nice to meet you."}
```

### 2. Register the tool

```python
# src/canvas_chat/plugins/__init__.py
from canvas_chat.tool_registry import ToolRegistry, PRIORITY
from canvas_chat.plugins.my_tool import MyTool

ToolRegistry.register(
    id="greet",
    handler=MyTool,
    priority=PRIORITY["BUILTIN"],
)
```

### 3. Test the tool

```python
# tests/test_my_tool.py
import asyncio
from canvas_chat.plugins.my_tool import MyTool


def test_greet_tool():
    tool = MyTool()
    result = asyncio.run(tool.execute(name="Alice"))
    assert result["greeting"] == "Hello, Alice! Nice to meet you."
```

Run tests:

```bash
mise run test tests/test_my_tool.py
```

## Detailed walkthrough

### Step 1: Extend ToolPlugin

Every tool must extend the `ToolPlugin` abstract base class:

```python
from canvas_chat.tool_plugin import ToolPlugin


class WebSearchTool(ToolPlugin):
    """Search the web using DuckDuckGo."""

    def get_name(self) -> str:
        """Return unique tool identifier.

        This name is used by the LLM to invoke the tool and should be:
        - Lowercase with underscores (snake_case)
        - Descriptive but concise
        - Unique across all registered tools
        """
        return "web_search"

    def get_description(self) -> str:
        """Return human-readable description.

        The LLM uses this to decide when to call the tool.
        Be specific about what the tool does and when to use it.
        """
        return "Search the web for current information using DuckDuckGo"

    def get_parameters(self) -> dict:
        """Return JSON Schema for parameters.

        This schema tells the LLM what arguments the tool accepts.
        Include clear descriptions for each parameter.
        """
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query to look up"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }

    async def execute(self, query: str = "", max_results: int = 5, **kwargs) -> dict:
        """Execute the tool.

        Arguments are passed as keyword arguments matching the schema.
        Always include **kwargs to handle unexpected parameters gracefully.
        """
        # Validate input
        if not query or not query.strip():
            return {"error": "Query is required", "results": []}

        # Perform the action
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = ddgs.text(query, max_results=max_results)

        # Return structured result
        return {
            "query": query,
            "results": [
                {
                    "title": r.get("title", "Untitled"),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")
                }
                for r in results
            ],
            "result_count": len(results)
        }
```

### Step 2: Define parameters with JSON Schema

The `get_parameters()` method returns a JSON Schema object. Here are common patterns:

**String parameter:**

```python
{
    "type": "object",
    "properties": {
        "text": {
            "type": "string",
            "description": "Text to process"
        }
    },
    "required": ["text"]
}
```

**Number parameter with bounds:**

```python
{
    "type": "object",
    "properties": {
        "temperature": {
            "type": "number",
            "description": "Temperature value",
            "minimum": 0,
            "maximum": 100
        }
    },
    "required": ["temperature"]
}
```

**Enum parameter:**

```python
{
    "type": "object",
    "properties": {
        "format": {
            "type": "string",
            "enum": ["json", "xml", "csv"],
            "description": "Output format"
        }
    },
    "required": ["format"]
}
```

**Optional parameter with default:**

```python
{
    "type": "object",
    "properties": {
        "limit": {
            "type": "integer",
            "description": "Maximum items to return",
            "default": 10
        }
    },
    "required": []  # No required params
}
```

**Array parameter:**

```python
{
    "type": "object",
    "properties": {
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of tags to filter by"
        }
    },
    "required": ["tags"]
}
```

### Step 3: Implement execute()

The `execute()` method contains your tool's logic:

```python
async def execute(self, expression: str = "", **kwargs) -> dict:
    """Evaluate mathematical expression safely."""
    # 1. Validate input
    if not expression or not expression.strip():
        return {"error": "Expression is required"}

    try:
        # 2. Perform the action
        result = self._safe_eval(expression)

        # 3. Return structured result
        return {
            "expression": expression,
            "result": result
        }
    except Exception as e:
        # 4. Handle errors gracefully
        return {
            "error": f"Failed to evaluate: {str(e)}",
            "expression": expression
        }
```

**Guidelines:**

- Always validate inputs before processing
- Return `{"error": "message"}` for failures, not exceptions
- Include relevant context in the result (original input, metadata)
- Use async/await for I/O operations (network, file system)
- Keep execution focused and fast

### Step 4: Register the tool

Add registration in `plugins/__init__.py`:

```python
from canvas_chat.tool_registry import ToolRegistry, PRIORITY
from canvas_chat.plugins.calculator_tool import CalculatorTool
from canvas_chat.plugins.web_search_tool import WebSearchTool
from canvas_chat.plugins.my_tool import MyTool

# Register built-in tools
ToolRegistry.register(
    id="calculator",
    handler=CalculatorTool,
    priority=PRIORITY["BUILTIN"],
)

ToolRegistry.register(
    id="web_search",
    handler=WebSearchTool,
    priority=PRIORITY["BUILTIN"],
)

# Register your custom tool
ToolRegistry.register(
    id="my_tool",
    handler=MyTool,
    priority=PRIORITY["BUILTIN"],  # or COMMUNITY for third-party
)
```

**Priority levels:**

| Priority | Value | Use for |
|----------|-------|---------|
| `BUILTIN` | 100 | Core tools shipped with Canvas-Chat |
| `OFFICIAL` | 50 | Official extension tools |
| `COMMUNITY` | 10 | Third-party/custom tools |

Higher priority tools are listed first and preferred when names conflict.

## Testing tools

### Unit tests

Test the tool class directly:

```python
# tests/test_calculator_tool.py
import asyncio
from canvas_chat.plugins.calculator_tool import CalculatorTool


class TestCalculatorTool:
    def setup_method(self):
        self.tool = CalculatorTool()

    def test_get_name(self):
        assert self.tool.get_name() == "calculator"

    def test_get_parameters(self):
        params = self.tool.get_parameters()
        assert params["type"] == "object"
        assert "expression" in params["properties"]

    def test_execute_addition(self):
        result = asyncio.run(self.tool.execute(expression="2 + 2"))
        assert result["result"] == 4

    def test_execute_empty_expression(self):
        result = asyncio.run(self.tool.execute(expression=""))
        assert "error" in result

    def test_to_openai_tool(self):
        tool = self.tool.to_openai_tool()
        assert tool["type"] == "function"
        assert tool["function"]["name"] == "calculator"
```

### Integration tests

Test through the registry:

```python
import asyncio
from canvas_chat.tool_registry import ToolRegistry


def test_registry_execution():
    result = asyncio.run(
        ToolRegistry.execute_tool("calculator", {"expression": "10 * 5"})
    )
    assert result["result"] == 50
```

### Manual testing

1. Start the dev server: `mise run dev`
2. Open the UI and enable tools in settings
3. Ask a question that requires the tool
4. Verify tool execution appears in the response

## Examples

### Calculator tool

Safe mathematical expression evaluation:

```python
import ast
import math
import operator
from canvas_chat.tool_plugin import ToolPlugin


# Allowed operations
OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
}

FUNCTIONS = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "abs": abs,
    "round": round,
}

CONSTANTS = {
    "pi": math.pi,
    "e": math.e,
}


def safe_eval(expression: str) -> float:
    """Safely evaluate expression using AST."""
    node = ast.parse(expression, mode='eval').body
    return _eval_node(node)


def _eval_node(node):
    if isinstance(node, ast.Constant):
        return node.value
    elif isinstance(node, ast.Name):
        if node.id in CONSTANTS:
            return CONSTANTS[node.id]
        raise ValueError(f"Unknown constant: {node.id}")
    elif isinstance(node, ast.BinOp):
        op = OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op)}")
        return op(_eval_node(node.left), _eval_node(node.right))
    elif isinstance(node, ast.UnaryOp):
        op = OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op)}")
        return op(_eval_node(node.operand))
    elif isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name):
            func = FUNCTIONS.get(node.func.id)
            if func is None:
                raise ValueError(f"Unknown function: {node.func.id}")
            args = [_eval_node(arg) for arg in node.args]
            return func(*args)
    raise ValueError(f"Unsupported expression: {type(node)}")


class CalculatorTool(ToolPlugin):
    def get_name(self) -> str:
        return "calculator"

    def get_description(self) -> str:
        return "Evaluate mathematical expressions. Supports basic arithmetic, sqrt, sin, cos, tan, log, abs, round, pi, e."

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Mathematical expression (e.g., 'sqrt(16) + pi * 2')"
                }
            },
            "required": ["expression"]
        }

    async def execute(self, expression: str = "", **kwargs) -> dict:
        if not expression or not expression.strip():
            return {"error": "Expression is required"}

        try:
            result = safe_eval(expression.strip())
            return {"expression": expression, "result": result}
        except Exception as e:
            return {"error": str(e), "expression": expression}
```

### Web search tool

Search using DuckDuckGo:

```python
from canvas_chat.tool_plugin import ToolPlugin


class WebSearchTool(ToolPlugin):
    def get_name(self) -> str:
        return "web_search"

    def get_description(self) -> str:
        return "Search the web for current information using DuckDuckGo"

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum results (default: 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }

    async def execute(self, query: str = "", max_results: int = 5, **kwargs) -> dict:
        if not query or not query.strip():
            return {"error": "Query is required", "results": []}

        try:
            from ddgs import DDGS
            with DDGS() as ddgs:
                raw_results = ddgs.text(query.strip(), max_results=max_results)

            results = [
                {
                    "title": r.get("title", "Untitled"),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")
                }
                for r in raw_results
            ]

            return {
                "query": query,
                "results": results,
                "result_count": len(results)
            }
        except Exception as e:
            return {
                "error": f"Search failed: {str(e)}",
                "query": query,
                "results": []
            }
```

## Best practices

### 1. Write clear descriptions

The LLM uses your description to decide when to call the tool:

```python
# Bad - too vague
def get_description(self):
    return "Does stuff"

# Good - specific and actionable
def get_description(self):
    return "Search the web for current information. Use when the user asks about recent events, news, or needs up-to-date data."
```

### 2. Validate all inputs

Never trust input from the LLM:

```python
async def execute(self, url: str = "", **kwargs) -> dict:
    if not url:
        return {"error": "URL is required"}

    if not url.startswith(("http://", "https://")):
        return {"error": "Invalid URL format"}

    # Now safe to proceed
```

### 3. Return structured data

Include context and metadata in results:

```python
# Bad - just the result
return 42

# Good - structured with context
return {
    "expression": "6 * 7",
    "result": 42,
    "type": "integer"
}
```

### 4. Handle errors gracefully

Return error information, don't raise exceptions:

```python
async def execute(self, **kwargs) -> dict:
    try:
        result = risky_operation()
        return {"result": result}
    except NetworkError as e:
        return {"error": f"Network error: {e}", "retry": True}
    except ValueError as e:
        return {"error": f"Invalid input: {e}", "retry": False}
```

### 5. Keep tools focused

Each tool should do one thing well:

```python
# Bad - too many responsibilities
class DoEverythingTool(ToolPlugin):
    def get_name(self):
        return "do_everything"
    # Handles search, calculation, file ops, etc.

# Good - single responsibility
class WebSearchTool(ToolPlugin):
    def get_name(self):
        return "web_search"
    # Only searches the web
```

### 6. Use async for I/O

Keep the server responsive:

```python
# Bad - blocks the event loop
def execute(self, url: str, **kwargs):
    response = requests.get(url)  # Blocking!
    return {"content": response.text}

# Good - non-blocking
async def execute(self, url: str, **kwargs) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return {"content": await response.text()}
```

## Related documentation

- [Tool Calling Architecture](../explanation/tool-calling-architecture.md) - Design decisions
- [Tool Registry API Reference](../reference/tool-registry-api.md) - Complete API docs
- [Plugin Architecture](../explanation/plugin-architecture.md) - Overview of plugin systems
