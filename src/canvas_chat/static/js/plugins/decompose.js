/**
 * Decompose Feature Module
 *
 * Handles the /decompose slash command which splits a selected node's list
 * content into one child node per item. Shows a preview modal where items can
 * be edited, removed, or regenerated with a different transform prompt before
 * any nodes are created on the canvas.
 */

import { NodeType, EdgeType, createNode, createEdge } from '../graph-types.js';
import { FeaturePlugin } from '../feature-plugin.js';
import { parseListItems, extractItemsWithLLM } from '../list-extraction.js';

/**
 * DecomposeFeature class manages splitting a node into per-item children.
 * Extends FeaturePlugin to integrate with the plugin architecture.
 */
class DecomposeFeature extends FeaturePlugin {
    /**
     * @param {AppContext} context - Application context with injected dependencies
     */
    constructor(context) {
        super(context);

        // Preview state: { sourceNodeId, items: string[], prompt: string }
        this._data = null;
        // Guards against stale LLM responses landing after a newer request or modal close
        this._requestId = 0;
    }

    /**
     * Lifecycle hook: called when plugin is loaded
     * @returns {Promise<void>}
     */
    async onLoad() {
        const modalTemplate = `
            <div id="decompose-main-modal" class="modal" style="display: none">
                <div class="modal-content modal-wide">
                    <div class="modal-header">
                        <h2>Decompose Node</h2>
                        <button class="modal-close" id="decompose-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="decompose-prompt-group">
                            <label for="decompose-prompt">Transform prompt (optional)</label>
                            <span class="decompose-prompt-hint">Leave empty to keep each item's text as-is</span>
                            <div class="decompose-prompt-row">
                                <input
                                    type="text"
                                    id="decompose-prompt"
                                    class="modal-text-input"
                                    placeholder="e.g., Summarize each item in one sentence"
                                />
                                <button id="decompose-regenerate" class="secondary-btn">Regenerate</button>
                            </div>
                        </div>

                        <div class="decompose-status" id="decompose-status" style="display: none;"></div>

                        <div class="decompose-items-group">
                            <div class="decompose-items-header">
                                <label>Preview</label>
                                <span class="decompose-items-count" id="decompose-count">0 nodes</span>
                            </div>
                            <div class="decompose-items-list" id="decompose-items-list"></div>
                        </div>

                        <div class="modal-actions">
                            <button id="decompose-cancel" class="secondary-btn">Cancel</button>
                            <button id="decompose-confirm" class="primary-btn" disabled>Create 0 nodes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalManager.registerModal('decompose', 'main', modalTemplate);

        this.injectCSS(`
            /* Decompose Modal Styles */
            .decompose-prompt-group {
                margin-bottom: 20px;
            }

            .decompose-prompt-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 4px;
                color: var(--text-primary);
            }

            .decompose-prompt-hint {
                display: block;
                font-size: 11px;
                color: var(--text-muted);
                margin-bottom: 8px;
            }

            .decompose-prompt-row {
                display: flex;
                gap: 8px;
                align-items: center;
            }

            .decompose-prompt-row .modal-text-input {
                flex: 1;
            }

            .decompose-status {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 16px;
                padding: 10px 14px;
                border-radius: var(--radius-sm);
                font-size: 12px;
            }

            .decompose-status.loading {
                background: var(--bg-secondary);
                color: var(--text-muted);
            }

            .decompose-status.error {
                background: rgba(250, 82, 82, 0.1);
                border: 1px solid var(--danger);
                color: var(--danger);
            }

            .decompose-items-group {
                margin-bottom: 20px;
            }

            .decompose-items-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .decompose-items-header label {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
            }

            .decompose-items-count {
                font-size: 12px;
                color: var(--text-muted);
            }

            .decompose-items-count.warning {
                color: var(--warning);
            }

            .decompose-items-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 300px;
                overflow-y: auto;
            }

            .decompose-item {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 8px 12px;
                background: var(--bg-secondary);
                border: 1px solid var(--bg-secondary);
                border-radius: var(--radius-sm);
            }

            .decompose-item:hover {
                border-color: var(--accent);
            }

            .decompose-item-text {
                flex: 1;
                min-height: 60px;
                padding: 6px 8px;
                border: 1px solid transparent;
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 13px;
                font-family: inherit;
                resize: vertical;
            }

            .decompose-item-text:focus {
                outline: none;
                border-color: var(--accent);
            }

            .decompose-item-remove {
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: none;
                background: transparent;
                color: var(--text-muted);
                cursor: pointer;
                border-radius: var(--radius-sm);
                font-size: 16px;
                transition: all 0.15s;
            }

            .decompose-item-remove:hover {
                background: rgba(250, 82, 82, 0.1);
                color: var(--danger);
            }

            .decompose-empty {
                padding: 16px;
                font-size: 12px;
                color: var(--text-muted);
                text-align: center;
            }
        `);

        const modal = this.modalManager.getPluginModal('decompose', 'main');

        modal.querySelector('#decompose-close')?.addEventListener('click', () => this._closeModal());
        modal.querySelector('#decompose-cancel')?.addEventListener('click', () => this._closeModal());
        modal.querySelector('#decompose-confirm')?.addEventListener('click', () => this._confirmCreate());

        const promptInput = modal.querySelector('#decompose-prompt');
        const regenerateBtn = modal.querySelector('#decompose-regenerate');
        regenerateBtn?.addEventListener('click', () => {
            this._runExtraction(promptInput.value.trim());
        });
        promptInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._runExtraction(promptInput.value.trim());
            }
        });

        // Event delegation for the dynamic item list
        const itemsList = modal.querySelector('#decompose-items-list');
        itemsList?.addEventListener('input', (e) => {
            if (!this._data || !e.target.classList.contains('decompose-item-text')) return;
            const index = parseInt(e.target.dataset.index, 10);
            this._data.items[index] = e.target.value;
            this._updateCount();
        });
        itemsList?.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.decompose-item-remove');
            if (!this._data || !removeBtn) return;
            const index = parseInt(removeBtn.dataset.index, 10);
            this._data.items.splice(index, 1);
            this._renderItems();
            this._updateCount();
        });
    }

    /**
     * Get slash commands metadata for autocomplete
     * @returns {Array<Object>}
     */
    getSlashCommands() {
        return [
            {
                command: '/decompose',
                description: 'Split a node into one child node per list item',
                placeholder: '/decompose [optional transform prompt]',
            },
        ];
    }

    /**
     * Handle /decompose slash command - parse items and show preview modal
     * @param {string} command - The command string (e.g., '/decompose')
     * @param {string} args - Optional transform prompt
     * @param {Object} context - Execution context
     */
    async handleCommand(command, args, context) {
        const selectedIds = this.canvas.getSelectedNodeIds();

        if (selectedIds.length === 0) {
            this.showToast?.('Select a node containing a list to decompose', 'error');
            return;
        }

        if (selectedIds.length > 1) {
            this.showToast?.('Select only one node to decompose', 'error');
            return;
        }

        const sourceNodeId = selectedIds[0];
        const sourceNode = this.graph.getNode(sourceNodeId);

        if (!sourceNode || !sourceNode.content) {
            this.showToast?.('Selected node has no content', 'error');
            return;
        }

        const prompt = args.trim();
        this._data = { sourceNodeId, items: [], prompt };
        this._showModal();

        if (!prompt) {
            const items = parseListItems(sourceNode.content);
            if (items) {
                this._data.items = items;
                this._renderItems();
                this._updateCount();
                return;
            }
        }

        await this._runExtraction(prompt);
    }

    /**
     * Run LLM extraction/transformation and update the preview.
     * Guarded against stale responses when regenerated or closed mid-flight.
     * @param {string} prompt - Transform prompt ('' = verbatim split)
     * @returns {Promise<void>}
     */
    async _runExtraction(prompt) {
        const data = this._data;
        if (!data) return;

        const requestId = ++this._requestId;
        this._setLoading(true, prompt);

        try {
            const sourceNode = this.graph.getNode(data.sourceNodeId);
            const model = this._getExtractionModel(!!prompt);
            if (!model) {
                throw new Error('No model selected. Configure an API key and select a model first.');
            }

            const items = await extractItemsWithLLM({
                chat: this.chat,
                model,
                content: sourceNode.content,
                instructions: prompt,
                transform: !!prompt,
            });

            if (requestId !== this._requestId || this._data !== data) return;

            data.items = items;
            data.prompt = prompt;
            this._setLoading(false);
            this._renderItems();
            this._updateCount();
        } catch (err) {
            if (requestId !== this._requestId || this._data !== data) return;
            this._setLoading(false);
            this._setError(err.message || 'Failed to extract items');
        }
    }

    /**
     * Pick the model for extraction: fast model for mechanical splits,
     * current model for quality-sensitive transformations.
     * @param {boolean} hasPrompt - Whether the user provided a transform prompt
     * @returns {string}
     */
    _getExtractionModel(hasPrompt) {
        if (!hasPrompt) {
            const fastModel = this.storage?.getFastModel?.();
            if (fastModel) return fastModel;
        }
        return this._getCurrentModel();
    }

    /**
     * Get the currently selected model from the app-level model picker.
     * @returns {string}
     */
    _getCurrentModel() {
        return this.getCurrentModel?.() || this.modelPicker?.dataset?.modelId || this.modelPicker?.value || '';
    }

    /**
     * Show the preview modal, seeding the prompt input from current state
     */
    _showModal() {
        const modal = this.modalManager.getPluginModal('decompose', 'main');
        const promptInput = modal.querySelector('#decompose-prompt');
        if (promptInput) promptInput.value = this._data?.prompt || '';
        this._setError(null);
        this._renderItems();
        this._updateCount();
        this.modalManager.showPluginModal('decompose', 'main');
    }

    /**
     * Close the modal, clear state, and drop any in-flight extraction
     */
    _closeModal() {
        this.modalManager.hidePluginModal('decompose', 'main');
        this._data = null;
        this._requestId++;
        this._setLoading(false);
        this._setError(null);
    }

    /**
     * Render one editable card per item
     */
    _renderItems() {
        const modal = this.modalManager.getPluginModal('decompose', 'main');
        const list = modal.querySelector('#decompose-items-list');
        list.innerHTML = '';

        const items = this._data?.items || [];
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'decompose-empty';
            empty.textContent = 'No items yet';
            list.appendChild(empty);
            return;
        }

        for (let i = 0; i < items.length; i++) {
            const row = document.createElement('div');
            row.className = 'decompose-item';

            const textarea = document.createElement('textarea');
            textarea.className = 'decompose-item-text';
            textarea.value = items[i];
            textarea.placeholder = 'Item text...';
            textarea.dataset.index = i;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'decompose-item-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove item';
            removeBtn.dataset.index = i;

            row.appendChild(textarea);
            row.appendChild(removeBtn);
            list.appendChild(row);
        }
    }

    /**
     * Update the item count label and confirm button state
     */
    _updateCount() {
        const modal = this.modalManager.getPluginModal('decompose', 'main');
        const countEl = modal.querySelector('#decompose-count');
        const confirmBtn = modal.querySelector('#decompose-confirm');
        const count = (this._data?.items || []).filter((item) => item.trim()).length;

        countEl.textContent = `${count} node${count !== 1 ? 's' : ''}`;
        countEl.classList.toggle('warning', count > 10);

        confirmBtn.textContent = `Create ${count} node${count !== 1 ? 's' : ''}`;
        confirmBtn.disabled = count === 0 || this._loading === true;
    }

    /**
     * Toggle the loading state (spinner, disabled buttons)
     * @param {boolean} isLoading
     * @param {string} [prompt] - Prompt in flight, used for status text
     */
    _setLoading(isLoading, prompt = '') {
        this._loading = isLoading;
        const modal = this.modalManager.getPluginModal('decompose', 'main');
        if (!modal) return;

        const status = modal.querySelector('#decompose-status');
        const regenerateBtn = modal.querySelector('#decompose-regenerate');

        if (isLoading) {
            status.className = 'decompose-status loading';
            status.style.display = 'flex';
            status.innerHTML = `
                <span class="loading-spinner"></span>
                <span>${prompt ? 'Transforming items...' : 'Extracting items...'}</span>
            `;
            if (regenerateBtn) regenerateBtn.disabled = true;
        } else {
            status.style.display = 'none';
            if (regenerateBtn) regenerateBtn.disabled = false;
        }
        this._updateCount();
    }

    /**
     * Show or clear an inline error banner (existing items stay editable)
     * @param {string|null} message
     */
    _setError(message) {
        const modal = this.modalManager.getPluginModal('decompose', 'main');
        if (!modal) return;

        const status = modal.querySelector('#decompose-status');
        if (message) {
            status.className = 'decompose-status error';
            status.style.display = 'flex';
            status.textContent = message;
        } else if (!this._loading) {
            status.style.display = 'none';
        }
    }

    /**
     * Create one AI child node per item, connected directly to the source node.
     * @returns {string[]} - IDs of the created nodes (seam for future per-item follow-up prompts)
     */
    _confirmCreate() {
        if (!this._data) return [];

        const { sourceNodeId } = this._data;
        const validItems = this._data.items.map((item) => item.trim()).filter(Boolean);

        if (validItems.length === 0) {
            this.showToast?.('No items to create', 'error');
            return [];
        }

        const sourceNode = this.graph.getNode(sourceNodeId);
        if (!sourceNode) {
            this.showToast?.('Source node no longer exists', 'error');
            this._closeModal();
            return [];
        }

        const basePos = sourceNode.position;
        const spacing = 400;
        const verticalOffset = 250;
        const startX = basePos.x - ((validItems.length - 1) * spacing) / 2;

        this._closeModal();

        const createdIds = [];
        for (let i = 0; i < validItems.length; i++) {
            const child = createNode(NodeType.AI, validItems[i], {
                position: {
                    x: startX + i * spacing,
                    y: basePos.y + verticalOffset,
                },
            });
            this.graph.addNode(child);
            this.graph.addEdge(createEdge(sourceNodeId, child.id, EdgeType.BRANCH));
            this.generateNodeSummary?.(child.id, validItems[i]);
            createdIds.push(child.id);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();
        this.canvas.centerOnAnimated(basePos.x, basePos.y + verticalOffset / 2, 300);

        return createdIds;
    }
}

export { DecomposeFeature };
