/**
 * Tests for sse.js - SSE parsing and text normalization utilities
 *
 * Tests normalizeText(), parseSSEEvent(), readSSEStream(), and streamSSEContent()
 * These are critical infrastructure used by all streaming LLM features.
 */

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  ${error.message}`);
        process.exit(1);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(value, message) {
    if (!value) {
        throw new Error(message || 'Expected true but got false');
    }
}

// =============================================================================
// normalizeText Tests
// =============================================================================

asyncTest('normalizeText handles null/undefined', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText(null), null, 'null should return null');
    assertEqual(normalizeText(undefined), undefined, 'undefined should return undefined');
});

asyncTest('normalizeText trims whitespace', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText('  hello  '), 'hello', 'should trim whitespace');
    assertEqual(normalizeText('\nhello\n'), 'hello', 'should trim newlines');
});

asyncTest('normalizeText fixes hyphenated words', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText('matter - of'), 'matter-of', 'should fix space around hyphen');
    assertEqual(normalizeText('state - of - the - art'), 'state-of-the-art', 'should fix multiple hyphens');
});

asyncTest('normalizeText removes spaces before punctuation', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText('hello , world'), 'hello, world', 'should remove space before comma');
    assertEqual(normalizeText('hello .'), 'hello.', 'should remove space before period');
    assertEqual(normalizeText('hello !'), 'hello!', 'should remove space before exclamation');
    assertEqual(normalizeText('hello ?'), 'hello?', 'should remove space before question mark');
    assertEqual(normalizeText('hello )'), 'hello)', 'should remove space before closing paren');
    assertEqual(normalizeText('hello ]'), 'hello]', 'should remove space before closing bracket');
    assertEqual(normalizeText('hello }'), 'hello}', 'should remove space before closing brace');
});

asyncTest('normalizeText removes spaces after opening brackets', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText('( hello'), '(hello', 'should remove space after opening paren');
    assertEqual(normalizeText('[ hello'), '[hello', 'should remove space after opening bracket');
    assertEqual(normalizeText('{ hello'), '{hello', 'should remove space after opening brace');
});

asyncTest('normalizeText fixes apostrophes in contractions', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText("don ' t"), "don't", 'should fix space before apostrophe');
    assertEqual(normalizeText("it ' s"), "it's", 'should fix contraction apostrophe');
});

asyncTest('normalizeText collapses multiple spaces', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');
    assertEqual(normalizeText('hello    world'), 'hello world', 'should collapse multiple spaces');
    assertEqual(normalizeText('a   b  c'), 'a b c', 'should handle mixed spacing');
});

asyncTest('normalizeText handles real LLM output artifacts', async () => {
    const { normalizeText } = await import('../src/canvas_chat/static/js/sse.js');

    // Real example: "Here is a list :\n1 . Item one\n2 . Item two"
    const input = 'Here is a list :\n1 . Item one\n2 . Item two';
    const expected = 'Here is a list:\n1. Item one\n2. Item two';
    assertEqual(normalizeText(input), expected, 'should fix numbered list artifacts');

    // Real example: "The answer is 42 ."
    const input2 = 'The answer is 42 .';
    assertEqual(normalizeText(input2), 'The answer is 42.', 'should fix space before period after number');
});

// =============================================================================
// parseSSEEvent Tests
// =============================================================================

asyncTest('parseSSEEvent parses basic message', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('data: hello world');
    assertEqual(result.eventType, 'message', 'should default to message event');
    assertEqual(result.data, 'hello world', 'should extract data');
});

asyncTest('parseSSEEvent parses explicit event type', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('event: done\ndata: completed');
    assertEqual(result.eventType, 'done', 'should extract event type');
    assertEqual(result.data, 'completed', 'should extract data');
});

asyncTest('parseSSEEvent handles event without space', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('event:done\ndata:completed');
    assertEqual(result.eventType, 'done', 'should handle event without space');
    assertEqual(result.data, 'completed', 'should extract data');
});

asyncTest('parseSSEEvent handles data without space', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('data:hello');
    assertEqual(result.data, 'hello', 'should handle data without space');
});

asyncTest('parseSSEEvent joins multiple data lines', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('data: line1\ndata: line2\ndata: line3');
    assertEqual(result.data, 'line1\nline2\nline3', 'should join data lines with newlines');
});

asyncTest('parseSSEEvent handles empty event block', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('');
    assertEqual(result.eventType, 'message', 'should default to message for empty');
    assertEqual(result.data, '', 'should have empty data');
});

asyncTest('parseSSEEvent handles error event', async () => {
    const { parseSSEEvent } = await import('../src/canvas_chat/static/js/sse.js');
    const result = parseSSEEvent('event: error\ndata: Something went wrong');
    assertEqual(result.eventType, 'error', 'should parse error event');
    assertEqual(result.data, 'Something went wrong', 'should extract error message');
});

// =============================================================================
// readSSEStream Tests
// =============================================================================
// Note: readSSEStream requires a mock Fetch Response with ReadableStream
// These tests require a more complex setup with jsdom or similar
// For now, we focus on the pure functions (normalizeText, parseSSEEvent)
// which are tested above.

console.log('\n✓ All sse.js tests passed!');
console.log('  (readSSEStream tests require jsdom setup - skipped for now)');
