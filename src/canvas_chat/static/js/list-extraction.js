/**
 * List Extraction Utilities
 *
 * Shared helpers for splitting node content into discrete list items.
 * Used by features that fan a single node out into multiple children
 * (e.g., /decompose).
 */

/**
 * Parse list items from content using pattern matching.
 * Captures full multi-line sections (everything until the next list marker or end).
 * @param {string} content - Node content to parse
 * @returns {string[]|null} - Array of items, or null if no list found (fewer than 2 markers)
 */
export function parseListItems(content) {
    // Try numbered sections: capture everything until next number or end
    const numberedSectionRegex = /^\s*(\d+)[\.\)]\s*/gm;
    const matches = [...content.matchAll(numberedSectionRegex)];

    if (matches.length >= 2) {
        const items = [];
        for (let i = 0; i < matches.length; i++) {
            const startIndex = matches[i].index + matches[i][0].length;
            const endIndex = i + 1 < matches.length ? matches[i + 1].index : content.length;
            items.push(content.slice(startIndex, endIndex).trim());
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
            items.push(content.slice(startIndex, endIndex).trim());
        }
        return items;
    }

    return null;
}

/**
 * Extract list items from content using an LLM.
 * @param {Object} options
 * @param {Object} options.chat - Chat client exposing sendMessage(messages, model, onChunk, onDone, onError)
 * @param {string} options.model - Model ID to use for extraction
 * @param {string} options.content - Node content to split
 * @param {string} [options.instructions] - Transformation instructions (used when transform is true)
 * @param {boolean} [options.transform] - If true, transform each item per instructions instead of verbatim split
 * @returns {Promise<string[]>} - Array of extracted items
 */
export function extractItemsWithLLM({ chat, model, content, instructions = '', transform = false }) {
    let prompt;
    if (transform && instructions) {
        prompt = `Split the following content into its distinct list items, then transform each item according to these instructions: ${instructions}

Return ONLY a JSON array of strings, one entry per item, with no additional text or explanation.

Content:
${content}`;
    } else {
        prompt = `Split the following content into its distinct list items. Return ONLY a JSON array of strings, with no additional text or explanation. Preserve each item's full text verbatim, including multi-line details.

Content:
${content}`;
    }

    return new Promise((resolve, reject) => {
        let fullResponse = '';

        chat.sendMessage(
            [{ role: 'user', content: prompt }],
            model,
            (chunk) => {
                fullResponse += chunk;
            },
            () => {
                try {
                    const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        const items = JSON.parse(jsonMatch[0]);
                        if (Array.isArray(items) && items.length > 0) {
                            resolve(items.map((item) => String(item).trim()));
                            return;
                        }
                    }
                    reject(new Error('Could not extract items from content'));
                } catch (parseError) {
                    reject(new Error('Failed to parse extracted items'));
                }
            },
            (err) => reject(err)
        );
    });
}
