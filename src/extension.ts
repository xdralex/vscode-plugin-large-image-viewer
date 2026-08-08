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
    button, input { height: 26px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid transparent; border-radius: 2px; font: inherit; }
    button { min-width: 28px; padding: 0 8px; cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    input { width: 64px; padding: 0 5px; text-align: right; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-color: var(--vscode-input-border, transparent); }
    #zoom-wrap { display: flex; align-items: center; gap: 2px; }
    #spacer { flex: 1; }
    #dimensions { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    #stage-wrap { position: relative; min-height: 0; background-color: var(--vscode-editor-background); background-image: linear-gradient(45deg, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--vscode-foreground) 5%, transparent) 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
    #viewer { position: absolute; inset: 0; }
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
      <button id="fit" type="button" title="Fit image to window (0)">Fit</button>
      <button id="actual" type="button" title="Show image at 100% (1)">100%</button>
      <button id="zoom-out" type="button" title="Zoom out (-)">−</button>
      <div id="zoom-wrap"><input id="zoom" aria-label="Zoom percent" inputmode="decimal" value="100"><span>%</span></div>
      <button id="zoom-in" type="button" title="Zoom in (+)">+</button>
      <div id="spacer"></div>
      <span id="dimensions"></span>
    </div>
    <div id="stage-wrap">
      <div id="viewer"></div>
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
