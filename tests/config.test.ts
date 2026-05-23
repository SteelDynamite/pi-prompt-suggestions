import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __test__ } from "../src/index.ts";

const { mergeConfigInputs, parseConfigInput, parseModelSpec, sanitizeSuggestion } = __test__;

describe("configuration helpers", () => {
	it("merges config with project values overriding global values", () => {
		assert.deepEqual(
			mergeConfigInputs(
				{ enabled: false, maxChars: 40, maxTokens: 100, model: "openai/a" },
				{ enabled: true, model: "anthropic/b" },
			),
			{ enabled: true, maxChars: 40, maxTokens: 100, model: "anthropic/b" },
		);
	});

	it("uses defaults when config files are empty", () => {
		assert.deepEqual(mergeConfigInputs({}, {}), { enabled: true, maxChars: 80, maxTokens: 256 });
	});

	it("parses valid config fields", () => {
		assert.deepEqual(
			parseConfigInput({ enabled: false, model: " openai/gpt ", maxChars: 120, maxTokens: 512 }),
			{ enabled: false, model: "openai/gpt", maxChars: 120, maxTokens: 512 },
		);
	});

	it("ignores invalid config fields", () => {
		const warnings: string[] = [];
		assert.deepEqual(
			parseConfigInput(
				{ enabled: "yes", model: "", maxChars: 0, maxTokens: 1.5 },
				"test.json",
				(message) => warnings.push(message),
			),
			{},
		);
		assert.equal(warnings.length, 4);
	});

	it("parses provider/model specs", () => {
		assert.deepEqual(parseModelSpec("openai/gpt-5-mini"), { provider: "openai", model: "gpt-5-mini" });
		assert.deepEqual(parseModelSpec("openrouter/anthropic/claude-sonnet-4.5"), {
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.5",
		});
		assert.equal(parseModelSpec("gpt-5-mini"), undefined);
		assert.equal(parseModelSpec("/gpt-5-mini"), undefined);
		assert.equal(parseModelSpec("openai/"), undefined);
	});

	it("uses configured maxChars in sanitizer", () => {
		const suggestion = "run " + "x".repeat(77);
		assert.equal(sanitizeSuggestion(suggestion, 120), suggestion);
		assert.equal(sanitizeSuggestion(suggestion, 80), undefined);
	});
});
