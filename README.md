# pi-prompt-suggestions

Pi extension that suggests a natural next prompt after an agent response.

Disclaimer: this is clanker slop.

Behavior:

- Generate a short next-prompt suggestion after `agent_end`.
- Show it as ghost text in the input editor by default.
- Optionally show it below the input editor.
- Accept it with Right Arrow when the editor is empty.
- Submit it immediately with Enter when the editor is empty.
- Optionally accept it with Tab when the editor is empty.
- Leave Tab/autocomplete behavior unchanged unless `acceptTab` is enabled.
- Reject common bad model outputs such as questions, meta text, labels, errors, markdown formatting, evaluative replies, and overlong suggestions.

## Install

From GitHub:

```bash
pi install git:github.com/SteelDynamite/pi-prompt-suggestions@master
```

Latest release tag currently points to the older below-editor implementation:

```bash
pi install git:github.com/SteelDynamite/pi-prompt-suggestions@v0.1.1
```

After npm publishing:

```bash
pi install npm:pi-prompt-suggestions@0.1.1
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
