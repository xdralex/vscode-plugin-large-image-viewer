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
const zoomSelect = requiredElement("zoom") as HTMLSelectElement;
const zoomCustomOption = requiredElement("zoom-custom") as HTMLOptionElement;
const navigatorToggleButton = requiredElement("navigator-toggle") as HTMLButtonElement;
const stageElement = requiredElement("stage-wrap");
const measurementOverlay = requiredElement("measurement-overlay") as unknown as SVGSVGElement;
const measurementLayer = requiredElement("measurement-layer") as unknown as SVGGElement;
const panToolButton = requiredElement("tool-pan") as HTMLButtonElement;
const rulerToolButton = requiredElement("tool-ruler") as HTMLButtonElement;
const rectangleToolButton = requiredElement("tool-rectangle") as HTMLButtonElement;

const ZOOM_LEVELS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16, 32] as const;
const ZOOM_EPSILON = 0.0001;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MEASUREMENT_LABEL_FONT_SIZE = 14;
const measurementLabelContext = document.createElement("canvas").getContext("2d");

type MeasurementTool = "pan" | "ruler" | "rectangle";
type DrawingTool = Exclude<MeasurementTool, "pan">;

interface ImagePoint {
  x: number;
  y: number;
}

interface Measurement {
  tool: DrawingTool;
  start: ImagePoint;
  end: ImagePoint;
}

interface MiddlePanState {
  pointerId: number;
  lastPosition: OpenSeadragon.Point;
}

let viewer: OpenSeadragon.Viewer | undefined;
let imageSmoothingEnabled: boolean | undefined;
let navigatorVisible = false;
let currentImage: ImageDescription | undefined;
let measurementTool: MeasurementTool = "pan";
let draftMeasurement: Measurement | undefined;
let measurementPointerId: number | undefined;
let middlePanState: MiddlePanState | undefined;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function currentTiledImage(): OpenSeadragon.TiledImage | undefined {
  return viewer?.world.getItemAt(0);
}

function imageZoom(current = false): number | undefined {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage) return undefined;
  return tiledImage.viewportToImageZoom(viewer.viewport.getZoom(current));
}

function updateZoomDisplay(): void {
  const zoom = imageZoom();
  if (zoom === undefined) return;

  const exactLevel = ZOOM_LEVELS.find((level) => Math.abs(level - zoom) < ZOOM_EPSILON);
  if (exactLevel !== undefined) {
    zoomCustomOption.hidden = true;
    zoomSelect.value = String(exactLevel);
    return;
  }

  const percent = zoom * 100;
  zoomCustomOption.textContent = `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
  zoomCustomOption.hidden = false;
  zoomSelect.value = "";
}

function updateImageRendering(): void {
  const zoom = imageZoom(true);
  if (!viewer || zoom === undefined) return;

  const shouldSmooth = zoom < 1 - ZOOM_EPSILON;
  if (shouldSmooth === imageSmoothingEnabled) return;
  imageSmoothingEnabled = shouldSmooth;
  viewer.drawer.setImageSmoothingEnabled(shouldSmooth);
}

function updateViewportDisplay(): void {
  updateZoomDisplay();
  updateImageRendering();
  renderMeasurements();
}

function setImageZoom(value: number, referencePoint?: OpenSeadragon.Point): void {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage || !Number.isFinite(value) || value <= 0) return;
  viewer.viewport.zoomTo(tiledImage.imageToViewportZoom(value), referencePoint, false);
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

function stepImageZoom(direction: 1 | -1, referencePoint?: OpenSeadragon.Point): void {
  const zoom = imageZoom();
  if (zoom === undefined) return;

  const level = direction > 0
    ? ZOOM_LEVELS.find((candidate) => candidate > zoom + ZOOM_EPSILON)
    : [...ZOOM_LEVELS].reverse().find((candidate) => candidate < zoom - ZOOM_EPSILON);
  if (level !== undefined) setImageZoom(level, referencePoint);
}

function setNavigatorVisible(visible: boolean): void {
  navigatorVisible = visible;
  navigatorToggleButton.classList.toggle("tool-active", visible);
  navigatorToggleButton.setAttribute("aria-pressed", String(visible));

  const currentViewer = viewer;
  const navigator = currentViewer?.navigator;
  if (!navigator) return;

  // Keep the navigator laid out while hidden. OpenSeadragon measures its
  // internal canvas while loading; display:none collapses it to 1x1 and leaves
  // an empty grey navigator when it is shown again.
  const controlWrapper = navigator.element.parentElement;
  if (controlWrapper) {
    controlWrapper.style.display = "inline-block";
    controlWrapper.style.visibility = visible ? "visible" : "hidden";
    controlWrapper.style.pointerEvents = visible ? "" : "none";
    controlWrapper.style.opacity = "1";
  }

  navigator.element.style.display = "";
  navigator.container.style.visibility = "";
  if (visible) {
    navigator.updateSize();
    navigator.update(currentViewer.viewport);
    navigator.forceRedraw();
  }
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

function viewerPointFromImagePoint(point: ImagePoint): OpenSeadragon.Point | undefined {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage) return undefined;
  const viewportPoint = tiledImage.imageToViewportCoordinates(point.x + 0.5, point.y + 0.5, true);
  return viewer.viewport.pixelFromPoint(viewportPoint, true);
}

function measurementLabelWidth(text: string): number {
  if (!measurementLabelContext) return text.length * 8;
  measurementLabelContext.font = `${MEASUREMENT_LABEL_FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`;
  return measurementLabelContext.measureText(text).width;
}

function renderCursorLabel(
  text: string,
  cursor: OpenSeadragon.Point,
  figurePoint: OpenSeadragon.Point,
): SVGGElement {
  const horizontalPadding = 7;
  const labelHeight = 22;
  const labelWidth = Math.ceil(measurementLabelWidth(text)) + horizontalPadding * 2;
  const edgeMargin = 4;
  const cursorGap = 8;
  const awayX = cursor.x - figurePoint.x;
  const awayY = cursor.y - figurePoint.y;

  const candidates = ([
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ] as const).map((direction) => {
    const x = cursor.x + direction.x * (labelWidth / 2 + cursorGap);
    const y = cursor.y + direction.y * (labelHeight / 2 + cursorGap);
    const overflow = Math.max(0, edgeMargin - (x - labelWidth / 2))
      + Math.max(0, x + labelWidth / 2 - (measurementOverlay.clientWidth - edgeMargin))
      + Math.max(0, edgeMargin - (y - labelHeight / 2))
      + Math.max(0, y + labelHeight / 2 - (measurementOverlay.clientHeight - edgeMargin));
    const awayAlignment = direction.x * awayX + direction.y * awayY;
    return { x, y, overflow, awayAlignment };
  });

  candidates.sort((a, b) => {
    if (a.overflow !== b.overflow) return a.overflow - b.overflow;
    return b.awayAlignment - a.awayAlignment;
  });

  const placement = candidates[0];
  const centreX = Math.max(
    labelWidth / 2 + edgeMargin,
    Math.min(measurementOverlay.clientWidth - labelWidth / 2 - edgeMargin, placement.x),
  );
  const centreY = Math.max(
    labelHeight / 2 + edgeMargin,
    Math.min(measurementOverlay.clientHeight - labelHeight / 2 - edgeMargin, placement.y),
  );

  const group = createSvgElement("g");
  const background = createSvgElement("rect");
  background.classList.add("measurement-label-background");
  setAttributes(background, {
    x: centreX - labelWidth / 2,
    y: centreY - labelHeight / 2,
    width: labelWidth,
    height: labelHeight,
    rx: 4,
  });

  const label = createSvgElement("text");
  label.classList.add("measurement-label");
  label.textContent = text;
  setAttributes(label, {
    x: centreX,
    y: centreY,
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  group.append(background, label);
  return group;
}

function renderMeasurement(measurement: Measurement): DocumentFragment | undefined {
  const start = viewerPointFromImagePoint(measurement.start);
  const end = viewerPointFromImagePoint(measurement.end);
  if (!start || !end) return undefined;

  const fragment = document.createDocumentFragment();
  const deltaX = Math.abs(measurement.end.x - measurement.start.x);
  const deltaY = Math.abs(measurement.end.y - measurement.start.y);

  if (measurement.tool === "ruler") {
    for (const tone of ["white", "black"] as const) {
      const line = createSvgElement("line");
      line.classList.add("measurement-stroke", `measurement-stroke-${tone}`);
      setAttributes(line, { x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      fragment.append(line);
    }

    for (const point of [start, end]) {
      const marker = createSvgElement("circle");
      marker.classList.add("measurement-point");
      setAttributes(marker, { cx: point.x, cy: point.y, r: 3 });
      fragment.append(marker);
    }

    const length = Math.round(Math.hypot(deltaX + 1, deltaY + 1));
    fragment.append(renderCursorLabel(
      `${length} px`,
      end,
      start,
    ));
  } else {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    for (const tone of ["white", "black"] as const) {
      const rectangle = createSvgElement("rect");
      rectangle.classList.add("measurement-stroke", `measurement-stroke-${tone}`);
      setAttributes(rectangle, { x: left, y: top, width, height });
      fragment.append(rectangle);
    }

    fragment.append(renderCursorLabel(`(${deltaX + 1}, ${deltaY + 1}) px`, end, start));
  }

  return fragment;
}

function renderMeasurements(): void {
  measurementLayer.replaceChildren();
  if (draftMeasurement) {
    const rendered = renderMeasurement(draftMeasurement);
    if (rendered) measurementLayer.append(rendered);
  }
}

function cancelDraftMeasurement(): void {
  if (measurementPointerId !== undefined && stageElement.hasPointerCapture(measurementPointerId)) {
    stageElement.releasePointerCapture(measurementPointerId);
  }
  measurementPointerId = undefined;
  draftMeasurement = undefined;
  renderMeasurements();
}

function setMeasurementTool(tool: MeasurementTool): void {
  cancelDraftMeasurement();
  measurementTool = tool;
  stageElement.classList.toggle("measurement-active", tool !== "pan");
  for (const [button, buttonTool] of [
    [panToolButton, "pan"],
    [rulerToolButton, "ruler"],
    [rectangleToolButton, "rectangle"],
  ] as const) {
    const active = tool === buttonTool;
    button.classList.toggle("tool-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function imagePointFromPointer(event: PointerEvent, clampToImage: boolean): ImagePoint | undefined {
  const tiledImage = currentTiledImage();
  if (!viewer || !tiledImage || !currentImage) return undefined;

  const bounds = viewerElement.getBoundingClientRect();
  const viewerPoint = new OpenSeadragon.Point(event.clientX - bounds.left, event.clientY - bounds.top);
  const viewportPoint = viewer.viewport.pointFromPixel(viewerPoint, true);
  const imagePoint = tiledImage.viewportToImageCoordinates(viewportPoint, true);
  const insideImage = imagePoint.x >= 0 && imagePoint.x < currentImage.width
    && imagePoint.y >= 0 && imagePoint.y < currentImage.height;
  if (!insideImage && !clampToImage) return undefined;

  return {
    x: Math.max(0, Math.min(currentImage.width - 1, Math.floor(imagePoint.x))),
    y: Math.max(0, Math.min(currentImage.height - 1, Math.floor(imagePoint.y))),
  };
}

function finishMeasurement(event: PointerEvent): void {
  if (event.pointerId !== measurementPointerId || !draftMeasurement) return;
  measurementPointerId = undefined;
  draftMeasurement = undefined;
  if (stageElement.hasPointerCapture(event.pointerId)) stageElement.releasePointerCapture(event.pointerId);
  renderMeasurements();
  event.preventDefault();
  event.stopPropagation();
}

function finishMiddlePan(pointerId?: number): void {
  if (!middlePanState || (pointerId !== undefined && pointerId !== middlePanState.pointerId)) return;
  if (stageElement.hasPointerCapture(middlePanState.pointerId)) {
    stageElement.releasePointerCapture(middlePanState.pointerId);
  }
  middlePanState = undefined;
  stageElement.classList.remove("middle-pan-active");
  viewer?.viewport.applyConstraints(false);
}

function openImage(image: ImageDescription): void {
  finishMiddlePan();
  viewer?.destroy();
  viewerElement.replaceChildren();
  imageSmoothingEnabled = undefined;
  currentImage = image;
  setMeasurementTool("pan");

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
    navigatorAutoFade: false,
    animationTime: 0.35,
    blendTime: 0,
    immediateRender: false,
    preserveViewport: true,
    minZoomImageRatio: 0.001,
    maxZoomPixelRatio: 32,
    imageSmoothingEnabled: true,
    smoothTileEdgesMinZoom: Infinity,
    visibilityRatio: 0.5,
    constrainDuringPan: true,
    gestureSettingsMouse: {
      clickToZoom: false,
      dblClickToZoom: false,
      dragToPan: true,
      scrollToZoom: true,
      pinchToZoom: true,
      flickEnabled: true,
    },
    gestureSettingsTouch: {
      clickToZoom: false,
      dblClickToZoom: false,
      dragToPan: true,
      scrollToZoom: false,
      pinchToZoom: true,
      flickEnabled: true,
    },
    gestureSettingsPen: {
      dblClickToZoom: false,
    },
    gestureSettingsUnknown: {
      dblClickToZoom: false,
    },
  });
  setNavigatorVisible(navigatorVisible);

  viewer.addHandler("open", () => {
    messageElement.hidden = true;
    dimensionsElement.textContent = `${image.width.toLocaleString()} × ${image.height.toLocaleString()} px`;
    applyInitialZoom(image);
    updateImageRendering();
  });
  viewer.addHandler("zoom", updateViewportDisplay);
  viewer.addHandler("animation", updateViewportDisplay);
  viewer.addHandler("pan", renderMeasurements);
  viewer.addHandler("resize", renderMeasurements);
  viewer.addHandler("open-failed", (event) => {
    messageElement.hidden = false;
    messageElement.classList.add("error");
    messageElement.textContent = `Could not load image tiles: ${event.message ?? "unknown error"}`;
  });
}

requiredElement("fit").addEventListener("click", fitImage);
requiredElement("actual").addEventListener("click", () => setImageZoom(1));
requiredElement("zoom-in").addEventListener("click", () => stepImageZoom(1));
requiredElement("zoom-out").addEventListener("click", () => stepImageZoom(-1));
zoomSelect.addEventListener("change", () => setImageZoom(Number.parseFloat(zoomSelect.value)));
navigatorToggleButton.addEventListener("click", () => setNavigatorVisible(!navigatorVisible));
panToolButton.addEventListener("click", () => setMeasurementTool("pan"));
rulerToolButton.addEventListener("click", () => setMeasurementTool("ruler"));
rectangleToolButton.addEventListener("click", () => setMeasurementTool("rectangle"));

stageElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 1 || !event.isPrimary) return;
  if (event.target instanceof Element && event.target.closest(".navigator")) return;

  middlePanState = {
    pointerId: event.pointerId,
    lastPosition: new OpenSeadragon.Point(event.clientX, event.clientY),
  };
  stageElement.classList.add("middle-pan-active");
  stageElement.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}, true);

stageElement.addEventListener("pointerdown", (event) => {
  if (measurementTool === "pan" || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.target instanceof Element && event.target.closest(".navigator")) return;

  const point = imagePointFromPointer(event, false);
  if (!point) return;
  measurementPointerId = event.pointerId;
  draftMeasurement = { tool: measurementTool, start: point, end: point };
  stageElement.setPointerCapture(event.pointerId);
  renderMeasurements();
}, true);

stageElement.addEventListener("pointermove", (event) => {
  if (event.pointerId !== middlePanState?.pointerId) return;
  if ((event.buttons & 4) === 0) {
    finishMiddlePan(event.pointerId);
    return;
  }

  const currentPosition = new OpenSeadragon.Point(event.clientX, event.clientY);
  const delta = currentPosition.minus(middlePanState.lastPosition);
  middlePanState.lastPosition = currentPosition;
  if (viewer && (delta.x !== 0 || delta.y !== 0)) {
    viewer.viewport.panBy(viewer.viewport.deltaPointsFromPixels(delta.negate()), true);
    viewer.viewport.applyConstraints(true);
  }
  event.preventDefault();
  event.stopPropagation();
}, true);

stageElement.addEventListener("pointermove", (event) => {
  if (event.pointerId !== measurementPointerId || !draftMeasurement) return;
  const point = imagePointFromPointer(event, true);
  if (point) draftMeasurement.end = point;
  renderMeasurements();
  event.preventDefault();
  event.stopPropagation();
}, true);

stageElement.addEventListener("pointerup", (event) => {
  if (event.pointerId !== middlePanState?.pointerId || event.button !== 1) return;
  finishMiddlePan(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}, true);
stageElement.addEventListener("pointerup", finishMeasurement, true);
stageElement.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== middlePanState?.pointerId) return;
  finishMiddlePan(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}, true);
stageElement.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== measurementPointerId) return;
  cancelDraftMeasurement();
  event.preventDefault();
  event.stopPropagation();
}, true);
stageElement.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (document.activeElement === zoomSelect) return;
  if (event.key === "Escape") setMeasurementTool("pan");
  else if (event.key === "0") fitImage();
  else if (event.key === "1") setImageZoom(1);
  else if (event.key === "+" || event.key === "=") stepImageZoom(1);
  else if (event.key === "-") stepImageZoom(-1);
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
