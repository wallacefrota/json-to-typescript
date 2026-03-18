import * as vscode from "vscode";
import { jsonToTs } from "./jsonToTs";
import { PreviewPanel } from "./previewPanel";

// ════════════════════════════════════════════════════════
// Smart Paste — Intercepts Ctrl+V in .ts/.tsx files
// If the clipboard contains JSON, offers to paste as TypeScript
// ════════════════════════════════════════════════════════

export class SmartPasteProvider {
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Comando de smart paste
    disposables.push(
      vscode.commands.registerCommand(
        "jsonToTs.smartPaste",
        () => this._handleSmartPaste()
      )
    );

    // Keybinding: Ctrl+Shift+J em arquivos .ts/.tsx
    // (defined into package.json)

    return disposables;
  }

  private async _handleSmartPaste(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // read clipboard
    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText.trim()) {
      vscode.window.showWarningMessage("Clipboard vazio.");
      return;
    }

    // verify if is JSON
    if (!this._isJson(clipboardText)) {
      // Not JSON, normally paste
      await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      return;
    }

    // ── Is JSON! Show options ──
    const info = this._getQuickInfo(clipboardText);

    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(symbol-interface) Paste as Interface",
          description: "Converts JSON and pastes it as a TypeScript interface.",
          action: "interface" as const,
        },
        {
          label: "$(symbol-type-parameter) Paste as Type",
          description: "Converts the JSON and pastes it as a TypeScript type.",
          action: "type" as const,
        },
        {
          label: "$(preview) Open in Preview",
          description: "Open the interactive preview to adjust before pasting.",
          action: "preview" as const,
        },
        {
          label: "$(clippy) Paste original JSON",
          description: "Paste the JSON without converting it.",
          action: "raw" as const,
        },
      ],
      {
        placeHolder: `⚡ JSON detected in clipboard. ${info} — How do you want to paste it??`,
        title: "Smart Paste — JSON to TypeScript",
      }
    );

    if (!choice) return;

    switch (choice.action) {
      case "interface":
        await this._pasteAsTs(editor, clipboardText, true);
        break;

      case "type":
        await this._pasteAsTs(editor, clipboardText, false);
        break;

      case "preview":
        PreviewPanel.createOrShow(this._context.extensionUri, clipboardText);
        break;

      case "raw":
        await editor.edit((b) => {
          if (editor.selection.isEmpty) {
            b.insert(editor.selection.active, clipboardText);
          } else {
            b.replace(editor.selection, clipboardText);
          }
        });
        break;
    }
  }

  private async _pasteAsTs(
    editor: vscode.TextEditor,
    jsonText: string,
    useInterface: boolean
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("jsonToTs");

    // ask name
    const rootName = await vscode.window.showInputBox({
      prompt: "Interface name/type",
      value: config.get<string>("rootName", "Root"),
      placeHolder: "Root",
      validateInput: (v) => {
        if (!v.trim()) return "The name cannot be empty.";
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(v)) return "Invalid name";
        return null;
      },
    });

    if (rootName === undefined) return;

    try {
      const result = jsonToTs(jsonText, {
        useInterface,
        rootName: rootName || "Root",
        addExport: config.get<boolean>("addExport", true),
        useSemicolons: config.get<boolean>("useSemicolons", true),
        optionalNull: config.get<boolean>("optionalNull", true),
        detectEnums: config.get<boolean>("detectEnums", true),
        smartNullable: config.get<boolean>("smartNullable", true),
        detectDates: config.get<boolean>("detectDates", true),
        useRealEnums: config.get<boolean>("useRealEnums", false),
        enumMaxValues: config.get<number>("enumMaxValues", 10),
        indent: 2,
      });

      await editor.edit((b) => {
        if (editor.selection.isEmpty) {
          b.insert(editor.selection.active, result);
        } else {
          b.replace(editor.selection, result);
        }
      });

      // Format the pasted region
      await vscode.commands.executeCommand("editor.action.formatDocument");

      vscode.window.showInformationMessage(
        `✅ JSON converted and pasted as ${useInterface ? "interface" : "type"}!`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`❌ Error: ${msg}`);
    }
  }

  private _isJson(text: string): boolean {
    const trimmed = text.trim();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) return false;

    // Anti-code patterns
    const codePatterns = [
      /\bfunction\b/,
      /\bconst\b/,
      /\blet\b/,
      /\bvar\b/,
      /\bimport\b/,
      /\bclass\b/,
      /=>/,
      /\breturn\b/,
    ];
    if (codePatterns.some((p) => p.test(trimmed))) return false;

    try {
      const cleaned = trimmed
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,\s*([\]}])/g, "$1");
      JSON.parse(cleaned);
      return true;
    } catch {
      try {
        const withQuotes = trimmed
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/,\s*([\]}])/g, "$1")
          .replace(/(?<=[{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '"$1":');
        JSON.parse(withQuotes);
        return true;
      } catch {
        return false;
      }
    }
  }

  private _getQuickInfo(text: string): string {
    try {
      const cleaned = text
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,\s*([\]}])/g, "$1");
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        return `(array, ${parsed.length} itens)`;
      }
      if (typeof parsed === "object" && parsed !== null) {
        return `(object, ${Object.keys(parsed).length} fields)`;
      }
    } catch {}
    return "";
  }
}