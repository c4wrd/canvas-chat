/**
 * Perplexity Feature Plugin
 *
 * Provides slash commands for Perplexity AI integration:
 * - /perplexity <question> - Quick Q&A using sonar model
 * - /perplexity-pro <question> - Deep research using sonar-pro model
 * - /perplexity-search <query> - Direct web search
 *
 * Features:
 * - SSE streaming for real-time responses
 * - Citation rendering with clickable badges
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
    }

    /**
     * Get slash commands metadata for autocomplete menu.
     * @returns {Array<{command: string, description: string, placeholder: string}>}
     */
    getSlashCommands() {
        return [
            {
                command: '/perplexity',
                description: 'Perplexity AI - web-grounded Q&A with citations',
                placeholder: 'Ask a question...',
            },
            {
                command: '/perplexity-pro',
                description: 'Perplexity Pro Search - deep research with more sources',
                placeholder: 'Research topic or question...',
            },
            {
                command: '/perplexity-search',
                description: 'Perplexity Search - find relevant web pages',
                placeholder: 'Search query...',
            },
        ];
    }

    /**
     * Handle the /perplexity command (quick Q&A with sonar model)
     * @param {string} command - The slash command
     * @param {string} args - Text after the command
     * @param {Object} contextObj - Additional context
     */
    async handlePerplexity(command, args, contextObj) {
        await this.executePerplexityChat(args.trim(), 'sonar', contextObj);
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
}

export { PerplexityFeature };
