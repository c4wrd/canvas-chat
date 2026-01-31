# Perplexity Responses API Testing Guide

## Prerequisites

1. **Perplexity API Key**: You need a valid Perplexity API key with access to the responses.create endpoint
2. **Server Running**: Start dev server with `mise run dev`
3. **Browser**: Open http://127.0.0.1:7865 in your browser

## Quick Test Commands

### 1. Fast Search (`/perplexity`)

```
/perplexity What is quantum entanglement?
```

**Expected Behavior:**
- Single-step search (max_steps=1)
- No reasoning section
- Fast results (<10 seconds)
- Citations displayed at bottom
- Node labeled "Perplexity Fast"

### 2. Deep Research (`/perplexity-research`)

```
/perplexity-research Analyze the impact of AI on healthcare in 2025
```

**Expected Behavior:**
- Multi-step research (up to 10 steps)
- Progress bar showing completion
- Reasoning section (collapsible)
- Research steps section (collapsible)
- Each step shows:
  - Step number (✅ completed, ⏳ in progress)
  - Thinking content
  - Main findings
  - Sources
- Node labeled "Perplexity Research"
- Takes 30-60 seconds

### 3. Agent Configuration (`/perplexity-agent`)

```
/perplexity-agent Explain climate change mitigation strategies
```

**Expected Behavior:**
1. Modal opens with configuration options
2. Query field shows your question (read-only)
3. Preset selector defaults to first option
4. Advanced options hidden unless "Custom" selected

**Test Preset Configurations:**

**Fast Search Preset:**
- Select "Fast Search"
- Advanced options hidden
- Click "Start Research"
- Should behave like `/perplexity` (1 step, no reasoning)

**Pro Search Preset:**
- Select "Pro Search"
- Advanced options hidden
- Click "Start Research"
- Should do 3 steps with medium reasoning

**Deep Research Preset:**
- Select "Deep Research"
- Advanced options hidden
- Click "Start Research"
- Should do 10 steps with high reasoning

**Custom Configuration:**
- Select "Custom Configuration"
- Advanced options appear
- Test each control:
  - Model dropdown: Select "Claude Sonnet 4.5"
  - Max steps slider: Drag to 5
  - Reasoning: Select "High"
  - Tools: Check both Web Search and Fetch URL
  - Custom instructions: "Focus on recent 2025 developments"
- Click "Start Research"
- Verify research uses custom settings

## UI Element Tests

### Modal Tests

1. **Open Modal:**
   ```
   /perplexity-agent test query
   ```
   - Modal should appear centered
   - Background should dim
   - Query field should show "test query"

2. **Preset Switching:**
   - Change preset dropdown
   - Advanced options should hide/show correctly
   - Only "Custom Configuration" shows advanced options

3. **Slider Interaction:**
   - Drag max steps slider
   - Value label should update in real-time
   - Range: 1-10

4. **Cancel:**
   - Click X button or Cancel button
   - Modal should close
   - No node created

5. **Start Research:**
   - Configure options
   - Click "Start Research"
   - Modal should close
   - Research node should appear

### Node Rendering Tests

1. **Status Indicator:**
   - During research: Shows spinner + step count
   - "Step 3 of 5 - Searching and analyzing..."

2. **Progress Bar:**
   - Should show during multi-step research
   - Updates as steps complete
   - Shows "X of Y steps completed"

3. **Model Badge:**
   - Fast Search → "Fast Search"
   - Pro Search → "Pro Search"
   - Deep Research → "Deep Research"
   - Custom model → Model name

4. **Reasoning Section:**
   - Click to expand/collapse
   - Shows purple-tinted background
   - Contains thinking content
   - Brain emoji (🧠) in header

5. **Research Steps Section:**
   - Click to expand/collapse
   - Shows blue-tinted background
   - Each step is a card with:
     - Status icon (✅ or ⏳)
     - Step number
     - Thinking (italic, purple-bordered)
     - Content (markdown rendered)
     - Sources (clickable links)
   - Clipboard emoji (📋) in header

6. **Main Content:**
   - Markdown rendered correctly
   - Citation badges [1] [2] clickable
   - Hover shows source title
   - Click opens source URL

7. **Sources Section:**
   - Listed at bottom
   - Numbered [1] [2] [3]
   - Clickable links
   - Domain names shown as titles

### Streaming Tests

1. **Real-time Updates:**
   - Content should appear word-by-word
   - Progress bar should update smoothly
   - Step counter should increment

2. **Stop Button:**
   - Click stop during streaming
   - Streaming should pause
   - Continue button should appear

3. **Continue Button:**
   - Click continue after stopping
   - Streaming should resume from where it left off

## Backend API Tests

### Direct API Test (with curl)

```bash
# Replace YOUR_API_KEY with your actual Perplexity API key
curl -N -X POST http://127.0.0.1:7865/api/perplexity/responses \
  -H "Content-Type: application/json" \
  -d '{
    "input": "What is the capital of France?",
    "preset": "fast-search",
    "api_key": "YOUR_API_KEY",
    "stream": true
  }'
```

**Expected SSE Events:**
```
event: step_start
data: {"step": 1}

event: step_content
data: Paris

event: step_content
data:  is

event: step_content
data:  the

event: step_content
data:  capital

event: step_sources
data: [{"url": "...", "title": "..."}]

event: step_complete
data: {"step": 1}

event: citations
data: [{"url": "...", "title": "..."}]

event: done
data:
```

### Test Error Handling

1. **Invalid API Key:**
   ```
   /perplexity test with invalid key
   ```
   - Should show error message in node
   - Error toast should appear

2. **Network Failure:**
   - Stop server mid-request
   - Should handle gracefully
   - Error message should appear

3. **Empty Query:**
   ```
   /perplexity
   ```
   - Should show error toast
   - "Please provide a question"

## Integration Tests

### Multi-Step Research Flow

1. Create a note with context:
   ```
   Create a note: "Focus on renewable energy and solar technology"
   ```

2. Select the note

3. Run deep research:
   ```
   /perplexity-research Latest advancements in solar energy
   ```

4. Verify context is used:
   - Check that response mentions renewable energy
   - Sources should be relevant to solar

### Concurrent Research

1. Start first research:
   ```
   /perplexity-research Topic A
   ```

2. Immediately start second research:
   ```
   /perplexity-research Topic B
   ```

3. Verify both stream simultaneously
4. Both should complete successfully
5. No cross-contamination of content

### Session Persistence

1. Start deep research
2. Wait for 2-3 steps to complete
3. Reload browser page (Cmd+R / Ctrl+R)
4. Verify:
   - Node still exists
   - Previous content preserved
   - Research can continue if incomplete

## Performance Tests

### Large Research (10 Steps)

```
/perplexity-research Comprehensive analysis of global economic trends in 2025, including inflation, trade, technology sector, emerging markets, and sustainability
```

**Monitor:**
- Memory usage (should not spike excessively)
- UI responsiveness (should remain smooth)
- Total duration (typically 60-90 seconds)
- All 10 steps complete successfully

### Citation Aggregation

```
/perplexity-research Find sources about quantum computing applications
```

**Verify:**
- Citations from all steps are aggregated
- No duplicate citations
- All citations have valid URLs
- Citation badges match source numbers

## Dark Mode Test

1. Enable dark mode in browser
2. Run any perplexity command
3. Verify:
   - Node background is dark blue (#0d3a5c)
   - Reasoning section has dark purple tint
   - Steps section has dark blue tint
   - Text is readable
   - Citation badges are bright (#42a5f5)

## Accessibility Tests

1. **Keyboard Navigation:**
   - Tab through modal controls
   - Enter to submit
   - Escape to close

2. **Screen Reader:**
   - Modal labels should be descriptive
   - Links should have meaningful text
   - Status messages should be announced

## Known Issues / Limitations

1. **Responses API Access:**
   - Not all Perplexity API keys have responses.create access
   - May need to upgrade plan

2. **Model Support:**
   - Not all models support reasoning parameter
   - Some models may not support multi-step

3. **Rate Limits:**
   - Perplexity API has rate limits
   - May need to wait between requests

4. **Browser Compatibility:**
   - Tested in Chrome, Firefox, Safari
   - SSE streaming requires modern browser

## Success Criteria

✅ All commands register and execute
✅ Modal opens and configures correctly
✅ SSE streaming works in real-time
✅ Progress indicators update
✅ Reasoning content displays
✅ Steps section is collapsible
✅ Citations are clickable
✅ Stop/continue works
✅ Session persistence works
✅ Error handling is graceful
✅ Dark mode renders correctly

## Troubleshooting

### Modal Doesn't Open
- Check browser console for errors
- Verify modalManager is initialized
- Check if modal template registered in onLoad()

### No Content Streaming
- Verify API key is valid
- Check network tab for SSE connection
- Look for CORS errors
- Verify server endpoint is accessible

### Citations Not Showing
- Check if response includes citations
- Verify JSON parsing is successful
- Check node.citations array in graph

### Progress Bar Not Updating
- Verify step_complete events are received
- Check max_steps value in config
- Ensure percentage calculation is correct

## Report Issues

If you find bugs or unexpected behavior:

1. Check browser console for errors
2. Check server logs for backend errors
3. Note the specific command used
4. Document the expected vs actual behavior
5. Create issue in GitHub repository
