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

        // Status indicator for in-progress research
        if (this.node.status === 'in_progress' || this.node.status === 'starting') {
            html += `
                <div class="deep-research-status">
                    <div class="deep-research-spinner"></div>
                    <span>Research in progress...</span>
                </div>
            `;
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
}
`,
});

export { DeepResearchNode };
console.log('Deep research node plugin loaded');
