# Tool Registry API reference

The `ToolRegistry` and `ToolPlugin` classes manage LLM tool plugins, enabling tools to be registered, discovered, and executed during chat conversations.

## Class: ToolPlugin

Abstract base class for all LLM tool plugins. Located in `src/canvas_chat/tool_plugin.py`.

### Methods

#### get_name()

```python
@abstractmethod
def get_name(self) -> str
```

Get the unique name for this tool.

**Returns:**

- `str` - Tool name used by the LLM to invoke the tool (e.g., `"web_search"`, `"calculator"`)

**Example:**

```python
def get_name(self) -> str:
    return "weather"
```

#### get_description()

```python
@abstractmethod
def get_description(self) -> str
```

Get a description of what this tool does.

This description is shown to the LLM to help it decide when to use the tool. Be specific and include use cases.

**Returns:**

- `str` - Human-readable description

**Example:**

```python
def get_description(self) -> str:
    return "Get current weather for a location. Use when the user asks about weather conditions."
```

#### get_parameters()

```python
@abstractmethod
def get_parameters(self) -> dict[str, Any]
```

Get the JSON Schema for this tool's parameters.

**Returns:**

- `dict` - JSON Schema object describing the tool's parameters

**Example:**

```python
def get_parameters(self) -> dict:
    return {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query to look up"
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results",
                "default": 5
            }
        },
        "required": ["query"]
    }
```

#### execute()

```python
@abstractmethod
async def execute(self, **kwargs: Any) -> dict[str, Any]
```

Execute the tool with the given arguments.

**Parameters:**

- `**kwargs` - Arguments matching the parameter schema

**Returns:**

- `dict` - Tool execution results. Should include relevant output and any error information.

**Example:**

```python
async def execute(self, query: str = "", max_results: int = 5, **kwargs) -> dict:
    if not query:
        return {"error": "Query is required", "results": []}

    results = await self._search(query, max_results)
    return {
        "query": query,
        "results": results,
        "result_count": len(results)
    }
```

#### to_openai_tool()

```python
def to_openai_tool(self) -> dict[str, Any]
```

Convert this tool to OpenAI/LiteLLM tool format.

**Returns:**

- `dict` - Tool definition in OpenAI function calling format:

```python
{
    "type": "function",
    "function": {
        "name": "tool_name",
        "description": "Tool description",
        "parameters": { ... JSON Schema ... }
    }
}
```

**Note:** This method is implemented in the base class and typically does not need to be overridden.

---

## Class: ToolRegistry

Central registry for LLM tool plugins. Located in `src/canvas_chat/tool_registry.py`.

All methods are class methods - no instantiation required.

### Tool management

#### register()

```python
@classmethod
def register(
    cls,
    id: str,
    handler: type[ToolPlugin] | None = None,
    priority: int = PRIORITY["COMMUNITY"],
    enabled: bool = True,
) -> None
```

Register a tool plugin.

**Parameters:**

- `id` (str, required) - Unique tool identifier. Should match `handler.get_name()`.
- `handler` (class, required) - Tool class extending `ToolPlugin`. Must be a class, not an instance.
- `priority` (int, optional) - Priority level. Default: `PRIORITY["COMMUNITY"]` (10)
- `enabled` (bool, optional) - Whether the tool is enabled by default. Default: `True`

**Raises:**

- `ValueError` - If id is empty
- `ValueError` - If handler is None
- `ValueError` - If handler is not a class
- `ValueError` - If handler does not extend ToolPlugin

**Example:**

```python
from canvas_chat.tool_registry import ToolRegistry, PRIORITY
from canvas_chat.plugins.my_tool import MyTool

ToolRegistry.register(
    id="my_tool",
    handler=MyTool,
    priority=PRIORITY["BUILTIN"],
    enabled=True,
)
```

#### get_instance()

```python
@classmethod
def get_instance(cls, tool_id: str) -> ToolPlugin | None
```

Get or create a tool instance by ID.

Tool instances are lazily created and cached.

**Parameters:**

- `tool_id` (str) - Tool ID to retrieve

**Returns:**

- `ToolPlugin` - Tool instance
- `None` - If tool not found

**Example:**

```python
calculator = ToolRegistry.get_instance("calculator")
if calculator:
    result = await calculator.execute(expression="2 + 2")
```

#### get_tool_by_id()

```python
@classmethod
def get_tool_by_id(cls, tool_id: str) -> dict[str, Any] | None
```

Get a tool configuration by ID.

**Parameters:**

- `tool_id` (str) - Tool ID

**Returns:**

- `dict` - Tool config with keys: `id`, `handler`, `priority`, `enabled`
- `None` - If tool not found

**Example:**

```python
config = ToolRegistry.get_tool_by_id("web_search")
if config:
    print(f"Priority: {config['priority']}")
    print(f"Enabled: {config['enabled']}")
```

#### get_all_tools()

```python
@classmethod
def get_all_tools(cls) -> list[dict[str, Any]]
```

Get all registered tools.

**Returns:**

- `list[dict]` - List of all tool config dicts

**Example:**

```python
all_tools = ToolRegistry.get_all_tools()
print(f"Total tools: {len(all_tools)}")
```

#### get_enabled_tools()

```python
@classmethod
def get_enabled_tools(cls) -> list[dict[str, Any]]
```

Get all enabled tools, sorted by priority (highest first).

**Returns:**

- `list[dict]` - List of enabled tool config dicts

**Example:**

```python
enabled = ToolRegistry.get_enabled_tools()
for tool in enabled:
    print(f"{tool['id']}: priority {tool['priority']}")
```

#### set_tool_enabled()

```python
@classmethod
def set_tool_enabled(cls, tool_id: str, enabled: bool) -> bool
```

Enable or disable a tool.

**Parameters:**

- `tool_id` (str) - Tool ID
- `enabled` (bool) - Whether to enable or disable

**Returns:**

- `True` - Tool was found and updated
- `False` - Tool not found

**Example:**

```python
# Disable web search
if ToolRegistry.set_tool_enabled("web_search", False):
    print("Web search disabled")

# Re-enable it
ToolRegistry.set_tool_enabled("web_search", True)
```

### Tool execution

#### execute_tool()

```python
@classmethod
async def execute_tool(cls, tool_id: str, arguments: dict[str, Any]) -> dict[str, Any]
```

Execute a tool with the given arguments.

**Parameters:**

- `tool_id` (str) - Tool ID to execute
- `arguments` (dict) - Arguments to pass to the tool

**Returns:**

- `dict` - Tool execution result

**Raises:**

- `ValueError` - If tool not found
- `Exception` - If tool execution fails

**Example:**

```python
result = await ToolRegistry.execute_tool("calculator", {
    "expression": "sqrt(144) + pi"
})
print(result)  # {"expression": "sqrt(144) + pi", "result": 15.14159...}
```

### OpenAI format

#### get_openai_tools()

```python
@classmethod
def get_openai_tools(cls, tool_ids: list[str] | None = None) -> list[dict[str, Any]]
```

Get tools in OpenAI/LiteLLM function calling format.

**Parameters:**

- `tool_ids` (list[str], optional) - Specific tool IDs to include. If `None`, returns all enabled tools.

**Returns:**

- `list[dict]` - Tool definitions in OpenAI format

**Example:**

```python
# Get all enabled tools
tools = ToolRegistry.get_openai_tools()

# Get specific tools
tools = ToolRegistry.get_openai_tools(["calculator", "web_search"])

# Use with LiteLLM
response = await litellm.acompletion(
    model="gpt-4",
    messages=messages,
    tools=tools,
    tool_choice="auto"
)
```

**Output format:**

```python
[
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Evaluate mathematical expressions",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression"
                    }
                },
                "required": ["expression"]
            }
        }
    },
    ...
]
```

### API responses

#### list_tools_info()

```python
@classmethod
def list_tools_info(cls) -> list[dict[str, Any]]
```

Get info about all registered tools for API responses.

Returns a simplified format suitable for frontend display.

**Returns:**

- `list[dict]` - Tool info dicts sorted by priority (highest first)

**Output format:**

```python
[
    {
        "id": "web_search",
        "name": "web_search",
        "description": "Search the web for current information",
        "enabled": True,
        "priority": 100
    },
    ...
]
```

**Example:**

```python
# In FastAPI endpoint
@app.get("/api/tools")
async def get_tools():
    return {"tools": ToolRegistry.list_tools_info()}
```

---

## Constants

### PRIORITY

```python
PRIORITY = {
    "BUILTIN": 100,   # Built-in tools (highest priority)
    "OFFICIAL": 50,   # Official extension tools
    "COMMUNITY": 10,  # Third-party/custom tools
}
```

Use these constants when registering tools:

```python
from canvas_chat.tool_registry import ToolRegistry, PRIORITY

# Built-in tool
ToolRegistry.register(
    id="calculator",
    handler=CalculatorTool,
    priority=PRIORITY["BUILTIN"],
)

# Community tool
ToolRegistry.register(
    id="custom_search",
    handler=CustomSearchTool,
    priority=PRIORITY["COMMUNITY"],
)
```

**Priority behavior:**

- Higher priority tools are listed first in `list_tools_info()` and `get_enabled_tools()`
- If two tools have the same ID, the later registration overwrites (with warning)

---

## Complete example

```python
"""Example: Currency conversion tool."""

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import ToolRegistry, PRIORITY


class CurrencyTool(ToolPlugin):
    """Convert between currencies using exchange rates."""

    # Simplified exchange rates (in production, fetch from API)
    RATES = {
        "USD": 1.0,
        "EUR": 0.85,
        "GBP": 0.73,
        "JPY": 110.0,
    }

    def get_name(self) -> str:
        return "currency_convert"

    def get_description(self) -> str:
        return "Convert amounts between currencies (USD, EUR, GBP, JPY)"

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "amount": {
                    "type": "number",
                    "description": "Amount to convert"
                },
                "from_currency": {
                    "type": "string",
                    "enum": ["USD", "EUR", "GBP", "JPY"],
                    "description": "Source currency"
                },
                "to_currency": {
                    "type": "string",
                    "enum": ["USD", "EUR", "GBP", "JPY"],
                    "description": "Target currency"
                }
            },
            "required": ["amount", "from_currency", "to_currency"]
        }

    async def execute(
        self,
        amount: float = 0,
        from_currency: str = "",
        to_currency: str = "",
        **kwargs
    ) -> dict:
        # Validate inputs
        if amount <= 0:
            return {"error": "Amount must be positive"}

        from_currency = from_currency.upper()
        to_currency = to_currency.upper()

        if from_currency not in self.RATES:
            return {"error": f"Unknown currency: {from_currency}"}
        if to_currency not in self.RATES:
            return {"error": f"Unknown currency: {to_currency}"}

        # Convert via USD
        usd_amount = amount / self.RATES[from_currency]
        result = usd_amount * self.RATES[to_currency]

        return {
            "amount": amount,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "result": round(result, 2),
            "rate": round(self.RATES[to_currency] / self.RATES[from_currency], 4)
        }


# Register the tool
ToolRegistry.register(
    id="currency_convert",
    handler=CurrencyTool,
    priority=PRIORITY["COMMUNITY"],
)


# Test the tool
if __name__ == "__main__":
    import asyncio

    async def test():
        tool = CurrencyTool()

        # Test conversion
        result = await tool.execute(
            amount=100,
            from_currency="USD",
            to_currency="EUR"
        )
        print(result)
        # {"amount": 100, "from_currency": "USD", "to_currency": "EUR",
        #  "result": 85.0, "rate": 0.85}

        # Test via registry
        result = await ToolRegistry.execute_tool("currency_convert", {
            "amount": 50,
            "from_currency": "GBP",
            "to_currency": "JPY"
        })
        print(result)

    asyncio.run(test())
```

---

## See also

- [Tool Calling Architecture](../explanation/tool-calling-architecture.md) - Design decisions
- [How to Create Tool Plugins](../how-to/create-tool-plugins.md) - Step-by-step guide
- [Plugin Architecture](../explanation/plugin-architecture.md) - Overview of plugin systems
