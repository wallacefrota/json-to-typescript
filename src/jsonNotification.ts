import * as vscode from "vscode";

// ════════════════════════════════════════════════════════
// Automatic notification when opening a large .json file.
// ════════════════════════════════════════════════════════

const DISMISSED_KEY = "jsonToTs.dismissedFiles";
const MIN_LINES = 4; // Only suggests if the JSON has at least N lines

export class JsonNotificationManager {
  private _dismissed: Set<string>;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._dismissed = new Set(
      context.globalState.get<string[]>(DISMISSED_KEY, [])
    );
  }

  // ── Register listener to open documents. ──
  public register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // When you open an editor
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this._check(editor.document);
        }
      })
    );

    // Check the current editor (if it's already open).
    if (vscode.window.activeTextEditor) {
      this._check(vscode.window.activeTextEditor.document);
    }

    return disposables;
  }

  private async _check(document: vscode.TextDocument): Promise<void> {
    // only JSON
    if (
      document.languageId !== "json" &&
      document.languageId !== "jsonc" &&
      !document.fileName.toLowerCase().endsWith(".json")
    ) {
      return;
    }

    // Ignore very small files.
    if (document.lineCount < MIN_LINES) {
      return;
    }

    // Ignore whether you've already deleted this file.
    const fileKey = document.uri.toString();
    if (this._dismissed.has(fileKey)) {
      return;
    }

    // Ignores package.json, tsconfig, etc.
    const name = document.fileName.toLowerCase();
    const ignoredFiles = [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "jsconfig.json",
      ".eslintrc.json",
      ".prettierrc.json",
      "composer.json",
      "manifest.json",
      "launch.json",
      "settings.json",
      "tasks.json",
      "extensions.json",
      "devcontainer.json",
    ];
    if (ignoredFiles.some((f) => name.endsWith(f))) {
      return;
    }

    // Check if it looks like JSON data (it has at least one object).
    const text = document.getText().trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      return;
    }

    // ── Show notification ──
    const lines = document.lineCount;
    const action = await vscode.window.showInformationMessage(
      `💡 This JSON file has ${lines} lines. Do you want to generate TypeScript types?`,
      "🔄 Interactive Preview",
      "⚡ Convert Now",
      "Do not show again"
    );

    switch (action) {
      case "🔄 Interactive Preview":
        vscode.commands.executeCommand("jsonToTs.preview");
        break;

      case "⚡ Convert Now":
        vscode.commands.executeCommand("jsonToTs.convertFile");
        break;

      case "Do not show again":
        this._dismissed.add(fileKey);
        await this._context.globalState.update(
          DISMISSED_KEY,
          [...this._dismissed]
        );
        break;
    }
  }
}