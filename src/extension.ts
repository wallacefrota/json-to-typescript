import * as vscode from "vscode";
import { jsonToTs, ConvertOptions } from "./jsonToTs";
import { PreviewPanel } from "./previewPanel";
import { JsonCodeLensProvider } from "./jsonCodeLens";
import { JsonNotificationManager } from "./jsonNotification";
import { JsonStatusBar } from "./statusBarItem";
import { PasteDetector } from "./pasteDetector";
import { SmartPasteProvider } from "./smartPasteProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 JSON to TS: activated!");

  // ────────────────────────────────────────
  // CODELENS
  // ────────────────────────────────────────
  const codeLensProvider = new JsonCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "json" },
        { language: "jsonc" },
        { pattern: "**/*.json" },
        { pattern: "**/*.json5" },
      ],
      codeLensProvider
    )
  );

  // ────────────────────────────────────────
  // NOTIFICATION AUTO-DETECT
  // ────────────────────────────────────────
  const notification = new JsonNotificationManager(context);
  context.subscriptions.push(...notification.register());

  // ────────────────────────────────────────
  // STATUS BAR
  // ────────────────────────────────────────
  const statusBar = new JsonStatusBar();
  context.subscriptions.push(...statusBar.register());

  // ────────────────────────────────────────
  // 🔥 PASTE DETECTOR — Auto detect JSON paste
  // ────────────────────────────────────────
  const pasteDetector = new PasteDetector(context);
  context.subscriptions.push(...pasteDetector.register());

  // ────────────────────────────────────────
  // 🔥 SMART PASTE — Ctrl+Alt+V
  // ────────────────────────────────────────
  const smartPaste = new SmartPasteProvider(context);
  context.subscriptions.push(...smartPaste.register());

  // ────────────────────────────────────────
  // COMMANDS
  // ────────────────────────────────────────

  const preview = vscode.commands.registerCommand(
    "jsonToTs.preview",
    () => {
      let json = "";
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.selection;
        if (!selection.isEmpty) {
          json = editor.document.getText(selection);
        } else if (
          editor.document.languageId === "json" ||
          editor.document.fileName.endsWith(".json")
        ) {
          json = editor.document.getText();
        }
      }
      PreviewPanel.createOrShow(context.extensionUri, json);
    }
  );

  const convertSelection = vscode.commands.registerCommand(
    "jsonToTs.convertSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      const text = editor.document.getText(editor.selection);
      if (!text.trim()) {
        vscode.window.showWarningMessage("Select a JSON file to convert.");
        return;
      }
      await convertAndShow(text);
    }
  );

  const convertFile = vscode.commands.registerCommand(
    "jsonToTs.convertFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }
      await convertAndShow(editor.document.getText());
    }
  );

  const convertClipboard = vscode.commands.registerCommand(
    "jsonToTs.convertClipboard",
    async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        vscode.window.showWarningMessage("Empty clipboard.");
        return;
      }
      await convertAndShow(text);
    }
  );

  const copyAsTs = vscode.commands.registerCommand(
    "jsonToTs.copyAsTs",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const config = vscode.workspace.getConfiguration("jsonToTs");

      try {
        const result = jsonToTs(editor.document.getText(), {
          useInterface: config.get<boolean>("useInterface", true),
          rootName: config.get<string>("rootName", "Root"),
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

        await vscode.env.clipboard.writeText(result);
        vscode.window.showInformationMessage("📋 TypeScript copied!");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Error";
        vscode.window.showErrorMessage(`❌ Error: ${msg}`);
      }
    }
  );

  context.subscriptions.push(
    preview,
    convertSelection,
    convertFile,
    convertClipboard,
    copyAsTs
  );

  console.log("🟢 all modules registereds!");
}

// ────────────────────────────────────────
// CONVERSION SPEED
// ────────────────────────────────────────
async function convertAndShow(jsonText: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("jsonToTs");

  const rootName = await vscode.window.showInputBox({
    prompt: "Nome da interface raiz",
    value: config.get<string>("rootName", "Root"),
    placeHolder: "Root",
  });

  if (rootName === undefined) return;

  try {
    const result = jsonToTs(jsonText, {
      useInterface: config.get<boolean>("useInterface", true),
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

    const doc = await vscode.workspace.openTextDocument({
      content: result,
      language: "typescript",
    });

    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });

    await vscode.env.clipboard.writeText(result);
    vscode.window.showInformationMessage("✅ TypeScript generated!");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error";
    vscode.window.showErrorMessage(`❌ Error: ${msg}`);
  }
}

export function deactivate() {}