import * as vscode from "vscode";

// ════════════════════════════════════════════════════════
// CodeLens — Show options in up file .json
// ════════════════════════════════════════════════════════

export class JsonCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChange.event;

  public refresh(): void {
    this._onDidChange.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    // Only show file JSON
    if (!this._isJsonLike(document)) {
      return [];
    }

    // Check if the content is valid JSON (or at least appears to be).
    const text = document.getText().trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      return [];
    }

    // Position: row 0, column 0 (top of file)
    const topRange = new vscode.Range(0, 0, 0, 0);

    return [
      // ── 🔍 Preview Interactive ──
      new vscode.CodeLens(topRange, {
        title: "🔄 Generate TypeScript types",
        tooltip: "Open interactive preview to convert this JSON into TypeScript interfaces.",
        command: "jsonToTs.preview",
      }),

      // ── ⚡ Quick Conversion ──
      new vscode.CodeLens(topRange, {
        title: "⚡ Quick Convert",
        tooltip: "Convert this JSON directly to TypeScript.",
        command: "jsonToTs.convertFile",
      }),

      // ── 📋 Copy as TS ──
      new vscode.CodeLens(topRange, {
        title: "📋 Copy as TypeScript",
        tooltip: "Convert and copy to clipboard",
        command: "jsonToTs.copyAsTs",
      }),
    ];
  }

  private _isJsonLike(document: vscode.TextDocument): boolean {
    // Check by languageId
    if (document.languageId === "json" || document.languageId === "jsonc") {
      return true;
    }

    // Check by extension
    const name = document.fileName.toLowerCase();
    if (
      name.endsWith(".json") ||
      name.endsWith(".jsonc") ||
      name.endsWith(".json5")
    ) {
      return true;
    }

    return false;
  }
}