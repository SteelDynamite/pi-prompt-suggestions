import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CustomEditor,
	convertToLlm,
	getAgentDir,
	type AgentEndEvent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { completeSimple, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "next-prompt-suggestion";
const DEFAULT_MAX_CHARS = 80;
const DEFAULT_MAX_TOKENS = 256;
const GLOBAL_CONFIG_RELATIVE_PATH = ["extensions", "prompt-suggestions.json"];
const PROJECT_CONFIG_RELATIVE_PATH = [".pi", "prompt-suggestions.json"];
const PROMPT_RELATIVE_PATH = ["prompts", "suggestion-system-prompt.md"];

interface PromptSuggestionsConfig {
	enabled: boolean;
	maxChars: number;
	maxTokens: number;
	model?: string;
}

type PromptSuggestionsConfigInput = Partial<PromptSuggestionsConfig>;

let suggestion: string | undefined;
let generationId = 0;
let lastCtx: ExtensionContext | undefined;

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

		const config = loadConfig(ctx.cwd, (message) => debug(ctx, message));
		if (!config.enabled) return debug(ctx, "skipped: disabled by config");
		if (!ctx.hasUI) return;
		if (ctx.hasPendingMessages()) return debug(ctx, "skipped: pending messages");
		if (ctx.ui.getEditorText().trim().length > 0) return debug(ctx, "skipped: editor is not empty");

		const model = resolveSuggestionModel(ctx, config.model);
		if (!model) return debug(ctx, "skipped: no model selected");

		const id = ++generationId;
		debug(ctx, "generating...");

		try {
			const text = await generateSuggestion(event.messages, ctx, model, config);
			debug(ctx, `raw: ${JSON.stringify(truncatePlain(text, 160))}`);
			if (id !== generationId) return debug(ctx, "ignored: stale result");
			if (ctx.hasPendingMessages()) return debug(ctx, "ignored: pending messages appeared");
			if (ctx.ui.getEditorText().trim().length > 0) return debug(ctx, "ignored: editor became non-empty");

			const clean = sanitizeSuggestion(text, config.maxChars);
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

async function generateSuggestion(
	messages: AgentEndEvent["messages"],
	ctx: ExtensionContext,
	model: Model<any>,
	config: PromptSuggestionsConfig,
): Promise<string> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
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
		maxTokens: config.maxTokens,
		reasoning: model.reasoning ? ("minimal" as const) : undefined,
	};

	const response = await completeSimple(
		model,
		{
			systemPrompt: loadSuggestionSystemPrompt(ctx.cwd, (message) => debug(ctx, message)),
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

function loadSuggestionSystemPrompt(cwd: string, onWarning?: (message: string) => void): string {
	const packagePromptPath = join(resolvePackageRoot(cwd), ...PROMPT_RELATIVE_PATH);
	try {
		return readFileSync(packagePromptPath, "utf-8").trim();
	} catch (error) {
		onWarning?.(`prompt load failed: ${packagePromptPath}: ${error instanceof Error ? error.message : String(error)}`);
		return FALLBACK_SUGGESTION_SYSTEM_PROMPT;
	}
}

function resolvePackageRoot(cwd: string): string {
	let dir = import.meta.dirname;
	while (dir !== join(dir, "..")) {
		if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "src", "index.ts"))) return dir;
		dir = join(dir, "..");
	}
	return cwd;
}

const FALLBACK_SUGGESTION_SYSTEM_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into pi.]\n\nReply with only a short natural next prompt, or nothing if unclear.`;

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

function sanitizeSuggestion(text: string, maxChars = DEFAULT_MAX_CHARS): string | undefined {
	let clean = text.trim();
	if (!clean) return undefined;
	if (clean.includes("\n")) return undefined;

	clean = clean.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "").trim();
	clean = clean.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "").trim();
	clean = clean.replace(/\.$/, "").trim();

	if (!clean) return undefined;
	if (clean.length > maxChars) return undefined;
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

function loadConfig(cwd: string, onWarning?: (message: string) => void): PromptSuggestionsConfig {
	const globalPath = join(getAgentDir(), ...GLOBAL_CONFIG_RELATIVE_PATH);
	const projectPath = join(cwd, ...PROJECT_CONFIG_RELATIVE_PATH);
	return mergeConfigInputs(
		readConfigFile(globalPath, onWarning),
		readConfigFile(projectPath, onWarning),
	);
}

function readConfigFile(path: string, onWarning?: (message: string) => void): PromptSuggestionsConfigInput {
	if (!existsSync(path)) return {};
	try {
		return parseConfigInput(JSON.parse(readFileSync(path, "utf-8")), path, onWarning);
	} catch (error) {
		onWarning?.(`config ignored: ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
}

function parseConfigInput(
	value: unknown,
	path = "config",
	onWarning?: (message: string) => void,
): PromptSuggestionsConfigInput {
	if (!isRecord(value)) {
		onWarning?.(`config ignored: ${path}: expected object`);
		return {};
	}

	const config: PromptSuggestionsConfigInput = {};
	if ("enabled" in value) {
		if (typeof value.enabled === "boolean") config.enabled = value.enabled;
		else onWarning?.(`config ignored: ${path}: enabled must be boolean`);
	}
	if ("model" in value) {
		if (typeof value.model === "string" && value.model.trim()) config.model = value.model.trim();
		else onWarning?.(`config ignored: ${path}: model must be non-empty string`);
	}
	if ("maxChars" in value) {
		if (isPositiveInteger(value.maxChars)) config.maxChars = value.maxChars;
		else onWarning?.(`config ignored: ${path}: maxChars must be positive integer`);
	}
	if ("maxTokens" in value) {
		if (isPositiveInteger(value.maxTokens)) config.maxTokens = value.maxTokens;
		else onWarning?.(`config ignored: ${path}: maxTokens must be positive integer`);
	}
	return config;
}

function mergeConfigInputs(...configs: PromptSuggestionsConfigInput[]): PromptSuggestionsConfig {
	return {
		enabled: true,
		maxChars: DEFAULT_MAX_CHARS,
		maxTokens: DEFAULT_MAX_TOKENS,
		...Object.assign({}, ...configs),
	};
}

function resolveSuggestionModel(ctx: ExtensionContext, configuredModel: string | undefined): Model<any> | undefined {
	if (!configuredModel) return ctx.model;
	const parsed = parseModelSpec(configuredModel);
	if (!parsed) {
		debug(ctx, `configured model ignored: expected provider/model, got ${configuredModel}`);
		return ctx.model;
	}
	const model = ctx.modelRegistry.find(parsed.provider, parsed.model);
	if (!model) {
		debug(ctx, `configured model not found: ${configuredModel}`);
		return ctx.model;
	}
	return model;
}

function parseModelSpec(spec: string): { provider: string; model: string } | undefined {
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) return undefined;
	return { provider: spec.slice(0, slash), model: spec.slice(slash + 1) };
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
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
	loadSuggestionSystemPrompt,
	mergeConfigInputs,
	parseConfigInput,
	parseModelSpec,
	sanitizeSuggestion,
	truncatePlain,
};
