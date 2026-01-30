/**
 * Branch Feature Module
 *
 * Handles the /branch slash command which parses list items from a selected node
 * and creates N parallel child nodes, each invoking the LLM with a user-specified
 * command template.
 */

import { NodeType, EdgeType, createNode, createEdge } from '../graph-types.js';
import { FeaturePlugin } from '../feature-plugin.js';
import { storage } from '../storage.js';

/**
 * BranchFeature class manages parallel branching functionality.
 * Extends FeaturePlugin to integrate with the plugin architecture.
 */
class BranchFeature extends FeaturePlugin {
    /**
     * @param {AppContext} context - Application context with injected dependencies
     */
    constructor(context) {
        super(context);

        // Branch state
        this._branchData = null;
        this._activeBranch = null;
    }

    /**
     * Lifecycle hook: called when plugin is loaded
     * @returns {Promise<void>}
     */
    async onLoad() {
        console.log('[BranchFeature] Loaded');

        // Register plugin modal
        const modalTemplate = `
            <div id="branch-main-modal" class="modal" style="display: none">
                <div class="modal-content modal-wide">
                    <div class="modal-header">
                        <h2>Branch Configuration</h2>
                        <button class="modal-close" id="branch-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="branch-items-group">
                            <div class="branch-items-header">
                                <label>Parsed Items</label>
                                <span class="branch-items-count" id="branch-items-count">0 items</span>
                            </div>
                            <div class="branch-items-list" id="branch-items-list">
                                <!-- Item rows will be added dynamically -->
                            </div>
                            <button id="branch-add-item-btn" class="secondary-btn branch-add-item-btn">
                                + Add Item
                            </button>
                        </div>

                        <div class="branch-template-group">
                            <label for="branch-template">Command template</label>
                            <span class="branch-template-hint">Use {item} as a placeholder for each item</span>
                            <input
                                type="text"
                                id="branch-template"
                                class="modal-text-input"
                                placeholder="e.g., Generate a detailed analysis of {item}"
                            />
                        </div>

                        <div class="branch-model-group">
                            <label for="branch-model">Model</label>
                            <select id="branch-model" class="branch-model-select">
                                <!-- Options populated by JS -->
                            </select>
                        </div>

                        <div class="branch-tools-group" id="branch-tools-group" style="display: none;">
                            <div class="branch-tools-header">
                                <label>Tools</label>
                                <span class="branch-tools-hint">Uses current tool settings from chat</span>
                            </div>
                        </div>

                        <div class="branch-warning" id="branch-warning" style="display: none;">
                            Creating many branches may take a while and use significant API credits.
                        </div>

                        <div class="modal-actions">
                            <button id="branch-cancel-btn" class="secondary-btn">Cancel</button>
                            <button id="branch-execute-btn" class="primary-btn" disabled>Create Branches</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalManager.registerModal('branch', 'main', modalTemplate);

        // Inject CSS styles
        this.injectCSS(`
            /* Branch Modal Styles */
            .branch-items-group {
                margin-bottom: 20px;
            }

            .branch-items-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .branch-items-header label {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
            }

            .branch-items-count {
                font-size: 12px;
                color: var(--text-muted);
            }

            .branch-items-count.warning {
                color: var(--warning);
            }

            .branch-items-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 250px;
                overflow-y: auto;
                margin-bottom: 12px;
            }

            .branch-item-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--bg-secondary);
                border: 1px solid var(--bg-secondary);
                border-radius: var(--radius-sm);
            }

            .branch-item-row:hover {
                border-color: var(--accent);
            }

            .branch-item-input {
                flex: 1;
                padding: 6px 8px;
                border: 1px solid transparent;
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 13px;
            }

            .branch-item-input:focus {
                outline: none;
                border-color: var(--accent);
            }

            .branch-item-remove {
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

            .branch-item-remove:hover {
                background: rgba(250, 82, 82, 0.1);
                color: var(--danger);
            }

            .branch-item-remove:disabled {
                opacity: 0.3;
                cursor: not-allowed;
            }

            .branch-add-item-btn {
                width: 100%;
                padding: 8px;
            }

            .branch-template-group {
                margin-bottom: 20px;
            }

            .branch-template-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 4px;
                color: var(--text-primary);
            }

            .branch-template-hint {
                display: block;
                font-size: 11px;
                color: var(--text-muted);
                margin-bottom: 8px;
            }

            .branch-model-group {
                margin-bottom: 20px;
            }

            .branch-model-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 6px;
                color: var(--text-primary);
            }

            .branch-model-select {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid var(--bg-secondary);
                border-radius: var(--radius-sm);
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 13px;
                cursor: pointer;
            }

            .branch-model-select:focus {
                outline: none;
                border-color: var(--accent);
            }

            .branch-tools-group {
                margin-bottom: 20px;
            }

            .branch-tools-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .branch-tools-header label {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
            }

            .branch-tools-hint {
                font-size: 11px;
                color: var(--text-muted);
            }

            .branch-warning {
                margin-bottom: 16px;
                padding: 10px 14px;
                background: rgba(250, 176, 5, 0.1);
                border: 1px solid var(--warning);
                border-radius: var(--radius-sm);
                font-size: 12px;
                color: var(--warning);
            }
        `);

        // Branch modal event listeners
        const modal = this.modalManager.getPluginModal('branch', 'main');
        const closeBtn = modal.querySelector('#branch-close');
        const cancelBtn = modal.querySelector('#branch-cancel-btn');
        const executeBtn = modal.querySelector('#branch-execute-btn');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }
        if (executeBtn) {
            executeBtn.addEventListener('click', () => {
                this.executeBranch();
            });
        }
    }

    /**
     * Get slash commands metadata for autocomplete
     * @returns {Array<Object>}
     */
    getSlashCommands() {
        return [
            {
                command: '/branch',
                description: 'Create parallel branches from a list of items',
                placeholder: '/branch [parsing instructions]',
            },
        ];
    }

    /**
     * Event subscriptions for this feature
     * @returns {Object}
     */
    getEventSubscriptions() {
        return {
            // Listen for branch-related events if needed
        };
    }

    /**
     * Parse list items from content using pattern matching
     * Captures full multi-line sections (everything until the next list marker or end)
     * @param {string} content - Node content to parse
     * @returns {string[]|null} - Array of items, or null if no list found
     */
    parseItems(content) {
        console.log('[Branch] parseItems called with content length:', content.length);

        // Try numbered sections: capture everything until next number or end
        const numberedSectionRegex = /^\s*(\d+)[\.\)]\s*/gm;
        const matches = [...content.matchAll(numberedSectionRegex)];
        console.log('[Branch] Numbered section matches:', matches.length);

        if (matches.length >= 2) {
            const items = [];
            for (let i = 0; i < matches.length; i++) {
                const startIndex = matches[i].index + matches[i][0].length;
                const endIndex = i + 1 < matches.length ? matches[i + 1].index : content.length;
                const section = content.slice(startIndex, endIndex).trim();
                console.log(`[Branch] Item ${i + 1} (chars ${startIndex}-${endIndex}):`, section.substring(0, 100) + (section.length > 100 ? '...' : ''));
                items.push(section);
            }
            console.log('[Branch] parseItems returning', items.length, 'numbered items');
            return items;
        }

        // Try bullet sections: capture until next bullet or end
        const bulletSectionRegex = /^\s*[-*•]\s*/gm;
        const bulletMatches = [...content.matchAll(bulletSectionRegex)];
        console.log('[Branch] Bullet section matches:', bulletMatches.length);

        if (bulletMatches.length >= 2) {
            const items = [];
            for (let i = 0; i < bulletMatches.length; i++) {
                const startIndex = bulletMatches[i].index + bulletMatches[i][0].length;
                const endIndex =
                    i + 1 < bulletMatches.length ? bulletMatches[i + 1].index : content.length;
                const section = content.slice(startIndex, endIndex).trim();
                console.log(`[Branch] Item ${i + 1} (chars ${startIndex}-${endIndex}):`, section.substring(0, 100) + (section.length > 100 ? '...' : ''));
                items.push(section);
            }
            console.log('[Branch] parseItems returning', items.length, 'bullet items');
            return items;
        }

        console.log('[Branch] parseItems returning null (no list found)');
        return null; // triggers LLM extraction
    }

    /**
     * Extract items using LLM when pattern matching fails
     * @param {string} content - Node content to parse
     * @param {string} instructions - Optional parsing instructions from user
     * @returns {Promise<string[]>} - Array of extracted items
     */
    async extractItemsWithLLM(content, instructions = '') {
        console.log('[Branch] extractItemsWithLLM called');
        console.log('[Branch] Instructions:', instructions || '(none)');
        const model = this.modelPicker.value;
        console.log('[Branch] Using model:', model);

        let prompt = `Extract a list of distinct items from the following content. Return ONLY a JSON array of strings, with no additional text or explanation.

Content:
${content}`;

        if (instructions) {
            prompt += `\n\nAdditional instructions: ${instructions}`;
        }

        console.log('[Branch] LLM prompt:', prompt.substring(0, 200) + '...');

        return new Promise((resolve, reject) => {
            let fullResponse = '';

            this.chat.sendMessage(
                [{ role: 'user', content: prompt }],
                model,
                (chunk) => {
                    fullResponse += chunk;
                },
                () => {
                    console.log('[Branch] LLM full response:', fullResponse);
                    try {
                        // Parse JSON response
                        const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
                        console.log('[Branch] JSON match found:', !!jsonMatch);
                        if (jsonMatch) {
                            const items = JSON.parse(jsonMatch[0]);
                            console.log('[Branch] Parsed items:', items);
                            console.log('[Branch] Items count:', items.length);
                            if (Array.isArray(items) && items.length > 0) {
                                const result = items.map((item) => String(item).trim());
                                console.log('[Branch] Returning items:', result);
                                resolve(result);
                                return;
                            }
                        }
                        reject(new Error('Could not extract items from content'));
                    } catch (parseError) {
                        console.error('[Branch] Failed to parse LLM extraction:', parseError);
                        reject(new Error('Failed to parse extracted items'));
                    }
                },
                (err) => reject(err)
            );
        });
    }

    /**
     * Handle /branch slash command - parse items and show modal
     * @param {string} command - The command string (e.g., '/branch')
     * @param {string} args - Optional parsing instructions
     * @param {Object} context - Execution context (selected nodes, etc.)
     */
    async handleCommand(command, args, context) {
        const selectedIds = this.canvas.getSelectedNodeIds();

        if (selectedIds.length === 0) {
            this.showToast?.('Select a node containing a list to branch from', 'error');
            return;
        }

        if (selectedIds.length > 1) {
            this.showToast?.('Select only one node to branch from', 'error');
            return;
        }

        const sourceNodeId = selectedIds[0];
        const sourceNode = this.graph.getNode(sourceNodeId);

        if (!sourceNode || !sourceNode.content) {
            this.showToast?.('Selected node has no content', 'error');
            return;
        }

        const parsingInstructions = args.trim();
        let items = null;

        console.log('[Branch] handleCommand called');
        console.log('[Branch] parsingInstructions:', parsingInstructions || '(none)');
        console.log('[Branch] sourceNode.content length:', sourceNode.content.length);

        // If user provided instructions, always use LLM (they want semantic parsing)
        // Otherwise, try pattern matching first
        if (!parsingInstructions) {
            console.log('[Branch] No instructions, trying pattern matching first');
            items = this.parseItems(sourceNode.content);
            console.log('[Branch] Pattern matching result:', items ? `${items.length} items` : 'null');
        } else {
            console.log('[Branch] Instructions provided, skipping pattern matching, will use LLM');
        }

        // If pattern matching failed or user provided instructions, use LLM
        if (!items) {
            console.log('[Branch] Using LLM extraction');
            try {
                // Show loading state
                const modal = this.modalManager.getPluginModal('branch', 'main');
                this.modalManager.showPluginModal('branch', 'main');

                const itemsList = modal.querySelector('#branch-items-list');
                itemsList.innerHTML = `
                    <div class="branch-loading">
                        <span class="loading-spinner"></span>
                        <span>Extracting items...</span>
                    </div>
                `;

                items = await this.extractItemsWithLLM(sourceNode.content, parsingInstructions);

                if (!items || items.length === 0) {
                    itemsList.innerHTML = `
                        <div class="branch-error">
                            No items found. Add items manually or try different instructions.
                        </div>
                    `;
                    this._branchData = {
                        sourceNodeId,
                        items: [],
                        template: '',
                        model: this.modelPicker.value,
                    };
                    this.renderItemsList();
                    this.updateItemsCount();
                    this.setupBranchModalEventListeners();
                    return;
                }
            } catch (error) {
                console.error('Failed to extract items:', error);
                this.showToast?.('Failed to extract items from content', 'error');
                this.closeModal();
                return;
            }
        }

        // Store data for the modal
        this._branchData = {
            sourceNodeId,
            items: items,
            template: '',
            model: this.modelPicker.value,
        };

        console.log('[Branch] Stored _branchData.items:', this._branchData.items);
        console.log('[Branch] First item preview:', this._branchData.items[0]?.substring(0, 200));

        // Show and populate modal
        this.showBranchModal();
    }

    /**
     * Show the branch configuration modal
     */
    showBranchModal() {
        const modal = this.modalManager.getPluginModal('branch', 'main');

        // Populate model dropdown
        const modelSelect = modal.querySelector('#branch-model');
        modelSelect.innerHTML = '';
        const availableModels = Array.from(this.modelPicker.options).map((opt) => ({
            id: opt.value,
            name: opt.textContent,
        }));
        for (const model of availableModels) {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        }
        modelSelect.value = this._branchData.model;

        // Populate template input
        const templateInput = modal.querySelector('#branch-template');
        templateInput.value = this._branchData.template;

        // Render items list
        this.renderItemsList();

        // Update counts and validation
        this.updateItemsCount();

        // Show modal
        this.modalManager.showPluginModal('branch', 'main');

        // Setup event listeners
        this.setupBranchModalEventListeners();
    }

    /**
     * Setup event listeners for branch modal
     */
    setupBranchModalEventListeners() {
        if (this._modalListenersSetup) return;
        this._modalListenersSetup = true;

        const modal = this.modalManager.getPluginModal('branch', 'main');

        // Add item button
        const addItemBtn = modal.querySelector('#branch-add-item-btn');
        addItemBtn.addEventListener('click', () => this.addItem());

        // Template input
        const templateInput = modal.querySelector('#branch-template');
        templateInput.addEventListener('input', (e) => {
            this._branchData.template = e.target.value;
            this.updateValidation();
        });

        // Model select
        const modelSelect = modal.querySelector('#branch-model');
        modelSelect.addEventListener('change', (e) => {
            this._branchData.model = e.target.value;
        });
    }

    /**
     * Render the items list
     */
    renderItemsList() {
        console.log('[Branch] renderItemsList called');
        console.log('[Branch] Items to render:', this._branchData.items.length);

        const modal = this.modalManager.getPluginModal('branch', 'main');
        const list = modal.querySelector('#branch-items-list');
        list.innerHTML = '';

        for (let i = 0; i < this._branchData.items.length; i++) {
            const item = this._branchData.items[i];
            console.log(`[Branch] Rendering item ${i}:`, item.substring(0, 100) + (item.length > 100 ? `... (${item.length} chars total)` : ''));
            const row = document.createElement('div');
            row.className = 'branch-item-row';
            row.dataset.index = i;

            // Item input
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'branch-item-input';
            input.value = item;
            input.placeholder = 'Item text...';
            input.dataset.index = i;
            input.addEventListener('input', (e) => {
                this._branchData.items[parseInt(e.target.dataset.index)] = e.target.value;
                this.updateValidation();
            });

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'branch-item-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove item';
            removeBtn.dataset.index = i;
            removeBtn.addEventListener('click', () => {
                this.removeItem(i);
            });

            row.appendChild(input);
            row.appendChild(removeBtn);
            list.appendChild(row);
        }
    }

    /**
     * Add a new empty item
     */
    addItem() {
        this._branchData.items.push('');
        this.renderItemsList();
        this.updateItemsCount();

        // Focus the new input
        const modal = this.modalManager.getPluginModal('branch', 'main');
        const inputs = modal.querySelectorAll('.branch-item-input');
        if (inputs.length > 0) {
            inputs[inputs.length - 1].focus();
        }
    }

    /**
     * Remove an item
     * @param {number} index - Item index to remove
     */
    removeItem(index) {
        this._branchData.items.splice(index, 1);
        this.renderItemsList();
        this.updateItemsCount();
    }

    /**
     * Update items count display
     */
    updateItemsCount() {
        const modal = this.modalManager.getPluginModal('branch', 'main');
        const countEl = modal.querySelector('#branch-items-count');
        const warningEl = modal.querySelector('#branch-warning');
        const count = this._branchData.items.filter((item) => item.trim()).length;

        countEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;

        // Show warning for many items
        if (count > 10) {
            countEl.classList.add('warning');
            warningEl.style.display = 'block';
        } else {
            countEl.classList.remove('warning');
            warningEl.style.display = 'none';
        }

        this.updateValidation();
    }

    /**
     * Update validation state of execute button
     */
    updateValidation() {
        const modal = this.modalManager.getPluginModal('branch', 'main');
        const executeBtn = modal.querySelector('#branch-execute-btn');
        const templateInput = modal.querySelector('#branch-template');

        const validItems = this._branchData.items.filter((item) => item.trim()).length;
        const hasTemplate = templateInput.value.trim().length > 0;

        executeBtn.disabled = validItems === 0 || !hasTemplate;
    }

    /**
     * Close the branch modal and clear state
     */
    closeModal() {
        this.modalManager.hidePluginModal('branch', 'main');
        this._branchData = null;
        this._modalListenersSetup = false;
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text
     * @returns {string}
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get display name for a model ID
     * @param {string} modelId - The model ID
     * @returns {string} - Display name for the model
     */
    getModelDisplayName(modelId) {
        const option = this.modelPicker.querySelector(`option[value="${modelId}"]`);
        return option ? option.textContent : modelId.split('/').pop();
    }

    /**
     * Execute the branch operation - create nodes and run LLM calls or slash commands
     */
    async executeBranch() {
        console.log('[Branch] executeBranch called');
        if (!this._branchData) return;

        const { sourceNodeId, items, template } = this._branchData;
        console.log('[Branch] Items from _branchData:', items);
        console.log('[Branch] Template:', template);

        const modal = this.modalManager.getPluginModal('branch', 'main');
        const model = modal.querySelector('#branch-model').value;

        // Filter out empty items
        const validItems = items.filter((item) => item.trim());
        console.log('[Branch] Valid items count:', validItems.length);
        validItems.forEach((item, i) => {
            console.log(`[Branch] Valid item ${i}:`, item.substring(0, 100) + (item.length > 100 ? `... (${item.length} chars)` : ''));
        });

        if (validItems.length === 0) {
            this.showToast?.('No items to branch', 'error');
            return;
        }

        // Close modal
        this.modalManager.hidePluginModal('branch', 'main');

        // Track recently used model
        storage.addRecentModel(model);

        // Get source node position
        const sourceNode = this.graph.getNode(sourceNodeId);
        const basePos = sourceNode.position;

        // Check if template is a slash command
        const isSlashCommand = template.trim().startsWith('/');
        console.log('[Branch] Template is slash command:', isSlashCommand);

        if (isSlashCommand) {
            // Process each item as a slash command (like user typing in chat input)
            await this.executeBranchSlashCommands(sourceNodeId, sourceNode, validItems, template);
        } else {
            // Process as regular LLM prompts
            await this.executeBranchLLM(sourceNodeId, sourceNode, validItems, template, model);
        }
    }

    /**
     * Execute branch with slash commands - each item processed through normal input flow
     * @param {string} sourceNodeId - Source node ID
     * @param {Object} sourceNode - Source node object
     * @param {string[]} validItems - Array of items to process
     * @param {string} template - Command template with {item} placeholder
     */
    async executeBranchSlashCommands(sourceNodeId, sourceNode, validItems, template) {
        console.log('[Branch] Executing slash commands for', validItems.length, 'items');

        // Create human node for the branch command
        const humanNode = createNode(NodeType.HUMAN, `/branch ${template}`, {
            position: this.graph.autoPosition([sourceNodeId]),
        });
        this.graph.addNode(humanNode);
        this.canvas.renderNode(humanNode);

        // Create edge from source to human
        const humanEdge = createEdge(sourceNodeId, humanNode.id, EdgeType.REPLY);
        this.graph.addEdge(humanEdge);

        // Clear input and save
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';
        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        // Detect if this is a modal-based command that we need to handle specially
        const isImageCommand = template.trim().startsWith('/image');
        let capturedImageSettings = null;

        if (!this.tryHandleSlashCommand) {
            console.error('[Branch] tryHandleSlashCommand not available');
            this.showToast?.('Slash commands not available', 'error');
            return;
        }

        if (isImageCommand) {
            // For /image commands: first item shows modal, then remaining run in parallel
            const firstItem = validItems[0];
            const firstResolvedCommand = template.replace(/\{item\}/g, firstItem);
            console.log('[Branch] Processing first /image command:', firstResolvedCommand.substring(0, 100));

            // Select the human node so the slash command has context
            this.canvas.selectNode(humanNode.id);

            // First /image: show modal and capture settings
            const handled = await this.tryHandleSlashCommandWithSettingsCapture(
                firstResolvedCommand,
                firstItem,
                [humanNode.id],
                (settings) => {
                    capturedImageSettings = settings;
                    console.log('[Branch] Captured image settings:', settings);
                }
            );

            if (!handled) {
                console.warn(`[Branch] Slash command not recognized: ${firstResolvedCommand}`);
                this.showToast?.(`Unknown command: ${firstResolvedCommand.split(' ')[0]}`, 'error');
                this.saveSession();
                return;
            }

            // If user cancelled the modal (no settings captured), stop
            if (!capturedImageSettings) {
                console.log('[Branch] User cancelled image settings modal');
                this.saveSession();
                return;
            }

            // Process remaining items in parallel
            if (validItems.length > 1) {
                const remainingItems = validItems.slice(1);
                console.log(`[Branch] Processing ${remainingItems.length} remaining /image commands in parallel`);

                // Select the human node for context (all parallel commands will use this)
                this.canvas.selectNode(humanNode.id);

                const promises = remainingItems.map((item, idx) => {
                    const resolvedCommand = template.replace(/\{item\}/g, item);
                    console.log(`[Branch] Queuing parallel /image command ${idx + 1}:`, resolvedCommand.substring(0, 100));
                    return this.tryHandleSlashCommandWithImageSettings(
                        resolvedCommand,
                        item,
                        [humanNode.id],
                        capturedImageSettings
                    ).then((handled) => {
                        console.log(`[Branch] Parallel /image command ${idx + 1} handled:`, handled);
                        if (!handled) {
                            console.warn(`[Branch] Slash command not recognized: ${resolvedCommand}`);
                        }
                        return handled;
                    });
                });

                await Promise.all(promises);
            }
        } else {
            // Non-image commands: process sequentially to avoid race conditions
            for (let i = 0; i < validItems.length; i++) {
                const item = validItems[i];
                const resolvedCommand = template.replace(/\{item\}/g, item);
                console.log(`[Branch] Processing slash command ${i}:`, resolvedCommand.substring(0, 100));

                // Select the human node so the slash command has context
                this.canvas.selectNode(humanNode.id);

                const handled = await this.tryHandleSlashCommand(resolvedCommand, item);
                console.log(`[Branch] Slash command ${i} handled:`, handled);
                if (!handled) {
                    console.warn(`[Branch] Slash command not recognized: ${resolvedCommand}`);
                    this.showToast?.(`Unknown command: ${resolvedCommand.split(' ')[0]}`, 'error');
                }
            }
        }

        this.saveSession();
    }

    /**
     * Try to handle a slash command and capture image settings if it's an /image command.
     * This is used for the first /image in a branch to capture the user's modal selections.
     * @param {string} content - The command content
     * @param {string} context - Context text (the item)
     * @param {string[]} parentNodeIds - Parent node IDs for connecting edges
     * @param {Function} onSettingsCapture - Callback when settings are captured
     * @returns {Promise<boolean>} - Whether the command was handled
     */
    async tryHandleSlashCommandWithSettingsCapture(content, context, parentNodeIds, onSettingsCapture) {
        // Parse the command
        const parts = content.split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');

        // Get the image generation feature
        const imageFeature = this.featureRegistry?.getFeature?.('image-generation');
        if (!imageFeature) {
            // Fall back to normal handling
            return await this.tryHandleSlashCommand(content, context);
        }

        // Call handleCommand but intercept the settings
        // The modal will show and when user clicks Generate, we capture the settings
        const selectedContext = context;
        const additionalInstructions = args.trim();

        let prompt = selectedContext || additionalInstructions;
        if (selectedContext && additionalInstructions) {
            prompt = `${selectedContext}\n\nAdditional instructions: ${additionalInstructions}`;
        }

        imageFeature.currentPrompt = prompt;
        imageFeature.parentNodeIds = parentNodeIds;

        // Show modal and wait for settings
        const settings = await imageFeature.showSettingsModal();
        if (settings) {
            // Capture the settings for subsequent items
            onSettingsCapture(settings);
            // Generate the image with these settings
            await imageFeature.generateImageWithSettings(
                imageFeature.currentPrompt,
                imageFeature.parentNodeIds,
                settings
            );
            return true;
        }
        // User cancelled
        return true;
    }

    /**
     * Try to handle a slash command with pre-specified image settings.
     * This is used for subsequent /image commands in a branch to skip the modal.
     * @param {string} content - The command content
     * @param {string} context - Context text (the item)
     * @param {string[]} parentNodeIds - Parent node IDs for connecting edges
     * @param {Object} imageSettings - Pre-captured image settings {model, size, quality}
     * @returns {Promise<boolean>} - Whether the command was handled
     */
    async tryHandleSlashCommandWithImageSettings(content, context, parentNodeIds, imageSettings) {
        // Parse the command
        const parts = content.split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');

        // Build context object with image settings and parent node IDs
        const contextObj = {
            text: context,
            parentNodeIds: parentNodeIds,
            imageSettings: imageSettings,
        };

        // Use the feature registry to handle the command with the augmented context
        if (this.featureRegistry) {
            return await this.featureRegistry.handleSlashCommand(command, args, contextObj);
        }

        // Fallback - shouldn't happen
        return await this.tryHandleSlashCommand(content, context);
    }

    /**
     * Execute branch with LLM calls - original behavior
     * @param {string} sourceNodeId - Source node ID
     * @param {Object} sourceNode - Source node object
     * @param {string[]} validItems - Array of items to process
     * @param {string} template - Prompt template with {item} placeholder
     * @param {string} model - Model ID to use
     */
    async executeBranchLLM(sourceNodeId, sourceNode, validItems, template, model) {
        console.log('[Branch] Executing LLM calls for', validItems.length, 'items');

        const basePos = sourceNode.position;

        // Calculate fan layout
        const spacing = 400;
        const verticalOffset = 250;
        const totalWidth = (validItems.length - 1) * spacing;
        const startX = basePos.x - totalWidth / 2;

        // Create human node for the branch command
        const humanNode = createNode(NodeType.HUMAN, `/branch ${template}`, {
            position: this.graph.autoPosition([sourceNodeId]),
        });
        this.graph.addNode(humanNode);
        this.canvas.renderNode(humanNode);

        // Create edge from source to human
        const humanEdge = createEdge(sourceNodeId, humanNode.id, EdgeType.REPLY);
        this.graph.addEdge(humanEdge);

        // Get tool settings from storage (mirror chat behavior)
        const toolsEnabled = storage.getToolsEnabled();
        const enabledTools = storage.getEnabledTools();

        // Create child nodes
        const childNodes = [];
        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            const prompt = template.replace(/\{item\}/g, item);
            console.log(`[Branch] Creating child ${i}: item length=${item.length}, prompt length=${prompt.length}`);
            console.log(`[Branch] Child ${i} prompt preview:`, prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''));

            const childNode = createNode(NodeType.AI, `*Processing: ${item}...*`, {
                position: {
                    x: startX + i * spacing,
                    y: basePos.y + verticalOffset,
                },
                model: model,
            });

            this.graph.addNode(childNode);

            // Create edge from human to child
            const edge = createEdge(humanNode.id, childNode.id, EdgeType.BRANCH);
            this.graph.addEdge(edge);

            childNodes.push({ node: childNode, item, prompt });
        }

        // Clear input and save
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';
        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        // Pan to see the branches
        this.canvas.centerOnAnimated(basePos.x, basePos.y + verticalOffset / 2, 300);

        // Store state for tracking active branch
        this._activeBranch = {
            childNodeIds: childNodes.map((c) => c.node.id),
            abortControllers: new Map(),
        };

        // Build context from source node
        const messages = [];
        if (sourceNode.content) {
            messages.push({ role: 'assistant', content: sourceNode.content });
        }

        // Run all LLM calls in parallel
        const promises = childNodes.map(({ node, item, prompt }) => {
            return this.processItem(node, prompt, model, messages, item, toolsEnabled, enabledTools);
        });

        try {
            await Promise.all(promises);
            this._activeBranch = null;
            this.saveSession();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[Branch] Branch generation aborted');
            } else {
                console.error('[Branch] Branch error:', err);
            }
            this._activeBranch = null;
            this.saveSession();
        }
    }

    /**
     * Process a single item - send to LLM and stream response
     * @param {Object} node - The child node
     * @param {string} prompt - The prompt to send
     * @param {string} model - Model ID
     * @param {Array} contextMessages - Context messages
     * @param {string} item - The item being processed
     * @param {boolean} toolsEnabled - Whether tools are enabled
     * @param {string[]|null} enabledTools - List of enabled tool IDs
     * @returns {Promise<string>} - The response content
     */
    async processItem(node, prompt, model, contextMessages, item, toolsEnabled, enabledTools) {
        const nodeId = node.id;
        const modelName = this.getModelDisplayName(model);

        // Build messages
        const messages = [...contextMessages, { role: 'user', content: prompt }];

        // Create abort controller
        const abortController = new AbortController();
        this._activeBranch.abortControllers.set(nodeId, abortController);

        // Register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'branch',
            context: { model, modelName, messages, item, nodeId, prompt },
            onContinue: async (nodeId, state) => {
                await this.continueItem(nodeId, state.context);
            },
        });

        // Build request options
        const requestOptions = {
            signal: abortController.signal,
        };

        // Add tools if enabled
        if (toolsEnabled) {
            requestOptions.tools = enabledTools;
        }

        return new Promise((resolve, reject) => {
            let fullContent = '';

            this.chat.sendMessage(
                messages,
                model,
                // onChunk
                (chunk, accumulated) => {
                    fullContent = accumulated;
                    this.canvas.updateNodeContent(nodeId, accumulated, true);
                },
                // onDone
                (finalContent) => {
                    fullContent = finalContent;
                    this.canvas.updateNodeContent(nodeId, finalContent, false);
                    this.graph.updateNode(nodeId, { content: finalContent });
                    this.streamingManager.unregister(nodeId);
                    this._activeBranch?.abortControllers.delete(nodeId);
                    this.saveSession();

                    // Generate summary for semantic zoom
                    if (this.generateNodeSummary) {
                        this.generateNodeSummary(nodeId, finalContent);
                    }

                    resolve(finalContent);
                },
                // onError
                (err) => {
                    if (err.name === 'AbortError') {
                        console.log(`[Branch] Item "${item}" aborted`);
                        this._activeBranch?.abortControllers.delete(nodeId);
                        resolve('');
                        return;
                    }
                    this.streamingManager.unregister(nodeId);
                    this._activeBranch?.abortControllers.delete(nodeId);

                    // Show error in node
                    const errorContent = `**Error**\n\n${err.message}`;
                    this.canvas.updateNodeContent(nodeId, errorContent, false);
                    this.graph.updateNode(nodeId, { content: errorContent });

                    reject(err);
                },
                requestOptions
            );
        });
    }

    /**
     * Continue item generation from where it was stopped
     * @param {string} nodeId - The node ID
     * @param {Object} context - Saved context
     */
    async continueItem(nodeId, context) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        const { model, modelName, messages, item } = context;

        // Get current content (remove stopped indicator)
        let currentContent = node.content.replace(/\n\n\*\[Generation stopped\]\*$/, '');

        // Build continuation messages
        const continueMessages = [
            ...messages,
            { role: 'assistant', content: currentContent },
            { role: 'user', content: 'Please continue your response from where you left off.' },
        ];

        // Create new abort controller
        const abortController = new AbortController();

        // Re-register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'branch',
            context,
            onContinue: async (nodeId, state) => {
                await this.continueItem(nodeId, state.context);
            },
        });

        // Continue streaming
        this.chat.sendMessage(
            continueMessages,
            model,
            // onChunk
            (chunk, accumulated) => {
                const combinedContent = currentContent + accumulated;
                this.canvas.updateNodeContent(nodeId, combinedContent, true);
            },
            // onDone
            (finalContent) => {
                const combinedContent = currentContent + finalContent;
                this.canvas.updateNodeContent(nodeId, combinedContent, false);
                this.graph.updateNode(nodeId, { content: combinedContent });
                this.streamingManager.unregister(nodeId);
                this.saveSession();
            },
            // onError
            (err) => {
                if (err.name === 'AbortError') {
                    console.log(`[Branch] Item continuation aborted`);
                } else {
                    console.error('[Branch] Continuation error:', err);
                    const errorContent = currentContent + `\n\n*Error continuing: ${err.message}*`;
                    this.canvas.updateNodeContent(nodeId, errorContent, false);
                    this.graph.updateNode(nodeId, { content: errorContent });
                }
                this.streamingManager.unregister(nodeId);
                this.saveSession();
            },
            abortController
        );
    }

    /**
     * Abort the active branch session if one is running
     */
    abort() {
        if (this._activeBranch) {
            for (const [nodeId, abortController] of this._activeBranch.abortControllers) {
                abortController.abort();
                this.streamingManager.unregister(nodeId);
            }
            this._activeBranch.abortControllers.clear();
            this._activeBranch = null;
        }
    }

    /**
     * Check if a branch session is currently active
     * @returns {boolean}
     */
    isActive() {
        return this._activeBranch !== null;
    }
}

// =============================================================================
// Exports
// =============================================================================

export { BranchFeature };
