# Test project

Start pi from this directory to test the local extension:

```bash
cd test
pi
```

Pi auto-discovers `.pi/extensions/next-prompt-suggestion.ts` and enables debug notifications for model-generated suggestions.

Expected behavior on startup:

1. A dim suggestion appears below the editor: `→ run the tests`.
2. Press Right Arrow while the editor is empty.
3. The editor fills with `run the tests`.
4. Typing instead clears the suggestion.

You can also show the test suggestion again with:

```text
/next-suggestion-test
```

To test model generation, send a normal prompt. After the agent finishes, debug notifications should show one of:

- `generating...`
- `raw: "..."`
- `shown: ...`
- `rejected: ...`
- `auth unavailable: ...`
- `response: error; ...`
- `error: ...`

Debug output is also appended to `next-suggestion-debug.log` in this directory.
