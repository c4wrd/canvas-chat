/**
 * Tests for the Decompose Feature Plugin
 */

import { JSDOM } from 'jsdom';

// Test setup - simulate browser environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

const { parseListItems, extractItemsWithLLM } = await import(
    '../src/canvas_chat/static/js/list-extraction.js'
);
const { DecomposeFeature } = await import('../src/canvas_chat/static/js/plugins/decompose.js');

console.log('\n=== Decompose Feature Plugin Tests ===\n');

/**
 * Simple test harness
 */
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
    }
}

function assertArrayEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`);
    }
}

function assertTrue(condition, message = '') {
    if (!condition) {
        throw new Error(message || 'Expected true but got false');
    }
}

function assertNull(value, message = '') {
    if (value !== null) {
        throw new Error(`${message}\n  Expected null but got: ${value}`);
    }
}

/**
 * Modal manager stub matching the plugin modal API
 */
function createModalManagerStub() {
    const modals = new Map();
    return {
        registerModal(pluginId, modalId, template) {
            const container = document.createElement('div');
            container.innerHTML = template.trim();
            const el = container.firstElementChild;
            el.id = `${pluginId}-${modalId}-modal`;
            document.body.appendChild(el);
            modals.set(`${pluginId}-${modalId}`, el);
        },
        getPluginModal(pluginId, modalId) {
            return modals.get(`${pluginId}-${modalId}`);
        },
        showPluginModal(pluginId, modalId) {
            modals.get(`${pluginId}-${modalId}`).style.display = 'flex';
        },
        hidePluginModal(pluginId, modalId) {
            modals.get(`${pluginId}-${modalId}`).style.display = 'none';
        },
    };
}

function createDecomposeFeature(overrides = {}) {
    const context = {
        canvas: null,
        chat: null,
        storage: null,
        modalManager: createModalManagerStub(),
        undoManager: null,
        featureRegistry: null,
        streamingManager: null,
        modelPicker: null,
        chatInput: null,
        showToast: null,
        saveSession: () => {},
        updateEmptyState: () => {},
        updateCollapseButtonForNode: null,
        buildLLMRequest: () => {},
        generateNodeSummary: null,
        tryHandleSlashCommand: null,
        registerStreaming: () => {},
        unregisterStreaming: () => {},
        getStreamingState: () => null,
        pyodideRunner: null,
        streamingNodes: new Map(),
        apiUrl: (path) => path,
        adminMode: false,
        adminModels: [],
        getCurrentModel: null,
        getAvailableModels: null,
        graph: null,
        searchIndex: null,
        ...overrides,
    };
    return new DecomposeFeature(context);
}

/**
 * Create a feature with onLoad() run (modal registered) and preview state seeded
 */
async function createLoadedFeature(overrides = {}) {
    const feature = createDecomposeFeature(overrides);
    await feature.onLoad();
    return feature;
}

// ============ parseListItems (shared module) ============

test('parseListItems handles numbered lists with periods', () => {
    const content = `Here are my options:
1. First option
2. Second option
3. Third option`;
    assertArrayEquals(parseListItems(content), ['First option', 'Second option', 'Third option']);
});

test('parseListItems handles numbered lists with parentheses', () => {
    const content = `Options:
1) Alpha
2) Beta
3) Gamma`;
    assertArrayEquals(parseListItems(content), ['Alpha', 'Beta', 'Gamma']);
});

test('parseListItems handles dash bullet points', () => {
    const content = `Ideas:
- Build a dashboard
- Create an API
- Write documentation`;
    assertArrayEquals(parseListItems(content), ['Build a dashboard', 'Create an API', 'Write documentation']);
});

test('parseListItems handles asterisk bullet points', () => {
    const content = `Things to do:
* First task
* Second task`;
    assertArrayEquals(parseListItems(content), ['First task', 'Second task']);
});

test('parseListItems handles bullet points (•)', () => {
    const content = `Concepts:
• Concept A
• Concept B`;
    assertArrayEquals(parseListItems(content), ['Concept A', 'Concept B']);
});

test('parseListItems handles indented lists', () => {
    const content = `Analysis:
   1. First point
   2. Second point`;
    assertArrayEquals(parseListItems(content), ['First point', 'Second point']);
});

test('parseListItems returns null for non-list content', () => {
    const content = `This is just regular text.
It doesn't contain any list items.`;
    assertNull(parseListItems(content));
});

test('parseListItems returns null for single item', () => {
    const content = `Only one:
- Single item`;
    assertNull(parseListItems(content), 'Should require at least 2 items');
});

test('parseListItems captures multi-line numbered sections', () => {
    const content = `1. Title of First Item
Description line 1
Key: Value

2. Title of Second Item
Description for item 2`;
    const items = parseListItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    assertTrue(items[0].includes('Description line 1'), 'First item should include sub-lines');
    assertTrue(items[0].includes('Key: Value'), 'First item should include Key line');
    assertTrue(items[1].includes('Description for item 2'), 'Second item should include its sub-line');
});

test('parseListItems captures multi-line bullet sections', () => {
    const content = `- First concept
  Additional details about the first concept

- Second concept
  Additional details about the second concept`;
    const items = parseListItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    assertTrue(items[0].includes('Additional details about the first'), 'First item should include sub-lines');
});

// ============ extractItemsWithLLM ============

await asyncTest('extractItemsWithLLM parses JSON array response', async () => {
    let capturedModel = null;
    const chat = {
        sendMessage(messages, model, onChunk, onDone) {
            capturedModel = model;
            onChunk('["alpha", "beta"]');
            onDone();
        },
    };
    const items = await extractItemsWithLLM({ chat, model: 'test/model', content: 'stuff' });
    assertArrayEquals(items, ['alpha', 'beta']);
    assertEquals(capturedModel, 'test/model');
});

await asyncTest('extractItemsWithLLM includes transform instructions in prompt', async () => {
    let capturedPrompt = null;
    const chat = {
        sendMessage(messages, model, onChunk, onDone) {
            capturedPrompt = messages[0].content;
            onChunk('["a", "b"]');
            onDone();
        },
    };
    await extractItemsWithLLM({
        chat,
        model: 'test/model',
        content: 'stuff',
        instructions: 'summarize each item',
        transform: true,
    });
    assertTrue(capturedPrompt.includes('summarize each item'), 'Prompt should contain instructions');
    assertTrue(capturedPrompt.includes('transform each item'), 'Prompt should be in transform mode');
});

await asyncTest('extractItemsWithLLM verbatim prompt omits transform wording', async () => {
    let capturedPrompt = null;
    const chat = {
        sendMessage(messages, model, onChunk, onDone) {
            capturedPrompt = messages[0].content;
            onChunk('["a", "b"]');
            onDone();
        },
    };
    await extractItemsWithLLM({ chat, model: 'test/model', content: 'stuff' });
    assertTrue(capturedPrompt.includes('verbatim'), 'Verbatim prompt should ask for exact text');
    assertTrue(!capturedPrompt.includes('transform each item'), 'Verbatim prompt should not be transform mode');
});

await asyncTest('extractItemsWithLLM rejects on malformed response', async () => {
    const chat = {
        sendMessage(messages, model, onChunk, onDone) {
            onChunk('not json at all');
            onDone();
        },
    };
    let rejected = false;
    try {
        await extractItemsWithLLM({ chat, model: 'test/model', content: 'stuff' });
    } catch (e) {
        rejected = true;
    }
    assertTrue(rejected, 'Should reject when no JSON array in response');
});

// ============ DecomposeFeature: handleCommand validation ============

await asyncTest('handleCommand rejects empty selection', async () => {
    const toasts = [];
    const feature = await createLoadedFeature({
        canvas: { getSelectedNodeIds: () => [] },
        showToast: (msg, type) => toasts.push({ msg, type }),
    });
    await feature.handleCommand('/decompose', '', {});
    assertEquals(toasts.length, 1);
    assertEquals(toasts[0].type, 'error');
    assertNull(feature._data, 'No preview state should be created');
});

await asyncTest('handleCommand rejects multiple selection', async () => {
    const toasts = [];
    const feature = await createLoadedFeature({
        canvas: { getSelectedNodeIds: () => ['a', 'b'] },
        showToast: (msg, type) => toasts.push({ msg, type }),
    });
    await feature.handleCommand('/decompose', '', {});
    assertEquals(toasts.length, 1);
    assertNull(feature._data, 'No preview state should be created');
});

await asyncTest('handleCommand rejects node without content', async () => {
    const toasts = [];
    const feature = await createLoadedFeature({
        canvas: { getSelectedNodeIds: () => ['a'] },
        graph: { getNode: () => ({ id: 'a', content: '' }) },
        showToast: (msg, type) => toasts.push({ msg, type }),
    });
    await feature.handleCommand('/decompose', '', {});
    assertEquals(toasts.length, 1);
    assertNull(feature._data, 'No preview state should be created');
});

await asyncTest('handleCommand uses regex parsing when no prompt given', async () => {
    let llmCalled = false;
    const feature = await createLoadedFeature({
        canvas: { getSelectedNodeIds: () => ['a'] },
        graph: {
            getNode: () => ({ id: 'a', content: '1. First\n2. Second' }),
        },
        chat: {
            sendMessage: () => {
                llmCalled = true;
            },
        },
    });
    await feature.handleCommand('/decompose', '', {});
    assertArrayEquals(feature._data.items, ['First', 'Second']);
    assertTrue(!llmCalled, 'LLM should not be called when regex parsing succeeds');
});

await asyncTest('handleCommand uses LLM when prompt is given', async () => {
    const feature = await createLoadedFeature({
        canvas: { getSelectedNodeIds: () => ['a'] },
        graph: {
            getNode: () => ({ id: 'a', content: '1. First\n2. Second' }),
        },
        getCurrentModel: () => 'test/current-model',
        chat: {
            sendMessage: (messages, model, onChunk, onDone) => {
                onChunk('["summary one", "summary two"]');
                onDone();
            },
        },
    });
    await feature.handleCommand('/decompose', 'summarize each', {});
    assertArrayEquals(feature._data.items, ['summary one', 'summary two']);
    assertEquals(feature._data.prompt, 'summarize each');
});

// ============ DecomposeFeature: model selection ============

test('_getExtractionModel uses fast model for verbatim split', () => {
    const feature = createDecomposeFeature({
        storage: { getFastModel: () => 'openai/gpt-4o-mini' },
        getCurrentModel: () => 'anthropic/claude-sonnet-4',
    });
    assertEquals(feature._getExtractionModel(false), 'openai/gpt-4o-mini');
});

test('_getExtractionModel uses current model for transformations', () => {
    const feature = createDecomposeFeature({
        storage: { getFastModel: () => 'openai/gpt-4o-mini' },
        getCurrentModel: () => 'anthropic/claude-sonnet-4',
    });
    assertEquals(feature._getExtractionModel(true), 'anthropic/claude-sonnet-4');
});

test('_getExtractionModel falls back to current model when no fast model', () => {
    const feature = createDecomposeFeature({
        storage: { getFastModel: () => null },
        getCurrentModel: () => 'anthropic/claude-sonnet-4',
    });
    assertEquals(feature._getExtractionModel(false), 'anthropic/claude-sonnet-4');
});

// ============ DecomposeFeature: stale response guard ============

await asyncTest('stale extraction responses are dropped', async () => {
    const pendingDones = [];
    const feature = await createLoadedFeature({
        graph: {
            getNode: () => ({ id: 'a', content: 'some content', position: { x: 0, y: 0 } }),
        },
        getCurrentModel: () => 'test/model',
        chat: {
            sendMessage: (messages, model, onChunk, onDone) => {
                pendingDones.push({ messages, onChunk, onDone });
            },
        },
    });
    feature._data = { sourceNodeId: 'a', items: [], prompt: '' };

    const first = feature._runExtraction('first prompt');
    const second = feature._runExtraction('second prompt');

    // Resolve in reverse order: second finishes first, then the stale first
    pendingDones[1].onChunk('["from second"]');
    pendingDones[1].onDone();
    await second;
    pendingDones[0].onChunk('["from first"]');
    pendingDones[0].onDone();
    await first;

    assertArrayEquals(feature._data.items, ['from second'], 'Only the latest request should land');
    assertEquals(feature._data.prompt, 'second prompt');
});

await asyncTest('extraction response after modal close is ignored', async () => {
    let pendingDone = null;
    const feature = await createLoadedFeature({
        graph: {
            getNode: () => ({ id: 'a', content: 'some content', position: { x: 0, y: 0 } }),
        },
        getCurrentModel: () => 'test/model',
        chat: {
            sendMessage: (messages, model, onChunk, onDone) => {
                pendingDone = { onChunk, onDone };
            },
        },
    });
    feature._data = { sourceNodeId: 'a', items: [], prompt: '' };

    const promise = feature._runExtraction('some prompt');
    feature._closeModal();
    pendingDone.onChunk('["late result"]');
    pendingDone.onDone();
    await promise;

    assertNull(feature._data, 'State should stay cleared after close');
});

// ============ DecomposeFeature: node creation ============

await asyncTest('_confirmCreate creates AI nodes with branch edges in fan layout', async () => {
    const addedNodes = [];
    const addedEdges = [];
    let sessionSaved = false;
    let selectionCleared = false;

    const feature = await createLoadedFeature({
        canvas: {
            getSelectedNodeIds: () => ['src'],
            clearSelection: () => {
                selectionCleared = true;
            },
            centerOnAnimated: () => {},
        },
        graph: {
            getNode: () => ({ id: 'src', content: 'x', position: { x: 1000, y: 500 } }),
            addNode: (node) => addedNodes.push(node),
            addEdge: (edge) => addedEdges.push(edge),
        },
        saveSession: () => {
            sessionSaved = true;
        },
    });
    feature._data = {
        sourceNodeId: 'src',
        items: ['Item one', '   ', 'Item two'],
        prompt: '',
    };

    const createdIds = feature._confirmCreate();

    assertEquals(addedNodes.length, 2, 'Blank items should be filtered out');
    assertEquals(addedNodes[0].type, 'ai', 'Children should be AI nodes');
    assertEquals(addedNodes[0].content, 'Item one');
    assertEquals(addedNodes[1].content, 'Item two');

    // Fan layout: spacing 400 centered under source, verticalOffset 250
    assertEquals(addedNodes[0].position.x, 800);
    assertEquals(addedNodes[1].position.x, 1200);
    assertEquals(addedNodes[0].position.y, 750);
    assertEquals(addedNodes[1].position.y, 750);

    assertEquals(addedEdges.length, 2);
    assertEquals(addedEdges[0].source, 'src', 'Edges should come directly from source node');
    assertEquals(addedEdges[0].target, addedNodes[0].id);
    assertEquals(addedEdges[0].type, 'branch');

    assertArrayEquals(createdIds, addedNodes.map((n) => n.id), 'Should return created node IDs');
    assertTrue(sessionSaved, 'Session should be saved');
    assertTrue(selectionCleared, 'Selection should be cleared');
    assertNull(feature._data, 'Preview state should be cleared after create');
});

await asyncTest('_confirmCreate with no valid items creates nothing', async () => {
    const addedNodes = [];
    const toasts = [];
    const feature = await createLoadedFeature({
        graph: {
            getNode: () => ({ id: 'src', content: 'x', position: { x: 0, y: 0 } }),
            addNode: (node) => addedNodes.push(node),
            addEdge: () => {},
        },
        showToast: (msg, type) => toasts.push({ msg, type }),
    });
    feature._data = { sourceNodeId: 'src', items: ['', '  '], prompt: '' };

    const createdIds = feature._confirmCreate();

    assertEquals(addedNodes.length, 0);
    assertEquals(createdIds.length, 0);
    assertEquals(toasts.length, 1);
});

// ============ DecomposeFeature: modal item editing ============

await asyncTest('editing a preview textarea updates item state', async () => {
    const feature = await createLoadedFeature({});
    feature._data = { sourceNodeId: 'src', items: ['original'], prompt: '' };
    feature._renderItems();

    const modal = feature.modalManager.getPluginModal('decompose', 'main');
    const textarea = modal.querySelector('.decompose-item-text');
    textarea.value = 'edited';
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    assertArrayEquals(feature._data.items, ['edited']);
});

await asyncTest('remove button deletes an item from state', async () => {
    const feature = await createLoadedFeature({});
    feature._data = { sourceNodeId: 'src', items: ['first', 'second'], prompt: '' };
    feature._renderItems();

    const modal = feature.modalManager.getPluginModal('decompose', 'main');
    const removeBtn = modal.querySelector('.decompose-item-remove');
    removeBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    assertArrayEquals(feature._data.items, ['second']);
});

await asyncTest('count label and confirm button reflect item count', async () => {
    const feature = await createLoadedFeature({});
    feature._data = { sourceNodeId: 'src', items: ['a', 'b', ''], prompt: '' };
    feature._renderItems();
    feature._updateCount();

    const modal = feature.modalManager.getPluginModal('decompose', 'main');
    assertEquals(modal.querySelector('#decompose-count').textContent, '2 nodes');
    assertEquals(modal.querySelector('#decompose-confirm').textContent, 'Create 2 nodes');
    assertTrue(!modal.querySelector('#decompose-confirm').disabled, 'Confirm should be enabled');

    feature._data.items = [];
    feature._updateCount();
    assertTrue(modal.querySelector('#decompose-confirm').disabled, 'Confirm should be disabled with 0 items');
});

// ============ Slash command metadata ============

test('getSlashCommands returns /decompose metadata', () => {
    const feature = createDecomposeFeature();
    const commands = feature.getSlashCommands();
    assertEquals(commands.length, 1);
    assertEquals(commands[0].command, '/decompose');
    assertTrue(commands[0].description.length > 0);
});

// Print summary
console.log(`\n${passed + failed} tests run, ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('✅ All decompose plugin tests passed!');
    process.exit(0);
}
