/**
 * Model browser modal for choosing the active chat model.
 */

import { storage } from './storage.js';
import { escapeHtmlText } from './utils.js';

/**
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} name
 * @property {string} provider
 * @property {number} [context_window]
 * @property {boolean} [supports_reasoning]
 * @property {boolean} [supports_vision]
 */

/**
 * @param {number|undefined} tokens
 * @returns {string}
 */
export function formatContextWindow(tokens) {
    if (!tokens) return '128k';
    if (tokens >= 1000000) {
        const value = tokens / 1000000;
        return `${Number.isInteger(value) ? value : value.toFixed(1)}M`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
}

/**
 * @param {ModelInfo[]} models
 * @returns {Array<{provider: string, count: number}>}
 */
export function getProviderCounts(models) {
    const counts = new Map();
    for (const model of models) {
        const provider = model.provider || model.id.split('/')[0] || 'Unknown';
        counts.set(provider, (counts.get(provider) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * @param {ModelInfo[]} models
 * @param {string} query
 * @param {string} provider
 * @returns {ModelInfo[]}
 */
export function filterModels(models, query = '', provider = 'all') {
    const normalizedQuery = query.trim().toLowerCase();
    return models.filter((model) => {
        const modelProvider = model.provider || model.id.split('/')[0] || 'Unknown';
        const matchesProvider = provider === 'all' || modelProvider === provider;
        if (!matchesProvider) return false;
        if (!normalizedQuery) return true;

        return [model.name, model.id, modelProvider].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
}

/**
 * @param {ModelInfo[]} models
 * @param {string[]} recentIds
 * @returns {ModelInfo[]}
 */
export function getRecentAvailableModels(models, recentIds) {
    const byId = new Map(models.map((model) => [model.id, model]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean);
}

/**
 *
 */
export class ModelBrowser {
    /**
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.modal = document.getElementById('model-selector-modal');
        this.searchInput = /** @type {HTMLInputElement|null} */ (document.getElementById('model-selector-search'));
        this.providerFilters = document.getElementById('model-selector-provider-filters');
        this.recentSection = document.getElementById('model-selector-recent-section');
        this.recentList = document.getElementById('model-selector-recent-list');
        this.modelList = document.getElementById('model-selector-list');
        this.emptyState = document.getElementById('model-selector-empty');
        this.closeButton = document.getElementById('model-selector-close');
        this.selectedProvider = 'all';

        this.closeButton?.addEventListener('click', () => this.close());
        this.searchInput?.addEventListener('input', () => this.render());
        this.providerFilters?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const button = /** @type {HTMLElement|null} */ (target.closest('[data-provider-filter]'));
            if (!button) return;
            this.selectedProvider = button.dataset.providerFilter || 'all';
            this.render();
        });
        this.modelList?.addEventListener('click', (event) => this.handleModelClick(event));
        this.recentList?.addEventListener('click', (event) => this.handleModelClick(event));
    }

    /**
     *
     */
    open() {
        if (!this.modal) return;
        this.modal.style.display = 'flex';
        this.render();
        window.requestAnimationFrame(() => this.searchInput?.focus());
    }

    /**
     *
     */
    close() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * @param {Event} event
     */
    handleModelClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const row = /** @type {HTMLElement|null} */ (target.closest('[data-model-id]'));
        if (!row) return;
        this.app.setCurrentModel(row.dataset.modelId || '', { addRecent: true });
        this.close();
    }

    /**
     *
     */
    render() {
        const models = this.app.availableModels || [];
        this.renderProviderFilters(models);
        this.renderRecentModels(models);
        this.renderModelList(models);
    }

    /**
     * @param {ModelInfo[]} models
     */
    renderProviderFilters(models) {
        if (!this.providerFilters) return;
        const providers = getProviderCounts(models);
        const allCount = models.length;
        const chips = [{ provider: 'all', label: 'All', count: allCount }]
            .concat(providers.map((item) => ({ ...item, label: item.provider })))
            .map((item) => {
                const isActive = item.provider === this.selectedProvider;
                return `<button class="model-provider-chip${isActive ? ' active' : ''}" type="button" data-provider-filter="${escapeHtmlText(item.provider)}">
                    <span>${escapeHtmlText(item.label)}</span>
                    <span class="model-provider-count">${item.count}</span>
                </button>`;
            })
            .join('');

        this.providerFilters.innerHTML = chips;
    }

    /**
     * @param {ModelInfo[]} models
     */
    renderRecentModels(models) {
        if (!this.recentSection || !this.recentList) return;
        const query = this.searchInput?.value || '';
        const recent = getRecentAvailableModels(models, storage.getRecentModels());
        const filteredRecent = filterModels(recent, query, this.selectedProvider);
        this.recentSection.style.display = filteredRecent.length > 0 ? 'block' : 'none';
        this.recentList.innerHTML = filteredRecent.map((model) => this.renderModelRow(model)).join('');
    }

    /**
     * @param {ModelInfo[]} models
     */
    renderModelList(models) {
        if (!this.modelList || !this.emptyState) return;
        const query = this.searchInput?.value || '';
        const filtered = filterModels(models, query, this.selectedProvider);
        this.modelList.innerHTML = filtered.map((model) => this.renderModelRow(model)).join('');

        if (models.length === 0) {
            this.emptyState.style.display = 'block';
            this.emptyState.textContent = 'No models are available. Configure API keys in Settings.';
        } else if (filtered.length === 0) {
            this.emptyState.style.display = 'block';
            this.emptyState.textContent = 'No models match the current filters.';
        } else {
            this.emptyState.style.display = 'none';
            this.emptyState.textContent = '';
        }
    }

    /**
     * @param {ModelInfo} model
     * @returns {string}
     */
    renderModelRow(model) {
        const currentModel = this.app.getCurrentModel();
        const isSelected = model.id === currentModel;
        const badges = [];
        if (model.supports_reasoning) badges.push('Reasoning');
        if (model.supports_vision) badges.push('Vision');

        return `<button class="model-selector-row${isSelected ? ' selected' : ''}" type="button" data-model-id="${escapeHtmlText(model.id)}">
            <span class="model-selector-main">
                <span class="model-selector-name">${escapeHtmlText(model.name || model.id)}</span>
                <span class="model-selector-id">${escapeHtmlText(model.id)}</span>
            </span>
            <span class="model-selector-meta">
                <span>${escapeHtmlText(model.provider || 'Unknown')}</span>
                <span>${formatContextWindow(model.context_window)} ctx</span>
                ${badges.map((badge) => `<span>${badge}</span>`).join('')}
            </span>
        </button>`;
    }
}
