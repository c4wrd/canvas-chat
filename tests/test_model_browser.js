import { assertEqual } from './test_helpers/assertions.js';

global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
};

const { filterModels, formatContextWindow, getProviderCounts, getRecentAvailableModels } = await import(
    '../src/canvas_chat/static/js/model-browser.js'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${err.message}`);
        failed++;
    }
}

const models = [
    {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'OpenAI',
        context_window: 128000,
    },
    {
        id: 'anthropic/claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'Anthropic',
        context_window: 200000,
    },
    {
        id: 'openai/o3',
        name: 'o3',
        provider: 'OpenAI',
        context_window: 200000,
    },
];

test('filterModels matches model name case-insensitively', () => {
    const result = filterModels(models, 'sonnet', 'all');
    assertEqual(
        result.map((model) => model.id),
        ['anthropic/claude-sonnet-4-20250514']
    );
});

test('filterModels matches provider and query together', () => {
    const result = filterModels(models, 'gpt', 'OpenAI');
    assertEqual(
        result.map((model) => model.id),
        ['openai/gpt-4o-mini']
    );
});

test('getProviderCounts returns sorted provider counts', () => {
    assertEqual(getProviderCounts(models), [
        { provider: 'Anthropic', count: 1 },
        { provider: 'OpenAI', count: 2 },
    ]);
});

test('getRecentAvailableModels preserves recent order and skips unavailable models', () => {
    const result = getRecentAvailableModels(models, ['openai/o3', 'missing/model', 'openai/gpt-4o-mini']);
    assertEqual(
        result.map((model) => model.id),
        ['openai/o3', 'openai/gpt-4o-mini']
    );
});

test('formatContextWindow formats common context sizes', () => {
    assertEqual(formatContextWindow(128000), '128k');
    assertEqual(formatContextWindow(1048576), '1.0M');
    assertEqual(formatContextWindow(undefined), '128k');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
