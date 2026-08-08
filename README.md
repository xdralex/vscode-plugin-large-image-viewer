# Large Image Viewer for VS Code

A fast, read-only image viewer for raster files that are too large for VS Code's
built-in preview. It keeps the normal VS Code Explorer and editors, while large
PNG, JPEG, TIFF, and WebP files open as a smooth, zoomable tiled image.

## Features

- Opens images with hundreds of millions of pixels without decoding the complete
  bitmap inside the webview.
- Smooth mouse-wheel and trackpad zoom, drag-to-pan, double-click zoom, and a
  navigator minimap.
- `Fit`, `100%`, zoom in/out, and exact percentage controls.
- Sensible initial scale: small images open at 100%; oversized images fit the
  available editor area.
- Generated tiles are cached and reused until the source file changes.
- Source images are always read-only and are never modified.
- Text, JSON, and every other file type continue to use VS Code's native editors.

## Installation

Download the `.vsix` from the
[latest GitHub Release](https://github.com/xdralex/vscode-plugin-large-image-viewer/releases/latest),
then run **Extensions: Install from VSIX…** from the VS Code Command Palette.

You can also install it from a terminal:

```sh
code --install-extension vscode-plugin-large-image-viewer-darwin-arm64-0.1.3.vsix
```

The current prebuilt release targets macOS on Apple Silicon. Because Sharp uses
native binaries, Intel macOS, Windows, and Linux need platform-specific builds.

## Usage

Open a supported image from the Explorer. Large Image Viewer is registered as
the default editor for supported image formats.

| Action | Control |
| --- | --- |
| Zoom | Mouse wheel or trackpad pinch |
| Pan | Drag the image |
| Zoom in | Double-click, `+`, or the `+` button |
| Zoom out | `-` or the `-` button |
| Fit to editor | `0` or **Fit** |
| Actual size | `1` or **100%** |
| Exact zoom | Enter a percentage in the zoom field |

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, and `.webp`
(including uppercase variants). Local files are currently supported.

## How it works

The extension uses Sharp/libvips to build a Deep Zoom (`.dzi`) pyramid made of
1024 px tiles. OpenSeadragon then requests only the tiles needed for the current
viewport and zoom level, avoiding the webview memory failure caused by loading a
huge source bitmap directly.

Tile pyramids live in VS Code's extension storage. Each cache entry is keyed by
the source path, file size, and modification time, so an unchanged image opens
from cache and a changed image gets a new pyramid.

Run **Large Image Viewer: Clear Tile Cache** from the Command Palette to remove
all generated tiles. This does not touch source images.

## Performance note

As a development smoke test, a 28,063 × 19,842 PNG produced 762 tiles and a
roughly 42 MB cache in about 1.36 seconds on an Apple Silicon development Mac.
Results vary with image encoding, storage, and hardware.

## Development

Requirements: Node.js 20 or newer, npm, and VS Code 1.90 or newer.

```sh
npm ci
npm run check
```

To exercise the tiling pipeline against a real image:

```sh
npm run smoke -- /absolute/path/to/image.png /tmp/large-image-viewer-cache
```

To build an Apple Silicon VSIX:

```sh
npm run package
```

For another OS or architecture, install dependencies for that target and run
`vsce package` with the appropriate
[VS Code target](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions).

## License

[MIT](LICENSE)
