import * as vscode from "vscode";
import { jsonToTs } from "./jsonToTs";

export class PreviewPanel {
  public static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = "jsonToTsPreview";

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _output: string = "";

  // ────────────────────────────────────────
  // CREATE OR REVEAL
  // ────────────────────────────────────────
  public static createOrShow(extensionUri: vscode.Uri, json: string = "") {
    const column = vscode.ViewColumn.Beside;

    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel._panel.reveal(column);
      if (json) {
        PreviewPanel.currentPanel._post({ command: "setJson", json });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      "🔄 JSON → TypeScript",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri, json);
  }

  // ────────────────────────────────────────
  // CONSTRUCTOR
  // ────────────────────────────────────────
  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    json: string
  ) {
    this._panel = panel;

    const config = vscode.workspace.getConfiguration("jsonToTs");
    const settings = {
      rootName: config.get<string>("rootName", "Root"),
      useInterface: config.get<boolean>("useInterface", true),
      addExport: config.get<boolean>("addExport", true),
      useSemicolons: config.get<boolean>("useSemicolons", true),
      optionalNull: config.get<boolean>("optionalNull", true),
      detectEnums: config.get<boolean>("detectEnums", true),
      smartNullable: config.get<boolean>("smartNullable", true),
      detectDates: config.get<boolean>("detectDates", true),
      useRealEnums: config.get<boolean>("useRealEnums", false),
    };

    this._panel.webview.html = this._getHtml(json, settings);

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
  }

  // ────────────────────────────────────────
  // WEBVIEW MESSAGES
  // ────────────────────────────────────────
  private async _handleMessage(msg: any) {
    switch (msg.command) {
      // ── Convert JSON → TS ──
      case "convert": {
        try {
          const result = jsonToTs(msg.json, {
            ...msg.options,
            detectEnums: msg.options.detectEnums ?? true,
            enumMaxValues: msg.options.enumMaxValues ?? 10,
            smartNullable: msg.options.smartNullable ?? true,
            detectDates: msg.options.detectDates ?? true,
            useRealEnums: msg.options.useRealEnums ?? false,
          });
          this._output = result;
          this._post({ command: "result", text: result, error: null });
        } catch (e) {
          this._output = "";
          this._post({
            command: "result",
            text: "",
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
        break;
      }

      // ── Copy output to clipboard ──
      case "copy": {
        if (!this._output) return;
        await vscode.env.clipboard.writeText(this._output);
        this._post({ command: "toast", text: "📋 Copied to clipboard!", type: "success" });
        break;
      }

      // ── Insert into editor ──
      case "insert": {
        if (!this._output) return;
        const editors = vscode.window.visibleTextEditors.filter(
          (e) => e.document.uri.scheme !== "webview-panel"
        );
        if (editors.length > 0) {
          const editor = editors[0];
          await editor.edit((b) => {
            if (editor.selection.isEmpty) {
              b.insert(editor.selection.active, this._output);
            } else {
              b.replace(editor.selection, this._output);
            }
          });
          await vscode.window.showTextDocument(editor.document, editor.viewColumn);
          this._post({ command: "toast", text: "📥 Inserted into the editor!", type: "success" });
        } else {
          await this._openNewFile();
        }
        break;
      }

      // ── Open in new file ──
      case "newFile": {
        await this._openNewFile();
        break;
      }

      // ── PASTE: Read clipboard via extension (webview is not accessible) ──
      case "requestClipboard": {
        const text = await vscode.env.clipboard.readText();
        this._post({ command: "clipboardContent", text: text || "" });
        break;
      }

      // ── FORMAT: Format JSON via extension ──
      case "formatJson": {
        try {
          const cleaned = msg.json
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/,\s*([\]}])/g, "$1");

          let parsed: unknown;
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            const withQuotes = cleaned.replace(
              /(?<=[{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g,
              '"$1":'
            );
            parsed = JSON.parse(withQuotes);
          }

          const formatted = JSON.stringify(parsed, null, 2);
          this._post({ command: "formatted", text: formatted });
        } catch {
          this._post({ command: "toast", text: "⚠️ Invalid JSON to format", type: "error" });
        }
        break;
      }
    }
  }

  private async _openNewFile() {
    if (!this._output) return;
    const doc = await vscode.workspace.openTextDocument({
      content: this._output,
      language: "typescript",
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    this._post({ command: "toast", text: "📄 Archive created!", type: "success" });
  }

  private _post(msg: any) {
    this._panel.webview.postMessage(msg);
  }

  private _dispose() {
    PreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  // ────────────────────────────────────────
  // HTML WEBVIEW
  // ────────────────────────────────────────
  private _getHtml(json: string, settings: any): string {
    const safeJson = json
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${")
      .replace(/<\/textarea>/gi, "&lt;/textarea&gt;");

    return /*html*/ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JSON → TypeScript</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px;
    line-height: 1.5;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
  }

  .header h1 {
    font-size: 17px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--vscode-input-background, #1e1e1e);
  }

  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #555;
    transition: background 0.3s;
  }
  .dot.ready { background: #3fb950; box-shadow: 0 0 6px #3fb95066; }
  .dot.error { background: #f85149; box-shadow: 0 0 6px #f8514966; }
  .dot.empty { background: #848d97; }

  /* ═══ SETTINGS ═══ */
  .settings {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    margin-bottom: 20px;
    padding: 14px 16px;
    border-radius: 8px;
    background: var(--vscode-input-background, #1e1e1e);
    border: 1px solid var(--vscode-input-border, #333);
  }

  .settings label {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  .settings input[type="text"] {
    background: var(--vscode-editor-background);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #444);
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 13px;
    width: 130px;
    outline: none;
    font-family: var(--vscode-editor-font-family, monospace);
    transition: border-color 0.2s;
  }
  .settings input[type="text"]:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .settings input[type="checkbox"] {
    accent-color: var(--vscode-focusBorder, #007acc);
    cursor: pointer;
    width: 14px; height: 14px;
  }

  .settings select {
    background: var(--vscode-editor-background);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #444);
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }
  .settings select:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .divider {
    width: 1px; height: 20px;
    background: var(--vscode-panel-border, #444);
  }

  /* ═══ PANELS ═══ */
  .panel { margin-bottom: 20px; }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .panel-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--vscode-descriptionForeground, #888);
  }

  .panel-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .panel-info {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #666);
    font-variant-numeric: tabular-nums;
  }

  /* ═══ INPUT ═══ */
  #jsonInput {
    width: 100%;
    min-height: 160px;
    max-height: 350px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-input-border, #333);
    border-radius: 8px;
    padding: 14px;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.7;
    resize: vertical;
    outline: none;
    tab-size: 2;
    transition: border-color 0.2s;
  }
  #jsonInput:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  #jsonInput::placeholder {
    color: var(--vscode-input-placeholderForeground, #555);
  }

  /* ═══ OUTPUT ═══ */
  .output-wrapper {
    border: 1px solid var(--vscode-input-border, #333);
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    min-height: 80px;
    transition: border-color 0.2s;
  }
  .output-wrapper.has-output {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .output-container { display: flex; overflow-x: auto; }

  .line-numbers {
    padding: 14px 10px 14px 14px;
    text-align: right;
    color: var(--vscode-editorLineNumber-foreground, #555);
    background: var(--vscode-editor-background);
    user-select: none;
    border-right: 1px solid var(--vscode-panel-border, #333);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.7;
    min-width: 40px;
  }

  .output-code {
    flex: 1;
    padding: 14px;
    margin: 0;
    background: var(--vscode-editor-background);
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.7;
    overflow-x: auto;
    white-space: pre;
    color: var(--vscode-editor-foreground);
    animation: fadeIn 0.25s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ═══ SYNTAX ═══ */
  .kw   { color: #569CD6; }
  .tp   { color: #4EC9B0; }
  .prop { color: #9CDCFE; }
  .opt  { color: #CE9178; font-weight: bold; }
  .punc { color: #808080; }
  .str  { color: #CE9178; }
  .num  { color: #B5CEA8; }

  /* ═══ EMPTY ═══ */
  .empty-state {
    padding: 50px 20px;
    text-align: center;
    color: var(--vscode-descriptionForeground, #666);
    font-size: 13px;
  }
  .empty-state .icon { font-size: 40px; margin-bottom: 12px; opacity: 0.6; }
  .empty-state .subtitle { margin-top: 6px; font-size: 11px; opacity: 0.6; }

  /* ═══ ERROR ═══ */
  .error-box {
    padding: 12px 16px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    border-radius: 8px;
    color: var(--vscode-errorForeground, #f48771);
    font-size: 13px;
    margin-bottom: 16px;
    display: none;
    animation: fadeIn 0.2s ease;
  }
  .error-box.show { display: block; }

  /* ═══ BUTTONS ═══ */
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    transition: all 0.15s ease;
    font-weight: 600;
    position: relative;
    overflow: hidden;
  }
  .btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: white;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .btn:hover::after { opacity: 0.05; }
  .btn:active { transform: scale(0.97); }

  .btn-primary {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #fff);
  }
  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground, #005a9e);
  }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }
  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
  .btn:disabled::after { display: none; }

  .btn .shortcut {
    font-size: 10px;
    opacity: 0.6;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.12);
    font-weight: 400;
  }

  .btn-mini {
    padding: 3px 10px;
    font-size: 11px;
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, #333);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
  }
  .btn-mini:hover {
    background: var(--vscode-button-secondaryHoverBackground, #444);
  }
  .btn-mini:active {
    transform: scale(0.95);
  }

  /* ═══ TOAST ═══ */
  .toast-container {
    position: fixed;
    top: 12px; right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toast {
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    animation: toastIn 0.3s ease, toastOut 0.3s ease 1.8s forwards;
    box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  }
  .toast.success { background: rgba(63,185,80,0.95); color: #fff; }
  .toast.error   { background: rgba(248,81,73,0.95); color: #fff; }

  @keyframes toastIn {
    from { transform: translateX(120%); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }
  @keyframes toastOut {
    from { opacity: 1; }
    to   { opacity: 0; transform: translateY(-10px); }
  }
</style>
</head>
<body>

<div class="toast-container" id="toastContainer"></div>

<!-- Header -->
<div class="header">
  <h1>🔄 JSON → TypeScript</h1>
  <div class="status">
    <span class="dot empty" id="statusDot"></span>
    <span id="statusText">Waiting JSON</span>
  </div>
</div>

<!-- Settings -->
<div class="settings">
  <label>
    Root:
    <input type="text" id="rootName" value="${settings.rootName}" spellcheck="false" />
  </label>

  <span class="divider"></span>

  <label>
    <select id="typeStyle">
      <option value="interface" ${settings.useInterface ? "selected" : ""}>interface</option>
      <option value="type" ${!settings.useInterface ? "selected" : ""}>type</option>
    </select>
  </label>

  <span class="divider"></span>

  <label><input type="checkbox" id="addExport" ${settings.addExport ? "checked" : ""} /> export</label>
  <label><input type="checkbox" id="useSemicolons" ${settings.useSemicolons ? "checked" : ""} /> semicolon</label>
  <label><input type="checkbox" id="optionalNull" ${settings.optionalNull ? "checked" : ""} /> null → optional</label>

  <span class="divider"></span>

  <label><input type="checkbox" id="detectEnums" ${settings.detectEnums ? "checked" : ""} /> 🎯 enums</label>
  <label><input type="checkbox" id="smartNullable" ${settings.smartNullable ? "checked" : ""} /> 🧠 smart null</label>
  <label><input type="checkbox" id="detectDates" ${settings.detectDates ? "checked" : ""} /> 📅 dates</label>
  <label><input type="checkbox" id="useRealEnums" ${settings.useRealEnums ? "checked" : ""} /> enum real</label>
</div>

<!-- Input -->
<div class="panel">
  <div class="panel-header">
    <span class="panel-title">📥 JSON Input</span>
    <div class="panel-actions">
      <span class="panel-info" id="inputInfo"></span>
      <button class="btn-mini" id="formatBtn" type="button">✨ Format</button>
      <button class="btn-mini" id="pasteBtn" type="button">📋 Paste</button>
      <button class="btn-mini" id="clearBtn" type="button">✕ Clear</button>
    </div>
  </div>
  <textarea
    id="jsonInput"
    placeholder='Paste your JSON here...

Exemplo:
{
  "name": "Jhon",
  "age": 25,
  "active": true
}'
    spellcheck="false"
  >${safeJson}</textarea>
</div>

<!-- Error -->
<div class="error-box" id="errorBox"></div>

<!-- Output -->
<div class="panel"> 
  <div class="panel-header"> 
    <span class="panel-title">📤 TypeScript Output</span> 
    <span class="panel-info" id="outputInfo"></span> 
    </div> 
      <div class="output-wrapper" id="outputWrapper"> 
      <div class="empty-state" id="emptyState"> 
      <div class="icon">⌨️</div> 
      <div>Paste a JSON above to generate the interfaces</div> 
      <div class="subtitle">Accepts JSON with comments, trailing commas and keys without quotes</div> 
    </div> 
  <div class="output-container" id="outputContainer" style="display:none;"> 
    <div class="line-numbers" id="lineNumbers"></div> 
    <pre class="output-code"><code id="outputCode"></code></pre> 
    </div> 
  </div>
</div>

<!-- Actions -->
<div class="actions">
  <button class="btn btn-primary" id="copyBtn" type="button" disabled>
    📋 Copy
    <span class="shortcut">Ctrl+C</span>
  </button>
  <button class="btn btn-secondary" id="insertBtn" type="button" disabled>
    📥 Insert into Editor
  </button>
  <button class="btn btn-secondary" id="newFileBtn" type="button" disabled>
    📄 New file .ts
  </button>
</div>

<script>
(function() {
  // ── VSCode API ──
  const vscode = acquireVsCodeApi();

  // ── Referências DOM ──
  const jsonInput     = document.getElementById('jsonInput');
  const rootName      = document.getElementById('rootName');
  const typeStyle     = document.getElementById('typeStyle');
  const addExport     = document.getElementById('addExport');
  const useSemicolons = document.getElementById('useSemicolons');
  const optionalNull  = document.getElementById('optionalNull');
  const detectEnums   = document.getElementById('detectEnums');
  const smartNullable = document.getElementById('smartNullable');
  const detectDates   = document.getElementById('detectDates');
  const useRealEnums  = document.getElementById('useRealEnums');
  const outputCode    = document.getElementById('outputCode');
  const lineNumbers   = document.getElementById('lineNumbers');
  const outputContainer = document.getElementById('outputContainer');
  const outputWrapper = document.getElementById('outputWrapper');
  const emptyState    = document.getElementById('emptyState');
  const errorBox      = document.getElementById('errorBox');
  const copyBtn       = document.getElementById('copyBtn');
  const insertBtn     = document.getElementById('insertBtn');
  const newFileBtn    = document.getElementById('newFileBtn');
  const formatBtn     = document.getElementById('formatBtn');
  const pasteBtn      = document.getElementById('pasteBtn');
  const clearBtn      = document.getElementById('clearBtn');
  const inputInfo     = document.getElementById('inputInfo');
  const outputInfo    = document.getElementById('outputInfo');
  const statusDot     = document.getElementById('statusDot');
  const statusText    = document.getElementById('statusText');
  const toastContainer = document.getElementById('toastContainer');

  let debounceTimer = null;

  // ══════════════════════════════════════
  // CONVERT (with debounce)
  // ══════════════════════════════════════
  function triggerConvert() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      doConvert();
    }, 250);
  }

  function doConvert() {
    var json = jsonInput.value.trim();
    if (!json) {
      showEmpty();
      return;
    }

    vscode.postMessage({
      command: 'convert',
      json: json,
      options: {
        rootName: rootName.value || 'Root',
        useInterface: typeStyle.value === 'interface',
        addExport: addExport.checked,
        useSemicolons: useSemicolons.checked,
        optionalNull: optionalNull.checked,
        detectEnums: detectEnums.checked,
        smartNullable: smartNullable.checked,
        detectDates: detectDates.checked,
        useRealEnums: useRealEnums.checked,
        indent: 2
      }
    });
  }

  // ══════════════════════════════════════
  // INPUT EVENTS
  // ══════════════════════════════════════
  jsonInput.addEventListener('input', function() {
    updateInputInfo();
    triggerConvert();
  });

  // Tab support textarea
  jsonInput.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = jsonInput.selectionStart;
      var end = jsonInput.selectionEnd;
      jsonInput.value = jsonInput.value.substring(0, start) + '  ' + jsonInput.value.substring(end);
      jsonInput.selectionStart = start + 2;
      jsonInput.selectionEnd = start + 2;
      triggerConvert();
    }
  });

  // ══════════════════════════════════════
  // SETTINGS EVENTS
  // ══════════════════════════════════════
  var settingsEls = [rootName, typeStyle, addExport, useSemicolons,
    optionalNull, detectEnums, smartNullable, detectDates, useRealEnums];

  settingsEls.forEach(function(el) {
    el.addEventListener('change', function() { triggerConvert(); });
    el.addEventListener('input', function() { triggerConvert(); });
  });

  // ══════════════════════════════════════
  // BUTTON EVENTS
  // ══════════════════════════════════════

  // 📋 COPY → sends to extension
  copyBtn.addEventListener('click', function() {
    vscode.postMessage({ command: 'copy' });
  });

  // 📥 INSERT → sends to extension
  insertBtn.addEventListener('click', function() {
    vscode.postMessage({ command: 'insert' });
  });

  // 📄 NEW FILE → sends to extension
  newFileBtn.addEventListener('click', function() {
    vscode.postMessage({ command: 'newFile' });
  });

  // ✨ FORMAT → sends to extension (secure parse)
  formatBtn.addEventListener('click', function() {
    var json = jsonInput.value.trim();
    if (!json) {
      showToast('⚠️ Nothing to format.', 'error');
      return;
    }
    vscode.postMessage({ command: 'formatJson', json: json });
  });

  // 📋 PASTE → Requests clipboard for extension.
  pasteBtn.addEventListener('click', function() {
    vscode.postMessage({ command: 'requestClipboard' });
  });

  // ✕ CLEAR → all
  clearBtn.addEventListener('click', function() {
    jsonInput.value = '';
    showEmpty();
    updateInputInfo();
  });

  // Keyboard: Ctrl+Enter = copy
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!copyBtn.disabled) {
        vscode.postMessage({ command: 'copy' });
      }
    }
  });

  // ══════════════════════════════════════
  // EXTENSION MESSAGES
  // ══════════════════════════════════════
  window.addEventListener('message', function(event) {
    var msg = event.data;

    switch (msg.command) {
      // Result of conversion
      case 'result':
        if (msg.error) {
          showError(msg.error);
        } else {
          showOutput(msg.text);
        }
        break;

      // JSON which came from the editor(setJson)
      case 'setJson':
        jsonInput.value = msg.json;
        updateInputInfo();
        triggerConvert();
        break;

      // Clipboard read by extension
      case 'clipboardContent':
        if (msg.text) {
          jsonInput.value = msg.text;
          updateInputInfo();
          triggerConvert();
          showToast('📋 Pasted from the clipboard!', 'success');
        } else {
          showToast('⚠️ Empty clipboard', 'error');
        }
        break;

      // JSON formatted by extension
      case 'formatted':
        jsonInput.value = msg.text;
        updateInputInfo();
        triggerConvert();
        showToast('✨ Formatted!', 'success');
        break;

      // Toast
      case 'toast':
        showToast(msg.text, msg.type || 'success');
        break;
    }
  });

  // ══════════════════════════════════════
  // UI HELPERS
  // ══════════════════════════════════════

  function showOutput(text) {
    errorBox.style.display = 'none';
    errorBox.classList.remove('show');
    emptyState.style.display = 'none';
    outputContainer.style.display = 'flex';
    outputWrapper.classList.add('has-output');

    var lines = text.split('\\n');
    var nums = [];
    for (var i = 1; i <= lines.length; i++) { nums.push(i); }
    lineNumbers.textContent = nums.join('\\n');
    outputCode.innerHTML = highlightSyntax(text);

    var typeCount = (text.match(/\\b(interface|type|enum)\\b/g) || []).length;
    outputInfo.textContent = lines.length + ' linhas · ' + typeCount + ' tipo(s)';

    setStatus('ready', 'Pronto');
    setButtons(true);
  }

  function showError(msg) {
    errorBox.innerHTML = '❌ ' + escapeHtml(msg);
    errorBox.style.display = 'block';
    errorBox.classList.add('show');
    emptyState.style.display = 'none';
    outputContainer.style.display = 'none';
    outputWrapper.classList.remove('has-output');
    outputInfo.textContent = '';
    setStatus('error', 'Error in JSON');
    setButtons(false);
  }

  function showEmpty() {
    errorBox.style.display = 'none';
    errorBox.classList.remove('show');
    emptyState.style.display = 'block';
    outputContainer.style.display = 'none';
    outputWrapper.classList.remove('has-output');
    outputInfo.textContent = '';
    setStatus('empty', 'Waiting JSON');
    setButtons(false);
  }

  function setButtons(enabled) {
    copyBtn.disabled = !enabled;
    insertBtn.disabled = !enabled;
    newFileBtn.disabled = !enabled;
  }

  function setStatus(type, text) {
    statusDot.className = 'dot ' + type;
    statusText.textContent = text;
  }

  function updateInputInfo() {
    var val = jsonInput.value;
    if (!val.trim()) {
      inputInfo.textContent = '';
      return;
    }
    var lines = val.split('\\n').length;
    var chars = val.length;
    inputInfo.textContent = lines + ' lines · ' + chars + ' chars';
  }

  function showToast(text, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'success');
    el.textContent = text;
    toastContainer.appendChild(el);
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2200);
  }

  // ══════════════════════════════════════
  // SYNTAX HIGHLIGHTING
  // ══════════════════════════════════════

  function highlightSyntax(code) {
    var h = escapeHtml(code);
    var savedStrings = [];

    h = h.replace(/"([^"]*)"/g, function(match, content) {
      var idx = savedStrings.length;
      savedStrings.push(content);
      return '__STRLIT_' + idx + '__';
    });

    h = h.replace(/\\b(export|interface|type|enum)\\b/g,
      '<span class="kw">$1</span>');

    // PASSO 3: Types
    h = h.replace(/\\b(string|number|boolean|unknown|null|undefined|void|any|never|Date|bigint|true|false)\\b/g,
      '<span class="tp">$1</span>');

    // PASSO 4: Number literals (1 | 2 | 3)
    //          \\b\\d+\\b NÃO captura o número em __STRLIT_0__
    //          porque _ é \\w, então não há word boundary
    h = h.replace(/\\b(\\d+)\\b/g,
      '<span class="num">$1</span>');

    // PASSO 5: Properties (indented word before ":")
    h = h.replace(/^(\\s+)([a-zA-Z_$][\\w$]*)(\\??)(:\\s)/gm,
      '$1<span class="prop">$2</span><span class="opt">$3</span>$4');

    // PASSO 6: Array brackets
    h = h.replace(/(\\[\\])/g,
      '<span class="punc">$1</span>');

    // PASSO 7: Restaurar string literals COM highlighting
    h = h.replace(/__STRLIT_(\\d+)__/g, function(match, idx) {
      return '<span class="str">"' + savedStrings[parseInt(idx)] + '"</span>';
    });

    return h;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ══════════════════════════════════════
  // INIT
  // ══════════════════════════════════════
  updateInputInfo();
  if (jsonInput.value.trim()) {
    triggerConvert();
  }

})();
</script>
</body>
</html>`;
  }
}