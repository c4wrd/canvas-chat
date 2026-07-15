---
name: verify
description: Build/launch/drive recipe for verifying canvas-chat changes end-to-end in a real browser.
---

# Verifying canvas-chat changes

## Launch

```bash
mise run dev    # serves http://127.0.0.1:7865
```

- Port 7865 in use usually means a dev server is already running with `--reload`;
  static JS is served from disk, so it picks up frontend changes without restart.
  Confirm with `curl -s http://127.0.0.1:7865/static/js/<changed-file>.js | head`.

## Drive (headless browser)

No Playwright in the repo. Install it in a temp dir and use the system Chrome
channel (no browser download needed):

```bash
mkdir -p /tmp/canvas-verify && cd /tmp/canvas-verify
npm init -y && npm install --no-save playwright
# in the driver script:
#   chromium.launch({ channel: 'chrome', headless: true })
```

Useful handles inside the page:

- `window.app` is the App instance: `app.graph.getAllNodes()`, `app.graph.getAllEdges()`,
  `app.canvas.selectNode(id)`, `app.canvas.getSelectedNodeIds()`, `app.canvas.clearSelection()`.
- Chat input is `#chat-input`. Enter submits; Shift+Enter inserts a newline
  (use `pressSequentially` + `keyboard.press('Shift+Enter')` for multi-line).
- `/note <markdown>` creates a note node locally with no LLM/API key needed —
  best way to seed content when no API key is configured.
- Feature plugin modals are `#<pluginId>-<modalId>-modal` appended to body
  (e.g. `#decompose-main-modal`, `#branch-main-modal`).
- Toasts: the app also has an unrelated "Review Now/Later" element that matches
  `[class*="toast"]` — screenshot instead of querying loosely.

## Gotchas

- LLM-dependent paths need an API key; without one, expect the feature's own
  error surface (e.g. "No model selected...") — useful for driving error paths.
- Wait for app readiness with `page.waitForFunction(() => window.app && window.app.graph)`.
- One benign 404 console error fires on load (ignore).
