"""Tests for the calculator tool plugin."""

import asyncio
import math

import pytest

from canvas_chat.plugins.calculator_tool import CalculatorTool, safe_eval


class TestSafeEval:
    """Tests for the safe_eval function."""

    def test_basic_arithmetic(self):
        """Test basic arithmetic operations."""
        assert safe_eval("2 + 2") == 4
        assert safe_eval("10 - 3") == 7
        assert safe_eval("4 * 5") == 20
        assert safe_eval("15 / 3") == 5
        assert safe_eval("2 ** 3") == 8
        assert safe_eval("17 % 5") == 2
        assert safe_eval("17 // 5") == 3

    def test_negative_numbers(self):
        """Test negative numbers."""
        assert safe_eval("-5") == -5
        assert safe_eval("-5 + 3") == -2
        assert safe_eval("5 + -3") == 2

    def test_parentheses(self):
        """Test parentheses for order of operations."""
        assert safe_eval("(2 + 3) * 4") == 20
        assert safe_eval("2 + 3 * 4") == 14
        assert safe_eval("((1 + 2) * 3) + 4") == 13

    def test_decimals(self):
        """Test decimal numbers."""
        assert abs(safe_eval("3.14 + 1") - 4.14) < 1e-10
        assert safe_eval("2.5 * 2") == 5.0
        assert abs(safe_eval("1 / 3") - 0.3333333333333333) < 1e-10

    def test_math_functions(self):
        """Test math functions."""
        assert safe_eval("sqrt(16)") == 4
        assert safe_eval("abs(-5)") == 5
        assert abs(safe_eval("sin(0)") - 0) < 1e-10
        assert abs(safe_eval("cos(0)") - 1) < 1e-10
        assert safe_eval("floor(3.7)") == 3
        assert safe_eval("ceil(3.2)") == 4
        assert safe_eval("round(3.5)") == 4
        assert safe_eval("max(1, 5, 3)") == 5
        assert safe_eval("min(1, 5, 3)") == 1
        assert safe_eval("pow(2, 3)") == 8

    def test_math_constants(self):
        """Test math constants."""
        assert abs(safe_eval("pi") - math.pi) < 1e-10
        assert abs(safe_eval("e") - math.e) < 1e-10
        assert abs(safe_eval("tau") - math.tau) < 1e-10
        assert abs(safe_eval("PI") - math.pi) < 1e-10  # Case insensitive

    def test_complex_expressions(self):
        """Test complex mathematical expressions."""
        assert abs(safe_eval("sin(pi/2)") - 1) < 1e-10
        assert abs(safe_eval("sqrt(2) ** 2") - 2) < 1e-10
        assert abs(safe_eval("log(e)") - 1) < 1e-10

    def test_invalid_syntax(self):
        """Test that invalid syntax raises ValueError."""
        with pytest.raises(ValueError, match="Invalid expression syntax"):
            safe_eval("2 +")
        with pytest.raises(ValueError, match="Invalid expression syntax"):
            safe_eval("(2 + 3")

    def test_unknown_variable(self):
        """Test that unknown variables raise ValueError."""
        with pytest.raises(ValueError, match="Unknown variable"):
            safe_eval("x + 1")
        with pytest.raises(ValueError, match="Unknown variable"):
            safe_eval("foo")

    def test_unknown_function(self):
        """Test that unknown functions raise ValueError."""
        with pytest.raises(ValueError, match="Unknown function"):
            safe_eval("evil_func(1)")
        with pytest.raises(ValueError, match="Unknown function"):
            safe_eval("__import__('os')")

    def test_disallowed_operations(self):
        """Test that dangerous operations are blocked."""
        # Strings are not allowed
        with pytest.raises(ValueError):
            safe_eval("'hello'")

        # Method calls are not allowed
        with pytest.raises(ValueError):
            safe_eval("(1).__class__")


class TestCalculatorTool:
    """Tests for the CalculatorTool class."""

    def setup_method(self):
        """Set up calculator tool instance."""
        self.tool = CalculatorTool()

    def test_get_name(self):
        """Test tool name."""
        assert self.tool.get_name() == "calculator"

    def test_get_description(self):
        """Test tool description."""
        desc = self.tool.get_description()
        assert "mathematical" in desc.lower()

    def test_get_parameters(self):
        """Test parameter schema."""
        params = self.tool.get_parameters()
        assert params["type"] == "object"
        assert "expression" in params["properties"]
        assert "expression" in params["required"]

    def test_to_openai_tool(self):
        """Test OpenAI tool format."""
        tool = self.tool.to_openai_tool()
        assert tool["type"] == "function"
        assert tool["function"]["name"] == "calculator"
        assert "parameters" in tool["function"]

    def test_execute_basic(self):
        """Test basic execution."""
        result = asyncio.run(self.tool.execute(expression="2 + 2"))
        assert result["expression"] == "2 + 2"
        assert result["result"] == 4

    def test_execute_complex(self):
        """Test complex expression execution."""
        result = asyncio.run(self.tool.execute(expression="sqrt(16) + 2 ** 3"))
        assert result["result"] == 12  # 4 + 8

    def test_execute_empty_expression(self):
        """Test empty expression."""
        result = asyncio.run(self.tool.execute(expression=""))
        assert "error" in result

    def test_execute_no_expression(self):
        """Test missing expression."""
        result = asyncio.run(self.tool.execute())
        assert "error" in result

    def test_execute_invalid_expression(self):
        """Test invalid expression."""
        result = asyncio.run(self.tool.execute(expression="invalid()"))
        assert "error" in result

    def test_execute_division_by_zero(self):
        """Test division by zero."""
        result = asyncio.run(self.tool.execute(expression="1 / 0"))
        assert "error" in result
        assert "zero" in result["error"].lower()
