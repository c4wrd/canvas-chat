"""Calculator Tool Plugin

Provides safe mathematical expression evaluation.
"""

import ast
import logging
import math
import operator
from typing import Any

from canvas_chat.tool_plugin import ToolPlugin
from canvas_chat.tool_registry import PRIORITY, ToolRegistry

logger = logging.getLogger(__name__)

# Allowed operators for safe evaluation
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

# Allowed math functions
SAFE_FUNCTIONS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
    "pow": pow,
}

# Allowed constants
SAFE_CONSTANTS = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
}


def safe_eval(expression: str) -> float | int:
    """Safely evaluate a mathematical expression.

    Only allows basic arithmetic operations, math functions, and constants.
    Does not allow arbitrary code execution.

    Args:
        expression: Mathematical expression to evaluate

    Returns:
        Result of the evaluation

    Raises:
        ValueError: If expression contains disallowed operations
    """
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"Invalid expression syntax: {e}") from e

    def _eval(node: ast.AST) -> float | int:
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        elif isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise ValueError(f"Unsupported constant type: {type(node.value)}")
        elif isinstance(node, ast.Name):
            name = node.id.lower()
            if name in SAFE_CONSTANTS:
                return SAFE_CONSTANTS[name]
            raise ValueError(f"Unknown variable: {node.id}")
        elif isinstance(node, ast.BinOp):
            op_type = type(node.op)
            if op_type not in SAFE_OPERATORS:
                raise ValueError(f"Unsupported operator: {op_type.__name__}")
            left = _eval(node.left)
            right = _eval(node.right)
            return SAFE_OPERATORS[op_type](left, right)
        elif isinstance(node, ast.UnaryOp):
            op_type = type(node.op)
            if op_type not in SAFE_OPERATORS:
                raise ValueError(f"Unsupported operator: {op_type.__name__}")
            operand = _eval(node.operand)
            return SAFE_OPERATORS[op_type](operand)
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only simple function calls are allowed")
            func_name = node.func.id.lower()
            if func_name not in SAFE_FUNCTIONS:
                raise ValueError(f"Unknown function: {node.func.id}")
            args = [_eval(arg) for arg in node.args]
            return SAFE_FUNCTIONS[func_name](*args)
        elif isinstance(node, ast.List):
            return [_eval(elem) for elem in node.elts]
        elif isinstance(node, ast.Tuple):
            return tuple(_eval(elem) for elem in node.elts)
        else:
            raise ValueError(f"Unsupported expression type: {type(node).__name__}")

    return _eval(tree)


class CalculatorTool(ToolPlugin):
    """Calculator tool for evaluating mathematical expressions."""

    def get_name(self) -> str:
        return "calculator"

    def get_description(self) -> str:
        return (
            "Evaluate mathematical expressions. Supports basic arithmetic "
            "(+, -, *, /, **, %), math functions (sqrt, sin, cos, tan, log, "
            "exp, floor, ceil, abs, round, min, max), and constants (pi, e)."
        )

    def get_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": (
                        "Mathematical expression to evaluate. Examples: "
                        "'2 + 2', 'sqrt(16)', 'sin(pi/2)', '2**10'"
                    ),
                },
            },
            "required": ["expression"],
        }

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Evaluate a mathematical expression safely.

        Args:
            expression: Mathematical expression string

        Returns:
            Dictionary with the result or error
        """
        expression = kwargs.get("expression", "")

        if not expression:
            return {"error": "No expression provided", "expression": ""}

        logger.info(f"[CalculatorTool] Evaluating: {expression}")

        try:
            result = safe_eval(expression)
            return {
                "expression": expression,
                "result": result,
            }
        except ValueError as e:
            return {
                "expression": expression,
                "error": str(e),
            }
        except ZeroDivisionError:
            return {
                "expression": expression,
                "error": "Division by zero",
            }
        except OverflowError:
            return {
                "expression": expression,
                "error": "Result too large",
            }
        except Exception as e:
            logger.error(f"[CalculatorTool] Evaluation failed: {e}")
            return {
                "expression": expression,
                "error": f"Evaluation failed: {str(e)}",
            }


# Register the calculator tool
ToolRegistry.register(
    id="calculator",
    handler=CalculatorTool,
    priority=PRIORITY["BUILTIN"],
    enabled=True,
)

logger.info("Calculator tool plugin loaded")
