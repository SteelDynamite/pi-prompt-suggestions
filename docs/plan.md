# Pi Next-Prompt Suggestions Extension Plan

## Goal

Add Claude Code-like suggested next prompts to pi as an extension, without changing pi core.

The extension will:

- Generate a short suggested next user prompt after an agent loop finishes.
- Display the suggestion near the input editor, not as inline ghost text.
- Accept the suggestion with Right Arrow when the input editor is empty.
- Avoid interfering with existing Tab/autocomplete behavior.

## UX

When pi finishes responding, show a dim hint below the editor:

```text
→ run the tests
```

Behavior:

- Press `Right Arrow` on an empty input to fill the editor with the suggestion.
- Start typing anything else to clear the suggestion.
- Submit normally with Enter after accepting/editing.
- No suggestion is shown if the next step is not obvious.

## Architecture

### Extension responsibilities

1. Subscribe to `agent_end`.
2. Generate a suggestion asynchronously.
3. Render the suggestion using `ctx.ui.setWidget()`.
4. Replace the editor with a small `CustomEditor` subclass via `ctx.ui.setEditorComponent()`.
5. Accept the suggestion on Right Arrow only when the editor is empty.
6. Clear stale suggestions on user input, new agent turns, session changes, and reload/shutdown.

### Pi core responsibilities

No required core changes.

Optional future core improvement:

- Add native editor suggestion primitives:
  - `ctx.ui.setEditorSuggestion(text | undefined)`
  - render inline ghost text
  - accept with Tab/Right Arrow

## Files

Proposed location:

```text
~/.pi/agent/extensions/next-prompt-suggestion.ts
```

Optional package layout if dependencies/config grow:

```text
~/.pi/agent/extensions/next-prompt-suggestion/
├── index.ts
└── README.md
```

## Implementation Steps

### 1. Create extension state

Maintain module-level/session-level state:

```ts
let suggestion: string | undefined;
let generationId = 0;
let lastCtx: ExtensionContext | undefined;
```

State rules:

- `suggestion` holds the currently visible suggestion.
- `generationId` invalidates stale async model responses.
- `lastCtx` lets the custom editor accept/clear via current UI context.

### 2. Render suggestion widget

Use a widget below the editor:

```ts
ctx.ui.setWidget(
  "next-prompt-suggestion",
  suggestion
    ? (_tui, theme) => ({
        render: () => [theme.fg("dim", `→ ${suggestion}`)],
        invalidate: () => {},
      })
    : undefined,
  { placement: "belowEditor" }
);
```

Clear with:

```ts
ctx.ui.setWidget("next-prompt-suggestion", undefined);
```

### 3. Add custom editor wrapper

Subclass pi's `CustomEditor`:

```ts
class SuggestionEditor extends CustomEditor {
  handleInput(data: string): void {
    if (isRightArrow(data) && this.getText().length === 0 && suggestion) {
      this.setText(suggestion);
      clearSuggestion();
      return;
    }

    if (suggestion && isUserEditKey(data)) {
      clearSuggestion();
    }

    super.handleInput(data);
  }
}
```

Important constraints:

- Do not use `registerShortcut("right")`; it would consume Right Arrow globally and break cursor movement.
- Only intercept Right Arrow when the editor is empty and a suggestion exists.
- Otherwise pass through to `super.handleInput(data)`.

### 4. Install editor on `session_start`

```ts
pi.on("session_start", (_event, ctx) => {
  lastCtx = ctx;
  ctx.ui.setEditorComponent((tui, theme, keybindings) =>
    new SuggestionEditor(tui, theme, keybindings)
  );
});
```

### 5. Generate suggestions on `agent_end`

On `agent_end`:

1. Clear existing suggestion.
2. Skip if no UI.
3. Skip if there are queued messages.
4. Skip if editor is non-empty.
5. Start async generation.
6. Ignore stale response if `generationId` changed.
7. Validate/sanitize output.
8. Render widget.

Pseudo-code:

```ts
pi.on("agent_end", async (event, ctx) => {
  clearSuggestion();

  if (!ctx.hasUI) return;
  if (ctx.hasPendingMessages()) return;
  if (ctx.ui.getEditorText().trim()) return;
  if (!ctx.model) return;

  const id = ++generationId;
  const text = await generateSuggestion(event.messages, ctx);
  if (id !== generationId) return;

  const clean = sanitizeSuggestion(text);
  if (!clean) return;

  suggestion = clean;
  renderSuggestion(ctx);
});
```

### 6. Suggestion prompt

Use a strict prompt modeled after Claude Code's observed behavior:

```text
[SUGGESTION MODE: Suggest what the user might naturally type next into pi.]

First, look at the user's recent messages, original request, and the assistant's latest response.
Predict what the user would naturally type next, not what you think they should do.

The test: would the user think "I was just about to type that"?

Good suggestions:
- are 2-12 words
- match the user's style
- are specific
- continue an obvious workflow

Examples:
- User asked to fix a bug and tests were not run: run the tests
- Code was written and obvious manual check remains: try it out
- Assistant asks whether to continue: yes
- Task complete and changes are ready: commit this

Never suggest:
- thanks / looks good / evaluative replies
- questions
- Claude/pi voice like "let me" or "I'll"
- new ideas the user did not ask about
- multiple sentences
- unsafe or sensitive actions, including security incidents, credentials, harm, or private data

If the user explicitly said what they will ask next, suggest that exact next request.
If a file was created/edited and tests/checks were not run, the next step is clear: suggest running the relevant test/check.
Only reply with nothing when there is genuinely no plausible next user prompt.
Reply with only the suggestion text.
```

### 7. Model call

Use `completeSimple()` from `@earendil-works/pi-ai`.

Inputs:

- Current model: `ctx.model`
- API key/headers from `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)`
- Short context derived from recent `event.messages`
- Small bounded max token limit; current implementation uses 256 so reasoning models have room to emit visible text
- Do not pass `temperature`; some Pi providers/models reject it

Open decision:

- Use current model by default.
- Later add config for a cheaper/faster model.

### 8. Sanitize output

Reject suggestions that are likely bad:

- empty
- more than 80 characters
- more than one sentence
- contains newline
- starts with quotes and cannot be cleaned
- starts with assistant voice:
  - `let me`
  - `I'll`
  - `I can`
  - `Here's`
- ends with `?`
- is only gratitude/evaluation:
  - `thanks`
  - `thank you`
  - `looks good`

Normalize:

- trim whitespace
- strip wrapping quotes
- strip trailing period if otherwise valid

### 9. Clear suggestion events

Clear suggestion on:

- `agent_start`
- `input`
- `session_shutdown`
- `session_start`
- user typing/editing in the custom editor
- accepting the suggestion
- `/reload` indirectly through session lifecycle

### 10. Error handling

If suggestion generation fails:

- Do not show an error by default.
- Optionally log/debug only.
- Never block agent completion or user input.

### 11. Configuration

Supported options:

```ts
const config = {
  enabled: true,
  acceptKey: "right",
  placement: "belowEditor",
  maxChars: 80,
  maxTokens: 256,
  model: undefined,
};
```

The current implementation loads extension-specific config from:

```text
~/.pi/agent/extensions/prompt-suggestions.json
.pi/prompt-suggestions.json
```

Project config overrides global config:

```json
{
  "enabled": true,
  "model": "openai/gpt-5-mini",
  "maxTokens": 256,
  "maxChars": 80
}
```

Possible future additions:

- extension flags for one-off overrides
- `/next-suggestion on|off`

## Risks

1. **Right Arrow detection**
   - Use pi-tui `matchesKey(data, "right")` rather than raw escape sequences.

2. **Editor compatibility**
   - Extend `CustomEditor`, not base `Editor`, so app-level keybindings still work.

3. **Stale async result**
   - Use `generationId` and clear on new input/agent start.

4. **Suggestion quality**
   - Prompt must strongly prefer silence over weak suggestions.
   - Sanitizer should reject questionable output.

5. **Latency/cost**
   - Run after agent end, asynchronously.
   - Use low max tokens.
   - Consider cheaper model later.

## Acceptance Criteria

- After a successful obvious task, a short suggestion appears below the editor.
- Pressing Right Arrow on an empty editor fills the suggestion.
- Pressing Right Arrow with non-empty editor behaves normally.
- Typing clears the suggestion.
- Tab/autocomplete behavior is unchanged.
- No suggestion appears for unclear next steps.
- Suggestion generation failure is silent and non-blocking.

## Future Improvements

1. Native inline ghost text if pi core adds editor suggestion primitives.
2. Configurable suggestion model.
3. User command to enable/disable suggestions.
4. Heuristic suggestions without model call for common cases:
   - tests not run
   - git changes present
   - assistant asked yes/no
5. Per-project style learning from prompt history.
