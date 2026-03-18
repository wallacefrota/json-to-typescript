import * as vscode from "vscode";
import { PreviewPanel } from "./previewPanel";

// ════════════════════════════════════════════════════════
// Paste Detector — Detects pasted JSON and suggests conversion.
// ════════════════════════════════════════════════════════

export class PasteDetector {
  private _context: vscode.ExtensionContext;
  private _cooldown = false;
  private _enabled = true;
  private _lastPasteTime = 0;
  private _dismissedHashes = new Set<string>();

  // Configurable
  private _minLines = 2;
  private _minLength = 20;
  private _cooldownMs = 3000;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;

    // Restore preferences
    this._enabled = vscode.workspace
      .getConfiguration("jsonToTs")
      .get<boolean>("pasteDetection", true);

    this._dismissedHashes = new Set(
      context.workspaceState.get<string[]>("jsonToTs.dismissedPastes", [])
    );
  }

  // ────────────────────────────────────────
  // REGISTER LISTENERS
  // ────────────────────────────────────────
  public register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // ── Listener principal: changes to the document ──
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this._enabled) return;
        this._onDocumentChange(e);
      })
    );

    // ── Configuration listener ──
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("jsonToTs.pasteDetection")) {
          this._enabled = vscode.workspace
            .getConfiguration("jsonToTs")
            .get<boolean>("pasteDetection", true);
        }
      })
    );

    // ── command toggle on/off ──
    disposables.push(
      vscode.commands.registerCommand("jsonToTs.togglePasteDetection", () => {
        this._enabled = !this._enabled;
        vscode.workspace
          .getConfiguration("jsonToTs")
          .update("pasteDetection", this._enabled, true);

        const status = this._enabled ? "enabled" : "deactivated";
        vscode.window.showInformationMessage(
          `🔄 JSON detection when pasting ${status}`
        );
      })
    );

    return disposables;
  }

  // ────────────────────────────────────────
  // DETECT PASTE
  // ────────────────────────────────────────
  private _onDocumentChange(e: vscode.TextDocumentChangeEvent): void {

    // / Ignore documents without a visible editor

    if (e.document.uri.scheme !== "file" && e.document.uri.scheme !== "untitled") {

      return;

    }

    // / Ignore if already in cooldown

    if (this._cooldown) return;

    // / Ignore automatic changes (formatting, etc.)

    if (e.reason === vscode.TextDocumentChangeReason.Undo ||

      e.reason === vscode.TextDocumentChangeReason.Redo) {

      return;

    }

    // / Analyze the changes

    for (const change of e.contentChanges) {

      const text = change.text;

      // / ── Quick filter: does it look like a paste? ──
      if (!this._looksLikePaste(text)) continue;

      // ── Filter: Does it look like JSON? ──
      if (!this._looksLikeJson(text)) continue;

      // ── Filter: Has this content already been discarded? ──
      const hash = this._simpleHash(text);

      if (this._dismissedHashes.has(hash)) continue;

      // ── Validate that it is parsable JSON ──
      if (!this._isValidJson(text)) continue;

      // ── Cooldown to prevent spam ──
      this._cooldown = true;

      this._lastPasteTime = Date.now();

      // Show popup (with delay to avoid interrupting the paste)

      setTimeout(() => {
        this._showPopup(text, hash, e.document);

      }, 300);

      setTimeout(() => {
        this._cooldown = false;

      }, this._cooldownMs);

      break; // Only processes the first change

    }

  }

  // ────────────────────────────────────────
  // SMART FILTERS
  // ────────────────────────────────────────

  private _looksLikePaste(text: string): boolean {
    // Paste is usually multi-line or long text 
    const lines = text.split("\n").length;
    const len = text.length;

    return lines >= this._minLines || len >= this._minLength;
  }

  private _looksLikeJson(text: string): boolean {
    const trimmed = text.trim();

    // Must start with { or [ 
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return false;
    }

    // Must end with } or ] 
    if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) {
      return false;
    }

    // Must have at least one : (key: value)

    if (!trimmed.includes(":") && !trimmed.includes(",")) {

      return false;

    }

    // Should not look like JS/TS code (functions, imports, etc.)
    const codePatterns = [
      /\bfunction\b/,
      /\bconst\b/,
      /\blet\b/,
      /\bvar\b/,
      /\bimport\b/,
      /\bexport\s+default\b/,
      /\bclass\b/,
      /=>/,
      /\bif\s*\(/,
      /\bfor\s*\(/,
      /\bwhile\s*\(/,
      /\breturn\b/,
    ];

    if (codePatterns.some((p) => p.test(trimmed))) {
      return false;
    }

    return true;
  }

  private _isValidJson(text: string): boolean {
    try {
      // Clear comments and trailing commas
      const cleaned = text
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,\s*([\]}])/g, "$1");

      JSON.parse(cleaned);
      return true;
    } catch {
      // Try using keys without quotes.
      try {
        const cleaned = text
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/,\s*([\]}])/g, "$1")
          .replace(/(?<=[{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '"$1":');

        JSON.parse(cleaned);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ────────────────────────────────────────
  // POPUP
  // ────────────────────────────────────────

  private async _showPopup(
    jsonText: string,
    hash: string,
    document: vscode.TextDocument
  ): Promise<void> {
    // Calculate JSON info to display in the popup
    const info = this._getJsonInfo(jsonText);

    const action = await vscode.window.showInformationMessage(
      `⚡ JSON detected! ${info} — Convert to TypeScript?`,
      { modal: false },
      "🔄 Preview",
      "⚡ Convert",
      "📋 Copy as TS",
      "🔇 Do not show"
    );

    switch (action) {
      case "🔄 Preview":
        PreviewPanel.createOrShow(this._context.extensionUri, jsonText);
        break;

      case "⚡ Convert":
        vscode.commands.executeCommand("jsonToTs.convertFile");
        break;

      case "📋 Copy as TS":
        vscode.commands.executeCommand("jsonToTs.copyAsTs");
        break;

      case "🔇 Do not show":
        await this._showDismissOptions(hash);
        break;
    }
  }

  private async _showDismissOptions(hash: string): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(x) Ignore this JSON",
          description: "Do not show for this specific content",
          action: "this",

        },

        {
          label: "$(mute) Disable for this session",
          description: "Reactivates when the editor restarts",
          action: "session",

        },

        {
          label: "$(settings-gear) Disable permanently",
          description: "Can be reactivated in Settings → jsonToTs.pasteDetection",
          action: "permanent",

        },
      ],
      { placeHolder: "How do you want to mute?" }
    );

    if (!choice) return;

    switch (choice.action) {
      case "this":
        this._dismissedHashes.add(hash);
        await this._context.workspaceState.update(
          "jsonToTs.dismissedPastes",
          [...this._dismissedHashes]
        );
        break;

      case "session":
        this._enabled = false;
        break;

      case "permanent":
        this._enabled = false;
        await vscode.workspace
          .getConfiguration("jsonToTs")
          .update("pasteDetection", false, true);
        break;
    }
  }

  // ────────────────────────────────────────
  // INFO JSON
  // ────────────────────────────────────────

  private _getJsonInfo(text: string): string {
    const trimmed = text.trim();
    const lines = text.split("\n").length;
    const parts: string[] = [];

    parts.push(`${lines} rows`);

    try {
      const cleaned = text
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,\s*([\]}])/g, "$1");

      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        parts.push(`array with ${parsed.length} itens`);
        if (parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
          const keys = Object.keys(parsed[0]).length;
          parts.push(`${keys} fields`);
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        const keys = Object.keys(parsed).length;
        parts.push(`${keys} fields`);

        // Counting depth
        const depth = this._getDepth(parsed);
        if (depth > 1) {
          parts.push(`${depth} levels`);
        }
      }
    } catch {
      // Fallback
    }

    return `(${parts.join(", ")})`;
  }

  private _getDepth(obj: unknown, current: number = 0): number {
    if (typeof obj !== "object" || obj === null) return current;

    let maxDepth = current + 1;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "object" && item !== null) {
          maxDepth = Math.max(maxDepth, this._getDepth(item, current + 1));
        }
      }
    } else {
      for (const value of Object.values(obj as Record<string, unknown>)) {
        if (typeof value === "object" && value !== null) {
          maxDepth = Math.max(maxDepth, this._getDepth(value, current + 1));
        }
      }
    }

    return maxDepth;
  }

  // ────────────────────────────────────────
  // UTILITIES
  // ────────────────────────────────────────

  private _simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}