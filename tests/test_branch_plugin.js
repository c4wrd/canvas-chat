/**
 * Tests for the Branch Feature Plugin
 */

import { JSDOM } from 'jsdom';

// Test setup - simulate browser environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

console.log('\n=== Branch Feature Plugin Tests ===\n');

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
 * Mock BranchFeature for testing parseItems
 */
class MockBranchFeature {
    parseItems(content) {
        // Try numbered sections: capture everything until next number or end
        const numberedSectionRegex = /^\s*(\d+)[\.\)]\s*/gm;
        const matches = [...content.matchAll(numberedSectionRegex)];

        if (matches.length >= 2) {
            const items = [];
            for (let i = 0; i < matches.length; i++) {
                const startIndex = matches[i].index + matches[i][0].length;
                const endIndex = i + 1 < matches.length ? matches[i + 1].index : content.length;
                const section = content.slice(startIndex, endIndex).trim();
                items.push(section);
            }
            return items;
        }

        // Try bullet sections: capture until next bullet or end
        const bulletSectionRegex = /^\s*[-*•]\s*/gm;
        const bulletMatches = [...content.matchAll(bulletSectionRegex)];

        if (bulletMatches.length >= 2) {
            const items = [];
            for (let i = 0; i < bulletMatches.length; i++) {
                const startIndex = bulletMatches[i].index + bulletMatches[i][0].length;
                const endIndex =
                    i + 1 < bulletMatches.length ? bulletMatches[i + 1].index : content.length;
                const section = content.slice(startIndex, endIndex).trim();
                items.push(section);
            }
            return items;
        }

        return null; // triggers LLM extraction
    }
}

// Create instance for testing
const feature = new MockBranchFeature();

// Test parseItems with numbered lists
test('parseItems handles numbered lists with periods', () => {
    const content = `Here are my options:
1. First option
2. Second option
3. Third option`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['First option', 'Second option', 'Third option']);
});

test('parseItems handles numbered lists with parentheses', () => {
    const content = `Options:
1) Alpha
2) Beta
3) Gamma`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['Alpha', 'Beta', 'Gamma']);
});

test('parseItems handles dash bullet points', () => {
    const content = `Ideas:
- Build a dashboard
- Create an API
- Write documentation`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['Build a dashboard', 'Create an API', 'Write documentation']);
});

test('parseItems handles asterisk bullet points', () => {
    const content = `Things to do:
* First task
* Second task
* Third task`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['First task', 'Second task', 'Third task']);
});

test('parseItems handles bullet points (•)', () => {
    const content = `Concepts:
• Concept A
• Concept B`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['Concept A', 'Concept B']);
});

test('parseItems handles indented lists', () => {
    const content = `Analysis:
   1. First point
   2. Second point
   3. Third point`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['First point', 'Second point', 'Third point']);
});

test('parseItems returns null for non-list content', () => {
    const content = `This is just regular text.
It doesn't contain any list items.
Just paragraphs of text.`;
    const items = feature.parseItems(content);
    assertNull(items);
});

test('parseItems returns null for single item', () => {
    const content = `Only one:
- Single item`;
    const items = feature.parseItems(content);
    assertNull(items, 'Should require at least 2 items');
});

test('parseItems handles mixed content with list', () => {
    const content = `Here is some introduction text.

1. First item in the list
2. Second item in the list
3. Third item

And some trailing text.`;
    const items = feature.parseItems(content);
    // With section-based parsing, trailing text after last item is included
    assertArrayEquals(items, ['First item in the list', 'Second item in the list', 'Third item\n\nAnd some trailing text.']);
});

test('parseItems handles list items with special characters', () => {
    const content = `Code options:
1. Use React.js
2. Use Vue.js (recommended)
3. Use Angular - enterprise`;
    const items = feature.parseItems(content);
    assertArrayEquals(items, ['Use React.js', 'Use Vue.js (recommended)', 'Use Angular - enterprise']);
});

// Test template replacement
test('template replacement works correctly', () => {
    const template = 'Generate a detailed analysis of {item}';
    const item = 'machine learning';
    const result = template.replace(/\{item\}/g, item);
    assertEquals(result, 'Generate a detailed analysis of machine learning');
});

test('template replacement handles multiple placeholders', () => {
    const template = '{item} compared to {item} alternatives';
    const item = 'React';
    const result = template.replace(/\{item\}/g, item);
    assertEquals(result, 'React compared to React alternatives');
});

test('template replacement preserves other text', () => {
    const template = 'Write a 500-word essay about {item} and its impact';
    const item = 'artificial intelligence';
    const result = template.replace(/\{item\}/g, item);
    assertEquals(result, 'Write a 500-word essay about artificial intelligence and its impact');
});

// Multi-line section parsing tests
test('parseItems captures multi-line numbered sections', () => {
    const content = `1) "BION Prism" (belief → reveal)
Icon: A minimal prism/diamond with a subtle inner "B"
BION representation: The split beam forms four rays
Style cues: Clean, high-tech, slightly sci‑fi.

2) "B + ION" (science/tech wordplay)
Icon: A bold B combined with an ion orbit
Style cues: Modern, scientific feel`;
    const items = feature.parseItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    assertTrue(items[0].includes('Icon: A minimal prism'), 'First item should include Icon line');
    assertTrue(items[0].includes('Style cues: Clean'), 'First item should include Style cues');
    assertTrue(items[1].includes('Icon: A bold B'), 'Second item should include its Icon line');
});

test('parseItems captures multi-line bullet sections', () => {
    const content = `- First concept
  Additional details about the first concept
  More context here

- Second concept
  Additional details about the second concept`;
    const items = feature.parseItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    assertTrue(items[0].includes('Additional details about the first'), 'First item should include sub-lines');
    assertTrue(items[1].includes('Additional details about the second'), 'Second item should include sub-lines');
});

test('parseItems handles numbered sections with nested content', () => {
    const content = `Options for the logo:

1. Option Alpha
   - Sub-detail one
   - Sub-detail two
   Color: Blue

2. Option Beta
   - Sub-detail A
   Color: Green`;
    const items = feature.parseItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    assertTrue(items[0].includes('Sub-detail one'), 'First item should include nested bullets');
    assertTrue(items[0].includes('Color: Blue'), 'First item should include Color line');
});

test('parseItems preserves full multi-line item content', () => {
    const content = `1. Title of First Item
Description line 1
Description line 2
Key: Value

2. Title of Second Item
Description for item 2`;
    const items = feature.parseItems(content);
    assertEquals(items.length, 2, 'Should find 2 items');
    // Verify full content is captured
    const firstLines = items[0].split('\n');
    assertTrue(firstLines.length >= 3, 'First item should have multiple lines');
    assertEquals(firstLines[0], 'Title of First Item', 'First line should be the title');
});

// Print summary
console.log(`\n${passed + failed} tests run, ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('✅ All branch plugin tests passed!');
    process.exit(0);
}
