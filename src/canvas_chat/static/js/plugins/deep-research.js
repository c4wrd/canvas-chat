/**
 * Deep Research Feature Module
 *
 * Handles the /deep-research command using Google's Deep Research agent.
 * Supports browser-resumable background tasks, streaming thinking summaries,
 * and multimodal context (images/PDFs from selected nodes).
 *
 * Extends FeaturePlugin to integrate with the plugin architecture.
 */

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
        const query = args.trim();
        const selectedContext = contextObj?.text || null;

        console.log('[DeepResearch] Starting with:', { command, query, selectedContext });

        // Check for Google API key
        const googleApiKey = storage.getGoogleApiKey();
        if (!googleApiKey) {
            this.showToast?.('Google API key required for Deep Research. Add it in Settings.', 'error');
            return;
        }

        // Get selected nodes for positioning and multimodal context
        const parentIds = this.canvas.getSelectedNodeIds();

        // Extract multimodal content from selected nodes
        const multimodalContent = this.extractMultimodalContent(parentIds);

        // Create deep research node
        const deepResearchNode = createNode(NodeType.DEEP_RESEARCH, `**Deep Research:** ${query}\n\n*Starting research...*`, {
            position: this.graph.autoPosition(parentIds.length > 0 ? parentIds : []),
            model: 'google-deep-research',
            // Store metadata for resume support
            interactionId: null, // Will be set after API call
            status: 'starting',
            thinkingHistory: [],
            sources: [],
            startedAt: Date.now(),
        });

        this.graph.addNode(deepResearchNode);

        // Create edges from parents only if they exist
        for (const parentId of parentIds) {
            const edge = createEdge(parentId, deepResearchNode.id, EdgeType.REFERENCE);
            this.graph.addEdge(edge);
            const parentNode = this.graph.getNode(parentId);
            this.canvas.renderEdge(edge, parentNode.position, deepResearchNode.position);
        }

        this.canvas.clearSelection();
        this.saveSession();
        this.updateEmptyState();

        // Start the research
        await this.startResearch(deepResearchNode.id, query, selectedContext, multimodalContent, googleApiKey);
    }

    /**
     * Start or resume a deep research task
     * @param {string} nodeId - Node ID to update
     * @param {string} query - Research query
     * @param {string|null} context - Text context
     * @param {Object} multimodalContent - Images and other multimodal content
     * @param {string} apiKey - Google API key
     * @param {string|null} existingInteractionId - Existing interaction ID for resume
     */
    async startResearch(nodeId, query, context, multimodalContent, apiKey, existingInteractionId = null) {
        const node = this.graph.getNode(nodeId);
        if (!node) {
            console.error('[DeepResearch] Node not found:', nodeId);
            return;
        }

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
                    existingNode?.interactionId
                );
            },
        });

        try {
            let interactionId = existingInteractionId;

            // Start new research if no existing interaction
            if (!interactionId) {
                this.canvas.updateNodeContent(nodeId, `**Deep Research:** ${query}\n\n*Initiating research task...*`, true);

                // Call start endpoint
                const startResponse = await fetch(apiUrl('/api/deep-research/start'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query,
                        context: context || null,
                        images: multimodalContent?.images || null,
                        api_key: apiKey,
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
                    status: 'in_progress',
                });

                // Store in localStorage for browser resume (Google ID added later when we get it)
                this.saveResumableState(nodeId, interactionId, null);
            }

            this.canvas.updateNodeContent(nodeId, `**Deep Research:** ${query}\n\n*Connecting to research stream...*`, true);

            // Connect to SSE stream
            const streamResponse = await fetch(apiUrl(`/api/deep-research/stream/${interactionId}`), {
                method: 'GET',
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

                // Get Google API key
                const googleApiKey = storage.getGoogleApiKey();
                if (!googleApiKey) {
                    console.warn('[DeepResearch] No Google API key, cannot resume');
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
            const streamResponse = await fetch(apiUrl(`/api/deep-research/stream/${taskId}`), {
                method: 'GET',
                signal: abortController.signal,
            });

            if (!streamResponse.ok) {
                throw new Error(`Failed to connect: ${streamResponse.statusText}`);
            }

            let reportContent = node.content || `**Deep Research:** ${query}\n\n`;

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
