# pi-prompt-suggestions

Pi extension that suggests a natural next prompt after an agent response.

Planned behavior:

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
