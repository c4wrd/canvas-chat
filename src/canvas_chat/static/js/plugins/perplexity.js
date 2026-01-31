/**
 * Perplexity Feature Plugin
 *
 * Provides slash commands for Perplexity AI integration:
 * - /perplexity <question> - Fast search with quick preset (responses API)
 * - /perplexity-pro <question> - Deep research using sonar-pro model (chat API)
 * - /perplexity-search <query> - Direct web search
 * - /perplexity-research <question> - Deep research with multi-step analysis (responses API)
 * - /perplexity-agent <question> - Full-featured configuration modal (responses API)
 *
 * Features:
 * - SSE streaming for real-time responses
 * - Citation rendering with clickable badges
 * - Multi-step research with reasoning
 * - Stop/continue support
 */

import { NodeType, EdgeType, createNode, createEdge } from '../graph-types.js';
import { storage } from '../storage.js';
import { readSSEStream } from '../sse.js';
import { apiUrl } from '../utils.js';
import { FeaturePlugin } from '../feature-plugin.js';

/**
 * PerplexityFeature - Handles Perplexity slash commands
 */
class PerplexityFeature extends FeaturePlugin {
    /**
     * Create a PerplexityFeature instance.
     * @param {AppContext} context - Application context with injected dependencies
     */
    constructor(context) {
        super(context);
    }

    /**
     * Lifecycle hook called when the plugin is loaded.
     */
    async onLoad() {
        console.log('[PerplexityFeature] Loaded');

        // Register agent configuration modal
        const modalTemplate = `
            <div id="perplexity-agent-modal" class="modal" style="display: none">
                <div class="modal-content modal-wide">
                    <div class="modal-header">
                        <h2>Perplexity Agent Configuration</h2>
                        <button class="modal-close" id="perplexity-agent-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="perplexity-query-group">
                            <label for="perplexity-query">Research Query</label>
                            <textarea
                                id="perplexity-query"
                                class="modal-text-input"
                                rows="3"
                                placeholder="Enter your research question..."
                                readonly
                            ></textarea>
                        </div>

                        <div class="perplexity-preset-group">
                            <label for="perplexity-preset">Preset</label>
                            <select id="perplexity-preset" class="perplexity-select">
                                <option value="fast-search">Fast Search</option>
                                <option value="pro-search">Pro Search</option>
                                <option value="deep-research">Deep Research</option>
                                <option value="custom">Custom Configuration</option>
                            </select>
                        </div>

                        <details class="perplexity-filters-section">
                            <summary>Search Filters</summary>
                            <div class="perplexity-filters-content">
                                <div class="perplexity-domain-group">
                                    <label>Domain Filter</label>
                                    <div class="perplexity-domain-presets">
                                        <button type="button" data-domains=".edu,arxiv.org,scholar.google.com" class="domain-preset-btn">Academic</button>
                                        <button type="button" data-domains="reuters.com,apnews.com,bbc.com,npr.org" class="domain-preset-btn">News</button>
                                        <button type="button" data-domains=".gov,gov.uk,europa.eu" class="domain-preset-btn">Government</button>
                                    </div>
                                    <div class="perplexity-domain-mode">
                                        <label><input type="radio" name="domain-mode" value="allow" checked /> Include only</label>
                                        <label><input type="radio" name="domain-mode" value="block" /> Exclude</label>
                                    </div>
                                    <input type="text" id="perplexity-domains" class="perplexity-input" placeholder="example.com, arxiv.org (comma-separated)" />
                                    <small>Click presets to add domains. Max 20 domains.</small>
                                </div>

                                <div class="perplexity-recency-group">
                                    <label for="perplexity-recency">Content Freshness</label>
                                    <select id="perplexity-recency" class="perplexity-select">
                                        <option value="">Any time</option>
                                        <option value="hour">Past hour</option>
                                        <option value="day">Past 24 hours</option>
                                        <option value="week">Past week</option>
                                        <option value="month">Past month</option>
                                        <option value="year">Past year</option>
                                    </select>
                                </div>

                                <div class="perplexity-date-group">
                                    <label>Custom Date Range (optional)</label>
                                    <div class="perplexity-date-inputs">
                                        <input type="date" id="perplexity-date-after" class="perplexity-input" />
                                        <span>to</span>
                                        <input type="date" id="perplexity-date-before" class="perplexity-input" />
                                    </div>
                                </div>

                                <div class="perplexity-language-group">
                                    <label for="perplexity-language">Result Languages</label>
                                    <select id="perplexity-language" class="perplexity-select" multiple size="3">
                                        <option value="en" selected>English</option>
                                        <option value="es">Spanish</option>
                                        <option value="fr">French</option>
                                        <option value="de">German</option>
                                        <option value="zh">Chinese</option>
                                        <option value="ja">Japanese</option>
                                        <option value="ko">Korean</option>
                                        <option value="pt">Portuguese</option>
                                    </select>
                                    <small>Ctrl/Cmd+click to select multiple</small>
                                </div>
                            </div>
                        </details>

                        <div id="perplexity-advanced-options" style="display: none;">
                            <div class="perplexity-model-group">
                                <label for="perplexity-model">Model</label>
                                <select id="perplexity-model" class="perplexity-select">
                                    <option value="perplexity/sonar">Sonar</option>
                                    <option value="anthropic/claude-opus-4-5">Claude Opus 4.5</option>
                                    <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</option>
                                    <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5</option>
                                    <option value="openai/gpt-5.2">GPT-5.2</option>
                                    <option value="openai/gpt-5.1">GPT-5.1</option>
                                    <option value="openai/gpt-5-mini">GPT-5 Mini</option>
                                    <option value="google/gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                                    <option value="google/gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                                    <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
                                    <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
                                    <option value="xai/grok-4-1-fast-non-reasoning" selected>Grok 4.1 Fast (Default)</option>
                                </select>
                            </div>

                            <div class="perplexity-steps-group">
                                <label for="perplexity-max-steps">
                                    Max Steps: <span id="perplexity-steps-value">3</span>
                                </label>
                                <input
                                    type="range"
                                    id="perplexity-max-steps"
                                    min="1"
                                    max="10"
                                    value="3"
                                    class="perplexity-slider"
                                />
                            </div>

                            <div class="perplexity-reasoning-group">
                                <label for="perplexity-reasoning">Reasoning Effort</label>
                                <select id="perplexity-reasoning" class="perplexity-select">
                                    <option value="">None</option>
                                    <option value="low">Low</option>
                                    <option value="medium" selected>Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </div>

                            <div class="perplexity-tools-group">
                                <label>Tools</label>
                                <div class="perplexity-tools-checkboxes">
                                    <label class="perplexity-checkbox-label">
                                        <input type="checkbox" id="perplexity-tool-web-search" checked />
                                        Web Search
                                    </label>
                                    <label class="perplexity-checkbox-label">
                                        <input type="checkbox" id="perplexity-tool-fetch-url" />
                                        Fetch URL
                                    </label>
                                </div>
                            </div>

                            <div class="perplexity-instructions-group">
                                <label for="perplexity-instructions">Custom Instructions (Optional)</label>
                                <textarea
                                    id="perplexity-instructions"
                                    class="modal-text-input"
                                    rows="3"
                                    placeholder="e.g., Focus on recent developments, prioritize academic sources..."
                                ></textarea>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button id="perplexity-agent-cancel" class="secondary-btn">Cancel</button>
                            <button id="perplexity-agent-start" class="primary-btn">Start Research</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalManager.registerModal('perplexity', 'agent', modalTemplate);

        // Inject CSS styles
        this.injectCSS(`
            /* Perplexity Agent Modal Styles */
            .perplexity-query-group,
            .perplexity-preset-group,
            .perplexity-model-group,
            .perplexity-steps-group,
            .perplexity-reasoning-group,
            .perplexity-tools-group,
            .perplexity-instructions-group {
                margin-bottom: 20px;
            }

            .perplexity-query-group label,
            .perplexity-preset-group label,
            .perplexity-model-group label,
            .perplexity-steps-group label,
            .perplexity-reasoning-group label,
            .perplexity-tools-group label,
            .perplexity-instructions-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
                margin-bottom: 8px;
            }

            .perplexity-select {
                width: 100%;
                padding: 8px 12px;
                font-size: 14px;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
            }

            .perplexity-slider {
                width: 100%;
                height: 6px;
                border-radius: 3px;
                background: var(--bg-secondary);
                outline: none;
            }

            .perplexity-slider::-webkit-slider-thumb {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: var(--accent);
                cursor: pointer;
            }

            .perplexity-slider::-moz-range-thumb {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: var(--accent);
                cursor: pointer;
                border: none;
            }

            .perplexity-tools-checkboxes {
                display: flex;
                gap: 16px;
            }

            .perplexity-checkbox-label {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                color: var(--text-secondary);
                cursor: pointer;
            }

            .perplexity-checkbox-label input[type="checkbox"] {
                cursor: pointer;
            }

            #perplexity-advanced-options {
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid var(--border);
            }

            /* Search Filters Section */
            .perplexity-filters-section {
                margin: 16px 0;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
            }

            .perplexity-filters-section summary {
                padding: 10px 12px;
                cursor: pointer;
                font-weight: 500;
                font-size: 13px;
                background: var(--bg-secondary);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
            }

            .perplexity-filters-section summary:hover {
                background: var(--bg-tertiary, var(--bg-secondary));
            }

            .perplexity-filters-section[open] summary {
                border-bottom: 1px solid var(--border);
                border-radius: var(--radius-sm) var(--radius-sm) 0 0;
            }

            .perplexity-filters-content {
                padding: 16px;
            }

            .perplexity-filters-content > div {
                margin-bottom: 16px;
            }

            .perplexity-filters-content > div:last-child {
                margin-bottom: 0;
            }

            .perplexity-filters-content label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
                margin-bottom: 8px;
            }

            .perplexity-domain-presets {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 10px;
            }

            .domain-preset-btn {
                padding: 4px 10px;
                font-size: 12px;
                border: 1px solid var(--border);
                border-radius: 12px;
                background: var(--bg-primary);
                color: var(--text-secondary);
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .domain-preset-btn:hover {
                background: var(--bg-secondary);
                border-color: var(--accent);
                color: var(--text-primary);
            }

            .domain-preset-btn.active {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }

            .perplexity-domain-mode {
                display: flex;
                gap: 16px;
                margin-bottom: 8px;
            }

            .perplexity-domain-mode label {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: normal;
                cursor: pointer;
            }

            .perplexity-input {
                width: 100%;
                padding: 8px 12px;
                font-size: 14px;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
            }

            .perplexity-input:focus {
                outline: none;
                border-color: var(--accent);
            }

            .perplexity-filters-content small {
                display: block;
                margin-top: 4px;
                font-size: 11px;
                color: var(--text-tertiary, var(--text-secondary));
            }

            .perplexity-date-inputs {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .perplexity-date-inputs input[type="date"] {
                flex: 1;
                padding: 6px 8px;
                font-size: 14px;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
            }

            .perplexity-date-inputs input[type="date"]:focus {
                outline: none;
                border-color: var(--accent);
            }

            .perplexity-date-inputs span {
                color: var(--text-secondary);
                font-size: 13px;
            }

            #perplexity-language {
                min-height: 80px;
            }

            #perplexity-language option {
                padding: 4px 8px;
            }
        `);
    }

    /**
     * Show agent configuration modal and return user's settings.
     * @param {string} query - The research query
     * @returns {Promise<Object|null>} Configuration object or null if cancelled
     */
    async showAgentModal(query) {
        return new Promise((resolve) => {
            const modal = this.modalManager.getPluginModal('perplexity', 'agent');
            if (!modal) {
                console.error('[Perplexity] Agent modal not found');
                resolve(null);
                return;
            }

            // Populate query field
            const queryField = document.getElementById('perplexity-query');
            if (queryField) queryField.value = query;

            // Set up preset change handler
            const presetSelect = document.getElementById('perplexity-preset');
            const advancedOptions = document.getElementById('perplexity-advanced-options');

            const updateAdvancedVisibility = () => {
                if (presetSelect.value === 'custom') {
                    advancedOptions.style.display = 'block';
                } else {
                    advancedOptions.style.display = 'none';
                }
            };

            presetSelect.addEventListener('change', updateAdvancedVisibility);
            updateAdvancedVisibility();

            // Set up steps slider
            const stepsSlider = document.getElementById('perplexity-max-steps');
            const stepsValue = document.getElementById('perplexity-steps-value');
            stepsSlider.addEventListener('input', () => {
                stepsValue.textContent = stepsSlider.value;
            });

            // Set up domain preset buttons
            const domainPresetBtns = document.querySelectorAll('.domain-preset-btn');
            const domainInput = document.getElementById('perplexity-domains');

            const handleDomainPresetClick = (e) => {
                const btn = e.target;
                const newDomains = btn.dataset.domains;
                const existing = domainInput.value.trim();

                if (existing) {
                    // Merge without duplicates
                    const allDomains = [...new Set([
                        ...existing.split(',').map(d => d.trim()).filter(Boolean),
                        ...newDomains.split(',')
                    ])];
                    domainInput.value = allDomains.join(', ');
                } else {
                    domainInput.value = newDomains;
                }

                // Toggle button active state
                btn.classList.toggle('active');
            };

            domainPresetBtns.forEach(btn => {
                btn.addEventListener('click', handleDomainPresetClick);
            });

            // Set up event handlers
            const closeBtn = document.getElementById('perplexity-agent-close');
            const cancelBtn = document.getElementById('perplexity-agent-cancel');
            const startBtn = document.getElementById('perplexity-agent-start');

            const cleanup = () => {
                presetSelect.removeEventListener('change', updateAdvancedVisibility);
                domainPresetBtns.forEach(btn => {
                    btn.removeEventListener('click', handleDomainPresetClick);
                    btn.classList.remove('active');
                });
                // Reset filter inputs
                domainInput.value = '';
                document.querySelector('input[name="domain-mode"][value="allow"]').checked = true;
                document.getElementById('perplexity-recency').value = '';
                document.getElementById('perplexity-date-after').value = '';
                document.getElementById('perplexity-date-before').value = '';
                const languageSelect = document.getElementById('perplexity-language');
                Array.from(languageSelect.options).forEach(opt => {
                    opt.selected = opt.value === 'en';
                });
                this.modalManager.hidePluginModal('perplexity', 'agent');
            };

            const handleCancel = () => {
                cleanup();
                resolve(null);
            };

            // Helper to convert date input value (YYYY-MM-DD) to MM/DD/YYYY format
            const formatDateForAPI = (dateStr) => {
                if (!dateStr) return null;
                const [year, month, day] = dateStr.split('-');
                return `${month}/${day}/${year}`;
            };

            const handleStart = () => {
                const preset = presetSelect.value;

                let config;
                if (preset === 'custom') {
                    // Build custom configuration
                    const tools = [];
                    if (document.getElementById('perplexity-tool-web-search')?.checked) {
                        tools.push('web_search');
                    }
                    if (document.getElementById('perplexity-tool-fetch-url')?.checked) {
                        tools.push('fetch_url');
                    }

                    const reasoningEffort = document.getElementById('perplexity-reasoning').value;
                    const instructions = document.getElementById('perplexity-instructions').value.trim();

                    config = {
                        model: document.getElementById('perplexity-model').value,
                        max_steps: parseInt(stepsSlider.value, 10),
                        reasoning_effort: reasoningEffort || null,
                        tools: tools.length > 0 ? tools : null,
                        instructions: instructions || null,
                    };
                } else {
                    // Use preset configuration
                    config = { preset };

                    // Set appropriate defaults based on preset
                    if (preset === 'fast-search') {
                        config.max_steps = 1;
                        config.reasoning_effort = null;
                    } else if (preset === 'pro-search') {
                        config.max_steps = 3;
                        config.reasoning_effort = 'medium';
                    } else if (preset === 'deep-research') {
                        config.max_steps = 10;
                        config.reasoning_effort = 'high';
                    }
                }

                // Collect search filters (applies to all modes)
                const domainsValue = domainInput.value.trim();
                const domainMode = document.querySelector('input[name="domain-mode"]:checked')?.value;
                const recency = document.getElementById('perplexity-recency').value;
                const dateAfter = document.getElementById('perplexity-date-after').value;
                const dateBefore = document.getElementById('perplexity-date-before').value;
                const languages = [...document.getElementById('perplexity-language').selectedOptions]
                    .map(opt => opt.value);

                // Build domain filter array
                if (domainsValue) {
                    const domains = domainsValue.split(',').map(d => d.trim()).filter(Boolean);
                    // Prefix with - for exclusion mode
                    config.search_domain_filter = domainMode === 'block'
                        ? domains.map(d => `-${d}`)
                        : domains;
                }

                // Add other filters
                if (recency) {
                    config.search_recency_filter = recency;
                }
                if (dateAfter) {
                    config.search_after_date = formatDateForAPI(dateAfter);
                }
                if (dateBefore) {
                    config.search_before_date = formatDateForAPI(dateBefore);
                }
                // Only include language filter if user changed from default (English only)
                const hasNonDefaultLanguages = languages.length !== 1 || languages[0] !== 'en';
                if (languages.length > 0 && hasNonDefaultLanguages) {
                    config.search_language_filter = languages;
                }

                cleanup();
                resolve(config);
            };

            closeBtn.addEventListener('click', handleCancel, { once: true });
            cancelBtn.addEventListener('click', handleCancel, { once: true });
            startBtn.addEventListener('click', handleStart, { once: true });

            // Show modal
            this.modalManager.showPluginModal('perplexity', 'agent');
        });
    }

    /**
     * Get slash commands metadata for autocomplete menu.
     * @returns {Array<{command: string, description: string, placeholder: string}>}
     */
    getSlashCommands() {
        return [
            {
                command: '/perplexity',
                description: 'Perplexity AI - fast search with quick results',
                placeholder: 'Ask a question...',
            },
            {
                command: '/perplexity-pro',
                description: 'Perplexity Pro Search - deep research with more sources',
                placeholder: 'Research topic or question...',
            },
            {
                command: '/perplexity-research',
                description: 'Perplexity Deep Research - multi-step analysis with reasoning',
                placeholder: 'Research topic...',
            },
            {
                command: '/perplexity-agent',
                description: 'Perplexity Agent - configure all research options',
                placeholder: 'Research topic...',
            },
            {
                command: '/perplexity-search',
                description: 'Perplexity Search - find relevant web pages',
                placeholder: 'Search query...',
            },
        ];
    }

    /**
     * Handle the /perplexity command (fast search using responses API)
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexity(command, args, contextObj) {
        await this.executeResponsesAPI(args.trim(), {
            preset: 'fast-search',
            max_steps: 1,
            reasoning_effort: null, // No reasoning for fast search
        }, contextObj);
    }

    /**
     * Handle the /perplexity-pro command (deep research with sonar-pro)
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexityPro(command, args, contextObj) {
        await this.executePerplexityChat(args.trim(), 'sonar-pro', contextObj);
    }

    /**
     * Handle the /perplexity-research command (deep research using responses API)
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexityResearch(command, args, contextObj) {
        await this.executeResponsesAPI(args.trim(), {
            preset: 'deep-research',
            max_steps: 10,
            reasoning_effort: 'high',
        }, contextObj);
    }

    /**
     * Handle the /perplexity-agent command (modal configuration)
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexityAgent(command, args, contextObj) {
        const query = args.trim();

        if (!query) {
            this.showToast?.('Please provide a research question', 'error');
            return;
        }

        // Show configuration modal
        const config = await this.showAgentModal(query);
        if (!config) {
            // User cancelled
            return;
        }

        // Execute with user configuration
        await this.executeResponsesAPI(query, config, contextObj);
    }

    /**
     * Handle the /perplexity-search command
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexitySearch(command, args, contextObj) {
        const query = args.trim();

        if (!query) {
            this.showToast?.('Please provide a search query', 'error');
            return;
        }

        // Check for API key
        const apiKey = storage.getPerplexityApiKey();
        if (!apiKey) {
            this.showToast?.('Perplexity API key required. Add it in Settings.', 'error');
            return;
        }

        // Get selected nodes for positioning
        const parentIds = this.canvas.getSelectedNodeIds();
        const selectedContext = contextObj?.text || null;

        // Create search node
        const searchNode = createNode(NodeType.SEARCH, `**Perplexity Search:** ${query}\n\n*Searching...*`, {
            position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
            model: 'perplexity-search',
            query: query,
        });

        this.graph.addNode(searchNode);

        // Create edges from parents
        for (const parentId of parentIds) {
            const edge = createEdge(parentId, searchNode.id, EdgeType.REFERENCE);
            this.graph.addEdge(edge);
            const parentNode = this.graph.getNode(parentId);
            this.canvas.renderEdge(edge, parentNode.position, searchNode.position);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        try {
            const response = await fetch(apiUrl('/api/perplexity/search'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query,
                    api_key: apiKey,
                    num_results: 5,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }

            const data = await response.json();

            // Format results
            let content = `**Perplexity Search:** ${query}\n\n`;

            if (data.results && data.results.length > 0) {
                content += `Found ${data.results.length} results:\n\n`;
                data.results.forEach((result, index) => {
                    content += `### ${index + 1}. ${result.title}\n`;
                    content += `[${result.url}](${result.url})\n\n`;
                    if (result.snippet) {
                        content += `${result.snippet}\n\n`;
                    }
                });
            } else if (data.raw_response) {
                content += data.raw_response;
            } else {
                content += '*No results found.*';
            }

            this.canvas.updateNodeContent(searchNode.id, content, false);
            this.graph.updateNode(searchNode.id, { content });
            this.saveSession();

        } catch (err) {
            const errorContent = `**Perplexity Search:** ${query}\n\n*Error: ${err.message}*`;
            this.canvas.updateNodeContent(searchNode.id, errorContent, false);
            this.graph.updateNode(searchNode.id, { content: errorContent, status: 'failed', error: err.message });
            this.saveSession();
        }
    }

    /**
     * Execute a Perplexity chat request with streaming
     * @param {string} query - The user's question
     * @param {string} model - Model to use (sonar or sonar-pro)
     * @param {Object} contextObj - Additional context
     */
    async executePerplexityChat(query, model, contextObj) {
        if (!query) {
            this.showToast?.('Please provide a question', 'error');
            return;
        }

        // Check for API key
        const apiKey = storage.getPerplexityApiKey();
        if (!apiKey) {
            this.showToast?.('Perplexity API key required. Add it in Settings.', 'error');
            return;
        }

        // Get selected nodes for positioning and context
        const parentIds = this.canvas.getSelectedNodeIds();
        const selectedContext = contextObj?.text || null;

        // Create Perplexity node
        const modelLabel = model === 'sonar-pro' ? 'Pro' : '';
        const perplexityNode = createNode(NodeType.PERPLEXITY, `**Perplexity${modelLabel ? ' ' + modelLabel : ''}:** ${query}\n\n*Starting search...*`, {
            position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
            model: model,
            query: query,
            status: 'starting',
            citations: [],
        });

        this.graph.addNode(perplexityNode);

        // Create edges from parents
        for (const parentId of parentIds) {
            const edge = createEdge(parentId, perplexityNode.id, EdgeType.REFERENCE);
            this.graph.addEdge(edge);
            const parentNode = this.graph.getNode(parentId);
            this.canvas.renderEdge(edge, parentNode.position, perplexityNode.position);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        // Start streaming
        await this.streamPerplexityChat(perplexityNode.id, query, model, selectedContext, apiKey);
    }

    /**
     * Stream Perplexity chat response
     * @param {string} nodeId - Node ID to update
     * @param {string} query - The query
     * @param {string} model - Model to use
     * @param {string|null} context - Optional context
     * @param {string} apiKey - Perplexity API key
     */
    async streamPerplexityChat(nodeId, query, model, context, apiKey) {
        const node = this.graph.getNode(nodeId);
        if (!node) {
            console.error('[Perplexity] Node not found:', nodeId);
            return;
        }

        // Create abort controller for stop button support
        const abortController = new AbortController();

        // Register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'perplexity',
            context: {
                type: 'perplexity-chat',
                query,
                model,
                textContext: context,
                apiKey,
            },
            onContinue: async (nodeId, state, _newAbortController) => {
                // Continue from where we left off
                await this.streamPerplexityChat(
                    nodeId,
                    state.context.query,
                    state.context.model,
                    state.context.textContext,
                    state.context.apiKey
                );
            },
        });

        try {
            this.graph.updateNode(nodeId, { status: 'in_progress' });
            this.canvas.renderNode(this.graph.getNode(nodeId));

            const modelLabel = model === 'sonar-pro' ? 'Pro' : '';
            const headerPrefix = `**Perplexity${modelLabel ? ' ' + modelLabel : ''}:** ${query}\n\n`;

            // Call streaming endpoint
            const response = await fetch(apiUrl('/api/perplexity/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query,
                    api_key: apiKey,
                    model: model,
                    context: context,
                }),
                signal: abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to connect: ${response.statusText}`);
            }

            let content = headerPrefix;
            let citations = [];

            await readSSEStream(response, {
                onEvent: (eventType, data) => {
                    if (eventType === 'content') {
                        content += data;
                        this.canvas.updateNodeContent(nodeId, content, true);
                        this.graph.updateNode(nodeId, { content });
                    } else if (eventType === 'citations') {
                        try {
                            citations = JSON.parse(data);
                            this.graph.updateNode(nodeId, { citations });
                            // Re-render to show citation badges
                            this.canvas.renderNode(this.graph.getNode(nodeId));
                        } catch (e) {
                            console.error('[Perplexity] Failed to parse citations:', e);
                        }
                    } else if (eventType === 'error') {
                        throw new Error(data);
                    }
                },
                onDone: () => {
                    this.streamingManager.unregister(nodeId);

                    // Update node status
                    this.graph.updateNode(nodeId, {
                        status: 'completed',
                        completedAt: Date.now(),
                    });

                    this.canvas.updateNodeContent(nodeId, content, false);

                    // Generate summary async
                    this.generateNodeSummary?.(nodeId);

                    this.saveSession();
                },
                onError: (err) => {
                    this.streamingManager.unregister(nodeId);
                    if (err.name !== 'AbortError') {
                        throw err;
                    }
                },
            });

        } catch (err) {
            this.streamingManager.unregister(nodeId);

            if (err.name === 'AbortError') {
                this.saveSession();
                return;
            }

            // Handle error
            const modelLabel = model === 'sonar-pro' ? 'Pro' : '';
            const errorContent = `**Perplexity${modelLabel ? ' ' + modelLabel : ''}:** ${query}\n\n*Error: ${err.message}*`;
            this.canvas.updateNodeContent(nodeId, errorContent, false);
            this.graph.updateNode(nodeId, {
                content: errorContent,
                status: 'failed',
                error: err.message,
            });
            this.saveSession();
        }
    }

    /**
     * Execute a Perplexity responses API request
     * @param {string} query - The user's question
     * @param {Object} config - Configuration options (preset, model, max_steps, etc.)
     * @param {Object} contextObj - Additional context
     */
    async executeResponsesAPI(query, config, contextObj) {
        if (!query) {
            this.showToast?.('Please provide a question', 'error');
            return;
        }

        // Check for API key
        const apiKey = storage.getPerplexityApiKey();
        if (!apiKey) {
            this.showToast?.('Perplexity API key required. Add it in Settings.', 'error');
            return;
        }

        // Get selected nodes for positioning and context
        const parentIds = this.canvas.getSelectedNodeIds();
        const selectedContext = contextObj?.text || null;

        // Create Perplexity node with appropriate label
        let label = 'Perplexity';
        if (config.preset === 'fast-search') label = 'Perplexity Fast';
        else if (config.preset === 'pro-search') label = 'Perplexity Pro';
        else if (config.preset === 'deep-research') label = 'Perplexity Research';
        else if (config.model) label = `Perplexity (${config.model})`;

        const perplexityNode = createNode(NodeType.PERPLEXITY, `**${label}:** ${query}\n\n*Starting research...*`, {
            position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
            model: config.model || config.preset || 'responses-api',
            query: query,
            status: 'starting',
            citations: [],
            steps: [],
            reasoning: [],
            config: config,
        });

        this.graph.addNode(perplexityNode);

        // Create edges from parents
        for (const parentId of parentIds) {
            const edge = createEdge(parentId, perplexityNode.id, EdgeType.REFERENCE);
            this.graph.addEdge(edge);
            const parentNode = this.graph.getNode(parentId);
            this.canvas.renderEdge(edge, parentNode.position, perplexityNode.position);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        // Start streaming
        await this.streamResponsesAPI(perplexityNode.id, query, config, selectedContext, apiKey);
    }

    /**
     * Stream Perplexity responses API response
     * @param {string} nodeId - Node ID to update
     * @param {string} query - The query
     * @param {Object} config - Configuration options
     * @param {string|null} context - Optional context
     * @param {string} apiKey - Perplexity API key
     */
    async streamResponsesAPI(nodeId, query, config, context, apiKey) {
        const node = this.graph.getNode(nodeId);
        if (!node) {
            console.error('[Perplexity] Node not found:', nodeId);
            return;
        }

        // Create abort controller for stop button support
        const abortController = new AbortController();

        // Register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'perplexity-responses',
            context: {
                type: 'perplexity-responses',
                query,
                config,
                textContext: context,
                apiKey,
            },
            onContinue: async (nodeId, state, _newAbortController) => {
                // Continue from where we left off
                await this.streamResponsesAPI(
                    nodeId,
                    state.context.query,
                    state.context.config,
                    state.context.textContext,
                    state.context.apiKey
                );
            },
        });

        try {
            this.graph.updateNode(nodeId, { status: 'in_progress' });
            this.canvas.renderNode(this.graph.getNode(nodeId));

            // Prepare request body
            const requestBody = {
                input: query,
                api_key: apiKey,
                stream: true,
            };

            // Add configuration options
            if (config.preset) requestBody.preset = config.preset;
            if (config.model) requestBody.model = config.model;
            if (config.instructions) requestBody.instructions = config.instructions;
            if (config.max_steps) requestBody.max_steps = config.max_steps;
            if (config.reasoning_effort) requestBody.reasoning_effort = config.reasoning_effort;
            if (config.tools && config.tools.length > 0) requestBody.tools = config.tools;
            if (context) requestBody.context = context;

            // Add search filter options
            if (config.search_domain_filter) requestBody.search_domain_filter = config.search_domain_filter;
            if (config.search_recency_filter) requestBody.search_recency_filter = config.search_recency_filter;
            if (config.search_after_date) requestBody.search_after_date = config.search_after_date;
            if (config.search_before_date) requestBody.search_before_date = config.search_before_date;
            if (config.search_language_filter) requestBody.search_language_filter = config.search_language_filter;

            // Call streaming endpoint
            const response = await fetch(apiUrl('/api/perplexity/responses'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to connect: ${response.statusText}`);
            }

            // Track state
            let currentStep = 0;
            let mainContent = '';
            let reasoning = [];
            let steps = [];
            let allCitations = [];

            await readSSEStream(response, {
                onEvent: (eventType, data) => {
                    if (eventType === 'step_start') {
                        const stepData = JSON.parse(data);
                        currentStep = stepData.step;
                        steps.push({
                            step: currentStep,
                            content: '',
                            thinking: '',
                            sources: [],
                            status: 'in_progress',
                        });
                        this.graph.updateNode(nodeId, { steps: [...steps], currentStep });
                        this.canvas.renderNode(this.graph.getNode(nodeId));

                    } else if (eventType === 'step_thinking') {
                        reasoning.push(data);
                        if (steps.length > 0) {
                            steps[steps.length - 1].thinking += data;
                        }
                        this.graph.updateNode(nodeId, { reasoning: [...reasoning], steps: [...steps] });
                        this.canvas.renderNode(this.graph.getNode(nodeId));

                    } else if (eventType === 'step_content') {
                        mainContent += data;
                        if (steps.length > 0) {
                            steps[steps.length - 1].content += data;
                        }
                        this.canvas.updateNodeContent(nodeId, mainContent, true);
                        this.graph.updateNode(nodeId, { content: mainContent, steps: [...steps] });

                    } else if (eventType === 'step_sources') {
                        const sources = JSON.parse(data);
                        if (steps.length > 0) {
                            steps[steps.length - 1].sources = sources;
                            allCitations.push(...sources);
                        }
                        this.graph.updateNode(nodeId, { steps: [...steps] });
                        this.canvas.renderNode(this.graph.getNode(nodeId));

                    } else if (eventType === 'step_complete') {
                        if (steps.length > 0) {
                            steps[steps.length - 1].status = 'completed';
                        }
                        this.graph.updateNode(nodeId, { steps: [...steps] });
                        this.canvas.renderNode(this.graph.getNode(nodeId));

                    } else if (eventType === 'citations') {
                        try {
                            allCitations = JSON.parse(data);
                            this.graph.updateNode(nodeId, { citations: allCitations });
                            this.canvas.renderNode(this.graph.getNode(nodeId));
                        } catch (e) {
                            console.error('[Perplexity] Failed to parse citations:', e);
                        }

                    } else if (eventType === 'error') {
                        throw new Error(data);
                    }
                },
                onDone: () => {
                    this.streamingManager.unregister(nodeId);

                    // Update node status
                    this.graph.updateNode(nodeId, {
                        status: 'completed',
                        completedAt: Date.now(),
                    });

                    this.canvas.updateNodeContent(nodeId, mainContent, false);

                    // Generate summary async
                    this.generateNodeSummary?.(nodeId);

                    this.saveSession();
                },
                onError: (err) => {
                    this.streamingManager.unregister(nodeId);
                    if (err.name !== 'AbortError') {
                        throw err;
                    }
                },
            });

        } catch (err) {
            this.streamingManager.unregister(nodeId);

            if (err.name === 'AbortError') {
                this.saveSession();
                return;
            }

            // Handle error
            const errorContent = `**Perplexity Research:** ${query}\n\n*Error: ${err.message}*`;
            this.canvas.updateNodeContent(nodeId, errorContent, false);
            this.graph.updateNode(nodeId, {
                content: errorContent,
                status: 'failed',
                error: err.message,
            });
            this.saveSession();
        }
    }
}

export { PerplexityFeature };
