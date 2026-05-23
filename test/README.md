# Test project

Start pi from this directory to test the local extension:

```bash
cd test
pi
```

Pi auto-discovers `.pi/extensions/next-prompt-suggestion.ts` and enables debug notifications for model-generated suggestions.

This test project also includes `.pi/prompt-suggestions.json`. It defaults to ghost display and enables `acceptTab` for testing. Set `display` to `belowEditor` to test the fallback widget mode.

Add a `model` field there to test a dedicated suggestion model:

```json
{
  "model": "openai/gpt-5-mini"
}
```

To test model generation, send a normal prompt with an obvious next step. After the agent finishes, a suggestion should appear as dim ghost text in the editor.

Expected behavior when a suggestion is visible:

1. Press Right Arrow while the editor is empty.
2. The editor fills with the suggestion without submitting.
3. Or press Tab while the editor is empty.
4. The editor fills with the suggestion without submitting.
5. Or press Enter while the editor is empty.
6. The suggestion is submitted immediately.
7. Typing instead clears the suggestion.

Debug notifications should show one of:

- `generating...`
- `raw: "..."`
- `shown: ...`
- `rejected: ...`
- `auth unavailable: ...`
- `response: error; ...`
- `error: ...`

Debug output is also appended to `next-suggestion-debug.log` in this directory.
