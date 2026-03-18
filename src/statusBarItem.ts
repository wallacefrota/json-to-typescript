import * as vscode from "vscode";

// ════════════════════════════════════════════════════════
// Status Bar — Fixed button when a JSON file is open.
// ════════════════════════════════════════════════════════

export class JsonStatusBar {
  private _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this._item.text = "$(symbol-interface) JSON → TS";
    this._item.tooltip = "Convert this JSON to TypeScript";
    this._item.command = "jsonToTs.preview";
  }

  public register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Show/hide based on the active editor.
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this._update())
    );

    // Check current editor
    this._update();

    disposables.push(this._item);
    return disposables;
  }

  private _update(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this._item.hide();
      return;
    }

    const doc = editor.document;
    const isJson =
      doc.languageId === "json" ||
      doc.languageId === "jsonc" ||
      doc.fileName.toLowerCase().endsWith(".json");

    if (isJson) {
      this._item.show();
    } else {
      this._item.hide();
    }
  }
}