/**
 * Agent Run Node Plugin (Built-in)
 *
 * Renders a single deep-agent run on the canvas. v1 surfaces:
 *   - Header with the agent's icon + name + live status pill
 *   - Live todo checklist (driven by todo_update SSE events)
 *   - Final markdown report (from message SSE events)
 *
 * Activity log and files panels are stubbed (hidden behind flags) so
 * v2 can light them up without rewriting the renderer.
 */

import { BaseNode, Actions, HeaderButtons } from '../node-protocols.js';
import { NodeRegistry } from '../node-registry.js';

const STATUS_LABELS = {
    pending: 'Pending',
    in_progress: 'Running',
    completed: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
};

/**
 *
 */
class AgentRunNode extends BaseNode {
    /**
     *
     */
    getTypeLabel() {
        return this.node.agentName || 'Agent';
    }

    /**
     *
     */
    getTypeIcon() {
        return this.node.agentIcon || '🤖'; // robot
    }

    /**
     *
     */
    getHeaderButtons() {
        return [
            HeaderButtons.NAV_PARENT,
            HeaderButtons.NAV_CHILD,
            HeaderButtons.COLLAPSE,
            HeaderButtons.STOP,
            HeaderButtons.RESET_SIZE,
            HeaderButtons.FIT_VIEWPORT,
            HeaderButtons.DELETE,
        ];
    }

    /**
     *
     */
    getActions() {
        return [Actions.REPLY, Actions.COPY];
    }

    /**
     *
     */
    supportsStopContinue() {
        return true;
    }

    /**
     *
     * @param canvas
     */
    renderContent(canvas) {
        const status = this.node.status || 'pending';
        const todos = Array.isArray(this.node.todos) ? this.node.todos : [];
        const toolCalls = Array.isArray(this.node.toolCalls) ? this.node.toolCalls : [];

        let html = '<div class="agent-run-content">';

        // Status pill
        const label = STATUS_LABELS[status] || status;
        const running = status === 'in_progress' || status === 'pending';
        html += `
            <div class="agent-run-status agent-run-status-${status}">
                ${running ? '<div class="agent-run-spinner"></div>' : ''}
                <span>${canvas.escapeHtml(label)}</span>
            </div>
        `;

        // Todos panel
        if (todos.length > 0 || running) {
            html += '<div class="agent-run-todos-section">';
            html += '<h4 class="agent-run-section-header">Plan</h4>';
            if (todos.length === 0) {
                html += '<div class="agent-run-todos-empty">Drafting plan...</div>';
            } else {
                html += '<ul class="agent-run-todos-list">';
                for (const t of todos) {
                    const text = t.content || t.task || t.title || '';
                    const tstatus = (t.status || 'pending').toLowerCase();
                    const tooltip = canvas.escapeHtml(tstatus);
                    const marker = tstatus === 'completed' ? '☑'
                        : tstatus === 'in_progress' ? '◐'
                        : '☐';
                    html += `
                        <li class="agent-run-todo agent-run-todo-${tstatus}" title="${tooltip}">
                            <span class="agent-run-todo-marker">${marker}</span>
                            <span class="agent-run-todo-text">${canvas.escapeHtml(text)}</span>
                        </li>
                    `;
                }
                html += '</ul>';
            }
            html += '</div>';
        }

        // Activity log — collapsed by default, shows tool calls
        if (toolCalls.length > 0) {
            html += `
                <details class="agent-run-activity-section">
                    <summary>Activity (${toolCalls.length})</summary>
                    <div class="agent-run-activity-body" onwheel="event.stopPropagation()">
            `;
            for (const tc of toolCalls) {
                html += `
                    <div class="agent-run-activity-item">
                        <span class="agent-run-activity-name">${canvas.escapeHtml(tc.name || '')}</span>
                        ${tc.result !== undefined ? '<span class="agent-run-activity-done">✓</span>' : ''}
                    </div>
                `;
            }
            html += '</div></details>';
        }

        // Final report (markdown)
        html += '<div class="agent-run-report node-content-inner">';
        if (this.node.content) {
            html += canvas.renderMarkdown(this.node.content);
        }
        html += '</div>';

        // Error state
        if (status === 'failed' && this.node.error) {
            html += `
                <div class="agent-run-error">
                    <span class="error-icon">Error</span>
                    <span class="error-message">${canvas.escapeHtml(this.node.error)}</span>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }
}

NodeRegistry.register({
    type: 'agent_run',
    protocol: AgentRunNode,
    defaultSize: { width: 700, height: 600 },
    cssVariables: {
        '--node-agent-run': '#eef2ff',
        '--node-agent-run-border': '#6366f1',
    },
    css: `
.node.agent_run {
    background: var(--node-agent-run);
    border-color: var(--node-agent-run-border);
}

.agent-run-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.agent-run-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm, 4px);
    color: var(--text-secondary);
    font-size: 0.9em;
    background: rgba(99, 102, 241, 0.12);
}

.agent-run-status-completed { background: rgba(34, 197, 94, 0.15); color: #166534; }
.agent-run-status-failed   { background: rgba(239, 68, 68, 0.12); color: #991b1b; }
.agent-run-status-stopped  { background: rgba(107, 114, 128, 0.18); color: #374151; }

.agent-run-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--node-agent-run-border);
    border-top-color: transparent;
    border-radius: 50%;
    animation: agent-run-spin 1s linear infinite;
}

@keyframes agent-run-spin {
    to { transform: rotate(360deg); }
}

.agent-run-section-header {
    margin: 0 0 6px 0;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-secondary);
}

.agent-run-todos-section {
    background: var(--bg-secondary, #f5f5f5);
    border-radius: var(--radius-sm, 4px);
    padding: 8px 12px;
}

.agent-run-todos-empty {
    font-size: 0.85em;
    color: var(--text-muted);
    font-style: italic;
}

.agent-run-todos-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.agent-run-todo {
    display: flex;
    gap: 8px;
    font-size: 0.9em;
    align-items: flex-start;
}

.agent-run-todo-marker {
    flex-shrink: 0;
    width: 1em;
    display: inline-block;
    font-weight: 600;
}

.agent-run-todo-completed .agent-run-todo-text {
    color: var(--text-muted);
    text-decoration: line-through;
}

.agent-run-todo-in_progress {
    font-weight: 500;
}

.agent-run-activity-section {
    background: var(--bg-secondary, #f5f5f5);
    border-radius: var(--radius-sm, 4px);
}

.agent-run-activity-section > summary {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 0.85em;
    color: var(--text-secondary);
    user-select: none;
    list-style: none;
}

.agent-run-activity-section > summary::-webkit-details-marker { display: none; }
.agent-run-activity-section > summary::before {
    content: '\\25B6';
    font-size: 0.7em;
    margin-right: 6px;
    transition: transform 0.2s;
}
.agent-run-activity-section[open] > summary::before { transform: rotate(90deg); }

.agent-run-activity-body {
    padding: 8px 12px;
    border-top: 1px solid var(--border, #e0e0e0);
    max-height: 200px;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.agent-run-activity-item {
    display: flex;
    gap: 8px;
    font-size: 0.85em;
}

.agent-run-activity-name {
    font-family: var(--font-mono, monospace);
    color: var(--text-primary);
}

.agent-run-activity-done {
    color: #16a34a;
}

.agent-run-report {
    flex: 1;
    min-height: 0;
}

.agent-run-error {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--danger, #ef4444);
    border-radius: var(--radius-sm, 4px);
    color: var(--danger, #ef4444);
    font-size: 0.9em;
}

@media (prefers-color-scheme: dark) {
    .node.agent_run {
        background: #1e1b4b;
        border-color: #818cf8;
    }
    .agent-run-todos-section,
    .agent-run-activity-section {
        background: rgba(255, 255, 255, 0.05);
    }
    .agent-run-status-completed { background: rgba(34, 197, 94, 0.2); color: #bbf7d0; }
    .agent-run-status-failed { background: rgba(239, 68, 68, 0.2); color: #fecaca; }
    .agent-run-status-stopped { background: rgba(107, 114, 128, 0.25); color: #d1d5db; }
}
`,
});

export { AgentRunNode };
console.log('Agent run node plugin loaded');
