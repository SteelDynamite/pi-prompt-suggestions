import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function promptSuggestions(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("pi-prompt-suggestions loaded", "info");
  });
}
