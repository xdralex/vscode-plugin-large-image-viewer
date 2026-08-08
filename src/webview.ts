import OpenSeadragon from "openseadragon";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface ImageDescription {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: string;
  maxLevel: number;
  tilesBaseUrl: string;
}

type HostMessage =
  | { type: "loading"; message: string }
  | { type: "error"; message: string }
  | { type: "open"; image: ImageDescription };

const vscode = acquireVsCodeApi();
const viewerElement = requiredElement("viewer");
const messageElement = requiredElement("message");
const dimensionsElement = requiredElement("dimensions");
const zoomInput = requiredElement("zoom") as HTMLInputElement;

let viewer: OpenSeadragon.Viewer | undefined;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function currentTiledImage(): OpenSeadragon.TiledImage | undefined {
  return viewer?.world.getItemAt(0);
}

function imageZoom(): number | undefined {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage) return undefined;
  return tiledImage.viewportToImageZoom(viewer.viewport.getZoom());
}

function updateZoomDisplay(): void {
  const zoom = imageZoom();
  if (zoom === undefined || document.activeElement === zoomInput) return;
  const percent = zoom * 100;
  zoomInput.value = percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
}

function setImageZoom(value: number): void {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage || !Number.isFinite(value) || value <= 0) return;
  viewer.viewport.zoomTo(tiledImage.imageToViewportZoom(value), undefined, false);
  viewer.viewport.applyConstraints(false);
  updateZoomDisplay();
}

function fitImage(): void {
  viewer?.viewport.goHome(false);
  updateZoomDisplay();
}

function applyInitialZoom(image: ImageDescription): void {
  const fitsAtActualSize =
    image.width <= viewerElement.clientWidth && image.height <= viewerElement.clientHeight;
  if (fitsAtActualSize) setImageZoom(1);
  else fitImage();
}

function changeZoom(factor: number): void {
  if (!viewer) return;
  viewer.viewport.zoomBy(factor);
  viewer.viewport.applyConstraints(false);
  updateZoomDisplay();
}

function openImage(image: ImageDescription): void {
  viewer?.destroy();
  viewerElement.replaceChildren();

  const tileSource = {
    width: image.width,
    height: image.height,
    tileSize: image.tileSize,
    tileOverlap: image.overlap,
    minLevel: 0,
    maxLevel: image.maxLevel,
    getTileUrl(level: number, x: number, y: number): string {
      return `${image.tilesBaseUrl}/${level}/${x}_${y}.${image.format}`;
    },
  };

  viewer = OpenSeadragon({
    element: viewerElement,
    tileSources: tileSource,
    showNavigationControl: false,
    showNavigator: true,
    navigatorPosition: "BOTTOM_RIGHT",
    navigatorSizeRatio: 0.14,
    navigatorMaintainSizeRatio: true,
    navigatorAutoFade: true,
    animationTime: 0.35,
    blendTime: 0.1,
    immediateRender: false,
    preserveViewport: true,
    minZoomImageRatio: 0.02,
    maxZoomPixelRatio: 32,
    visibilityRatio: 0.5,
    constrainDuringPan: true,
    gestureSettingsMouse: {
      clickToZoom: false,
      dblClickToZoom: true,
      dragToPan: true,
      scrollToZoom: true,
      pinchToZoom: true,
      flickEnabled: true,
    },
    gestureSettingsTouch: {
      clickToZoom: false,
      dblClickToZoom: true,
      dragToPan: true,
      scrollToZoom: false,
      pinchToZoom: true,
      flickEnabled: true,
    },
  });

  viewer.addHandler("open", () => {
    messageElement.hidden = true;
    dimensionsElement.textContent = `${image.width.toLocaleString()} × ${image.height.toLocaleString()} px`;
    applyInitialZoom(image);
  });
  viewer.addHandler("zoom", updateZoomDisplay);
  viewer.addHandler("animation", updateZoomDisplay);
  viewer.addHandler("open-failed", (event) => {
    messageElement.hidden = false;
    messageElement.classList.add("error");
    messageElement.textContent = `Could not load image tiles: ${event.message ?? "unknown error"}`;
  });
}

requiredElement("fit").addEventListener("click", fitImage);
requiredElement("actual").addEventListener("click", () => setImageZoom(1));
requiredElement("zoom-in").addEventListener("click", () => changeZoom(1.25));
requiredElement("zoom-out").addEventListener("click", () => changeZoom(0.8));
zoomInput.addEventListener("change", () => setImageZoom(Number.parseFloat(zoomInput.value) / 100));
zoomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    setImageZoom(Number.parseFloat(zoomInput.value) / 100);
    zoomInput.blur();
  }
});

window.addEventListener("keydown", (event) => {
  if (document.activeElement === zoomInput) return;
  if (event.key === "0") fitImage();
  else if (event.key === "1") setImageZoom(1);
  else if (event.key === "+" || event.key === "=") changeZoom(1.25);
  else if (event.key === "-") changeZoom(0.8);
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "loading") {
    messageElement.hidden = false;
    messageElement.classList.remove("error");
    messageElement.textContent = message.message;
  } else if (message.type === "error") {
    messageElement.hidden = false;
    messageElement.classList.add("error");
    messageElement.textContent = message.message;
  } else if (message.type === "open") {
    openImage(message.image);
  }
});

vscode.postMessage({ type: "ready" });
