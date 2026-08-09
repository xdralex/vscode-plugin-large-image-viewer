import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import * as vscode from "vscode";

import { ensureTilePyramid, type TilePyramid } from "./tile-pyramid";

const VIEW_TYPE = "largeImageViewer.editor";

class LargeImageDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

class LargeImageEditorProvider implements vscode.CustomReadonlyEditorProvider<LargeImageDocument> {
  private readonly builds = new Map<string, Promise<TilePyramid>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): LargeImageDocument {
    return new LargeImageDocument(uri);
  }

  async resolveCustomEditor(
    document: LargeImageDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    if (document.uri.scheme !== "file") {
      throw new Error("Large Image Viewer currently supports local files only.");
    }

    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewPanel.title = path.basename(document.uri.fsPath);
    webview.html = this.renderHtml(webview, path.basename(document.uri.fsPath));

    const load = async (): Promise<void> => {
      await webview.postMessage({ type: "loading", message: "Building tiled preview…" });
      try {
        const pyramid = await this.getPyramid(document.uri.fsPath);
        webview.options = {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri, vscode.Uri.file(pyramid.directory)],
        };
        const tilesUri = webview.asWebviewUri(vscode.Uri.file(pyramid.tilesDirectory));
        await webview.postMessage({
          type: "open",
          image: {
            name: path.basename(document.uri.fsPath),
            width: pyramid.width,
            height: pyramid.height,
            tileSize: pyramid.tileSize,
            overlap: pyramid.overlap,
            format: pyramid.format,
            maxLevel: pyramid.maxLevel,
            tilesBaseUrl: tilesUri.toString(true),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await webview.postMessage({ type: "error", message });
        void vscode.window.showErrorMessage(`Could not open ${path.basename(document.uri.fsPath)}: ${message}`);
      }
    };

    const messageSubscription = webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message.type === "ready") void load();
    });
    webviewPanel.onDidDispose(() => messageSubscription.dispose());
  }

  private getPyramid(sourcePath: string): Promise<TilePyramid> {
    const key = sourcePath;
    const running = this.builds.get(key);
    if (running) return running;

    const promise = ensureTilePyramid(sourcePath, this.context.globalStorageUri.fsPath);
    this.builds.set(key, promise);
    void promise.finally(() => this.builds.delete(key));
    return promise;
  }

  private renderHtml(webview: vscode.Webview, title: string): string {
    const nonce = cryptoNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const escapedTitle = escapeHtml(title);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 12px var(--vscode-font-family); }
    #app { display: grid; grid-template-rows: 36px 1fr; }
    #toolbar { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--vscode-editorGroupHeader-tabsBackground); border-bottom: 1px solid var(--vscode-panel-border); }
    button, select { height: 26px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid transparent; border-radius: 2px; font: inherit; }
    button { min-width: 28px; padding: 0 8px; cursor: pointer; }
    button.icon-button { display: flex; width: 28px; min-width: 28px; align-items: center; justify-content: center; padding: 0; }
    button.icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { cursor: default; opacity: .35; }
    button.tool-active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.tool-active:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    select { width: 84px; padding: 0 5px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-color: var(--vscode-dropdown-border, transparent); }
    .toolbar-separator { width: 1px; height: 20px; margin: 0 4px; background: var(--vscode-panel-border); }
    #spacer { flex: 1; }
    #dimensions { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    #stage-wrap { position: relative; min-height: 0; background-color: var(--vscode-editor-background); background-image: linear-gradient(45deg, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
    #viewer { position: absolute; inset: 0; }
    #measurement-overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    #stage-wrap.measurement-active, #stage-wrap.measurement-active * { cursor: crosshair !important; }
    .measurement-line, .measurement-rectangle { fill: none; stroke: var(--vscode-focusBorder); stroke-width: 1.5; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
    .measurement-point { fill: var(--vscode-focusBorder); stroke: var(--vscode-editor-background); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .measurement-label-background { fill: rgba(72, 72, 72, .92); }
    .measurement-label { fill: #fff; font: 14px var(--vscode-font-family); pointer-events: none; }
    #message { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 24px; color: var(--vscode-descriptionForeground); pointer-events: none; }
    #message.error { color: var(--vscode-errorForeground); }
    .navigator { border: 1px solid var(--vscode-panel-border) !important; background: var(--vscode-editor-background) !important; opacity: .9; }
    .displayregion { border: 2px solid var(--vscode-focusBorder) !important; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <main id="app">
    <div id="toolbar">
      <!-- Inline Lucide icons, 16px / stroke width 2. -->
      <button id="fit" class="icon-button" type="button" title="Fit image to window (0)" aria-label="Fit image to window">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      <button id="actual" class="icon-button" type="button" title="Show actual size at 100% (1)" aria-label="Show actual size at 100%">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M14 15H9v-5" />
          <path d="M16 3h5v5" />
          <path d="M21 3 9 15" />
        </svg>
      </button>
      <button id="zoom-out" class="icon-button" type="button" title="Zoom out (-)" aria-label="Zoom out">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" x2="16.65" y1="21" y2="16.65" />
          <line x1="8" x2="14" y1="11" y2="11" />
        </svg>
      </button>
      <select id="zoom" aria-label="Zoom level" title="Zoom level">
        <option id="zoom-custom" value="" disabled hidden>100%</option>
        <option value="0.01">1%</option>
        <option value="0.02">2%</option>
        <option value="0.05">5%</option>
        <option value="0.1">10%</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1" selected>100%</option>
        <option value="2">200%</option>
        <option value="4">400%</option>
        <option value="8">800%</option>
        <option value="16">1600%</option>
        <option value="32">3200%</option>
      </select>
      <button id="zoom-in" class="icon-button" type="button" title="Zoom in (+)" aria-label="Zoom in">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" x2="16.65" y1="21" y2="16.65" />
          <line x1="11" x2="11" y1="8" y2="14" />
          <line x1="8" x2="14" y1="11" y2="11" />
        </svg>
      </button>
      <button id="navigator-toggle" class="icon-button" type="button" title="Toggle minimap" aria-label="Toggle minimap" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
          <rect width="10" height="7" x="12" y="13" rx="2" />
        </svg>
      </button>
      <div class="toolbar-separator" aria-hidden="true"></div>
      <button id="tool-pan" class="icon-button tool-active" type="button" title="Pan image" aria-label="Pan image" aria-pressed="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
          <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
          <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      </button>
      <button id="tool-ruler" class="icon-button" type="button" title="Measure distance" aria-label="Measure distance" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
          <path d="m14.5 12.5 2-2" />
          <path d="m11.5 9.5 2-2" />
          <path d="m8.5 6.5 2-2" />
          <path d="m17.5 15.5 2-2" />
        </svg>
      </button>
      <button id="tool-rectangle" class="icon-button" type="button" title="Measure width and height" aria-label="Measure width and height" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3a2 2 0 0 0-2 2" />
          <path d="M19 3a2 2 0 0 1 2 2" />
          <path d="M21 19a2 2 0 0 1-2 2" />
          <path d="M5 21a2 2 0 0 1-2-2" />
          <path d="M9 3h1" />
          <path d="M9 21h1" />
          <path d="M14 3h1" />
          <path d="M14 21h1" />
          <path d="M3 9v1" />
          <path d="M21 9v1" />
          <path d="M3 14v1" />
          <path d="M21 14v1" />
        </svg>
      </button>
      <div id="spacer"></div>
      <span id="dimensions"></span>
    </div>
    <div id="stage-wrap">
      <div id="viewer"></div>
      <svg id="measurement-overlay" aria-hidden="true"><g id="measurement-layer"></g></svg>
      <div id="message">Loading viewer…</div>
    </div>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function cryptoNonce(): string {
  return randomBytes(24).toString("base64");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new LargeImageEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("largeImageViewer.clearCache", async () => {
      const answer = await vscode.window.showWarningMessage(
        "Delete all cached Large Image Viewer tiles? Source images will not be changed.",
        { modal: true },
        "Delete Cache",
      );
      if (answer !== "Delete Cache") return;
      await fs.rm(context.globalStorageUri.fsPath, { recursive: true, force: true });
      void vscode.window.showInformationMessage("Large Image Viewer tile cache cleared.");
    }),
  );
}

export function deactivate(): void {}
