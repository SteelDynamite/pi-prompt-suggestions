import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
	CustomEditor,
	convertToLlm,
	type AgentEndEvent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { completeSimple, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "next-prompt-suggestion";
const MAX_CHARS = 80;

let suggestion: string | undefined;
let generationId = 0;
let lastCtx: ExtensionContext | undefined;

const SUGGESTION_SYSTEM_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into pi.]

Look at the user's recent messages and the assistant's latest response.
Predict what the user would naturally type next, not what you think they should do.

Good suggestions:
- are 2-8 words
- match the user's style
- are specific
- continue an obvious workflow
- are imperative user prompts like "run the tests" or "commit this"
- follow an explicit user-stated next request

Examples:
- User asked to fix a bug and tests were not run: run the tests
- User asked to create or edit package.json with a test script and tests were not run: run the tests
- User said "count to 10 and then I will ask you to count to 20" and assistant counted to 10: count to 20
- Code was written and obvious manual check remains: try it out
- Assistant asks whether to continue: yes
- Task complete and changes are ready: commit this

Never suggest:
- thanks / looks good / evaluative replies
- questions
- Claude/pi voice like "let me" or "I'll"
- new ideas the user did not ask about
- multiple sentences

If the user explicitly said what they will ask next, suggest that exact next request.
If a file was created/edited and tests/checks were not run, the next step is clear: suggest running the relevant test/check.
Only reply with nothing when there is genuinely no plausible next user prompt.
Reply with only the suggestion text.`;

class SuggestionEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, Key.right) && this.getText().length === 0 && suggestion) {
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

export default function promptSuggestions(pi: ExtensionAPI) {
	if (process.env.PI_PROMPT_SUGGESTIONS_TEST === "1") {
		pi.registerCommand("next-suggestion-test", {
			description: "Show a test next-prompt suggestion",
			handler: async (_args, ctx) => {
				lastCtx = ctx;
				showSuggestion("run the tests", ctx);
			},
		});
	}

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
		clearSuggestion(ctx);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new SuggestionEditor(tui, theme, keybindings));
		if (process.env.PI_PROMPT_SUGGESTIONS_TEST === "1") {
			showSuggestion("run the tests", ctx);
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		lastCtx = ctx;
		clearSuggestion(ctx);
	});

	pi.on("input", (_event, ctx) => {
		lastCtx = ctx;
		clearSuggestion(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearSuggestion(ctx);
		ctx.ui.setEditorComponent(undefined);
		lastCtx = undefined;
	});

	pi.on("agent_end", async (event, ctx) => {
		lastCtx = ctx;
		clearSuggestion(ctx);

		if (!ctx.hasUI) return;
		if (ctx.hasPendingMessages()) return debug(ctx, "skipped: pending messages");
		if (ctx.ui.getEditorText().trim().length > 0) return debug(ctx, "skipped: editor is not empty");
		if (!ctx.model) return debug(ctx, "skipped: no model selected");

		const id = ++generationId;
		debug(ctx, "generating...");

		try {
			const text = await generateSuggestion(event.messages, ctx);
			debug(ctx, `raw: ${JSON.stringify(truncatePlain(text, 160))}`);
			if (id !== generationId) return debug(ctx, "ignored: stale result");
			if (ctx.hasPendingMessages()) return debug(ctx, "ignored: pending messages appeared");
			if (ctx.ui.getEditorText().trim().length > 0) return debug(ctx, "ignored: editor became non-empty");

			const clean = sanitizeSuggestion(text);
			if (!clean) return debug(ctx, `rejected: ${JSON.stringify(truncatePlain(text, 160))}`);

			showSuggestion(clean, ctx);
			debug(ctx, `shown: ${clean}`);
		} catch (error) {
			debug(ctx, `error: ${error instanceof Error ? error.message : String(error)}`);
			// Suggestion generation is best-effort and must never interrupt normal use.
		}
	});
}

function clearSuggestion(ctx = lastCtx): void {
	generationId++;
	suggestion = undefined;
	ctx?.ui.setWidget(WIDGET_KEY, undefined);
}

function showSuggestion(text: string, ctx = lastCtx): void {
	clearSuggestion(ctx);
	suggestion = text;
	renderSuggestion(ctx);
}

function renderSuggestion(ctx = lastCtx): void {
	if (!ctx || !suggestion) return;
	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui, theme) => ({
			render: (width: number) => [truncateToWidth(theme.fg("dim", `→ ${suggestion}`), width)],
			invalidate: () => {},
		}),
		{ placement: "belowEditor" },
	);
}

async function generateSuggestion(messages: AgentEndEvent["messages"], ctx: ExtensionContext): Promise<string> {
	if (!ctx.model) return "";

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) {
		debug(ctx, `auth unavailable: ${"error" in auth ? auth.error : "unknown error"}`);
		return "";
	}

	const llmMessages = convertToLlm(messages);
	const context = buildSuggestionContext(llmMessages);
	debug(ctx, `context: ${JSON.stringify(truncatePlain(context, 240))}`);
	const options = {
		apiKey: auth.apiKey,
		headers: auth.headers,
		maxTokens: 256,
		reasoning: ctx.model.reasoning ? ("minimal" as const) : undefined,
	};

	const response = await completeSimple(
		ctx.model,
		{
			systemPrompt: SUGGESTION_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: context,
					timestamp: Date.now(),
				},
			],
		},
		options,
	);

	debug(
		ctx,
		`response: ${response.stopReason}; ${response.content.map((part) => part.type).join(",")}; ${response.errorMessage ?? ""}`,
	);
	if (response.diagnostics?.length) {
		debug(ctx, `diagnostics: ${JSON.stringify(response.diagnostics).slice(0, 500)}`);
	}
	return extractAssistantText(response);
}

function buildSuggestionContext(messages: Message[]): string {
	const recent = messages.slice(-8).map(formatMessageForSuggestion).filter(Boolean);
	return `Recent conversation from the just-finished agent turn:\n\n${recent.join("\n\n")}`;
}

function formatMessageForSuggestion(message: Message): string {
	const role = getMessageRole(message);
	const text = extractMessageText(message).trim();
	if (!text) return `${role}: [no text]`;
	return `${role}: ${truncatePlain(text, 2_000)}`;
}

function getMessageRole(message: unknown): string {
	if (isRecord(message) && typeof message.role === "string") return message.role;
	if (isRecord(message) && typeof message.type === "string") return message.type;
	return "message";
}

function extractMessageText(message: unknown): string {
	if (!isRecord(message)) return "";
	const { content } = message;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return JSON.stringify(message);
	return content
		.map((part) => {
			if (!isRecord(part) || typeof part.type !== "string") return "";
			if (part.type === "text" && typeof part.text === "string") return part.text;
			if (part.type === "thinking") return "";
			if (part.type === "toolCall" && typeof part.name === "string") return `[tool call: ${part.name}]`;
			if (part.type === "image") return "[image]";
			return "";
		})
		.join("\n");
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sanitizeSuggestion(text: string): string | undefined {
	let clean = text.trim();
	if (!clean) return undefined;
	if (clean.includes("\n")) return undefined;

	clean = clean.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "").trim();
	clean = clean.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "").trim();
	clean = clean.replace(/\.$/, "").trim();

	if (!clean) return undefined;
	if (clean.length > MAX_CHARS) return undefined;
	if (clean.endsWith("?")) return undefined;
	if (/[.!?].+\S/.test(clean)) return undefined;

	const lower = clean.toLowerCase();
	if (/^(let me|i'll|i can|here's)\b/.test(lower)) return undefined;
	if (/^(thanks|thank you|looks good|sounds good|ok thanks|okay thanks)[!.]?$/i.test(clean)) return undefined;

	return clean;
}

function isUserEditKey(data: string): boolean {
	if (data.length === 1 && data.charCodeAt(0) >= 32) return true;
	return (
		matchesKey(data, Key.backspace) ||
		matchesKey(data, Key.delete) ||
		matchesKey(data, Key.enter) ||
		matchesKey(data, Key.tab)
	);
}

function truncatePlain(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function debug(ctx: ExtensionContext, message: string): void {
	if (process.env.PI_PROMPT_SUGGESTIONS_DEBUG !== "1") return;
	ctx.ui.setStatus("next-suggestion", `suggestion: ${message}`);
	ctx.ui.notify(`next-suggestion: ${message}`, "info");
	try {
		appendFileSync(join(ctx.cwd, "next-suggestion-debug.log"), `${new Date().toISOString()} ${message}\n`);
	} catch {
		// Debug logging must not affect the extension.
	}
}

export const __test__ = {
	buildSuggestionContext,
	extractAssistantText,
	extractMessageText,
	formatMessageForSuggestion,
	getMessageRole,
	sanitizeSuggestion,
	truncatePlain,
};
