/**
 * Deep Research Node Plugin (Built-in)
 *
 * Provides deep research nodes for Google's Deep Research agent.
 * Deep research nodes display:
 * - Collapsible thinking summaries section (live updates)
 * - Main research report (markdown)
 * - Citations/sources section
 * - Progress indicator during research
 *
 * Supports stop/continue and can be resumed after browser close.
 */
import { BaseNode, Actions, HeaderButtons } from '../node-protocols.js';
import { NodeRegistry } from '../node-registry.js';

/**
 * DeepResearchNode - Protocol for Google Deep Research results
 */
class DeepResearchNode extends BaseNode {
    /**
     * Get the type label for this node
     * @returns {string}
     */
    getTypeLabel() {
        return 'Deep Research';
    }

    /**
     * Get the type icon for this node
     * @returns {string}
     */
    getTypeIcon() {
        return '\uD83D\uDD2C'; // Microscope emoji
    }

    /**
     * Get header buttons for this node
     * @returns {Array<string>}
     */
    getHeaderButtons() {
        return [
            HeaderButtons.NAV_PARENT,
            HeaderButtons.NAV_CHILD,
            HeaderButtons.COLLAPSE,
            HeaderButtons.STOP, // For stopping research generation
            HeaderButtons.CONTINUE, // For continuing stopped research
            HeaderButtons.RESET_SIZE,
            HeaderButtons.FIT_VIEWPORT,
            HeaderButtons.DELETE,
        ];
    }

    /**
     * Get action buttons for this node
     * @returns {Array<string>}
     */
    getActions() {
        return [Actions.REPLY, Actions.CREATE_FLASHCARDS, Actions.COPY];
    }

    /**
     * Custom content rendering for deep research nodes.
     * Shows thinking summaries section, main content, and sources.
     * @param {Canvas} canvas - Canvas instance for rendering utilities
     * @returns {string} HTML content
     */
    renderContent(canvas) {
        let html = '<div class="deep-research-content">';

        const isPlanning = this.node.status === 'planning';
        const awaitingApproval = this.node.status === 'awaiting_plan_approval';

        // Status indicator for in-progress research
        if (this.node.status === 'in_progress' || this.node.status === 'starting') {
            html += `
                <div class="deep-research-status">
                    <div class="deep-research-spinner"></div>
                    <span>Research in progress...</span>
                </div>
            `;
        } else if (isPlanning) {
            html += `
                <div class="deep-research-status">
                    <div class="deep-research-spinner"></div>
                    <span>Drafting plan...</span>
                </div>
            `;
        }

        // Plan-review section (visible during planning + awaiting_plan_approval)
        const turns = Array.isArray(this.node.planTurns) ? this.node.planTurns : [];
        if ((isPlanning || awaitingApproval) && (turns.length > 0 || isPlanning)) {
            html += '<div class="deep-research-plan-section">';
            html += '<h4 class="deep-research-plan-header">Proposed plan</h4>';

            const latestAgentIdx = (() => {
                for (let i = turns.length - 1; i >= 0; i--) {
                    if (turns[i].role === 'agent') return i;
                }
                return -1;
            })();

            // Earlier turns collapsed
            if (latestAgentIdx > 0) {
                html += `
                    <details class="deep-research-plan-history">
                        <summary>Plan history (${latestAgentIdx} earlier ${latestAgentIdx === 1 ? 'turn' : 'turns'})</summary>
                        <div class="deep-research-plan-history-body" onwheel="event.stopPropagation()">
                `;
                for (let i = 0; i < latestAgentIdx; i++) {
                    const t = turns[i];
                    const roleLabel = t.role === 'user' ? (t.approve ? 'You approved' : 'Your feedback') : 'Agent plan';
                    html += `
                        <div class="deep-research-plan-turn ${t.role}">
                            <span class="deep-research-plan-role">${canvas.escapeHtml(roleLabel)}</span>
                            <div class="deep-research-plan-text">${canvas.renderMarkdown(t.text || '')}</div>
                        </div>
                    `;
                }
                html += '</div></details>';
            }

            // Latest agent plan
            if (latestAgentIdx >= 0) {
                const latest = turns[latestAgentIdx];
                html += `
                    <div class="deep-research-plan-turn agent latest">
                        <div class="deep-research-plan-text">${canvas.renderMarkdown(latest.text || '')}</div>
                    </div>
                `;
            } else if (isPlanning) {
                html += '<div class="deep-research-plan-empty">Waiting for the agent to draft a plan...</div>';
            }

            // Revise/approve controls when awaiting approval
            if (awaitingApproval) {
                html += `
                    <div class="deep-research-plan-controls">
                        <textarea
                            class="deep-research-plan-feedback"
                            placeholder="Describe revisions (e.g., focus on X, drop section Y) — leave blank to approve as-is."
                            rows="3"
                            onwheel="event.stopPropagation()"
                        ></textarea>
                        <div class="deep-research-plan-buttons">
                            <button class="secondary-btn deep-research-plan-revise-btn">Revise plan</button>
                            <button class="primary-btn deep-research-plan-approve-btn">Approve & Run</button>
                        </div>
                    </div>
                `;
            }

            html += '</div>';
        }

        // Thinking summaries section (collapsible)
        if (this.node.thinkingHistory && this.node.thinkingHistory.length > 0) {
            html += `
                <details class="deep-research-thinking-section">
                    <summary class="deep-research-thinking-summary">
                        <span class="thinking-icon">\uD83E\uDDE0</span> Thinking (${this.node.thinkingHistory.length} updates)
                    </summary>
                    <div class="deep-research-thinking-content" onwheel="event.stopPropagation()">
            `;

            for (const thought of this.node.thinkingHistory) {
                const time = new Date(thought.timestamp).toLocaleTimeString();
                html += `
                    <div class="deep-research-thought-item">
                        <span class="thought-time">${time}</span>
                        <div class="thought-text">${canvas.renderMarkdown(thought.summary)}</div>
                    </div>
                `;
            }

            html += `
                    </div>
                </details>
            `;
        }

        // Main content (markdown report)
        html += '<div class="deep-research-main-content node-content-inner">';
        if (this.node.content) {
            html += canvas.renderMarkdown(this.node.content);
        }
        html += '</div>';

        // Sources section
        if (this.node.sources && this.node.sources.length > 0) {
            html += `
                <div class="deep-research-sources-section">
                    <h4 class="sources-header">Sources (${this.node.sources.length})</h4>
                    <ul class="sources-list">
            `;
            for (const source of this.node.sources) {
                html += `<li><a href="${canvas.escapeHtml(source.url)}" target="_blank" rel="noopener">${canvas.escapeHtml(source.title)}</a></li>`;
            }
            html += `
                    </ul>
                </div>
            `;
        }

        // Error state
        if (this.node.status === 'failed' && this.node.error) {
            html += `
                <div class="deep-research-error">
                    <span class="error-icon">Error</span>
                    <span class="error-message">${canvas.escapeHtml(this.node.error)}</span>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    /**
     * Wire revise/approve buttons inside the rendered plan section.
     * Emits canvas events that the DeepResearchFeature plugin listens for.
     * @returns {Array}
     */
    getEventBindings() {
        return [
            {
                selector: '.deep-research-plan-revise-btn',
                handler: (nodeId, e, canvas) => {
                    const root = e.currentTarget.closest('.deep-research-plan-section');
                    const textarea = root?.querySelector('.deep-research-plan-feedback');
                    const feedback = textarea?.value?.trim() || '';
                    canvas.emit('deepResearchPlanRevise', nodeId, { feedback });
                },
            },
            {
                selector: '.deep-research-plan-approve-btn',
                handler: (nodeId, e, canvas) => {
                    const root = e.currentTarget.closest('.deep-research-plan-section');
                    const textarea = root?.querySelector('.deep-research-plan-feedback');
                    const feedback = textarea?.value?.trim() || '';
                    canvas.emit('deepResearchPlanApprove', nodeId, { feedback });
                },
            },
        ];
    }
}

// Register the node type
NodeRegistry.register({
    type: 'deep_research',
    protocol: DeepResearchNode,
    defaultSize: { width: 700, height: 600 },
    cssVariables: {
        '--node-deep-research': '#e8f5e9',
        '--node-deep-research-border': '#66bb6a',
    },
    css: `
/* Deep Research Node Styles */
.node.deep_research {
    background: var(--node-deep-research);
    border-color: var(--node-deep-research-border);
}

.deep-research-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Status indicator with spinner */
.deep-research-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(102, 187, 106, 0.15);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-secondary);
    font-size: 0.9em;
}

.deep-research-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--node-deep-research-border);
    border-top-color: transparent;
    border-radius: 50%;
    animation: deep-research-spin 1s linear infinite;
}

@keyframes deep-research-spin {
    to { transform: rotate(360deg); }
}

/* Thinking section */
.deep-research-thinking-section {
    background: var(--bg-secondary, #f5f5f5);
    border-radius: var(--radius-sm, 4px);
    margin-bottom: 8px;
}

.deep-research-thinking-summary {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
    color: var(--text-secondary);
    list-style: none;
    user-select: none;
}

.deep-research-thinking-summary::-webkit-details-marker {
    display: none;
}

.deep-research-thinking-summary::before {
    content: '\\25B6';
    font-size: 0.7em;
    transition: transform 0.2s;
}

.deep-research-thinking-section[open] .deep-research-thinking-summary::before {
    transform: rotate(90deg);
}

.deep-research-thinking-summary:hover {
    background: rgba(0, 0, 0, 0.05);
}

.deep-research-thinking-content {
    padding: 8px 12px;
    border-top: 1px solid var(--border, #e0e0e0);
    max-height: 200px;
    overflow-y: auto;
    overscroll-behavior: contain; /* Prevent scroll from bubbling to canvas */
}

.deep-research-thought-item {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    font-size: 0.85em;
    border-bottom: 1px dashed var(--border, #e0e0e0);
}

.deep-research-thought-item:last-child {
    border-bottom: none;
}

.thought-time {
    color: var(--text-muted, #999);
    font-size: 0.85em;
    flex-shrink: 0;
}

.thought-text {
    color: var(--text-secondary);
    word-break: break-word;
    flex: 1;
    min-width: 0;
}

.thought-text p {
    margin: 0 0 0.5em 0;
}

.thought-text p:last-child {
    margin-bottom: 0;
}

.thought-text code {
    background: rgba(0, 0, 0, 0.05);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
}

/* Main content area */
.deep-research-main-content {
    flex: 1;
    min-height: 0;
}

/* Sources section */
.deep-research-sources-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border, #e0e0e0);
}

.sources-header {
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 8px 0;
}

.sources-list {
    margin: 0;
    padding-left: 20px;
    font-size: 0.85em;
}

.sources-list li {
    margin: 4px 0;
}

.sources-list a {
    color: var(--accent, #228be6);
    text-decoration: none;
}

.sources-list a:hover {
    text-decoration: underline;
}

/* Error state */
.deep-research-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--danger, #ef4444);
    border-radius: var(--radius-sm, 4px);
    color: var(--danger, #ef4444);
    font-size: 0.9em;
}

.error-icon {
    font-weight: 600;
}

/* Plan-review section (collaborative planning) */
.deep-research-plan-section {
    background: rgba(102, 187, 106, 0.08);
    border: 1px solid var(--node-deep-research-border);
    border-radius: var(--radius-sm, 4px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.deep-research-plan-header {
    margin: 0;
    font-size: 0.95em;
    font-weight: 600;
    color: var(--text-primary);
}

.deep-research-plan-history summary {
    cursor: pointer;
    font-size: 0.85em;
    color: var(--text-secondary);
    user-select: none;
}

.deep-research-plan-history-body {
    margin-top: 8px;
    padding: 8px;
    max-height: 200px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg-secondary, rgba(0, 0, 0, 0.03));
    border-radius: var(--radius-sm, 4px);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.deep-research-plan-turn {
    padding: 8px 10px;
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-primary);
    border-left: 3px solid var(--node-deep-research-border);
}

.deep-research-plan-turn.user {
    border-left-color: var(--accent, #228be6);
    background: rgba(34, 139, 230, 0.06);
}

.deep-research-plan-turn.latest {
    border-left-width: 4px;
}

.deep-research-plan-role {
    display: block;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 4px;
}

.deep-research-plan-text {
    font-size: 0.9em;
    color: var(--text-primary);
    word-break: break-word;
}

.deep-research-plan-text p {
    margin: 0 0 0.5em 0;
}

.deep-research-plan-text p:last-child {
    margin-bottom: 0;
}

.deep-research-plan-empty {
    font-size: 0.85em;
    color: var(--text-muted);
    font-style: italic;
}

.deep-research-plan-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
}

.deep-research-plan-feedback {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border, #d0d0d0);
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9em;
    resize: vertical;
}

.deep-research-plan-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
    .node.deep_research {
        background: #1b3320;
        border-color: #388e3c;
    }

    .deep-research-status {
        background: rgba(102, 187, 106, 0.2);
    }

    .deep-research-thinking-section {
        background: rgba(255, 255, 255, 0.05);
    }

    .deep-research-thinking-summary:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .thought-text code {
        background: rgba(255, 255, 255, 0.1);
    }

    .deep-research-plan-section {
        background: rgba(102, 187, 106, 0.12);
    }

    .deep-research-plan-turn {
        background: rgba(255, 255, 255, 0.04);
    }

    .deep-research-plan-turn.user {
        background: rgba(34, 139, 230, 0.12);
    }

    .deep-research-plan-history-body {
        background: rgba(255, 255, 255, 0.03);
    }
}
`,
});

export { DeepResearchNode };
console.log('Deep research node plugin loaded');
