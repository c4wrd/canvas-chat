# Perplexity Responses API Implementation

## Summary

Implemented three distinct Perplexity slash commands differentiated by use case:

1. **`/perplexity`** - Fast search using responses.create API with fast-search preset
2. **`/perplexity-research`** - Deep research with multi-step analysis (up to 10 steps)
3. **`/perplexity-agent`** - Full-featured GUI modal for configuring all options

The existing `/perplexity-pro` and `/perplexity-search` commands remain unchanged for backward compatibility.

## Changes Made

### Backend (`src/canvas_chat/app.py`)

1. **Added Request Model** (line ~440):
   - `PerplexityResponsesRequest` with support for:
     - `input`: Query string or message array
     - `preset`: fast-search, pro-search, deep-research
     - `model`: Custom model selection
     - `instructions`: System-level guidance
     - `max_steps`: Research iterations (1-10)
     - `reasoning_effort`: low, medium, high
     - `tools`: web_search, fetch_url
     - `stream`: SSE streaming
     - `context`: Selected node context

2. **Added Endpoint** (`/api/perplexity/responses`):
   - Uses official `AsyncPerplexity().responses.create()` SDK method
   - Streams SSE events:
     - `step_start`: New research step begins
     - `step_thinking`: Reasoning/thinking content
     - `step_content`: Main content chunks
     - `step_sources`: Sources for current step
     - `step_complete`: Step finished
     - `citations`: Final citation list
     - `done`: Research complete
     - `error`: Error occurred

### Frontend (`src/canvas_chat/static/js/plugins/perplexity.js`)

1. **Updated Commands**:
   - Modified `/perplexity` to use responses API with fast-search preset
   - Added `/perplexity-research` for deep research (10 steps, high reasoning)
   - Added `/perplexity-agent` for modal-based configuration

2. **New Methods**:
   - `executeResponsesAPI()`: Creates node and initiates streaming
   - `streamResponsesAPI()`: Handles SSE stream with step tracking
   - `showAgentModal()`: Displays configuration modal and returns settings

3. **Modal UI** (registered in `onLoad()`):
   - Preset selector: Fast Search, Pro Search, Deep Research, Custom
   - Advanced options (shown for Custom):
     - Model dropdown (12+ models including Sonar, Claude, GPT, Gemini)
     - Max steps slider (1-10)
     - Reasoning effort selector (none/low/medium/high)
     - Tools checkboxes (web_search, fetch_url)
     - Custom instructions textarea
   - Promise-based configuration flow

### Node Rendering (`src/canvas_chat/static/js/plugins/perplexity-node.js`)

1. **Enhanced Content Display**:
   - Progress indicator with percentage bar for multi-step research
   - Current step counter in status message
   - Dynamic model badge based on preset or model

2. **New Sections** (collapsible):
   - **Reasoning Section**: Shows thinking content from all steps
   - **Research Steps Section**: Expandable list with:
     - Step number and status (✅ completed, ⏳ in progress)
     - Thinking content per step
     - Main content per step
     - Sources per step

3. **Styling**:
   - Purple-tinted reasoning section
   - Blue-tinted steps section
   - Animated progress bar
   - Dark mode support for all new elements

## Testing Checklist

### Manual Testing

- [ ] `/perplexity quick test` - Fast search (1 step, no reasoning)
- [ ] `/perplexity-research deep analysis of AI` - Deep research (10 steps)
- [ ] `/perplexity-agent market analysis` - Modal configuration
- [ ] Modal preset switching (Fast → Pro → Deep → Custom)
- [ ] Modal advanced options visibility
- [ ] Custom model selection
- [ ] Max steps slider functionality
- [ ] Reasoning effort selector
- [ ] Tools checkboxes
- [ ] Custom instructions field
- [ ] Stop/continue buttons during streaming
- [ ] Progress indicator updates
- [ ] Reasoning section collapsible
- [ ] Steps section collapsible
- [ ] Citation badges clickable
- [ ] Sources aggregation
- [ ] Error handling (invalid API key)
- [ ] Session persistence (reload page)

### Backend Testing

```bash
# Test endpoint with curl (requires valid Perplexity API key)
curl -X POST http://localhost:7865/api/perplexity/responses \
  -H "Content-Type: application/json" \
  -d '{
    "input": "What is quantum computing?",
    "preset": "pro-search",
    "max_steps": 3,
    "api_key": "YOUR_KEY",
    "stream": true
  }'
```

### Integration Testing

- [ ] Multiple concurrent researches
- [ ] Stop mid-research and continue
- [ ] Long research (10 steps)
- [ ] Network error recovery
- [ ] API key validation

## Backward Compatibility

✅ All existing commands remain functional:
- `/perplexity-pro` - Uses old chat API with sonar-pro model
- `/perplexity-search` - Direct search endpoint

## Configuration

No configuration changes required. Users need:
- Perplexity API key in Settings
- API key must support responses.create endpoint

## Known Limitations

1. Responses API is separate from chat API - different pricing
2. Not all Perplexity models may support reasoning parameter
3. Max steps limited to 10 by Perplexity API
4. Sources structure may vary between models

## Next Steps

1. Test with actual Perplexity API key
2. Verify reasoning content format across different models
3. Test edge cases (network failures, rate limits)
4. Consider adding response caching
5. Add metrics tracking for research quality

## Files Modified

1. `/src/canvas_chat/app.py` - Backend endpoint and model
2. `/src/canvas_chat/static/js/plugins/perplexity.js` - Feature plugin
3. `/src/canvas_chat/static/js/plugins/perplexity-node.js` - Node renderer

## Architecture Notes

- Uses official Perplexity Python SDK (`perplexity` package)
- SSE streaming for real-time updates
- CRDT-based graph for collaborative editing
- IndexedDB persistence for offline support
- Modal registration via ModalManager
- StreamingManager for stop/continue functionality
