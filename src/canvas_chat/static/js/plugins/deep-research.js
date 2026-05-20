/**
 * Deep Research Feature Module
 *
 * Handles the /deep-research command using Google's Deep Research agent.
 * Supports browser-resumable background tasks, streaming thinking summaries,
 * and multimodal context (images/PDFs from selected nodes).
 *
 * Extends FeaturePlugin to integrate with the plugin architecture.
 */

import { authManager } from '../auth.js';
import { NodeType, EdgeType, createNode, createEdge } from '../graph-types.js';
import { storage } from '../storage.js';
import { readSSEStream } from '../sse.js';
import { apiUrl } from '../utils.js';
import { FeaturePlugin } from '../feature-plugin.js';

// LocalStorage key for tracking resumable research
const RESUMABLE_RESEARCH_KEY = 'deep-research-resumable';

/**
 * DeepResearchFeature - Handles /deep-research command with Google's Deep Research.
 * Extends FeaturePlugin to integrate with the plugin architecture.
 */
class DeepResearchFeature extends FeaturePlugin {
    /**
     * Create a DeepResearchFeature instance.
     * @param {AppContext} context - Application context with injected dependencies
     */
    constructor(context) {
        super(context);
    }

    /**
     * Lifecycle hook called when the plugin is loaded.
     */
    async onLoad() {
        console.log('[DeepResearchFeature] Loaded');

        this.registerConfigModal();

        // Check for resumable research on load (after session loads)
        // Use setTimeout to ensure session is loaded first
        setTimeout(() => {
            this.checkForResumableResearch();
            this.showContinueButtonsForResumableNodes();
            this.fetchMissingCompletedReports();
        }, 1000);

        // Listen for continue events on deep research nodes
        // This handles the case where a node failed (e.g., gateway timeout) but still has a Google ID
        this.canvas.on('nodeContinueGeneration', async (nodeId) => {
            await this.handleContinueRequest(nodeId);
        });

        // Plan-review buttons rendered inside the deep_research node emit
        // these canvas events. The node binding sends `{ feedback }` payload.
        this.canvas.on('deepResearchPlanRevise', async (nodeId, payload) => {
            await this.submitPlanRevision(nodeId, payload?.feedback || '', false);
        });
        this.canvas.on('deepResearchPlanApprove', async (nodeId, payload) => {
            await this.submitPlanRevision(nodeId, payload?.feedback || '', true);
        });
        this.canvas.on('deepResearchPlanPromote', async (nodeId) => {
            await this.promotePlanToReport(nodeId);
        });
    }

    /**
     * Register the model + planning configuration modal opened by /deep-research.
     */
    registerConfigModal() {
        const modalTemplate = `
            <div id="deep-research-config-modal" class="modal" style="display: none">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Deep Research</h2>
                        <button class="modal-close" id="dr-config-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="dr-config-group">
                            <label for="dr-config-model">Model</label>
                            <select id="dr-config-model" class="dr-config-select">
                                <option value="standard">Deep Research — ~$1–$3 per task</option>
                                <option value="max">Deep Research Max — ~$3–$7, ~160 searches, ~900k tokens</option>
                            </select>
                        </div>
                        <div class="dr-config-group">
                            <label class="dr-config-checkbox">
                                <input type="checkbox" id="dr-config-planning" />
                                <span>Review plan before running</span>
                            </label>
                            <span class="dr-config-hint">The agent drafts a plan first; you can revise or approve it before research kicks off.</span>
                        </div>
                        <div class="dr-config-group">
                            <label for="dr-config-query">Research query</label>
                            <textarea
                                id="dr-config-query"
                                class="modal-text-input dr-config-query"
                                rows="4"
                                placeholder="What would you like to research?"
                            ></textarea>
                        </div>
                        <div class="modal-actions">
                            <button id="dr-config-cancel" class="secondary-btn">Cancel</button>
                            <button id="dr-config-submit" class="primary-btn">Start research</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.modalManager.registerModal('deep-research', 'config', modalTemplate);

        this.injectCSS(`
            #deep-research-config-modal .dr-config-group {
                margin-bottom: 16px;
            }
            #deep-research-config-modal .dr-config-group label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
                margin-bottom: 6px;
            }
            #deep-research-config-modal .dr-config-select {
                width: 100%;
                padding: 8px 10px;
                border-radius: var(--radius-sm, 4px);
                border: 1px solid var(--border, #d0d0d0);
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 13px;
            }
            #deep-research-config-modal .dr-config-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 500;
                cursor: pointer;
                margin-bottom: 4px;
            }
            #deep-research-config-modal .dr-config-checkbox input {
                margin: 0;
            }
            #deep-research-config-modal .dr-config-hint {
                display: block;
                font-size: 12px;
                color: var(--text-muted);
            }
            #deep-research-config-modal .dr-config-query {
                width: 100%;
                resize: vertical;
                min-height: 80px;
                font-family: inherit;
            }
        `, 'deep-research-config-styles');
    }

    /**
     * Scan for deep research nodes that failed but can be resumed and show Continue button.
     * Called on session load to ensure users can retry failed research.
     */
    showContinueButtonsForResumableNodes() {
        if (!this.graph) return;

        const nodes = this.graph.getAllNodes();
        for (const node of nodes) {
            // Only check deep research nodes
            if (node.type !== NodeType.DEEP_RESEARCH) continue;

            // Check if it's a failed node with a Google ID that can be resumed
            if (node.status === 'failed' && node.googleInteractionId) {
                console.log('[DeepResearch] Showing Continue button for resumable node:', node.id);
                this.canvas.showContinueButton(node.id);
            }
        }
    }

    /**
     * Check for completed deep research nodes that are missing their report content.
     * This can happen if the SSE connection was lost before content was received.
     * Automatically fetches the missing content from Google.
     */
    async fetchMissingCompletedReports() {
        if (!this.graph) return;

        const googleApiKey = storage.getGoogleApiKey();
        if (!googleApiKey) {
            console.log('[DeepResearch] No Google API key, skipping missing report fetch');
            return;
        }

        const nodes = this.graph.getAllNodes();
        for (const node of nodes) {
            // Only check deep research nodes
            if (node.type !== NodeType.DEEP_RESEARCH) continue;

            // Skip nodes still in the planning workflow — fetching the final
            // report would clobber the plan-review state.
            if (node.status === 'planning' || node.status === 'awaiting_plan_approval') {
                continue;
            }

            // Check if it's a completed node with a Google ID but missing/minimal content
            if (node.googleInteractionId && this.isContentMissing(node)) {
                console.log('[DeepResearch] Fetching missing content for node:', node.id);
                await this.fetchAndUpdateNodeContent(node.id, node.googleInteractionId, googleApiKey);
            }
        }
    }

    /**
     * Check if a node's content appears to be missing or incomplete.
     * @param {Object} node - The node to check
     * @returns {boolean} True if content seems missing
     */
    isContentMissing(node) {
        // No content at all
        if (!node.content) return true;

        // Content is just the header/status (no actual report)
        const content = node.content.trim();
        if (content.startsWith('**Deep Research:**') && content.length < 500) {
            // Short content that's likely just the query + status, not a full report
            return true;
        }

        // Content only contains error message
        if (content.includes('*Error:') && !content.includes('##')) {
            return true;
        }

        // Has status markers but no substantial content
        if ((content.includes('*Research in progress*') ||
             content.includes('*Connecting to research*') ||
             content.includes('*Initiating research*')) &&
            content.length < 500) {
            return true;
        }

        return false;
    }

    /**
     * Fetch content from Google and update the node.
     * @param {string} nodeId - Node ID to update
     * @param {string} googleId - Google interaction ID
     * @param {string} apiKey - Google API key
     */
    async fetchAndUpdateNodeContent(nodeId, googleId, apiKey) {
        try {
            const response = await fetch(apiUrl(`/api/deep-research/finalize/${googleId}?api_key=${encodeURIComponent(apiKey)}`));
            if (!response.ok) {
                console.warn('[DeepResearch] Failed to fetch content:', response.statusText);
                return;
            }

            const result = await response.json();

            if (result.status === 'completed' && result.content) {
                console.log('[DeepResearch] Retrieved missing content for node:', nodeId);

                // Update the node with the content
                this.graph.updateNode(nodeId, {
                    content: result.content,
                    sources: result.sources || [],
                    status: 'completed',
                });

                // Re-render the node
                this.canvas.renderNode(this.graph.getNode(nodeId));
                this.saveSession();

                this.showToast?.('Retrieved completed research report', 'success');
            } else if (result.status === 'in_progress') {
                console.log('[DeepResearch] Research still in progress for node:', nodeId);
                // Update status and show continue button
                this.graph.updateNode(nodeId, { status: 'in_progress' });
                this.canvas.renderNode(this.graph.getNode(nodeId));
                this.canvas.showContinueButton(nodeId);
            } else if (result.status === 'failed') {
                console.warn('[DeepResearch] Research failed:', result.error);
                this.graph.updateNode(nodeId, {
                    status: 'failed',
                    error: result.error
                });
                this.canvas.renderNode(this.graph.getNode(nodeId));
                this.canvas.showContinueButton(nodeId);
            }
        } catch (err) {
            console.error('[DeepResearch] Error fetching content:', err);
        }
    }

    /**
     * Handle continue request for a deep research node.
     * This is called when the user clicks Continue on any node.
     * We check if it's a failed deep research node with a Google ID and resume it.
     * @param {string} nodeId - The node ID
     */
    async handleContinueRequest(nodeId) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        // Only handle deep research nodes
        if (node.type !== NodeType.DEEP_RESEARCH) return;

        // Check if the streaming manager is already handling this node
        if (this.streamingManager.isStreaming(nodeId) || this.streamingManager.isStopped(nodeId)) {
            // Let the streaming manager handle it
            return;
        }

        // Check if this is a failed or in-progress node that can be resumed
        const googleId = node.googleInteractionId;
        if (!googleId) {
            console.log('[DeepResearch] No Google ID stored, cannot resume');
            return;
        }

        // Check if we have an API key
        const googleApiKey = storage.getGoogleApiKey();
        if (!googleApiKey) {
            this.showToast?.('Google API key required to resume. Add it in Settings.', 'error');
            return;
        }

        console.log('[DeepResearch] Attempting to resume node with Google ID:', googleId);
        this.showToast?.('Resuming deep research...', 'info');

        // Update node status
        this.graph.updateNode(nodeId, { status: 'in_progress' });
        this.canvas.renderNode(this.graph.getNode(nodeId));

        try {
            await this.resumeWithGoogleId(nodeId, googleId, googleApiKey);
        } catch (err) {
            console.warn('[DeepResearch] Resume stream failed, checking if completed:', err);
            // Try to fetch final results if streaming fails
            await this.checkAndFinalizeResearch(nodeId, googleId, googleApiKey);
        }
    }

    /**
     * Get slash commands metadata for autocomplete menu.
     * @returns {Array<{command: string, description: string, placeholder: string}>}
     */
    getSlashCommands() {
        return [
            {
                command: '/deep-research',
                description: 'Google Deep Research - comprehensive analysis with thinking',
                placeholder: 'What would you like to research?',
            },
        ];
    }

    /**
     * Handle the /deep-research command
     * @param {string} command - The slash command (e.g., '/deep-research')
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context (e.g., { text: selectedNodesContent })
     */
    async handleDeepResearch(command, args, contextObj) {
        const initialQuery = args.trim();
        const selectedContext = contextObj?.text || null;

        // Check for Google API key
        const googleApiKey = storage.getGoogleApiKey();
        if (!googleApiKey) {
            this.showToast?.('Google API key required for Deep Research. Add it in Settings.', 'error');
            return;
        }

        // Capture parent selection now — closing the modal must not change it.
        const parentIds = this.canvas.getSelectedNodeIds();
        const multimodalContent = this.extractMultimodalContent(parentIds);

        this.openConfigModal({
            initialQuery,
            onSubmit: async ({ model, collaborativePlanning, query }) => {
                if (!query) {
                    this.showToast?.('Enter a research query.', 'error');
                    return;
                }

                const initialContent = collaborativePlanning
                    ? `**Deep Research:** ${query}\n\n*Drafting plan...*`
                    : `**Deep Research:** ${query}\n\n*Starting research...*`;

                const deepResearchNode = createNode(NodeType.DEEP_RESEARCH, initialContent, {
                    position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
                    model: model === 'max' ? 'google-deep-research-max' : 'google-deep-research',
                    modelTier: model,
                    collaborativePlanning,
                    planTurns: [],
                    interactionId: null,
                    status: collaborativePlanning ? 'planning' : 'starting',
                    thinkingHistory: [],
                    sources: [],
                    startedAt: Date.now(),
                });

                this.graph.addNode(deepResearchNode);

                for (const parentId of parentIds) {
                    const edge = createEdge(parentId, deepResearchNode.id, EdgeType.REFERENCE);
                    this.graph.addEdge(edge);
                    const parentNode = this.graph.getNode(parentId);
                    this.canvas.renderEdge(edge, parentNode.position, deepResearchNode.position);
                }

                this.canvas.clearSelection();
                this.saveSession();
                this.updateEmptyState();

                await this.startResearch(
                    deepResearchNode.id,
                    query,
                    selectedContext,
                    multimodalContent,
                    googleApiKey,
                    null,
                    { model, collaborativePlanning },
                );
            },
        });
    }

    /**
     * Show the model + planning configuration modal.
     * @param {Object} opts
     * @param {string} opts.initialQuery - Prefill text for the query field.
     * @param {(values: {model: string, collaborativePlanning: boolean, query: string}) => Promise<void>} opts.onSubmit
     */
    openConfigModal({ initialQuery, onSubmit }) {
        const modal = this.modalManager.getPluginModal('deep-research', 'config');
        if (!modal) {
            console.error('[DeepResearch] Config modal not registered');
            return;
        }

        const modelEl = modal.querySelector('#dr-config-model');
        const planningEl = modal.querySelector('#dr-config-planning');
        const queryEl = modal.querySelector('#dr-config-query');
        const submitBtn = modal.querySelector('#dr-config-submit');
        const cancelBtn = modal.querySelector('#dr-config-cancel');
        const closeBtn = modal.querySelector('#dr-config-close');

        modelEl.value = 'standard';
        planningEl.checked = false;
        queryEl.value = initialQuery || '';

        const close = () => this.modalManager.hidePluginModal('deep-research', 'config');

        const cleanup = () => {
            submitBtn.removeEventListener('click', onSubmitClick);
            cancelBtn.removeEventListener('click', onCancelClick);
            closeBtn.removeEventListener('click', onCancelClick);
        };

        const onSubmitClick = async () => {
            const values = {
                model: modelEl.value === 'max' ? 'max' : 'standard',
                collaborativePlanning: !!planningEl.checked,
                query: queryEl.value.trim(),
            };
            cleanup();
            close();
            try {
                await onSubmit(values);
            } catch (err) {
                console.error('[DeepResearch] config submit failed:', err);
            }
        };

        const onCancelClick = () => {
            cleanup();
            close();
        };

        submitBtn.addEventListener('click', onSubmitClick);
        cancelBtn.addEventListener('click', onCancelClick);
        closeBtn.addEventListener('click', onCancelClick);

        this.modalManager.showPluginModal('deep-research', 'config');
        // Focus the query field for keyboard-first use
        setTimeout(() => queryEl?.focus(), 50);
    }

    /**
     * Start or resume a deep research task
     * @param {string} nodeId - Node ID to update
     * @param {string} query - Research query
     * @param {string|null} context - Text context
     * @param {Object} multimodalContent - Images and other multimodal content
     * @param {string} apiKey - Google API key
     * @param {string|null} existingInteractionId - Existing interaction ID for resume
     * @param options
     */
    async startResearch(nodeId, query, context, multimodalContent, apiKey, existingInteractionId = null, options = {}) {
        const node = this.graph.getNode(nodeId);
        if (!node) {
            console.error('[DeepResearch] Node not found:', nodeId);
            return;
        }

        const modelTier = options.model || node.modelTier || 'standard';
        const collaborativePlanning = options.collaborativePlanning ?? node.collaborativePlanning ?? false;

        // Create abort controller for stop button support
        const abortController = new AbortController();

        // Register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'deep-research',
            context: {
                type: 'deep-research',
                query,
                textContext: context,
                multimodalContent,
                apiKey,
                modelTier,
                collaborativePlanning,
            },
            onContinue: async (nodeId, state, _newAbortController) => {
                // Continue research from where it left off
                const existingNode = this.graph.getNode(nodeId);
                await this.startResearch(
                    nodeId,
                    state.context.query,
                    state.context.textContext,
                    state.context.multimodalContent,
                    state.context.apiKey,
                    existingNode?.interactionId,
                    {
                        model: state.context.modelTier,
                        collaborativePlanning: state.context.collaborativePlanning,
                    },
                );
            },
        });

        try {
            let interactionId = existingInteractionId;

            // Start new research if no existing interaction
            if (!interactionId) {
                const initStatus = collaborativePlanning
                    ? 'Initiating planning task...'
                    : 'Initiating research task...';
                this.canvas.updateNodeContent(nodeId, `**Deep Research:** ${query}\n\n*${initStatus}*`, true);

                // Call start endpoint
                const startHeaders = { 'Content-Type': 'application/json' };
                const idToken = await authManager.getIdToken();
                if (idToken) startHeaders['Authorization'] = `Bearer ${idToken}`;

                const startResponse = await fetch(apiUrl('/api/deep-research/start'), {
                    method: 'POST',
                    headers: startHeaders,
                    body: JSON.stringify({
                        query,
                        context: context || null,
                        images: multimodalContent?.images || null,
                        api_key: apiKey,
                        model: modelTier,
                        collaborative_planning: collaborativePlanning,
                    }),
                    signal: abortController.signal,
                });

                if (!startResponse.ok) {
                    throw new Error(`Failed to start research: ${startResponse.statusText}`);
                }

                const startData = await startResponse.json();
                interactionId = startData.interaction_id;

                // Store task ID in node metadata for resume
                this.graph.updateNode(nodeId, {
                    taskId: interactionId,
                    status: collaborativePlanning ? 'planning' : 'in_progress',
                });

                // Store in localStorage for browser resume (Google ID added later when we get it)
                this.saveResumableState(nodeId, interactionId, null);
            }

            this.canvas.updateNodeContent(nodeId, `**Deep Research:** ${query}\n\n*Connecting to research stream...*`, true);

            // Connect to SSE stream (with auth header for artifact saving)
            const streamHeaders = {};
            const streamToken = await authManager.getIdToken();
            if (streamToken) streamHeaders['Authorization'] = `Bearer ${streamToken}`;

            const streamResponse = await fetch(apiUrl(`/api/deep-research/stream/${interactionId}`), {
                method: 'GET',
                headers: streamHeaders,
                signal: abortController.signal,
            });

            if (!streamResponse.ok) {
                throw new Error(`Failed to connect to research stream: ${streamResponse.statusText}`);
            }

            // Process SSE stream
            let reportContent = `**Deep Research:** ${query}\n\n`;
            let thinkingHistory = [];
            let sources = [];
            let lastStatus = '';
            let googleInteractionId = null;

            // Planning-turn state. `planChunkBuffer` accumulates the live plan
            // text; on `plan_done` we finalize the turn and stop without
            // entering the completion path.
            const existingTurns = (this.graph.getNode(nodeId)?.planTurns || []).slice();
            let planTurns = existingTurns;
            let planChunkBuffer = '';
            let planTurnPending = false;
            let planCompleted = false;

            const updateLivePlanTurn = () => {
                const turns = planTurns.slice();
                if (planTurnPending) {
                    turns[turns.length - 1] = {
                        role: 'agent',
                        text: planChunkBuffer,
                        pending: true,
                    };
                } else {
                    turns.push({
                        role: 'agent',
                        text: planChunkBuffer,
                        pending: true,
                    });
                    planTurnPending = true;
                }
                planTurns = turns;
                this.graph.updateNode(nodeId, {
                    planTurns,
                    status: 'planning',
                });
                this.canvas.renderNode(this.graph.getNode(nodeId));
            };

            await readSSEStream(streamResponse, {
                onEvent: (eventType, data) => {
                    if (eventType === 'status') {
                        lastStatus = data.trim();
                        const statusContent = `${reportContent}*${lastStatus}*`;
                        this.canvas.updateNodeContent(nodeId, statusContent, true);
                    } else if (eventType === 'interaction_id') {
                        // Capture the Google interaction ID for resume support
                        googleInteractionId = data.trim();
                        this.graph.updateNode(nodeId, { googleInteractionId });
                        // Update localStorage with Google ID for browser resume
                        this.saveResumableState(nodeId, interactionId, googleInteractionId);
                        console.log('[DeepResearch] Got Google interaction ID:', googleInteractionId);
                    } else if (eventType === 'thinking') {
                        // Add thinking summary to history
                        thinkingHistory.push({
                            timestamp: Date.now(),
                            summary: data,
                        });
                        // Update node metadata
                        this.graph.updateNode(nodeId, { thinkingHistory });
                        // Re-render node to show thinking
                        this.canvas.renderNode(this.graph.getNode(nodeId));
                    } else if (eventType === 'plan_chunk') {
                        planChunkBuffer += data;
                        updateLivePlanTurn();
                    } else if (eventType === 'plan_done') {
                        const finalText = (data && data.length > 0) ? data : planChunkBuffer;
                        const turns = planTurns.slice();
                        if (planTurnPending) {
                            turns[turns.length - 1] = {
                                role: 'agent',
                                text: finalText,
                                pending: false,
                                interactionId: googleInteractionId,
                            };
                        } else {
                            turns.push({
                                role: 'agent',
                                text: finalText,
                                pending: false,
                                interactionId: googleInteractionId,
                            });
                        }
                        planTurns = turns;
                        planTurnPending = false;
                        planCompleted = true;
                        this.graph.updateNode(nodeId, {
                            planTurns,
                            status: 'awaiting_plan_approval',
                        });
                        this.canvas.renderNode(this.graph.getNode(nodeId));
                    } else if (eventType === 'content') {
                        // Append content chunk
                        reportContent += data;
                        this.canvas.updateNodeContent(nodeId, reportContent, true);
                        this.graph.updateNode(nodeId, { content: reportContent });
                    } else if (eventType === 'sources') {
                        try {
                            sources = JSON.parse(data);
                            this.graph.updateNode(nodeId, { sources });
                        } catch (e) {
                            console.error('[DeepResearch] Failed to parse sources:', e);
                        }
                    }
                },
                onDone: async () => {
                    // Clean up streaming state
                    this.streamingManager.unregister(nodeId);

                    // If a plan_done arrived alongside actual report content or
                    // sources, the model ran end-to-end instead of pausing for
                    // a plan. Promote the captured text into node.content and
                    // fall through to the normal completion path.
                    const reportPrefixLen = `**Deep Research:** ${query}\n\n`.length;
                    const gotReportContent = reportContent.length > reportPrefixLen;
                    if (planCompleted && (sources.length > 0 || gotReportContent)) {
                        const latestPlanText = planTurns?.length
                            ? planTurns[planTurns.length - 1]?.text
                            : '';
                        if (!gotReportContent && latestPlanText) {
                            reportContent = `**Deep Research:** ${query}\n\n${latestPlanText}`;
                        }
                        planCompleted = false;
                        this.graph.updateNode(nodeId, {
                            planTurns: [],
                            status: 'in_progress',
                            content: reportContent,
                        });
                    } else if (planCompleted) {
                        // Real plan-pause — leave node in awaiting_plan_approval
                        // for the user to revise/approve.
                        this.saveSession();
                        return;
                    }

                    // Check if we actually received substantial content
                    const currentNode = this.graph.getNode(nodeId);
                    const googleId = googleInteractionId || currentNode?.googleInteractionId;
                    const hasSubstantialContent = reportContent.length > 500 && reportContent.includes('##');

                    if (!hasSubstantialContent && googleId) {
                        // Content seems incomplete, try to fetch it from Google
                        console.log('[DeepResearch] Content seems incomplete, fetching from Google...');
                        try {
                            await this.fetchAndUpdateNodeContent(nodeId, googleId, apiKey);
                            this.clearResumableState(nodeId);
                            return;
                        } catch (err) {
                            console.warn('[DeepResearch] Failed to fetch missing content:', err);
                            // Continue with what we have
                        }
                    }

                    this.clearResumableState(nodeId);

                    // Update node status
                    this.graph.updateNode(nodeId, {
                        status: 'completed',
                        completedAt: Date.now(),
                    });

                    // Add sources section if available
                    if (sources.length > 0) {
                        reportContent += '\n\n---\n**Sources:**\n';
                        for (const source of sources) {
                            reportContent += `- [${source.title}](${source.url})\n`;
                        }
                    }

                    this.canvas.updateNodeContent(nodeId, reportContent, false);
                    this.graph.updateNode(nodeId, { content: reportContent });

                    // Generate summary async
                    this.generateNodeSummary?.(nodeId);
                },
                onError: (err) => {
                    // Clean up streaming state on error
                    this.streamingManager.unregister(nodeId);

                    // Re-throw if not an abort error
                    if (err.name !== 'AbortError') {
                        throw err;
                    }
                },
            });

            this.saveSession();

        } catch (err) {
            // Clean up streaming state
            this.streamingManager.unregister(nodeId);

            // Check if it was aborted (user clicked stop)
            if (err.name === 'AbortError') {
                this.saveSession();
                return;
            }

            // Check if we have a Google ID for potential resume
            const currentNode = this.graph.getNode(nodeId);
            const hasGoogleId = currentNode?.googleInteractionId;

            // Other errors
            const errorContent = hasGoogleId
                ? `**Deep Research:** ${query}\n\n*Error: ${err.message}*\n\n*Click Continue to retry.*`
                : `**Deep Research:** ${query}\n\n*Error: ${err.message}*`;
            this.canvas.updateNodeContent(nodeId, errorContent, false);
            this.graph.updateNode(nodeId, {
                content: errorContent,
                status: 'failed',
                error: err.message,
            });

            // If we have a Google ID, show Continue button for resume
            if (hasGoogleId) {
                this.canvas.showContinueButton(nodeId);
                // Keep resumable state for browser refresh resume
            } else {
                this.clearResumableState(nodeId);
            }
            this.saveSession();
        }
    }

    /**
     * Recover a research report whose text the model produced during what was
     * supposed to be a planning turn. Promotes the latest agent plan turn's
     * text into the node's report content and clears the plan-review state.
     * @param {string} nodeId
     */
    async promotePlanToReport(nodeId) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        const turns = Array.isArray(node.planTurns) ? node.planTurns : [];
        let latestAgentText = '';
        for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i]?.role === 'agent' && turns[i]?.text) {
                latestAgentText = turns[i].text;
                break;
            }
        }

        if (!latestAgentText) {
            this.showToast?.('No captured text to promote.', 'error');
            return;
        }

        const queryLine = node.content?.split('\n')[0] || `**Deep Research:** ${node.query || ''}`;
        const reportContent = `${queryLine}\n\n${latestAgentText}`;

        this.graph.updateNode(nodeId, {
            content: reportContent,
            status: 'completed',
            planTurns: [],
            completedAt: Date.now(),
        });
        this.canvas.updateNodeContent(nodeId, reportContent, false);
        this.canvas.renderNode(this.graph.getNode(nodeId));
        this.clearResumableState(nodeId);
        this.generateNodeSummary?.(nodeId);
        this.saveSession?.();
    }

    /**
     * Submit a plan revision or approval for a deep research node.
     * Posts to /api/deep-research/revise then re-opens /stream to either
     * iterate on the plan or kick off the actual research.
     * @param {string} nodeId
     * @param {string} feedback
     * @param {boolean} approve
     */
    async submitPlanRevision(nodeId, feedback, approve) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        const taskId = node.taskId;
        if (!taskId) {
            this.showToast?.('No active research task to revise.', 'error');
            return;
        }

        const apiKey = storage.getGoogleApiKey();
        if (!apiKey) {
            this.showToast?.('Google API key required. Add it in Settings.', 'error');
            return;
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            const idToken = await authManager.getIdToken();
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

            const reviseResponse = await fetch(apiUrl(`/api/deep-research/revise/${taskId}`), {
                method: 'POST',
                headers,
                body: JSON.stringify({ feedback, approve }),
            });

            if (!reviseResponse.ok) {
                const detail = await reviseResponse.text().catch(() => '');
                throw new Error(`Failed to revise plan: ${reviseResponse.statusText} ${detail}`);
            }

            // Append the user's turn to the visible plan history.
            if (feedback) {
                const turns = (node.planTurns || []).slice();
                turns.push({ role: 'user', text: feedback, approve });
                this.graph.updateNode(nodeId, {
                    planTurns: turns,
                    status: approve ? 'in_progress' : 'planning',
                });
            } else {
                this.graph.updateNode(nodeId, {
                    status: approve ? 'in_progress' : 'planning',
                });
            }
            this.canvas.renderNode(this.graph.getNode(nodeId));

            // Re-open the stream — backend will pick up pending_revision and
            // either iterate on the plan or run the actual research.
            const refreshed = this.graph.getNode(nodeId);
            await this.startResearch(
                nodeId,
                node.content?.split('\n')[0]?.replace('**Deep Research:**', '').trim() || '',
                null,
                null,
                apiKey,
                taskId,
                {
                    model: refreshed?.modelTier || 'standard',
                    collaborativePlanning: refreshed?.collaborativePlanning ?? !approve,
                },
            );
        } catch (err) {
            console.error('[DeepResearch] Plan revision failed:', err);
            this.showToast?.(err.message || 'Plan revision failed', 'error');
        }
    }

    /**
     * Extract multimodal content (images, PDFs) from selected nodes
     * @param {string[]} nodeIds - Array of selected node IDs
     * @returns {Object} Object with images array and other content
     */
    extractMultimodalContent(nodeIds) {
        const result = {
            images: [],
            pdfContent: [],
        };

        for (const nodeId of nodeIds) {
            const node = this.graph.getNode(nodeId);
            if (!node) continue;

            // Check for image nodes
            if (node.type === NodeType.IMAGE && node.imageData) {
                result.images.push(node.imageData);
            }

            // Check for image content in other nodes (inline images)
            if (node.content && node.content.includes('data:image/')) {
                // Extract base64 images from content
                const imageMatches = node.content.match(/data:image\/[^;]+;base64,[^")\s]+/g);
                if (imageMatches) {
                    result.images.push(...imageMatches);
                }
            }

            // Check for PDF content
            if (node.type === NodeType.PDF && node.content) {
                result.pdfContent.push(node.content);
            }
        }

        return result;
    }

    /**
     * Check for resumable research tasks on session load
     */
    async checkForResumableResearch() {
        try {
            const resumableData = localStorage.getItem(RESUMABLE_RESEARCH_KEY);
            if (!resumableData) return;

            const resumable = JSON.parse(resumableData);
            const now = Date.now();

            // Check each resumable task
            for (const [nodeId, data] of Object.entries(resumable)) {
                // Skip tasks older than 1 hour
                if (now - data.savedAt > 3600000) {
                    delete resumable[nodeId];
                    continue;
                }

                // Check if node still exists and is not completed
                const node = this.graph?.getNode(nodeId);
                if (!node || node.status === 'completed') {
                    delete resumable[nodeId];
                    continue;
                }

                // Awaiting plan approval — node state is already rendered from
                // planTurns; the user drives progression via Revise/Approve.
                // Don't auto-resume any stream.
                if (node.status === 'awaiting_plan_approval') {
                    continue;
                }

                // Get Google API key
                const googleApiKey = storage.getGoogleApiKey();
                if (!googleApiKey) {
                    console.warn('[DeepResearch] No Google API key, cannot resume');
                    continue;
                }

                // Mid-planning: re-open /stream so the in-flight plan keeps
                // streaming into the node. /resume/{googleId} is for completed
                // research, not planning, so we use the task-id stream path.
                if (node.status === 'planning' && data.taskId) {
                    try {
                        await this.resumeResearchStream(nodeId, data.taskId);
                    } catch (err) {
                        console.warn('[DeepResearch] Planning resume failed:', err);
                    }
                    continue;
                }

                // Try to resume using Google interaction ID if available
                const googleId = data.googleInteractionId || node.googleInteractionId;

                if (googleId) {
                    console.log('[DeepResearch] Attempting to resume with Google ID:', googleId);
                    this.showToast?.('Resuming deep research...', 'info');

                    try {
                        // Create a new task on backend with the Google interaction ID for resume
                        await this.resumeWithGoogleId(nodeId, googleId, googleApiKey);
                    } catch (err) {
                        console.warn('[DeepResearch] Failed to resume with Google ID:', err);
                        // Try checking if it completed
                        await this.checkAndFinalizeResearch(nodeId, googleId, googleApiKey);
                    }
                } else {
                    // No Google ID - check backend task status
                    try {
                        const statusResponse = await fetch(apiUrl(`/api/deep-research/status/${data.taskId}`));
                        const status = await statusResponse.json();

                        if (status.status === 'in_progress' || status.status === 'pending') {
                            console.log('[DeepResearch] Resuming via backend task:', data.taskId);
                            this.showToast?.('Resuming deep research task...', 'info');

                            // Resume the research stream
                            await this.resumeResearchStream(nodeId, data.taskId);
                        } else if (status.status === 'completed') {
                            this.graph.updateNode(nodeId, { status: 'completed' });
                            delete resumable[nodeId];
                        } else if (status.status === 'failed') {
                            this.graph.updateNode(nodeId, {
                                status: 'failed',
                                error: status.error,
                            });
                            delete resumable[nodeId];
                        } else {
                            // Not found on backend - clean up
                            delete resumable[nodeId];
                        }
                    } catch (err) {
                        console.warn('[DeepResearch] Failed to check status:', err);
                        delete resumable[nodeId];
                    }
                }
            }

            // Update localStorage
            if (Object.keys(resumable).length > 0) {
                localStorage.setItem(RESUMABLE_RESEARCH_KEY, JSON.stringify(resumable));
            } else {
                localStorage.removeItem(RESUMABLE_RESEARCH_KEY);
            }
        } catch (err) {
            console.error('[DeepResearch] Error checking for resumable research:', err);
        }
    }

    /**
     * Resume research using a Google interaction ID (after server restart)
     * Creates a new backend task configured to resume the Google interaction
     * @param {string} nodeId - Node ID
     * @param {string} googleId - Google interaction ID
     * @param {string} apiKey - Google API key
     */
    async resumeWithGoogleId(nodeId, googleId, apiKey) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        // Create abort controller
        const abortController = new AbortController();

        // Register with StreamingManager
        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'deep-research',
            context: { type: 'deep-research-resume', googleId },
        });

        try {
            // Call resume endpoint with Google ID
            const streamResponse = await fetch(apiUrl(`/api/deep-research/resume/${googleId}?api_key=${encodeURIComponent(apiKey)}`), {
                method: 'GET',
                signal: abortController.signal,
            });

            if (!streamResponse.ok) {
                throw new Error(`Failed to resume: ${streamResponse.statusText}`);
            }

            // Process the stream
            let reportContent = node.content || `**Deep Research:** (resumed)\n\n`;

            await readSSEStream(streamResponse, {
                onEvent: (eventType, data) => {
                    if (eventType === 'content') {
                        reportContent += data;
                        this.canvas.updateNodeContent(nodeId, reportContent, true);
                        this.graph.updateNode(nodeId, { content: reportContent });
                    } else if (eventType === 'thinking') {
                        const thinkingHistory = node.thinkingHistory || [];
                        thinkingHistory.push({ timestamp: Date.now(), summary: data });
                        this.graph.updateNode(nodeId, { thinkingHistory });
                        this.canvas.renderNode(this.graph.getNode(nodeId));
                    } else if (eventType === 'sources') {
                        try {
                            const sources = JSON.parse(data);
                            this.graph.updateNode(nodeId, { sources });
                        } catch (e) {
                            console.error('[DeepResearch] Failed to parse sources:', e);
                        }
                    }
                },
                onDone: () => {
                    this.streamingManager.unregister(nodeId);
                    this.clearResumableState(nodeId);
                    this.graph.updateNode(nodeId, { status: 'completed', completedAt: Date.now() });
                    this.canvas.updateNodeContent(nodeId, reportContent, false);
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
            if (err.name !== 'AbortError') {
                console.error('[DeepResearch] Resume failed:', err);
            }
            throw err;
        }
    }

    /**
     * Check if research completed and fetch final results
     * @param {string} nodeId - Node ID
     * @param {string} googleId - Google interaction ID
     * @param {string} apiKey - Google API key
     */
    async checkAndFinalizeResearch(nodeId, googleId, apiKey) {
        try {
            const response = await fetch(apiUrl(`/api/deep-research/finalize/${googleId}?api_key=${encodeURIComponent(apiKey)}`));
            if (!response.ok) {
                throw new Error('Failed to finalize research');
            }

            const result = await response.json();

            if (result.status === 'completed') {
                const node = this.graph.getNode(nodeId);
                let content = node?.content || '';

                if (result.content && !content.includes(result.content)) {
                    content = result.content;
                }

                this.graph.updateNode(nodeId, {
                    content,
                    status: 'completed',
                    sources: result.sources || [],
                    completedAt: Date.now(),
                });
                this.canvas.updateNodeContent(nodeId, content, false);
                this.clearResumableState(nodeId);
                this.saveSession();
            } else if (result.status === 'failed') {
                this.graph.updateNode(nodeId, {
                    status: 'failed',
                    error: result.error,
                });
                this.clearResumableState(nodeId);
            }
            // If still in progress, leave it for next check
        } catch (err) {
            console.warn('[DeepResearch] Failed to finalize:', err);
        }
    }

    /**
     * Resume research stream using backend task ID
     * @param {string} nodeId - Node ID
     * @param {string} taskId - Backend task ID
     */
    async resumeResearchStream(nodeId, taskId) {
        const node = this.graph.getNode(nodeId);
        if (!node) return;

        // Extract query from node content
        const query = node.content?.replace('**Deep Research:** ', '').split('\n')[0] || '';

        const abortController = new AbortController();

        this.streamingManager.register(nodeId, {
            abortController,
            featureId: 'deep-research',
            context: { type: 'deep-research-resume', taskId },
        });

        try {
            const resumeHeaders = {};
            const resumeToken = await authManager.getIdToken();
            if (resumeToken) resumeHeaders['Authorization'] = `Bearer ${resumeToken}`;

            const streamResponse = await fetch(apiUrl(`/api/deep-research/stream/${taskId}`), {
                method: 'GET',
                headers: resumeHeaders,
                signal: abortController.signal,
            });

            if (!streamResponse.ok) {
                throw new Error(`Failed to connect: ${streamResponse.statusText}`);
            }

            let reportContent = node.content || `**Deep Research:** ${query}\n\n`;
            let planChunkBuffer = '';
            let planTurns = (node.planTurns || []).slice();
            let planTurnPending = false;
            let planCompleted = false;

            const updateLivePlanTurn = () => {
                const turns = planTurns.slice();
                if (planTurnPending) {
                    turns[turns.length - 1] = {
                        role: 'agent',
                        text: planChunkBuffer,
                        pending: true,
                    };
                } else {
                    turns.push({ role: 'agent', text: planChunkBuffer, pending: true });
                    planTurnPending = true;
                }
                planTurns = turns;
                this.graph.updateNode(nodeId, { planTurns, status: 'planning' });
                this.canvas.renderNode(this.graph.getNode(nodeId));
            };

            await readSSEStream(streamResponse, {
                onEvent: (eventType, data) => {
                    if (eventType === 'content') {
                        reportContent += data;
                        this.canvas.updateNodeContent(nodeId, reportContent, true);
                        this.graph.updateNode(nodeId, { content: reportContent });
                    } else if (eventType === 'interaction_id') {
                        this.graph.updateNode(nodeId, { googleInteractionId: data.trim() });
                        this.saveResumableState(nodeId, taskId, data.trim());
                    } else if (eventType === 'thinking') {
                        const thinkingHistory = node.thinkingHistory || [];
                        thinkingHistory.push({ timestamp: Date.now(), summary: data });
                        this.graph.updateNode(nodeId, { thinkingHistory });
                        this.canvas.renderNode(this.graph.getNode(nodeId));
                    } else if (eventType === 'plan_chunk') {
                        planChunkBuffer += data;
                        updateLivePlanTurn();
                    } else if (eventType === 'plan_done') {
                        const finalText = (data && data.length > 0) ? data : planChunkBuffer;
                        const turns = planTurns.slice();
                        const refreshed = this.graph.getNode(nodeId);
                        const interactionId = refreshed?.googleInteractionId || null;
                        if (planTurnPending) {
                            turns[turns.length - 1] = {
                                role: 'agent',
                                text: finalText,
                                pending: false,
                                interactionId,
                            };
                        } else {
                            turns.push({
                                role: 'agent',
                                text: finalText,
                                pending: false,
                                interactionId,
                            });
                        }
                        planTurns = turns;
                        planTurnPending = false;
                        planCompleted = true;
                        this.graph.updateNode(nodeId, {
                            planTurns,
                            status: 'awaiting_plan_approval',
                        });
                        this.canvas.renderNode(this.graph.getNode(nodeId));
                    } else if (eventType === 'sources') {
                        try {
                            const sources = JSON.parse(data);
                            this.graph.updateNode(nodeId, { sources });
                        } catch (e) {
                            console.error('[DeepResearch] Failed to parse sources:', e);
                        }
                    }
                },
                onDone: () => {
                    this.streamingManager.unregister(nodeId);
                    // If plan_done arrived alongside actual content (model
                    // ran end-to-end despite collaborative_planning), promote
                    // the captured text into the report and fall through to
                    // the completion path.
                    const refreshedNode = this.graph.getNode(nodeId);
                    const sourcesAvail = (refreshedNode?.sources || []).length > 0;
                    const queryPrefixLen = `**Deep Research:** ${query}\n\n`.length;
                    const gotReportContent = reportContent.length > queryPrefixLen;
                    if (planCompleted && (sourcesAvail || gotReportContent)) {
                        const latestPlanText = planTurns?.length
                            ? planTurns[planTurns.length - 1]?.text
                            : '';
                        if (!gotReportContent && latestPlanText) {
                            reportContent = `**Deep Research:** ${query}\n\n${latestPlanText}`;
                        }
                        planCompleted = false;
                        this.graph.updateNode(nodeId, { planTurns: [], content: reportContent });
                    } else if (planCompleted) {
                        // Awaiting user revision/approval — keep resumable
                        // state so a refresh re-renders the node correctly.
                        this.saveSession();
                        return;
                    }
                    this.clearResumableState(nodeId);
                    this.graph.updateNode(nodeId, { status: 'completed', completedAt: Date.now() });
                    this.canvas.updateNodeContent(nodeId, reportContent, false);
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
            if (err.name !== 'AbortError') {
                throw err;
            }
        }
    }

    /**
     * Save resumable state to localStorage
     * @param {string} nodeId - Node ID
     * @param {string} taskId - Local task ID
     * @param {string} googleInteractionId - Google's interaction ID (for direct resume)
     */
    saveResumableState(nodeId, taskId, googleInteractionId = null) {
        try {
            const resumable = JSON.parse(localStorage.getItem(RESUMABLE_RESEARCH_KEY) || '{}');
            resumable[nodeId] = {
                taskId,
                googleInteractionId, // Store Google ID for direct resume after server restart
                savedAt: Date.now(),
            };
            localStorage.setItem(RESUMABLE_RESEARCH_KEY, JSON.stringify(resumable));
        } catch (err) {
            console.warn('[DeepResearch] Failed to save resumable state:', err);
        }
    }

    /**
     * Clear resumable state from localStorage
     * @param {string} nodeId - Node ID
     */
    clearResumableState(nodeId) {
        try {
            const resumable = JSON.parse(localStorage.getItem(RESUMABLE_RESEARCH_KEY) || '{}');
            delete resumable[nodeId];
            if (Object.keys(resumable).length > 0) {
                localStorage.setItem(RESUMABLE_RESEARCH_KEY, JSON.stringify(resumable));
            } else {
                localStorage.removeItem(RESUMABLE_RESEARCH_KEY);
            }
        } catch (err) {
            console.warn('[DeepResearch] Failed to clear resumable state:', err);
        }
    }
}

export { DeepResearchFeature };
