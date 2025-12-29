# Matrix evaluation

This document explains the design decision for the `/matrix` command that creates cross-product evaluation tables.

## Context

When exploring ideas in Canvas Chat, users often need to evaluate multiple options against multiple criteria. For example:

- Evaluating 10 mRNA therapy ideas against 5 development criteria
- Comparing product features across customer segments
- Assessing risks against mitigation strategies

Doing this manually requires creating many individual nodes and loses the structured relationship between rows and columns.

## Decision

We implemented a `/matrix` command that creates a specialized MATRIX node type representing a cross-product evaluation table.

## User flow

1. **Select two nodes** containing lists (e.g., "10 ideas" and "5 criteria")
2. **Type `/matrix <context>`** where context describes the evaluation goal
3. **Confirm axes in modal** - review parsed items, remove unwanted ones, swap rows/columns
4. **Create empty matrix** - table appears with "+" buttons in each cell
5. **Fill cells** - click individual cells, rows, columns, or "Fill All"
6. **View and pin** - click filled cells to see details, optionally pin to canvas

## Alternatives considered

### Individual nodes for each evaluation

Create a separate node for each row×column combination.

**Advantages:**

- Simpler implementation
- Each evaluation is a first-class node

**Disadvantages:**

- Overwhelming for large matrices (50+ nodes for 10×5)
- Loses visual structure of the matrix relationship
- Difficult to compare across rows or columns

### Markdown table in a single node

Generate a markdown table with all evaluations in one node.

**Advantages:**

- Simple rendering
- Compact display

**Disadvantages:**

- No interactivity (can't fill cells individually)
- Can't branch from individual cells
- All-or-nothing generation

### Spreadsheet-like interface

Full spreadsheet with formulas, sorting, filtering.

**Advantages:**

- Maximum flexibility
- Familiar interface

**Disadvantages:**

- Scope creep beyond chat interface
- Complex implementation
- Doesn't integrate with DAG structure

## Why interactive matrix nodes

The matrix node approach provides the best balance:

1. **Structured visualization** - clear rows, columns, and cells
2. **Incremental filling** - fill one cell, one row, or all at once
3. **Cell-level interaction** - view details, pin to canvas
4. **DAG integration** - pinned cells become nodes you can branch from
5. **Context-aware generation** - each cell fill includes DAG history

## Implementation notes

### Axis limits

Maximum 10 items per axis (100 cells total). This prevents:

- Overwhelming API costs
- UI performance issues
- Unreadable tables

Users are warned when their lists exceed 10 items.

### LLM-powered list parsing

The `/api/parse-list` endpoint uses an LLM to extract list items from freeform text. This handles:

- Numbered lists (`1.`, `2.`, etc.)
- Bullet lists (`-`, `*`, `•`)
- Paragraph-separated items
- Mixed formats

### Cell context

When filling a cell, the LLM receives:

1. The matrix context (user-provided evaluation goal)
2. The row item (full text)
3. The column item (full text)
4. The DAG history (all ancestor nodes)

This ensures evaluations are informed by the full conversation context.

### Pinned cells

Clicking a filled cell opens a detail modal. The "Pin to Canvas" action:

1. Creates a CELL node with the evaluation content
2. Connects it to the matrix via MATRIX_CELL edge (dashed line)
3. Positions it to the right of the matrix

Pinned cells are full nodes that can be replied to, branched from, or used as context for new questions.

## Future improvements

Potential enhancements if needed:

- **Row/column fill buttons** - fill entire row or column at once
- **Re-fill cell** - regenerate a cell's content
- **Export to CSV** - download matrix as spreadsheet
- **Sort/filter** - reorder rows based on column values
- **Cell editing** - manually adjust generated content
