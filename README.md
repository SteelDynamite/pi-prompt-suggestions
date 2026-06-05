# pi-prompt-suggestions

Pi extension that suggests a natural next prompt after an agent response.

Disclaimer: this is clanker slop.

Behavior:

- Generate a short next-prompt suggestion after `agent_end` in TUI mode.
- Skip non-TUI modes such as RPC, JSON, and print mode.
- Show it as ghost text in the input editor by default.
- Optionally show it below the input editor.
- Accept it with Right Arrow when the editor is empty.
- Submit it immediately with Enter when the editor is empty.
- Optionally accept it with Tab when the editor is empty.
- Leave Tab/autocomplete behavior unchanged unless `acceptTab` is enabled.
- Reject common bad model outputs such as questions, meta text, labels, errors, markdown formatting, evaluative replies, and overlong suggestions.

## Privacy and cost

In TUI mode after each `agent_end`, this extension sends a condensed slice of the just-finished conversation to the configured suggestion model, or to the active Pi model if no suggestion model is configured. That request can include recent user text, assistant text, and tool-call names. Treat it like any other model call: it may incur provider cost and may send conversation context to that provider.

Non-TUI modes, including RPC/Paseo, JSON, and print mode, are skipped so the extension does not generate suggestions or spend tokens where the editor UI cannot use them.

If `PI_PROMPT_SUGGESTIONS_DEBUG=1` is set, debug details are shown in the UI and appended to `next-suggestion-debug.log` in the current working directory. Disable debug logging before working with sensitive prompts.

## Install

From npm:

```bash
pi install npm:pi-prompt-suggestions
```

From GitHub:

```bash
pi install git:github.com/SteelDynamite/pi-prompt-suggestions
```

## Configuration

By default, suggestions use the active Pi model.

Optional global config:

```text
~/.pi/agent/extensions/prompt-suggestions.json
```

Optional project config:

```text
.pi/prompt-suggestions.json
```

Project config overrides global config.

```json
{
  "enabled": true,
  "acceptTab": false,
  "display": "ghost",
  "model": "openai/gpt-5-mini",
  "maxTokens": 256,
  "maxChars": 80
}
```

`acceptTab` defaults to `false`. When `true`, Tab accepts the visible suggestion into an empty editor without submitting; this can steal Tab from autocomplete while a suggestion is visible.

`display` can be `ghost` or `belowEditor`; default is `ghost`.

`ghost` mode intentionally replaces Pi's editor component so it can render inline ghost text. This can override another custom-editor extension. Use `belowEditor` if editor composition matters more than inline suggestions.

`model` uses `provider/modelId`. If omitted or invalid, the extension falls back to the active Pi model.

The suggestion-generation system prompt lives in [`prompts/suggestion-system-prompt.md`](prompts/suggestion-system-prompt.md). Edit that file if you want to change the generation instructions before packaging/installing from source.

See [`docs/plan.md`](docs/plan.md) for the implementation plan.

## Development

Run the validation suite:

```bash
npm run validate
```

Try the extension interactively from the local test project:

```bash
cd test
pi
```
