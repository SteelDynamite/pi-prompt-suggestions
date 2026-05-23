# pi-prompt-suggestions

Pi extension that suggests a natural next prompt after an agent response.

Behavior:

- Generate a short next-prompt suggestion after `agent_end`.
- Show it near the input editor.
- Accept it with Right Arrow when the editor is empty.
- Leave Tab/autocomplete behavior unchanged.

## Install

From GitHub:

```bash
pi install git:github.com/SteelDynamite/pi-prompt-suggestions@v0.1.0
```

After npm publishing:

```bash
pi install npm:pi-prompt-suggestions@0.1.0
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
  "model": "openai/gpt-5-mini",
  "maxTokens": 256,
  "maxChars": 80
}
```

`model` uses `provider/modelId`. If omitted or invalid, the extension falls back to the active Pi model.

The suggestion-generation system prompt lives in [`prompts/suggestion-system-prompt.md`](prompts/suggestion-system-prompt.md).

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
