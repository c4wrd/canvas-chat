/**
 * Perplexity Node Plugin (Built-in)
 *
 * Provides custom node rendering for Perplexity AI responses.
 * Features:
 * - Citation badges [1] [2] with hover tooltips showing source title
 * - Clickable badges that open source URL in new tab
 * - Sources section at bottom with full links
 * - Perplexity branding in header
 * - Stop/continue support for streaming
 */
import { BaseNode, Actions, HeaderButtons } from '../node-protocols.js';
import { NodeRegistry } from '../node-registry.js';

/**
 * PerplexityNode - Protocol for Perplexity AI web-grounded responses
 */
class PerplexityNode extends BaseNode {
    /**
     * Get the type label for this node
     * @returns {string}
     */
    getTypeLabel() {
        return 'Perplexity';
    }

    /**
     * Get the type icon for this node
     * @returns {string}
     */
    getTypeIcon() {
        return '\uD83D\uDD0D'; // Magnifying glass emoji
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
            HeaderButtons.STOP, // For stopping streaming
            HeaderButtons.CONTINUE, // For continuing stopped streaming
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
     * Custom content rendering for Perplexity nodes.
     * Shows content with citation badges and sources section.
     * @param {Canvas} canvas - Canvas instance for rendering utilities
     * @returns {string} HTML content
     */
    renderContent(canvas) {
        let html = '<div class="perplexity-content">';

        // Status indicator for in-progress responses
        if (this.node.status === 'in_progress' || this.node.status === 'starting') {
            const stepInfo = this.node.currentStep
                ? `Step ${this.node.currentStep} of ${this.node.config?.max_steps || '?'} - `
                : '';
            html += `
                <div class="perplexity-status">
                    <div class="perplexity-spinner"></div>
                    <span>${stepInfo}Searching and analyzing...</span>
                </div>
            `;
        }

        // Model badge
        if (this.node.model) {
            let modelName = 'Perplexity';
            if (this.node.model === 'sonar-pro') modelName = 'Sonar Pro';
            else if (this.node.model === 'sonar') modelName = 'Sonar';
            else if (this.node.config?.preset === 'fast-search') modelName = 'Fast Search';
            else if (this.node.config?.preset === 'pro-search') modelName = 'Pro Search';
            else if (this.node.config?.preset === 'deep-research') modelName = 'Deep Research';
            else if (this.node.model.includes('/')) {
                // Extract model name from format like "anthropic/claude-opus-4-5"
                const parts = this.node.model.split('/');
                modelName = parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            }
            html += `<div class="perplexity-model-badge">${modelName}</div>`;
        }

        // Progress indicator for multi-step research
        if (this.node.steps && this.node.steps.length > 0 && this.node.config?.max_steps > 1) {
            const completedSteps = this.node.steps.filter(s => s.status === 'completed').length;
            const totalSteps = this.node.config.max_steps;
            const percentage = (completedSteps / totalSteps) * 100;

            html += `
                <div class="perplexity-progress">
                    <div class="perplexity-progress-bar">
                        <div class="perplexity-progress-fill" style="width: ${percentage}%"></div>
                    </div>
                    <div class="perplexity-progress-label">
                        ${completedSteps} of ${totalSteps} steps completed
                    </div>
                </div>
            `;
        }

        // Reasoning section (collapsible)
        if (this.node.reasoning && this.node.reasoning.length > 0) {
            html += `
                <details class="perplexity-reasoning-section">
                    <summary class="perplexity-reasoning-header">
                        <span class="reasoning-icon">🧠</span>
                        <span>Reasoning & Thinking</span>
                    </summary>
                    <div class="perplexity-reasoning-content">
            `;
            this.node.reasoning.forEach((thinking, index) => {
                html += `
                    <div class="perplexity-reasoning-item">
                        ${canvas.escapeHtml(thinking)}
                    </div>
                `;
            });
            html += `
                    </div>
                </details>
            `;
        }

        // Research steps (collapsible)
        if (this.node.steps && this.node.steps.length > 0 && this.node.config?.max_steps > 1) {
            html += `
                <details class="perplexity-steps-section">
                    <summary class="perplexity-steps-header">
                        <span class="steps-icon">📋</span>
                        <span>Research Steps (${this.node.steps.length})</span>
                    </summary>
                    <div class="perplexity-steps-content">
            `;
            this.node.steps.forEach((step, index) => {
                const statusIcon = step.status === 'completed' ? '✅' : '⏳';
                html += `
                    <div class="perplexity-step-item ${step.status}">
                        <div class="perplexity-step-header">
                            <span class="step-icon">${statusIcon}</span>
                            <span class="step-title">Step ${step.step}</span>
                        </div>
                        ${step.thinking ? `
                            <div class="perplexity-step-thinking">
                                <strong>Thinking:</strong> ${canvas.escapeHtml(step.thinking)}
                            </div>
                        ` : ''}
                        ${step.content ? `
                            <div class="perplexity-step-content">
                                ${canvas.renderMarkdown(step.content)}
                            </div>
                        ` : ''}
                        ${step.sources && step.sources.length > 0 ? `
                            <div class="perplexity-step-sources">
                                <strong>Sources:</strong>
                                <ul>
                                    ${step.sources.map((source, i) => {
                                        const url = typeof source === 'string' ? source : source.url;
                                        const title = typeof source === 'string'
                                            ? this.extractDomain(source)
                                            : (source.title || this.extractDomain(source.url));
                                        return `<li><a href="${canvas.escapeHtml(url)}" target="_blank" rel="noopener">${canvas.escapeHtml(title)}</a></li>`;
                                    }).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            html += `
                    </div>
                </details>
            `;
        }

        // Main content with citation processing
        html += '<div class="perplexity-main-content node-content-inner">';
        if (this.node.content) {
            // Process content to add citation badges
            let processedContent = this.node.content;

            // Replace citation references [1], [2], etc. with clickable badges
            if (this.node.citations && this.node.citations.length > 0) {
                processedContent = this.processCitations(processedContent, this.node.citations, canvas);
            }

            html += canvas.renderMarkdown(processedContent);
        }
        html += '</div>';

        // Citations/Sources section
        if (this.node.citations && this.node.citations.length > 0) {
            html += `
                <div class="perplexity-sources-section">
                    <h4 class="perplexity-sources-header">
                        <span class="sources-icon">\uD83D\uDD17</span>
                        Sources (${this.node.citations.length})
                    </h4>
                    <ul class="perplexity-sources-list">
            `;
            this.node.citations.forEach((citation, index) => {
                const url = typeof citation === 'string' ? citation : citation.url;
                const title = typeof citation === 'string'
                    ? this.extractDomain(citation)
                    : (citation.title || this.extractDomain(citation.url));
                html += `
                    <li class="perplexity-source-item">
                        <span class="source-number">[${index + 1}]</span>
                        <a href="${canvas.escapeHtml(url)}" target="_blank" rel="noopener" title="${canvas.escapeHtml(url)}">
                            ${canvas.escapeHtml(title)}
                        </a>
                    </li>
                `;
            });
            html += `
                    </ul>
                </div>
            `;
        }

        // Error state
        if (this.node.status === 'failed' && this.node.error) {
            html += `
                <div class="perplexity-error">
                    <span class="error-icon">\u26A0\uFE0F</span>
                    <span class="error-message">${canvas.escapeHtml(this.node.error)}</span>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    /**
     * Process content to add clickable citation badges
     * @param {string} content - The raw content
     * @param {Array} citations - Array of citation URLs or objects
     * @param {Canvas} canvas - Canvas for escaping
     * @returns {string} Processed content with citation badges
     */
    processCitations(content, citations, canvas) {
        // Match citation patterns like [1], [2], [1,2], [1][2], etc.
        return content.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (match, nums) => {
            const numbers = nums.split(/,\s*/).map(n => parseInt(n.trim(), 10));
            const badges = numbers.map(num => {
                const index = num - 1;
                if (index >= 0 && index < citations.length) {
                    const citation = citations[index];
                    const url = typeof citation === 'string' ? citation : citation.url;
                    const title = typeof citation === 'string'
                        ? this.extractDomain(citation)
                        : (citation.title || this.extractDomain(citation.url));
                    return `<a href="${canvas.escapeHtml(url)}" target="_blank" rel="noopener" class="citation-badge" title="${canvas.escapeHtml(title)}">[${num}]</a>`;
                }
                return `[${num}]`;
            });
            return badges.join('');
        });
    }

    /**
     * Extract domain from URL for display
     * @param {string} url - The URL
     * @returns {string} Domain name
     */
    extractDomain(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace(/^www\./, '');
        } catch {
            return url;
        }
    }
}

// Register the node type
NodeRegistry.register({
    type: 'perplexity',
    protocol: PerplexityNode,
    defaultSize: { width: 640, height: 480 },
    cssVariables: {
        '--node-perplexity': '#e3f2fd',
        '--node-perplexity-border': '#2196f3',
    },
    css: `
/* Perplexity Node Styles */
.node.perplexity {
    background: var(--node-perplexity);
    border-color: var(--node-perplexity-border);
}

.perplexity-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Status indicator with spinner */
.perplexity-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(33, 150, 243, 0.15);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-secondary);
    font-size: 0.9em;
}

.perplexity-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--node-perplexity-border);
    border-top-color: transparent;
    border-radius: 50%;
    animation: perplexity-spin 1s linear infinite;
}

@keyframes perplexity-spin {
    to { transform: rotate(360deg); }
}

/* Model badge */
.perplexity-model-badge {
    display: inline-block;
    padding: 2px 8px;
    background: var(--node-perplexity-border);
    color: white;
    font-size: 0.75em;
    font-weight: 600;
    border-radius: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    align-self: flex-start;
}

/* Main content area */
.perplexity-main-content {
    flex: 1;
    min-height: 0;
}

/* Citation badges */
.citation-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    margin: 0 1px;
    min-width: 18px;
    height: 18px;
    background: var(--node-perplexity-border);
    color: white;
    font-size: 0.7em;
    font-weight: 600;
    border-radius: 9px;
    text-decoration: none;
    vertical-align: super;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
}

.citation-badge:hover {
    background: #1976d2;
    transform: scale(1.1);
    text-decoration: none;
}

/* Sources section */
.perplexity-sources-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border, #e0e0e0);
}

.perplexity-sources-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 8px 0;
}

.sources-icon {
    font-size: 1em;
}

.perplexity-sources-list {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85em;
}

.perplexity-source-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 4px 0;
    padding: 4px 8px;
    background: rgba(33, 150, 243, 0.08);
    border-radius: var(--radius-sm, 4px);
    transition: background 0.15s;
}

.perplexity-source-item:hover {
    background: rgba(33, 150, 243, 0.15);
}

.source-number {
    color: var(--node-perplexity-border);
    font-weight: 600;
    font-size: 0.85em;
    flex-shrink: 0;
}

.perplexity-source-item a {
    color: var(--accent, #228be6);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.perplexity-source-item a:hover {
    text-decoration: underline;
}

/* Progress indicator */
.perplexity-progress {
    margin: 12px 0;
}

.perplexity-progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(33, 150, 243, 0.15);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 6px;
}

.perplexity-progress-fill {
    height: 100%;
    background: var(--node-perplexity-border);
    transition: width 0.3s ease;
}

.perplexity-progress-label {
    font-size: 0.8em;
    color: var(--text-muted);
    text-align: center;
}

/* Reasoning section */
.perplexity-reasoning-section {
    margin: 12px 0;
    padding: 12px;
    background: rgba(156, 39, 176, 0.08);
    border: 1px solid rgba(156, 39, 176, 0.2);
    border-radius: var(--radius-sm, 4px);
}

.perplexity-reasoning-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    list-style: none;
}

.perplexity-reasoning-header::-webkit-details-marker {
    display: none;
}

.reasoning-icon {
    font-size: 1em;
}

.perplexity-reasoning-content {
    margin-top: 12px;
    font-size: 0.85em;
    color: var(--text-secondary);
}

.perplexity-reasoning-item {
    padding: 8px;
    margin: 4px 0;
    background: rgba(156, 39, 176, 0.05);
    border-radius: var(--radius-sm, 4px);
}

/* Research steps section */
.perplexity-steps-section {
    margin: 12px 0;
    padding: 12px;
    background: rgba(33, 150, 243, 0.08);
    border: 1px solid rgba(33, 150, 243, 0.2);
    border-radius: var(--radius-sm, 4px);
}

.perplexity-steps-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    list-style: none;
}

.perplexity-steps-header::-webkit-details-marker {
    display: none;
}

.steps-icon {
    font-size: 1em;
}

.perplexity-steps-content {
    margin-top: 12px;
}

.perplexity-step-item {
    padding: 12px;
    margin: 8px 0;
    background: rgba(33, 150, 243, 0.05);
    border: 1px solid rgba(33, 150, 243, 0.15);
    border-radius: var(--radius-sm, 4px);
}

.perplexity-step-item.completed {
    opacity: 0.9;
}

.perplexity-step-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9em;
    margin-bottom: 8px;
}

.step-icon {
    font-size: 1em;
}

.perplexity-step-thinking {
    font-size: 0.85em;
    color: var(--text-muted);
    font-style: italic;
    margin: 6px 0;
    padding: 6px 10px;
    background: rgba(156, 39, 176, 0.08);
    border-left: 3px solid rgba(156, 39, 176, 0.4);
    border-radius: 2px;
}

.perplexity-step-content {
    font-size: 0.9em;
    margin: 8px 0;
}

.perplexity-step-sources {
    font-size: 0.85em;
    margin-top: 8px;
}

.perplexity-step-sources ul {
    margin: 4px 0 0 0;
    padding-left: 20px;
}

.perplexity-step-sources li {
    margin: 2px 0;
}

/* Error state */
.perplexity-error {
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
    font-size: 1.1em;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
    .node.perplexity {
        background: #0d3a5c;
        border-color: #42a5f5;
    }

    .perplexity-status {
        background: rgba(33, 150, 243, 0.25);
    }

    .perplexity-progress-bar {
        background: rgba(33, 150, 243, 0.25);
    }

    .perplexity-reasoning-section {
        background: rgba(156, 39, 176, 0.15);
        border-color: rgba(156, 39, 176, 0.3);
    }

    .perplexity-reasoning-item {
        background: rgba(156, 39, 176, 0.1);
    }

    .perplexity-steps-section {
        background: rgba(33, 150, 243, 0.15);
        border-color: rgba(33, 150, 243, 0.3);
    }

    .perplexity-step-item {
        background: rgba(33, 150, 243, 0.1);
        border-color: rgba(33, 150, 243, 0.25);
    }

    .perplexity-step-thinking {
        background: rgba(156, 39, 176, 0.15);
        border-left-color: rgba(156, 39, 176, 0.5);
    }

    .perplexity-source-item {
        background: rgba(33, 150, 243, 0.15);
    }

    .perplexity-source-item:hover {
        background: rgba(33, 150, 243, 0.25);
    }

    .citation-badge {
        background: #42a5f5;
    }

    .citation-badge:hover {
        background: #64b5f6;
    }
}
`,
});

export { PerplexityNode };
console.log('Perplexity node plugin loaded');
