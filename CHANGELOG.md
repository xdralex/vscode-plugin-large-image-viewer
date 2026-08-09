# Changelog

All notable changes to Large Image Viewer are documented here.

## Unreleased

- Replaced free-form zoom with fixed 1% through 3200% zoom levels.
- Made toolbar and keyboard `+`/`−` zoom use the fixed levels while keeping
  mouse-wheel, trackpad, and pinch zoom smooth.
- Disabled double-click zoom.
- Switched generated tiles from lossy JPEG to lossless WebP.
- Added nearest-neighbor rendering at 100% and above and removed tile crossfades.
- Added integer pixel ruler and rectangle measurement tools with transient
  overlays shown only while dragging.
- Rendered measurement strokes as alternating black-and-white dashes.
- Replaced text toolbar actions with compact 16px Lucide icons.
- Added a minimap toggle and made the minimap hidden by default.
- Added temporary middle-mouse panning while any tool is selected.

## 0.1.3

- Added a read-only tiled viewer for large PNG, JPEG, TIFF, and WebP files.
- Added smooth zoom and pan, Fit and 100% controls, exact zoom percentages, and
  a navigator minimap.
- Defaulted small images to 100% and oversized images to Fit.
- Added automatic Deep Zoom tile caching and a command to clear the cache.
- Fixed webview access to generated tiles.
- Removed the redundant status bar and repeated progress notifications.
