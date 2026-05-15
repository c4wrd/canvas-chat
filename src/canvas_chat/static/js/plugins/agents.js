/**
 * Agents Feature Plugin (built-in)
 *
 * Hosts user-defined DeepAgents:
 *   - Manages an IndexedDB-backed catalog of AgentConfig objects.
 *   - Dynamically registers a slash command per saved agent
 *     (so users can type "/researcher" to invoke "Researcher").
 *   - Owns the Agents tab in the settings modal, the config editor
 *     modal, and the agent-run dispatch flow.
 *
 * Backend contract is /api/agents/start (kick off), /api/agents/stream
 * (SSE), /api/agents/stop (cancel), /api/agents/status (poll).
 *
 * v1 surfaces todos + final markdown report; subagents and a
 * filesystem viewer are stubbed but inert.
 */

import { authManager } from '../auth.js';
import { NodeType, EdgeType, createNode, createEdge } from '../graph-types.js';
import { readSSEStream } from '../sse.js';
import { apiUrl } from '../utils.js';
import { FeaturePlugin } from '../feature-plugin.js';

/**
 *
 */
class AgentsFeature extends FeaturePlugin {
    /**
     *
     * @param context
     */
    constructor(context) {
        super(context);
        /** @type {Array<Object>} */
        this._configs = [];
        /** @type {Array<{id: string, name: string, description: string, enabled: boolean}>} */
        this._availableTools = [];
        /** @type {Set<string>} - slugs currently registered with the feature registry */
        this._registeredSlugs = new Set();
    }

    /**
     *
     */
    async onLoad() {
        this._registerSettingsModal();
        this._registerEditorModal();
        this._injectStyles();

        try {
            this._availableTools = await this._fetchTools();
        } catch (err) {
            console.warn('[AgentsFeature] Failed to fetch tools:', err);
        }

        await this._reloadConfigs();
        this._refreshAgentPicker();
    }

    // --- Slash command exposure ------------------------------------------

    /**
     *
     */
    getSlashCommands() {
        // Surface a synthetic /agent + one entry per saved config so the
        // autocomplete menu has them. Backed by handleAgentCommand.
        const base = [
            {
                command: '/agent',
                description: 'Open the agents tab to manage agents',
                placeholder: '/agent <slug> [prompt]',
            },
        ];
        for (const cfg of this._configs) {
            base.push({
                command: `/${cfg.slug}`,
                description: `${cfg.icon || '🤖'} ${cfg.name}${cfg.description ? ' — ' + cfg.description : ''}`,
                placeholder: `Run ${cfg.name}...`,
            });
        }
        return base;
    }

    /**
     * Dispatch entry point for /agent and every per-agent slug. The
     * feature-registry routes here for both because we register the
     * slug-specific commands at load time with the same handler name.
     * @param command
     * @param args
     * @param context
     */
    async handleAgentCommand(command, args, context) {
        const slug = command.replace(/^\//, '').toLowerCase();
        if (slug === 'agent') {
            this._openSettingsModal();
            return;
        }
        const cfg = this._configs.find((c) => c.slug === slug);
        if (!cfg) {
            this.showToast?.(`No agent registered for /${slug}`, 'error');
            return;
        }
        await this._startAgentRun(cfg, args.trim(), context);
    }

    // --- Agent run dispatch ----------------------------------------------

    /**
     *
     * @param config
     * @param input
     * @param contextObj
     */
    async _startAgentRun(config, input, contextObj) {
        if (!input) {
            this.showToast?.(`Enter a prompt after /${config.slug}`, 'error');
            return;
        }

        // Resolve credentials the same way /api/chat does.
        const modelId = config.model;
        const provider = (modelId || '').split('/')[0];
        const apiKey = this.storage.getApiKeyForProvider(provider);
        const baseUrl = this.storage.getBaseUrlForModel(modelId);

        const selectedText = contextObj?.text || null;
        const parentIds = this.canvas.getSelectedNodeIds();

        const initialContent = `**${config.name}:** ${input}\n\n*Starting...*`;
        const node = createNode(NodeType.AGENT_RUN, initialContent, {
            position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
            model: modelId,
            agentSlug: config.slug,
            agentName: config.name,
            agentIcon: config.icon,
            status: 'pending',
            todos: [],
            toolCalls: [],
            taskId: null,
            input,
            startedAt: Date.now(),
        });

        this.graph.addNode(node);
        for (const parentId of parentIds) {
            const edge = createEdge(parentId, node.id, EdgeType.REFERENCE);
            this.graph.addEdge(edge);
            const parentNode = this.graph.getNode(parentId);
            this.canvas.renderEdge(edge, parentNode.position, node.position);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        const parentMessages = [];
        if (selectedText) {
            parentMessages.push({ role: 'user', content: selectedText });
        }

        const abortController = new AbortController();
        this.streamingManager.register(node.id, {
            abortController,
            featureId: 'agents',
            context: { type: 'agent-run', configId: config.id },
            onStop: async (nodeId) => {
                const n = this.graph.getNode(nodeId);
                if (n?.taskId) {
                    try {
                        await fetch(apiUrl(`/api/agents/stop/${n.taskId}`), { method: 'POST' });
                    } catch (err) {
                        console.warn('[AgentsFeature] stop request failed:', err);
                    }
                }
            },
        });

        try {
            const startHeaders = { 'Content-Type': 'application/json' };
            const token = await authManager.getIdToken();
            if (token) startHeaders['Authorization'] = `Bearer ${token}`;

            const startResp = await fetch(apiUrl('/api/agents/start'), {
                method: 'POST',
                headers: startHeaders,
                body: JSON.stringify({
                    agent: config,
                    input,
                    parent_messages: parentMessages,
                    api_key: apiKey,
                    base_url: baseUrl,
                    model: modelId,
                }),
                signal: abortController.signal,
            });

            if (!startResp.ok) {
                const detail = await startResp.text().catch(() => '');
                throw new Error(`Failed to start agent: ${startResp.statusText} ${detail}`);
            }

            const { task_id: taskId } = await startResp.json();
            this.graph.updateNode(node.id, { taskId, status: 'in_progress' });
            this.canvas.renderNode(this.graph.getNode(node.id));

            const streamHeaders = {};
            if (token) streamHeaders['Authorization'] = `Bearer ${token}`;

            const streamResp = await fetch(apiUrl(`/api/agents/stream/${taskId}`), {
                method: 'GET',
                headers: streamHeaders,
                signal: abortController.signal,
            });

            if (!streamResp.ok) {
                throw new Error(`Failed to connect to agent stream: ${streamResp.statusText}`);
            }

            let report = '';
            const live = { todos: [], toolCalls: [] };

            await readSSEStream(streamResp, {
                onEvent: (eventType, data) => {
                    if (eventType === 'message') {
                        report += data;
                        this.canvas.updateNodeContent(node.id, report, true);
                        this.graph.updateNode(node.id, { content: report });
                    } else if (eventType === 'thinking') {
                        // v1 doesn't surface thinking in the node renderer.
                        // The backend still forwards it for completeness.
                    } else if (eventType === 'todo_update') {
                        try {
                            const payload = JSON.parse(data);
                            live.todos = payload.todos || [];
                            this.graph.updateNode(node.id, { todos: live.todos });
                            this.canvas.renderNode(this.graph.getNode(node.id));
                        } catch (e) {
                            console.warn('[AgentsFeature] bad todo_update:', e);
                        }
                    } else if (eventType === 'tool_call') {
                        try {
                            const payload = JSON.parse(data);
                            live.toolCalls.push({ id: payload.id, name: payload.name, arguments: payload.arguments });
                            this.graph.updateNode(node.id, { toolCalls: live.toolCalls });
                            this.canvas.renderNode(this.graph.getNode(node.id));
                        } catch (e) {
                            console.warn('[AgentsFeature] bad tool_call:', e);
                        }
                    } else if (eventType === 'tool_result') {
                        try {
                            const payload = JSON.parse(data);
                            const tc = live.toolCalls.find((t) => t.id === payload.id);
                            if (tc) tc.result = payload.result;
                            this.graph.updateNode(node.id, { toolCalls: live.toolCalls });
                            this.canvas.renderNode(this.graph.getNode(node.id));
                        } catch (e) {
                            console.warn('[AgentsFeature] bad tool_result:', e);
                        }
                    } else if (eventType === 'error') {
                        const message = (() => {
                            try { return JSON.parse(data).message; } catch { return data; }
                        })();
                        this.graph.updateNode(node.id, { status: 'failed', error: message });
                        this.canvas.renderNode(this.graph.getNode(node.id));
                    }
                },
                onDone: () => {
                    this.streamingManager.unregister(node.id);
                    const current = this.graph.getNode(node.id);
                    if (current?.status !== 'failed') {
                        this.graph.updateNode(node.id, { status: 'completed', completedAt: Date.now() });
                    }
                    this.canvas.updateNodeContent(node.id, report || current?.content || '', false);
                    this.canvas.renderNode(this.graph.getNode(node.id));
                    this.saveSession();
                    this.generateNodeSummary?.(node.id);
                },
                onError: (err) => {
                    this.streamingManager.unregister(node.id);
                    if (err.name === 'AbortError') return;
                    throw err;
                },
            });
        } catch (err) {
            this.streamingManager.unregister(node.id);
            const aborted = err.name === 'AbortError';
            this.graph.updateNode(node.id, {
                status: aborted ? 'stopped' : 'failed',
                error: aborted ? null : err.message,
            });
            this.canvas.renderNode(this.graph.getNode(node.id));
            this.saveSession();
            if (!aborted) {
                console.error('[AgentsFeature] agent run failed:', err);
                this.showToast?.(err.message || 'Agent run failed', 'error');
            }
        }
    }

    // --- Settings modal (Agents tab) -------------------------------------

    /**
     *
     */
    _registerSettingsModal() {
        const html = `
            <div id="agents-list-modal" class="modal" style="display: none">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Agents</h2>
                        <button class="modal-close" id="agents-list-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="agents-list-actions">
                            <button id="agents-new-btn" class="primary-btn">+ New Agent</button>
                        </div>
                        <div id="agents-list-empty" class="agents-list-empty" style="display:none">
                            No agents yet. Click <strong>+ New Agent</strong> to build one.
                        </div>
                        <div id="agents-list" class="agents-list"></div>
                    </div>
                </div>
            </div>
        `;
        this.modalManager.registerModal('agents', 'list', html);
    }

    /**
     *
     */
    _registerEditorModal() {
        const html = `
            <div id="agents-editor-modal" class="modal" style="display: none">
                <div class="modal-content modal-content-wide">
                    <div class="modal-header">
                        <h2 id="agents-editor-title">New Agent</h2>
                        <button class="modal-close" id="agents-editor-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="agents-form-grid">
                            <label>Name
                                <input type="text" id="agents-form-name" placeholder="Researcher" />
                            </label>
                            <label>Slug
                                <input type="text" id="agents-form-slug" placeholder="researcher" />
                            </label>
                            <label>Icon
                                <input type="text" id="agents-form-icon" maxlength="4" placeholder="🔬" />
                            </label>
                            <label>Model
                                <input type="text" id="agents-form-model" placeholder="openai/gpt-4o" />
                            </label>
                            <label>Temperature
                                <input type="number" id="agents-form-temperature" min="0" max="2" step="0.1" value="0.7" />
                            </label>
                            <label>Max iterations
                                <input type="number" id="agents-form-max-iters" min="1" max="100" value="25" />
                            </label>
                        </div>
                        <label class="agents-form-block">Description
                            <input type="text" id="agents-form-description" placeholder="Multi-step research with citations." />
                        </label>
                        <label class="agents-form-block">System prompt
                            <textarea id="agents-form-prompt" rows="6" placeholder="You are a careful researcher..."></textarea>
                        </label>
                        <fieldset class="agents-form-tools">
                            <legend>Tools</legend>
                            <div id="agents-form-tools-list"></div>
                        </fieldset>
                        <div class="modal-actions">
                            <button id="agents-editor-cancel" class="secondary-btn">Cancel</button>
                            <button id="agents-editor-save" class="primary-btn">Save</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.modalManager.registerModal('agents', 'editor', html);
    }

    /**
     *
     */
    _injectStyles() {
        this.injectCSS(`
            .agents-list-actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }
            .agents-list { display: flex; flex-direction: column; gap: 8px; }
            .agents-list-empty { padding: 16px; color: var(--text-muted); text-align: center; }
            .agents-list-item {
                display: flex; gap: 10px; align-items: center;
                padding: 10px 12px;
                border: 1px solid var(--border, #d0d0d0);
                border-radius: var(--radius-sm, 4px);
                background: var(--bg-primary);
            }
            .agents-list-item-icon { font-size: 1.4em; }
            .agents-list-item-body { flex: 1; min-width: 0; }
            .agents-list-item-name { font-weight: 600; color: var(--text-primary); }
            .agents-list-item-slug { font-family: var(--font-mono, monospace); color: var(--text-muted); font-size: 0.85em; }
            .agents-list-item-desc { font-size: 0.85em; color: var(--text-secondary); margin-top: 2px; }
            .agents-list-item-actions { display: flex; gap: 6px; }
            .agents-list-item-actions button {
                padding: 4px 10px; font-size: 0.85em;
                background: var(--bg-secondary); border: 1px solid var(--border);
                border-radius: var(--radius-sm, 4px); cursor: pointer;
            }
            .agents-list-item-actions .danger { color: var(--danger, #ef4444); }

            .modal-content-wide { max-width: 720px; }
            .agents-form-grid {
                display: grid;
                grid-template-columns: 1fr 1fr 1fr;
                gap: 10px;
                margin-bottom: 12px;
            }
            .agents-form-grid label,
            .agents-form-block {
                display: flex; flex-direction: column;
                font-size: 0.85em; color: var(--text-secondary);
                gap: 4px;
                margin-bottom: 10px;
            }
            .agents-form-grid input,
            .agents-form-block input,
            .agents-form-block textarea {
                padding: 6px 8px;
                border: 1px solid var(--border, #d0d0d0);
                border-radius: var(--radius-sm, 4px);
                background: var(--bg-primary);
                color: var(--text-primary);
                font: inherit;
                font-size: 0.9em;
            }
            .agents-form-block textarea { resize: vertical; min-height: 100px; font-family: inherit; }
            .agents-form-tools {
                border: 1px solid var(--border, #d0d0d0);
                border-radius: var(--radius-sm, 4px);
                padding: 8px 12px;
                margin-bottom: 12px;
            }
            .agents-form-tools legend { font-size: 0.85em; color: var(--text-secondary); }
            #agents-form-tools-list {
                display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto;
            }
            #agents-form-tools-list label {
                display: flex; gap: 8px; align-items: flex-start; font-size: 0.9em;
            }
            #agents-form-tools-list .tool-desc { color: var(--text-muted); font-size: 0.85em; }
        `, 'agents-feature-styles');
    }

    /**
     *
     */
    async _fetchTools() {
        const res = await fetch(apiUrl('/api/tools'));
        if (!res.ok) throw new Error(`Failed to list tools: ${res.statusText}`);
        return await res.json();
    }

    // --- Config catalog --------------------------------------------------

    /**
     *
     */
    async _reloadConfigs() {
        try {
            this._configs = await this.storage.getAgentConfigs();
        } catch (err) {
            console.warn('[AgentsFeature] Failed to load configs:', err);
            this._configs = [];
        }
        this._syncSlashRegistrations();
    }

    /**
     *
     */
    _syncSlashRegistrations() {
        const desired = new Set(this._configs.map((c) => c.slug));
        // Remove slugs that no longer exist
        for (const slug of Array.from(this._registeredSlugs)) {
            if (!desired.has(slug)) {
                this.featureRegistry._slashCommands.delete(`/${slug}`);
                this._registeredSlugs.delete(slug);
            }
        }
        // Add new slugs (skip if a higher-priority feature already owns it)
        for (const cfg of this._configs) {
            const cmdKey = `/${cfg.slug}`;
            if (this._registeredSlugs.has(cfg.slug)) continue;
            if (this.featureRegistry._slashCommands.has(cmdKey)) {
                console.warn(`[AgentsFeature] /${cfg.slug} already registered; skipping.`);
                continue;
            }
            this.featureRegistry._slashCommands.set(cmdKey, {
                featureId: 'agents',
                handler: 'handleAgentCommand',
                priority: 800, // below BUILTIN(1000), above COMMUNITY(100)
            });
            this._registeredSlugs.add(cfg.slug);
        }
    }

    /**
     *
     */
    _refreshAgentPicker() {
        const picker = document.getElementById('agent-picker');
        if (!picker) return;
        const current = picker.value;
        picker.innerHTML = '<option value="">No agent (chat)</option>';
        for (const cfg of this._configs) {
            const opt = document.createElement('option');
            opt.value = cfg.slug;
            opt.textContent = `${cfg.icon || '🤖'} ${cfg.name}`;
            picker.appendChild(opt);
        }
        if (current) picker.value = current;

        // Wire the change-listener once. The picker acts as a quick
        // autocomplete for slash commands: choosing an agent prefills
        // the chat input with `/<slug> `.
        if (!picker._agentsHandlerBound) {
            picker.addEventListener('change', () => {
                const slug = picker.value;
                if (!slug) return;
                const input = this.chatInput;
                if (!input) return;
                const current = input.value.trim();
                const prefix = `/${slug} `;
                if (!current.startsWith('/')) {
                    input.value = prefix + (current ? current : '');
                } else if (!current.startsWith(prefix)) {
                    // Replace existing slash command with the agent slug.
                    const restIdx = current.indexOf(' ');
                    const rest = restIdx >= 0 ? current.slice(restIdx + 1) : '';
                    input.value = prefix + rest;
                }
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
                picker.value = '';
            });
            picker._agentsHandlerBound = true;
        }
    }

    // --- Modal flows -----------------------------------------------------

    /**
     *
     */
    _openSettingsModal() {
        const modal = this.modalManager.getPluginModal('agents', 'list');
        if (!modal) return;

        this._renderConfigList(modal);

        const closeBtn = modal.querySelector('#agents-list-close');
        const newBtn = modal.querySelector('#agents-new-btn');

        const close = () => this.modalManager.hidePluginModal('agents', 'list');
        const onClose = () => close();
        const onNew = () => {
            close();
            this._openEditor(null);
        };
        closeBtn.addEventListener('click', onClose, { once: true });
        newBtn.addEventListener('click', onNew, { once: true });

        this.modalManager.showPluginModal('agents', 'list');
    }

    /**
     *
     * @param modal
     */
    _renderConfigList(modal) {
        const list = modal.querySelector('#agents-list');
        const empty = modal.querySelector('#agents-list-empty');
        list.innerHTML = '';
        if (this._configs.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        for (const cfg of this._configs) {
            const item = document.createElement('div');
            item.className = 'agents-list-item';
            item.innerHTML = `
                <div class="agents-list-item-icon">${cfg.icon || '🤖'}</div>
                <div class="agents-list-item-body">
                    <div class="agents-list-item-name">${this._escape(cfg.name)}</div>
                    <div class="agents-list-item-slug">/${this._escape(cfg.slug)}</div>
                    ${cfg.description ? `<div class="agents-list-item-desc">${this._escape(cfg.description)}</div>` : ''}
                </div>
                <div class="agents-list-item-actions">
                    <button class="agents-list-item-edit">Edit</button>
                    <button class="agents-list-item-delete danger">Delete</button>
                </div>
            `;
            item.querySelector('.agents-list-item-edit').addEventListener('click', () => {
                this.modalManager.hidePluginModal('agents', 'list');
                this._openEditor(cfg);
            });
            item.querySelector('.agents-list-item-delete').addEventListener('click', async () => {
                if (!confirm(`Delete agent "${cfg.name}"?`)) return;
                try {
                    await this.storage.deleteAgentConfig(cfg.id);
                    await this._reloadConfigs();
                    this._refreshAgentPicker();
                    this._renderConfigList(modal);
                } catch (err) {
                    this.showToast?.(`Delete failed: ${err.message}`, 'error');
                }
            });
            list.appendChild(item);
        }
    }

    /**
     *
     * @param existing
     */
    _openEditor(existing) {
        const modal = this.modalManager.getPluginModal('agents', 'editor');
        if (!modal) return;

        const title = modal.querySelector('#agents-editor-title');
        const name = modal.querySelector('#agents-form-name');
        const slug = modal.querySelector('#agents-form-slug');
        const icon = modal.querySelector('#agents-form-icon');
        const model = modal.querySelector('#agents-form-model');
        const temperature = modal.querySelector('#agents-form-temperature');
        const maxIters = modal.querySelector('#agents-form-max-iters');
        const description = modal.querySelector('#agents-form-description');
        const prompt = modal.querySelector('#agents-form-prompt');
        const toolsList = modal.querySelector('#agents-form-tools-list');
        const closeBtn = modal.querySelector('#agents-editor-close');
        const cancelBtn = modal.querySelector('#agents-editor-cancel');
        const saveBtn = modal.querySelector('#agents-editor-save');

        const editing = !!existing;
        title.textContent = editing ? 'Edit Agent' : 'New Agent';
        name.value = existing?.name || '';
        slug.value = existing?.slug || '';
        icon.value = existing?.icon || '🤖';
        model.value = existing?.model || (this.modelPicker?.value || 'openai/gpt-4o');
        temperature.value = existing?.temperature ?? 0.7;
        maxIters.value = existing?.max_iterations ?? 25;
        description.value = existing?.description || '';
        prompt.value = existing?.system_prompt || '';

        const selected = new Set(existing?.tools || []);
        toolsList.innerHTML = '';
        for (const t of this._availableTools) {
            const id = `agents-tool-${t.id}`;
            const wrap = document.createElement('label');
            wrap.innerHTML = `
                <input type="checkbox" id="${id}" value="${this._escape(t.id)}"
                    ${selected.has(t.id) ? 'checked' : ''} />
                <div>
                    <div>${this._escape(t.name || t.id)}</div>
                    <div class="tool-desc">${this._escape(t.description || '')}</div>
                </div>
            `;
            toolsList.appendChild(wrap);
        }

        const close = () => this.modalManager.hidePluginModal('agents', 'editor');
        const cleanup = () => {
            saveBtn.removeEventListener('click', onSave);
            cancelBtn.removeEventListener('click', onClose);
            closeBtn.removeEventListener('click', onClose);
        };
        const onClose = () => { cleanup(); close(); };
        const onSave = async () => {
            const toolIds = Array.from(toolsList.querySelectorAll('input[type=checkbox]:checked'))
                .map((el) => el.value);
            const newConfig = {
                id: existing?.id || crypto.randomUUID(),
                version: 1,
                name: name.value.trim() || 'Untitled agent',
                icon: icon.value.trim() || '🤖',
                slug: (slug.value || name.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                description: description.value.trim(),
                system_prompt: prompt.value,
                model: model.value.trim(),
                temperature: parseFloat(temperature.value) || 0.7,
                max_iterations: parseInt(maxIters.value, 10) || 25,
                tools: toolIds,
                filesystem_enabled: true,
                subagents: existing?.subagents || [],
                created_at: existing?.created_at || Date.now(),
                updated_at: Date.now(),
            };
            try {
                await this.storage.saveAgentConfig(newConfig);
                await this._reloadConfigs();
                this._refreshAgentPicker();
                cleanup();
                close();
                this.showToast?.(`Saved /${newConfig.slug}`, 'success');
            } catch (err) {
                this.showToast?.(`Save failed: ${err.message}`, 'error');
            }
        };

        saveBtn.addEventListener('click', onSave);
        cancelBtn.addEventListener('click', onClose);
        closeBtn.addEventListener('click', onClose);

        this.modalManager.showPluginModal('agents', 'editor');
        setTimeout(() => name?.focus(), 50);
    }

    /**
     *
     * @param s
     */
    _escape(s) {
        return String(s || '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
}

export { AgentsFeature };
