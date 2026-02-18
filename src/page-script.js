(() => {
  const SENTINEL = "__W4S_MAIN_READY__";
  if (window[SENTINEL]) {
    return;
  }
  window[SENTINEL] = true;

  const CONFIG = {
    apiBase: "https://api.open-meteo.com/v1/forecast",
    refreshDebounceMs: 320,
    mapScanMs: 950,
    urlPollMs: 900,
    gridRowsAtLevel5: 9,
    gridColsAtLevel5: 11,
    minGridRows: 3,
    maxGridRows: 18,
    minGridCols: 4,
    maxGridCols: 22,
    densityMin: 1,
    densityMax: 10,
    densityStep: 1,
    defaultDensityLevel: 5,
    maxOffsetHours: 24,
    offsetStepHours: 2,
    maxPointsPerRequest: 85,
    minFetchIntervalMs: 3500,
    maxFetchRetries: 4,
    retryBaseDelayMs: 1200,
    retryMaxDelayMs: 8000,
    manualRefreshFreshMs: 10 * 60 * 1000,
    rateLimitDensityFactor: 0.6,
    rateLimitCapDurationMs: 2 * 60 * 1000,
    staleCacheMaxAgeMs: 2 * 60 * 60 * 1000,
    maxCacheEntries: 24,
    objectScanMaxNodes: 700,
    objectScanMaxProps: 35,
    stravaButtonSize: 40,
    stravaButtonGap: 0,
    overlayZIndex: 2,
    controlsZIndex: 30
  };

  const MESSAGE_SOURCE_EXT = "w4s-ext";
  const MESSAGE_SOURCE_PAGE = "w4s-page";
  const DEFAULT_SETTINGS = {
    enabled: false,
    offsetHours: 0,
    densityLevel: CONFIG.defaultDensityLevel
  };

  const state = {
    map: null,
    mapPollId: null,
    urlPollId: null,
    refreshTimerId: null,
    refreshNonce: 0,
    fetchController: null,
    activeRequestKey: "",
    cache: new Map(),
    overlayRoot: null,
    canvas: null,
    ctx: null,
    mountedContainer: null,
    mapboxCtorPatched: false,
    mapDetectCounter: 0,
    lastUrl: location.href,
    lastFallbackSignature: "",
    lastUiStateSignature: "",
    lastError: null,
    lastFetchStartedAtMs: 0,
    densityCapUntilMs: 0,
    effectiveDensityCap: CONFIG.densityMax,
    settings: { ...DEFAULT_SETTINGS },
    statusText: "Wind is off. Click the wind icon near Heatmaps and Segments to enable.",
    statusLevel: "off",
    forecastText: "Forecast: Unavailable",
    lastGeoMode: null,
    lastDerivedVectors: null,
    lastDerivedForecastTimeMs: Number.NaN,
    lastDerivedMode: null,
    viewRedrawFrameId: 0,
    isAreaDirty: false,
    lastFetchedCacheKey: "",
    lastManualRefreshAtMs: 0,
    stravaToggleButton: null,
    stravaRefreshButton: null,
    stravaControlGroup: null,
    stravaToggleSlot: null,
    lastButtonAnchorSignature: "",
    buttonObserver: null
  };

  function debug(...args) {
    try {
      console.debug("[W4S]", ...args);
    } catch {
      // no-op
    }
  }

  function rememberError(step, error) {
    const message = error?.message || String(error);
    state.lastError = `${step}: ${message}`;
    debug(`Error in ${step}`, error);
  }

  function isRouteBuilderUrl(urlString = location.href) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return false;
    }

    const host = url.hostname.toLowerCase();
    const isStravaHost = host === "strava.com" || host === "www.strava.com" || host.endsWith(".strava.com");
    if (!isStravaHost) {
      return false;
    }

    const path = url.pathname.toLowerCase();
    if (path === "/routes/new" || path.startsWith("/routes/new/")) {
      return true;
    }

    if (/^\/routes\/\d+\/edit$/.test(path)) {
      return true;
    }

    if (path.startsWith("/maps")) {
      return true;
    }

    return path.includes("route") || path.includes("map");
  }

  function clampOffsetHours(value) {
    const numeric = Number(value);
    const fallback = DEFAULT_SETTINGS.offsetHours;
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    const stepped = Math.round(numeric / CONFIG.offsetStepHours) * CONFIG.offsetStepHours;
    return Math.max(0, Math.min(CONFIG.maxOffsetHours, stepped));
  }

  function clampDensityLevel(value) {
    const numeric = Number(value);
    const fallback = DEFAULT_SETTINGS.densityLevel;
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(CONFIG.densityMin, Math.min(CONFIG.densityMax, Math.round(numeric)));
  }

  function normalizeEnabled(value) {
    if (value === true || value === 1) {
      return true;
    }
    if (typeof value === "string") {
      return value.trim().toLowerCase() === "true";
    }
    return false;
  }

  function normalizeSettings(value) {
    return {
      enabled: normalizeEnabled(value?.enabled),
      offsetHours: clampOffsetHours(value?.offsetHours),
      densityLevel: clampDensityLevel(value?.densityLevel)
    };
  }

  function ensureInlineStyles() {
    if (document.getElementById("w4s-inline-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "w4s-inline-style";
    style.textContent = `
      .w4s-overlay-root {
        position: absolute;
        inset: 0;
        z-index: ${CONFIG.overlayZIndex};
        pointer-events: none;
      }
      .w4s-overlay-root.w4s-overlay-root--fixed {
        position: fixed;
      }
      .w4s-overlay-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .w4s-strava-btn {
        pointer-events: auto;
        position: relative;
        height: ${CONFIG.stravaButtonSize}px;
        width: ${CONFIG.stravaButtonSize}px;
        min-width: ${CONFIG.stravaButtonSize}px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #242428;
        cursor: pointer;
        font-family: "Boathouse", "Inter", "Avenir Next", "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        display: inline-flex;
        justify-content: center;
        align-items: center;
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      }
      .w4s-btn-group {
        display: inline-flex;
        align-items: stretch;
        gap: ${CONFIG.stravaButtonGap}px;
        pointer-events: auto;
        background: #ffffff;
        border: 1px solid #d5d8de;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
      }
      .w4s-btn-group:hover {
        border-color: #c3c7cf;
      }
      .w4s-btn-group .w4s-strava-btn + .w4s-strava-btn {
        border-left: 1px solid #e2e6ed;
      }
      .w4s-slot {
        display: inline-flex;
        position: fixed;
        top: -9999px;
        left: -9999px;
        width: ${(CONFIG.stravaButtonSize * 2) + CONFIG.stravaButtonGap}px;
        height: ${CONFIG.stravaButtonSize}px;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: ${CONFIG.controlsZIndex};
        flex-shrink: 0;
      }
      .w4s-strava-btn:hover {
        background: #f8fafc;
      }
      .w4s-strava-btn:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px rgba(252, 76, 2, 0.45);
      }
      .w4s-strava-btn:disabled {
        cursor: not-allowed;
        opacity: 0.7;
      }
      .w4s-strava-btn .w4s-btn-icon {
        display: inline-flex;
        width: 16px;
        height: 16px;
        color: currentColor;
      }
      .w4s-strava-btn.w4s-btn--off {
        color: #5f6773;
        background: transparent;
      }
      .w4s-strava-btn.w4s-btn--on {
        background: #fff7f3;
        color: #fc4c02;
      }
      .w4s-strava-btn.w4s-btn--error {
        background: #fff5f5;
        color: #991b1b;
      }
      .w4s-strava-btn.w4s-btn--loading {
        color: #fc4c02;
        background: #fff8f3;
      }
      .w4s-strava-btn.w4s-btn--loading .w4s-btn-icon {
        animation: w4s-spin 0.85s linear infinite;
      }
      .w4s-refresh-btn {
        color: #5f6773;
        background: transparent;
      }
      .w4s-refresh-btn.w4s-refresh-btn--dirty {
        color: #fc4c02;
        background: #fff7f3;
      }
      .w4s-refresh-btn.w4s-refresh-btn--loading .w4s-btn-icon {
        animation: w4s-spin 0.85s linear infinite;
      }
      @keyframes w4s-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `;

    const parent = document.head ?? document.documentElement;
    if (parent) {
      parent.appendChild(style);
    }
  }

  function hasCallableProperty(target, key) {
    if (!target) {
      return false;
    }
    try {
      return typeof target[key] === "function";
    } catch {
      return false;
    }
  }

  function looksLikeMapObject(candidate) {
    return (
      hasCallableProperty(candidate, "getContainer") &&
      hasCallableProperty(candidate, "getBounds") &&
      hasCallableProperty(candidate, "project") &&
      hasCallableProperty(candidate, "on")
    );
  }

  function patchMapboxCtorIfAvailable() {
    if (state.mapboxCtorPatched) {
      return;
    }

    const mapbox = window.mapboxgl;
    if (!mapbox || !mapbox.Map || mapbox.Map.__w4sPatched) {
      return;
    }

    const OriginalMap = mapbox.Map;
    function PatchedMap(...args) {
      const map = new OriginalMap(...args);
      onMapReady(map, "mapbox constructor");
      return map;
    }

    PatchedMap.prototype = OriginalMap.prototype;
    Object.setPrototypeOf(PatchedMap, OriginalMap);
    PatchedMap.__w4sPatched = true;
    mapbox.Map = PatchedMap;

    state.mapboxCtorPatched = true;
    debug("Patched mapbox.Map constructor");

    const existing = findMapFromWindowByCtor(OriginalMap);
    if (existing) {
      onMapReady(existing, "existing mapbox instance");
    }
  }

  function findMapFromWindowByCtor(MapCtor) {
    const keys = Object.getOwnPropertyNames(window);
    for (const key of keys) {
      let value;
      try {
        value = window[key];
        if (!value) {
          continue;
        }

        if (value instanceof MapCtor) {
          return value;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            try {
              if (item instanceof MapCtor) {
                return item;
              }
            } catch {
              // ignore inaccessible cross-origin item
            }
          }
        }
      } catch {
        // ignore inaccessible cross-origin window properties
        continue;
      }
    }

    return null;
  }

  function findMapFromDomProps() {
    const candidates = document.querySelectorAll(
      ".mapboxgl-map, canvas.mapboxgl-canvas, [class*='mapboxgl'], [data-testid*='map'], [class*='map']"
    );

    for (const node of candidates) {
      const element = node instanceof HTMLCanvasElement ? node.parentElement : node;
      if (!element || !(element instanceof HTMLElement)) {
        continue;
      }

      const directKeys = ["_map", "__map", "map", "__mapbox", "__mapboxgl", "_mapInstance"];
      for (const key of directKeys) {
        let value;
        try {
          value = element[key];
        } catch {
          continue;
        }
        if (looksLikeMapObject(value)) {
          return value;
        }
      }

      let props;
      try {
        props = Object.getOwnPropertyNames(element);
      } catch {
        continue;
      }

      for (let i = 0; i < props.length; i += 1) {
        const key = props[i];
        if (key.startsWith("__react")) {
          continue;
        }

        let value;
        try {
          value = element[key];
        } catch {
          continue;
        }

        if (looksLikeMapObject(value)) {
          return value;
        }

        if (value && typeof value === "object" && looksLikeMapObject(value.map)) {
          return value.map;
        }
      }
    }

    return null;
  }

  function findMapInObjectGraph() {
    const queue = [window];
    const seen = new WeakSet();
    let inspected = 0;

    while (queue.length && inspected < CONFIG.objectScanMaxNodes) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const type = typeof current;
      if (type !== "object" && type !== "function") {
        continue;
      }

      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      inspected += 1;

      if (looksLikeMapObject(current)) {
        return current;
      }

      let keys;
      try {
        keys = Object.getOwnPropertyNames(current);
      } catch {
        continue;
      }

      for (let i = 0; i < keys.length && i < CONFIG.objectScanMaxProps; i += 1) {
        const key = keys[i];
        if (
          key === "window" ||
          key === "self" ||
          key === "top" ||
          key === "parent" ||
          key === "frames" ||
          key === "globalThis" ||
          key === "document"
        ) {
          continue;
        }

        let value;
        try {
          value = current[key];
        } catch {
          continue;
        }

        if (!value) {
          continue;
        }

        if (looksLikeMapObject(value)) {
          return value;
        }

        const valueType = typeof value;
        if (valueType === "object" || valueType === "function") {
          if (!(value instanceof Node)) {
            queue.push(value);
          }
        }
      }
    }

    return null;
  }

  function detectMapObjectFallback(includeDeepScan) {
    if (state.map) {
      return;
    }

    const fromDom = findMapFromDomProps();
    if (fromDom) {
      onMapReady(fromDom, "DOM properties");
      return;
    }

    if (includeDeepScan) {
      const fromGraph = findMapInObjectGraph();
      if (fromGraph) {
        onMapReady(fromGraph, "window object graph");
      }
    }
  }

  function onMapReady(map, source) {
    if (!looksLikeMapObject(map)) {
      return;
    }

    if (state.map === map) {
      return;
    }

    state.map = map;
    state.mapDetectCounter = 0;
    debug("Map attached from", source);

    try {
      map.on("move", scheduleViewRedraw);
      map.on("rotate", scheduleViewRedraw);
      map.on("pitch", scheduleViewRedraw);
      map.on("moveend", () => handleViewportChanged("map-moveend"));
      map.on("zoomend", () => handleViewportChanged("map-zoomend"));
      map.on("dragend", () => handleViewportChanged("map-dragend"));
      map.on("resize", () => handleViewportChanged("map-resize"));
    } catch (error) {
      debug("Failed to bind map listeners", error);
    }

    ensureOverlay();
    mountOverlayToBestContainer();
    refreshViewState("map-ready");
  }

  function getMapContainer() {
    if (!state.map || typeof state.map.getContainer !== "function") {
      return null;
    }

    try {
      const container = state.map.getContainer();
      return container instanceof HTMLElement ? container : null;
    } catch {
      return null;
    }
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 320 || rect.height < 220) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    return true;
  }

  function isInternalOverlayElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (element.classList?.contains("w4s-overlay-canvas")) {
      return true;
    }
    return Boolean(element.closest(".w4s-overlay-root, .w4s-slot"));
  }

  function findMapViewportElement() {
    const explicitMaps = Array.from(document.querySelectorAll(".mapboxgl-map")).filter(
      (node) => node instanceof HTMLElement && isVisibleElement(node) && !isInternalOverlayElement(node)
    );
    if (explicitMaps.length) {
      return explicitMaps.sort(
        (a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height
      )[0];
    }

    const mapboxCanvas = Array.from(document.querySelectorAll("canvas.mapboxgl-canvas")).find(
      (node) => node instanceof HTMLCanvasElement && !isInternalOverlayElement(node)
    );
    if (mapboxCanvas instanceof HTMLCanvasElement) {
      const parent = mapboxCanvas.parentElement;
      if (parent && isVisibleElement(parent) && !isInternalOverlayElement(parent)) {
        return parent;
      }
    }

    const canvases = document.querySelectorAll("main canvas, canvas");
    let bestCanvas = null;
    let bestArea = 0;

    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement)) {
        continue;
      }
      if (isInternalOverlayElement(canvas)) {
        continue;
      }

      const rect = canvas.getBoundingClientRect();
      if (rect.width < 320 || rect.height < 220) {
        continue;
      }

      const style = window.getComputedStyle(canvas);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        continue;
      }

      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        bestCanvas = canvas;
      }
    }

    if (bestCanvas) {
      const parent = bestCanvas.closest(".mapboxgl-map") ?? bestCanvas.parentElement;
      if (parent instanceof HTMLElement && isVisibleElement(parent) && !isInternalOverlayElement(parent)) {
        return parent;
      }
    }

    return null;
  }

  function getFallbackContainer() {
    const mapViewport = findMapViewportElement();
    if (mapViewport) {
      return mapViewport;
    }

    const main = document.querySelector("main");
    if (main instanceof HTMLElement) {
      return main;
    }

    return document.body;
  }

  function mountOverlayToBestContainer() {
    if (!state.overlayRoot) {
      return;
    }

    const mapContainer = getMapContainer();
    const fixedTarget = document.body ?? document.documentElement;
    const target = state.map ? (mapContainer ?? getFallbackContainer()) : fixedTarget;
    if (!target) {
      return;
    }

    if (state.mountedContainer !== target) {
      if (target !== document.body && target !== document.documentElement) {
        const computed = window.getComputedStyle(target);
        if (computed.position === "static") {
          target.style.position = "relative";
        }
      }

      target.appendChild(state.overlayRoot);
      state.mountedContainer = target;
    }

    const isFixed = !state.map || target === document.body || target === document.documentElement;
    if (isFixed) {
      state.overlayRoot.classList.add("w4s-overlay-root--fixed");
      if (state.canvas) {
        state.canvas.style.display = "block";
      }
      syncCanvasSize();
      return;
    }

    state.overlayRoot.classList.remove("w4s-overlay-root--fixed");
    if (state.canvas) {
      state.canvas.style.display = "block";
    }

    syncCanvasSize();
  }

  function ensureOverlay() {
    if (state.overlayRoot) {
      mountOverlayToBestContainer();
      return;
    }

    const root = document.createElement("div");
    root.className = "w4s-overlay-root w4s-overlay-root--fixed";

    const canvas = document.createElement("canvas");
    canvas.className = "w4s-overlay-canvas";

    root.appendChild(canvas);

    state.overlayRoot = root;
    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");
    mountOverlayToBestContainer();
  }

  function createStravaToggleButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "w4s-strava-btn w4s-btn--off";
    button.setAttribute("aria-label", "Toggle wind overlay");
    button.innerHTML = `
      <span class="w4s-btn-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 10.2h9.2c1.7 0 2.8-1 2.8-2.3 0-1.2-1-2.2-2.3-2.2-1 0-1.8.5-2.1 1.3"></path>
          <path d="M3.6 14h11.1c2 0 3.2 1.1 3.2 2.5 0 1.5-1.2 2.5-2.8 2.5-1.1 0-2-.5-2.4-1.4"></path>
          <path d="M9.5 8.1l2.3-1.2-1.2-2.2"></path>
          <path d="M10.5 16.9l2.3 1.2-1.2 2.2"></path>
        </svg>
      </span>
    `;

    button.addEventListener("click", () => {
      const nextEnabled = !state.settings.enabled;
      applySettings({ enabled: nextEnabled }, "button-toggle");
      emitMessageToExtension("w4s:user-toggle", { enabled: nextEnabled });
    });

    return button;
  }

  function createStravaRefreshButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "w4s-strava-btn w4s-refresh-btn";
    button.setAttribute("aria-label", "Refresh wind overlay for current map area");
    button.innerHTML = `
      <span class="w4s-btn-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66"></path>
          <path d="M20 4v6h-6"></path>
        </svg>
      </span>
    `;

    button.addEventListener("click", () => {
      if (state.fetchController) {
        return;
      }

      if (!state.settings.enabled) {
        applySettings({ enabled: true }, "refresh-button-off", { fetchOnEnable: false });
        emitMessageToExtension("w4s:user-toggle", { enabled: true });
        void requestAreaRefresh("refresh-button-off", {
          manual: true,
          allowCache: true,
          allowNetwork: true,
          immediate: true
        });
        return;
      }

      void requestAreaRefresh("refresh-button", {
        manual: true,
        allowCache: true,
        allowNetwork: true,
        immediate: true
      });
    });

    return button;
  }

  function createStravaControlGroup() {
    const group = document.createElement("span");
    group.className = "w4s-btn-group";

    if (!state.stravaToggleButton) {
      state.stravaToggleButton = createStravaToggleButton();
    }
    if (!state.stravaRefreshButton) {
      state.stravaRefreshButton = createStravaRefreshButton();
    }

    group.replaceChildren(state.stravaToggleButton, state.stravaRefreshButton);
    return group;
  }

  function createStravaToggleSlot() {
    const slot = document.createElement("span");
    slot.className = "w4s-slot";
    return slot;
  }

  function collectNodeHints(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    const attributes = [
      element.className,
      element.id,
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-qa"),
      element.getAttribute("data-component"),
      element.getAttribute("aria-label")
    ]
      .filter(Boolean)
      .map((part) => String(part).toLowerCase());
    return attributes.join(" ");
  }

  function isLikelySquadratsSubtree(element) {
    let current = element instanceof HTMLElement ? element : null;
    while (current) {
      const hints = collectNodeHints(current);
      if (hints.includes("squadrats")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function elementSignature(element) {
    if (!(element instanceof HTMLElement)) {
      return "none";
    }
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test-id") || "";
    return [element.tagName, element.id, element.className, testId].join(":");
  }

  function getAnchorSignature(anchor) {
    if (!anchor) {
      return "";
    }
    return [elementSignature(anchor.referenceControl), `${anchor.left},${anchor.top}`].join("|");
  }

  function isVisibleToolbarControl(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 42 || rect.height < 28) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  }

  function getToolbarIntent(control) {
    const hint = [collectNodeHints(control), (control.textContent || "").trim().toLowerCase()].filter(Boolean).join(" ");
    return {
      hasHeatmaps: hint.includes("heatmap"),
      hasSegments: hint.includes("segment")
    };
  }

  function resolveToolbarRow(referenceControl) {
    if (!(referenceControl instanceof HTMLElement)) {
      return null;
    }

    let current = referenceControl.parentElement;
    let depth = 0;
    while (current && depth < 6) {
      if (!(current instanceof HTMLElement)) {
        return null;
      }
      if (!current.closest("main")) {
        return null;
      }

      const directControls = Array.from(current.children).filter(
        (child) =>
          child instanceof HTMLElement &&
          (child.matches("button") || child.matches("a[role='button']") || child.matches("[role='button']")) &&
          isVisibleToolbarControl(child)
      );
      const style = window.getComputedStyle(current);
      if (directControls.length >= 2 && (style.display.includes("flex") || style.display.includes("grid"))) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return referenceControl.parentElement instanceof HTMLElement ? referenceControl.parentElement : null;
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function pickFloatingLeft(anchorRow, referenceControl, preferredLeft, topPx) {
    const slotWidth = (CONFIG.stravaButtonSize * 2) + CONFIG.stravaButtonGap;
    const slotHeight = CONFIG.stravaButtonSize;
    const jump = slotWidth + 10;
    const candidates = [preferredLeft, preferredLeft + jump, preferredLeft - jump, preferredLeft + (jump * 2)];
    const controls = anchorRow
      ? Array.from(anchorRow.querySelectorAll("button, a[role='button'], [role='button']")).filter(
          (el) =>
            el instanceof HTMLElement &&
            el !== state.stravaToggleButton &&
            el !== state.stravaRefreshButton &&
            !el.closest(".w4s-slot") &&
            isVisibleToolbarControl(el)
        )
      : [];

    for (const left of candidates) {
      if (left < 8 || left + slotWidth > window.innerWidth - 8) {
        continue;
      }

      const slotRect = {
        left,
        right: left + slotWidth,
        top: topPx,
        bottom: topPx + slotHeight
      };
      let hasOverlap = false;
      for (const control of controls) {
        if (control === referenceControl) {
          continue;
        }
        const rect = control.getBoundingClientRect();
        if (rectsOverlap(slotRect, rect)) {
          hasOverlap = true;
          break;
        }
      }
      if (!hasOverlap) {
        return left;
      }
    }

    return null;
  }

  function findMapToolbarAnchor() {
    const controls = Array.from(document.querySelectorAll("main button, main a[role='button'], main [role='button']")).filter((el) =>
      el instanceof HTMLElement && isVisibleToolbarControl(el)
    );
    if (!controls.length) {
      return null;
    }

    const matches = controls
      .map((control) => ({
        control,
        intent: getToolbarIntent(control),
        rect: control.getBoundingClientRect()
      }))
      .filter((entry) => entry.intent.hasHeatmaps || entry.intent.hasSegments);

    if (!matches.length) {
      return null;
    }

    const segmentMatches = matches.filter((entry) => entry.intent.hasSegments);
    const heatmapMatches = matches.filter((entry) => entry.intent.hasHeatmaps);
    const preferred = (segmentMatches.length ? segmentMatches : heatmapMatches).sort((a, b) => b.rect.right - a.rect.right)[0];
    if (!preferred || !(preferred.control instanceof HTMLElement)) {
      return null;
    }
    if (isLikelySquadratsSubtree(preferred.control)) {
      return null;
    }

    const anchorRow = resolveToolbarRow(preferred.control);
    if (!(anchorRow instanceof HTMLElement) || isLikelySquadratsSubtree(anchorRow)) {
      return null;
    }

    const slotWidth = (CONFIG.stravaButtonSize * 2) + CONFIG.stravaButtonGap;
    const slotHeight = CONFIG.stravaButtonSize;
    const referenceRect = preferred.control.getBoundingClientRect();
    const preferredTop = Math.round(referenceRect.top + (referenceRect.height - slotHeight) / 2);
    const topPx = Math.max(8, Math.min(Math.max(window.innerHeight - (slotHeight + 8), 8), preferredTop));

    let preferredLeft = Math.round(referenceRect.right + 10);
    if (preferredLeft + slotWidth > window.innerWidth - 8) {
      preferredLeft = Math.round(referenceRect.left - (slotWidth + 10));
    }

    const leftPx = pickFloatingLeft(anchorRow, preferred.control, preferredLeft, topPx);
    if (!Number.isFinite(leftPx)) {
      return null;
    }

    return {
      referenceControl: preferred.control,
      actionContainer: anchorRow,
      left: leftPx,
      top: topPx
    };
  }

  function updateStravaToggleButton() {
    if (state.stravaToggleButton) {
      const button = state.stravaToggleButton;
      button.classList.remove("w4s-btn--off", "w4s-btn--loading", "w4s-btn--on", "w4s-btn--error");

      let visualStateClass = "w4s-btn--off";
      if (state.settings.enabled) {
        if (state.statusLevel === "loading") {
          visualStateClass = "w4s-btn--loading";
        } else if (state.statusLevel === "error") {
          visualStateClass = "w4s-btn--error";
        } else {
          visualStateClass = "w4s-btn--on";
        }
      }

      button.classList.add(visualStateClass);
      button.setAttribute("aria-pressed", String(state.settings.enabled));
      button.title = state.statusText || (state.settings.enabled ? "Wind overlay enabled." : "Wind overlay disabled.");
    }

    if (state.stravaRefreshButton) {
      const button = state.stravaRefreshButton;
      const isLoading = Boolean(state.fetchController);
      const shouldHighlightDirty = Boolean(state.settings.enabled && (state.isAreaDirty || !state.lastFetchedCacheKey));
      button.classList.remove("w4s-refresh-btn--dirty", "w4s-refresh-btn--loading");
      if (isLoading) {
        button.classList.add("w4s-refresh-btn--loading");
      } else if (shouldHighlightDirty) {
        button.classList.add("w4s-refresh-btn--dirty");
      }
      button.disabled = isLoading;

      if (!state.settings.enabled) {
        button.title = "Enable wind and refresh the current map area.";
      } else if (isLoading) {
        button.title = "Refreshing wind data...";
      } else if (state.isAreaDirty) {
        button.title = "Refresh wind for the current visible map area.";
      } else {
        button.title = "Refresh wind for the current visible map area.";
      }
    }
  }

  function ensureStravaToggleButton() {
    if (!isRouteBuilderUrl()) {
      detachStravaToggleButton();
      return;
    }

    const anchor = findMapToolbarAnchor();
    if (!anchor || !(anchor.referenceControl instanceof HTMLElement) || !(anchor.actionContainer instanceof HTMLElement)) {
      detachStravaToggleButton();
      return;
    }

    const anchorSignature = getAnchorSignature(anchor);

    if (!state.stravaToggleButton || !state.stravaToggleButton.isConnected) {
      state.stravaToggleButton = createStravaToggleButton();
    }
    if (!state.stravaRefreshButton || !state.stravaRefreshButton.isConnected) {
      state.stravaRefreshButton = createStravaRefreshButton();
    }
    if (!state.stravaControlGroup || !state.stravaControlGroup.isConnected) {
      state.stravaControlGroup = createStravaControlGroup();
    }
    if (!state.stravaToggleSlot || !state.stravaToggleSlot.isConnected) {
      state.stravaToggleSlot = createStravaToggleSlot();
    }

    if (
      state.stravaControlGroup.children.length !== 2 ||
      state.stravaControlGroup.children[0] !== state.stravaToggleButton ||
      state.stravaControlGroup.children[1] !== state.stravaRefreshButton
    ) {
      state.stravaControlGroup.replaceChildren(state.stravaToggleButton, state.stravaRefreshButton);
    }

    if (state.stravaControlGroup.parentElement !== state.stravaToggleSlot) {
      state.stravaToggleSlot.replaceChildren(state.stravaControlGroup);
    }

    if (state.stravaToggleSlot.parentElement !== document.body) {
      document.body.appendChild(state.stravaToggleSlot);
    }

    if (state.lastButtonAnchorSignature !== anchorSignature) {
      state.stravaToggleSlot.style.top = `${anchor.top}px`;
      state.stravaToggleSlot.style.left = `${anchor.left}px`;
      state.lastButtonAnchorSignature = anchorSignature;
    }

    updateStravaToggleButton();
  }

  function detachStravaToggleButton() {
    if (state.stravaToggleSlot?.parentNode) {
      state.stravaToggleSlot.parentNode.removeChild(state.stravaToggleSlot);
    }
    if (state.stravaControlGroup?.parentNode) {
      state.stravaControlGroup.parentNode.removeChild(state.stravaControlGroup);
    }
    if (state.stravaToggleButton?.parentNode) {
      state.stravaToggleButton.parentNode.removeChild(state.stravaToggleButton);
    }
    if (state.stravaRefreshButton?.parentNode) {
      state.stravaRefreshButton.parentNode.removeChild(state.stravaRefreshButton);
    }
    state.stravaToggleSlot = null;
    state.stravaControlGroup = null;
    state.stravaToggleButton = null;
    state.stravaRefreshButton = null;
    state.lastButtonAnchorSignature = "";
  }

  function startButtonMountWatcher() {
    if (state.buttonObserver || !(document.body instanceof HTMLElement)) {
      return;
    }

    state.buttonObserver = new MutationObserver(() => {
      ensureStravaToggleButton();
    });
    state.buttonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function destroyOverlay() {
    if (state.viewRedrawFrameId) {
      window.cancelAnimationFrame(state.viewRedrawFrameId);
      state.viewRedrawFrameId = 0;
    }

    if (state.fetchController) {
      state.fetchController.abort();
      state.fetchController = null;
      state.activeRequestKey = "";
    }

    if (state.refreshTimerId) {
      window.clearTimeout(state.refreshTimerId);
      state.refreshTimerId = null;
    }

    if (state.overlayRoot?.parentNode) {
      state.overlayRoot.parentNode.removeChild(state.overlayRoot);
    }

    state.overlayRoot = null;
    state.canvas = null;
    state.ctx = null;
    state.mountedContainer = null;
    state.isAreaDirty = false;
    clearLatestDerived();
  }

  function syncCanvasSize() {
    if (!state.canvas || !state.ctx) {
      return;
    }

    const isFixed = state.overlayRoot?.classList.contains("w4s-overlay-root--fixed");
    const container = state.mountedContainer instanceof HTMLElement ? state.mountedContainer : null;
    const width = isFixed ? Math.max(window.innerWidth, 1) : Math.max(container?.clientWidth ?? 0, 1);
    const height = isFixed ? Math.max(window.innerHeight, 1) : Math.max(container?.clientHeight ?? 0, 1);
    const dpr = Math.max(window.devicePixelRatio || 1, 1);

    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);

    if (state.canvas.width !== targetWidth || state.canvas.height !== targetHeight) {
      state.canvas.width = targetWidth;
      state.canvas.height = targetHeight;
      state.canvas.style.width = `${width}px`;
      state.canvas.style.height = `${height}px`;
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function parseMapHash() {
    const match = location.hash.match(/#([0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)/);
    if (!match) {
      return null;
    }

    const zoom = Number(match[1]);
    const lat = Number(match[2]);
    const lon = Number(match[3]);

    if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    return { zoom, lat, lon };
  }

  function clampLat(lat) {
    return Math.max(-85.05112878, Math.min(85.05112878, lat));
  }

  function normalizeLon(lon) {
    let value = lon;
    while (value < -180) {
      value += 360;
    }
    while (value >= 180) {
      value -= 360;
    }
    return value;
  }

  function lonToWorldX(lon, worldSize) {
    return ((normalizeLon(lon) + 180) / 360) * worldSize;
  }

  function latToWorldY(lat, worldSize) {
    const rad = (clampLat(lat) * Math.PI) / 180;
    const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    return (worldSize / 2) - (worldSize * merc) / (2 * Math.PI);
  }

  function worldXToLon(x, worldSize) {
    return normalizeLon((x / worldSize) * 360 - 180);
  }

  function worldYToLat(y, worldSize) {
    const n = Math.PI - (2 * Math.PI * y) / worldSize;
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  function destinationPoint(lat, lon, bearingDegrees, distanceMeters) {
    const angularDistance = distanceMeters / 6371000;
    const bearing = toRadians(bearingDegrees);
    const lat1 = toRadians(clampLat(lat));
    const lon1 = toRadians(normalizeLon(lon));

    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinAngular = Math.sin(angularDistance);
    const cosAngular = Math.cos(angularDistance);

    const lat2 = Math.asin(
      sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * sinAngular * cosLat1,
        cosAngular - sinLat1 * Math.sin(lat2)
      );

    return {
      lat: clampLat(toDegrees(lat2)),
      lon: normalizeLon(toDegrees(lon2))
    };
  }

  function is3DRequestedFromUrl(urlString = location.href) {
    try {
      const url = new URL(urlString);
      return (url.searchParams.get("3d") || "").toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  function getMapGeoContext() {
    const mapContainer = getMapContainer();
    if (!state.map || !mapContainer) {
      return null;
    }

    try {
      const mapBounds = state.map.getBounds();
      const bounds = {
        west: mapBounds.getWest(),
        east: mapBounds.getEast(),
        north: mapBounds.getNorth(),
        south: mapBounds.getSouth()
      };

      return {
        mode: "map",
        bounds,
        width: mapContainer.clientWidth,
        height: mapContainer.clientHeight,
        clipRect: {
          left: 0,
          top: 0,
          right: mapContainer.clientWidth,
          bottom: mapContainer.clientHeight
        },
        project: (lon, lat) => state.map.project([lon, lat])
      };
    } catch {
      return null;
    }
  }

  function getHashGeoContext() {
    const container = findMapViewportElement() ?? (state.mountedContainer instanceof HTMLElement ? state.mountedContainer : null);
    if (!container) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width || container.clientWidth);
    const height = Math.round(rect.height || container.clientHeight);
    if (width < 320 || height < 220) {
      return null;
    }

    const view = parseMapHash();
    if (!view) {
      return null;
    }

    const worldSize = 512 * Math.pow(2, view.zoom);
    const centerX = lonToWorldX(view.lon, worldSize);
    const centerY = latToWorldY(view.lat, worldSize);

    const leftX = centerX - width / 2;
    const rightX = centerX + width / 2;
    const topY = centerY - height / 2;
    const bottomY = centerY + height / 2;

    const bounds = {
      west: worldXToLon(leftX, worldSize),
      east: worldXToLon(rightX, worldSize),
      north: worldYToLat(topY, worldSize),
      south: worldYToLat(bottomY, worldSize)
    };

    const project = (lon, lat) => {
      const x = lonToWorldX(lon, worldSize);
      const y = latToWorldY(lat, worldSize);

      let dx = x - centerX;
      if (dx > worldSize / 2) {
        dx -= worldSize;
      } else if (dx < -worldSize / 2) {
        dx += worldSize;
      }

      return {
        x: rect.left + width / 2 + dx,
        y: rect.top + height / 2 + (y - centerY)
      };
    };

    return {
      mode: "hash",
      bounds,
      width: Math.max(window.innerWidth, 1),
      height: Math.max(window.innerHeight, 1),
      clipRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      },
      project
    };
  }

  function getGeoContext() {
    return getMapGeoContext() ?? getHashGeoContext();
  }

  function getMapPitch() {
    if (!state.map || typeof state.map.getPitch !== "function") {
      return null;
    }
    try {
      const value = Number(state.map.getPitch());
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  function getMapBearing() {
    if (!state.map || typeof state.map.getBearing !== "function") {
      return null;
    }
    try {
      const value = Number(state.map.getBearing());
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  function clearLatestDerived() {
    state.lastDerivedVectors = null;
    state.lastDerivedForecastTimeMs = Number.NaN;
    state.lastDerivedMode = null;
  }

  function rememberLatestDerived(vectors, forecastTimeMs, geoMode) {
    state.lastDerivedVectors = Array.isArray(vectors) ? vectors : null;
    state.lastDerivedForecastTimeMs = Number.isFinite(forecastTimeMs) ? forecastTimeMs : Number.NaN;
    state.lastDerivedMode = typeof geoMode === "string" ? geoMode : null;
  }

  function getActiveStatusForGeo(geo) {
    if (geo?.mode === "hash" && is3DRequestedFromUrl()) {
      return {
        text: "3D view fallback mode: wind directions are approximate.",
        level: "warn"
      };
    }

    return {
      text: "Wind overlay active.",
      level: "ok"
    };
  }

  function applyActiveStatusForGeo(geo) {
    const status = getActiveStatusForGeo(geo);
    setStatus(status.text, status.level);
  }

  function redrawFromLatestData() {
    if (!state.settings.enabled) {
      return;
    }
    if (!Array.isArray(state.lastDerivedVectors) || !state.lastDerivedVectors.length) {
      return;
    }

    const geo = getGeoContext();
    if (!geo) {
      return;
    }

    state.lastGeoMode = geo.mode;
    syncAreaDirtyForGeo(geo);
    drawVectors(state.lastDerivedVectors, geo.project, geo.width, geo.height, geo.clipRect);
    setForecastReadout(state.lastDerivedForecastTimeMs);
    if (state.fetchController) {
      setStatus("Refreshing wind data...", "loading");
      return;
    }
    if (state.isAreaDirty) {
      setStatus("Map moved. Press Refresh to load wind for this area.", "warn");
      return;
    }
    applyActiveStatusForGeo(geo);
  }

  function scheduleViewRedraw() {
    if (state.viewRedrawFrameId || !state.settings.enabled) {
      return;
    }
    if (!Array.isArray(state.lastDerivedVectors) || !state.lastDerivedVectors.length) {
      return;
    }

    state.viewRedrawFrameId = window.requestAnimationFrame(() => {
      state.viewRedrawFrameId = 0;
      redrawFromLatestData();
    });
  }

  function getAreaKeyFromGeo(geo) {
    if (!geo?.bounds || typeof geo.mode !== "string") {
      return "";
    }
    return getBoundsKey(geo.bounds, geo.mode);
  }

  function syncAreaDirtyForGeo(geo) {
    const previousDirty = state.isAreaDirty;
    if (!state.settings.enabled) {
      state.isAreaDirty = false;
      if (previousDirty !== state.isAreaDirty) {
        updateStravaToggleButton();
      }
      return "";
    }

    const areaKey = getAreaKeyFromGeo(geo);
    if (!areaKey) {
      return "";
    }

    if (state.lastFetchedCacheKey) {
      state.isAreaDirty = areaKey !== state.lastFetchedCacheKey;
    }

    if (previousDirty !== state.isAreaDirty) {
      updateStravaToggleButton();
    }

    return areaKey;
  }

  function refreshViewState(reason = "view-update") {
    if (!isRouteBuilderUrl()) {
      destroyOverlay();
      detachStravaToggleButton();
      return;
    }

    ensureOverlay();
    ensureStravaToggleButton();
    mountOverlayToBestContainer();

    if (!state.settings.enabled) {
      if (state.viewRedrawFrameId) {
        window.cancelAnimationFrame(state.viewRedrawFrameId);
        state.viewRedrawFrameId = 0;
      }
      clearLatestDerived();
      clearCanvas();
      setForecastReadout(Number.NaN);
      setStatus("Wind is off. Click the wind icon near Heatmaps and Segments to enable.", "off");
      state.isAreaDirty = false;
      return;
    }

    const geo = getGeoContext();
    if (!geo) {
      if (!state.fetchController) {
        setStatus("Waiting for Strava map viewport...", "loading");
      }
      return;
    }
    state.lastGeoMode = geo.mode;
    syncAreaDirtyForGeo(geo);

    const hasLatestVectors = Boolean(Array.isArray(state.lastDerivedVectors) && state.lastDerivedVectors.length);

    if (hasLatestVectors) {
      drawVectors(state.lastDerivedVectors, geo.project, geo.width, geo.height, geo.clipRect);
      setForecastReadout(state.lastDerivedForecastTimeMs);
    }

    if (state.fetchController) {
      setStatus("Refreshing wind data...", "loading");
      return;
    }

    if (!hasLatestVectors && hasDailyLimitLastError()) {
      setStatus("Open-Meteo daily limit reached. Please try again tomorrow.", "error");
      return;
    }

    if (state.isAreaDirty) {
      setStatus("Map moved. Press Refresh to load wind for this area.", "warn");
      return;
    }

    if (hasLatestVectors) {
      applyActiveStatusForGeo(geo);
      return;
    }

    if (!state.lastFetchedCacheKey) {
      setStatus("Press Refresh to load wind data for this area.", "idle");
      debug("No fetched area cache yet in", reason);
      return;
    }

    setStatus("Map moved. Press Refresh to load wind for this area.", "warn");
  }

  function handleViewportChanged(reason = "viewport-change") {
    debug("Viewport changed", reason);
    refreshViewState(reason);
  }

  function requestAreaRefresh(source = "unknown", options = {}) {
    const {
      manual = false,
      allowCache = true,
      allowNetwork = true,
      forceNetwork = false,
      immediate = false
    } = options;

    if (!isRouteBuilderUrl()) {
      destroyOverlay();
      detachStravaToggleButton();
      return;
    }

    ensureOverlay();
    ensureStravaToggleButton();
    mountOverlayToBestContainer();

    if (!state.settings.enabled) {
      if (state.fetchController) {
        state.fetchController.abort();
        state.fetchController = null;
        state.activeRequestKey = "";
      }
      clearLatestDerived();
      clearCanvas();
      setForecastReadout(Number.NaN);
      setStatus("Wind is off. Click the wind icon near Heatmaps and Segments to enable.", "off");
      state.isAreaDirty = false;
      return;
    }

    if (manual) {
      state.lastManualRefreshAtMs = Date.now();
    }

    if (state.refreshTimerId) {
      window.clearTimeout(state.refreshTimerId);
      state.refreshTimerId = null;
    }

    const run = () => {
      state.refreshTimerId = null;
      void refreshOverlay({
        source,
        manual,
        allowCache,
        allowNetwork,
        forceNetwork
      });
    };

    if (immediate) {
      run();
      return;
    }

    state.refreshTimerId = window.setTimeout(run, CONFIG.refreshDebounceMs);
  }

  function getBoundsKey(bounds, mode) {
    return [
      mode,
      bounds.south.toFixed(2),
      bounds.north.toFixed(2),
      bounds.west.toFixed(2),
      bounds.east.toFixed(2)
    ].join("|");
  }

  function pruneCache() {
    if (state.cache.size <= CONFIG.maxCacheEntries) {
      return;
    }

    const firstKey = state.cache.keys().next().value;
    if (firstKey) {
      state.cache.delete(firstKey);
    }
  }

  function isRetryableStatus(status) {
    return status === 429 || status >= 500;
  }

  function isRateLimitedStatus(status) {
    return status === 429;
  }

  function isRateLimitError(error) {
    return Boolean(error?.isRateLimited || isRateLimitedStatus(error?.status));
  }

  function isDailyLimitError(error) {
    if (error?.isDailyLimit) {
      return true;
    }
    const reason = typeof error?.reason === "string" ? error.reason : "";
    const message = typeof error?.message === "string" ? error.message : "";
    return /daily api request limit exceeded/i.test(`${reason} ${message}`);
  }

  function hasDailyLimitLastError() {
    const message = typeof state.lastError === "string" ? state.lastError : "";
    return /daily api request limit exceeded/i.test(message);
  }

  function refreshDensityCapIfExpired() {
    if (state.densityCapUntilMs && Date.now() >= state.densityCapUntilMs) {
      state.densityCapUntilMs = 0;
      state.effectiveDensityCap = CONFIG.densityMax;
    }
  }

  function getEffectiveDensityLevel(requestedDensityLevel) {
    refreshDensityCapIfExpired();
    const requested = Math.max(CONFIG.densityMin, Math.min(CONFIG.densityMax, requestedDensityLevel));
    if (Date.now() < state.densityCapUntilMs) {
      return Math.min(requested, state.effectiveDensityCap);
    }
    return requested;
  }

  function applyRateLimitDensityCap(requestedDensityLevel) {
    const requested = Math.max(CONFIG.densityMin, Math.min(CONFIG.densityMax, requestedDensityLevel));
    const capped = Math.max(CONFIG.densityMin, Math.ceil(requested * CONFIG.rateLimitDensityFactor));
    state.effectiveDensityCap = Math.min(state.effectiveDensityCap, capped);
    state.densityCapUntilMs = Date.now() + CONFIG.rateLimitCapDurationMs;
  }

  function getBestStaleCacheEntry(mode) {
    const now = Date.now();
    let best = null;

    for (const entry of state.cache.values()) {
      if (!entry || entry.mode !== mode) {
        continue;
      }
      if (!entry.fetchedAtMs || now - entry.fetchedAtMs > CONFIG.staleCacheMaxAgeMs) {
        continue;
      }
      if (!best || entry.fetchedAtMs > best.fetchedAtMs) {
        best = entry;
      }
    }

    return best;
  }

  async function sleepWithAbort(ms, signal) {
    if (ms <= 0) {
      return;
    }
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      function onAbort() {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  async function waitForRateWindow(signal) {
    const elapsed = Date.now() - state.lastFetchStartedAtMs;
    const waitMs = CONFIG.minFetchIntervalMs - elapsed;
    if (waitMs > 0) {
      await sleepWithAbort(waitMs, signal);
    }
  }

  async function fetchJsonWithRetry(url, signal) {
    let lastError = null;

    for (let attempt = 0; attempt < CONFIG.maxFetchRetries; attempt += 1) {
      await waitForRateWindow(signal);
      state.lastFetchStartedAtMs = Date.now();

      try {
        const response = await fetch(url, { signal });
        if (response.ok) {
          return response.json();
        }
        let reason = "";
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const payload = await response.json();
            reason =
              (typeof payload?.reason === "string" && payload.reason) ||
              (typeof payload?.message === "string" && payload.message) ||
              (typeof payload?.error === "string" && payload.error) ||
              "";
          } else {
            reason = (await response.text()) || "";
          }
        } catch {
          reason = "";
        }

        const details = reason ? `: ${String(reason).slice(0, 220)}` : "";
        const error = new Error(`Open-Meteo error ${response.status}${details}`);
        error.status = response.status;
        error.reason = reason || null;
        error.isRateLimited = isRateLimitedStatus(response.status);
        error.isDailyLimit = Boolean(reason && /daily api request limit exceeded/i.test(reason));

        if (error.isDailyLimit) {
          throw error;
        }

        if (!isRetryableStatus(response.status)) {
          throw error;
        }

        lastError = error;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw error;
        }
        if (isDailyLimitError(error)) {
          throw error;
        }
        if (typeof error?.status === "number" && !isRetryableStatus(error.status)) {
          throw error;
        }
        lastError = error;
      }

      if (attempt >= CONFIG.maxFetchRetries - 1) {
        break;
      }

      const backoff = Math.min(
        CONFIG.retryBaseDelayMs * Math.pow(2, attempt),
        CONFIG.retryMaxDelayMs
      );
      await sleepWithAbort(backoff, signal);
    }

    throw lastError ?? new Error("Open-Meteo request failed");
  }

  async function refreshOverlay(options = {}) {
    const {
      source = "unknown",
      manual = false,
      allowCache = true,
      allowNetwork = true,
      forceNetwork = false
    } = options;

    if (!state.ctx || !state.canvas || !isRouteBuilderUrl()) {
      return;
    }

    if (!state.settings.enabled) {
      if (state.viewRedrawFrameId) {
        window.cancelAnimationFrame(state.viewRedrawFrameId);
        state.viewRedrawFrameId = 0;
      }
      clearLatestDerived();
      if (state.fetchController) {
        state.fetchController.abort();
        state.fetchController = null;
        state.activeRequestKey = "";
      }
      clearCanvas();
      setForecastReadout(Number.NaN);
      setStatus("Wind is off. Click the wind icon near Heatmaps and Segments to enable.", "off");
      state.isAreaDirty = false;
      return;
    }

    mountOverlayToBestContainer();
    syncCanvasSize();

    const geo = getGeoContext();
    if (!geo) {
      setForecastReadout(Number.NaN);
      setStatus("Waiting for Strava map viewport...", "loading");
      clearCanvas();
      return;
    }
    state.lastGeoMode = geo.mode;

    const bounds = geo.bounds;
    const cacheKey = getBoundsKey(bounds, geo.mode);
    let cached = state.cache.get(cacheKey);
    const cachedAgeMs = Number.isFinite(cached?.fetchedAtMs) ? Date.now() - cached.fetchedAtMs : Number.POSITIVE_INFINITY;
    const manualCacheFresh = cachedAgeMs <= CONFIG.manualRefreshFreshMs;
    const canUseCache =
      Boolean(cached) &&
      Boolean(allowCache) &&
      !forceNetwork &&
      (!manual || manualCacheFresh);

    if (!canUseCache && !allowNetwork) {
      state.isAreaDirty = true;
      if (Array.isArray(state.lastDerivedVectors) && state.lastDerivedVectors.length) {
        const fallbackGeo = getGeoContext() ?? geo;
        drawVectors(state.lastDerivedVectors, fallbackGeo.project, fallbackGeo.width, fallbackGeo.height, fallbackGeo.clipRect);
        setForecastReadout(state.lastDerivedForecastTimeMs);
      } else {
        clearCanvas();
        setForecastReadout(Number.NaN);
      }
      setStatus("Map moved. Press Refresh to load wind for this area.", "warn");
      debug("Skipped network refresh", source, { manual, cacheKey });
      return;
    }

    if (!canUseCache) {
      if (state.fetchController && state.activeRequestKey === cacheKey) {
        setStatus(manual ? "Refreshing wind data..." : "Loading wind data...", "loading");
        return;
      }

      if (state.fetchController) {
        state.fetchController.abort();
        state.activeRequestKey = "";
      }

      const controller = new AbortController();
      state.fetchController = controller;
      state.activeRequestKey = cacheKey;
      const runId = ++state.refreshNonce;

      setStatus(manual ? "Refreshing wind data..." : "Loading wind data...", "loading");

      try {
        const fetchGrid = getFetchGridDimensions();
        const samples = buildSamplePoints(bounds, fetchGrid.rows, fetchGrid.cols);
        const series = await fetchWindSeries(samples, controller.signal);

        if (runId !== state.refreshNonce) {
          return;
        }

        cached = {
          key: cacheKey,
          mode: geo.mode,
          bounds,
          grid: fetchGrid,
          samples,
          series,
          fetchedAtMs: Date.now()
        };
        state.cache.set(cacheKey, cached);
        pruneCache();
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        if (isRateLimitError(error)) {
          applyRateLimitDensityCap(state.settings.densityLevel);
        }

        const stale = getBestStaleCacheEntry(geo.mode);
        if (stale) {
          if (isRateLimitError(error)) {
            if (isDailyLimitError(error)) {
              setStatus("Open-Meteo daily limit reached. Showing recent cached wind.", "warn");
            } else {
              setStatus("Rate limited. Showing recent cached wind.", "warn");
            }
          } else {
            setStatus("Using recent cached wind data.", "warn");
          }

          const staleOffsetHours = state.settings.offsetHours;
          const staleRequestedDensity = state.settings.densityLevel;
          const staleEffectiveDensity = getEffectiveDensityLevel(staleRequestedDensity);
          const staleDerived = deriveVectorsAtOffset(stale, staleOffsetHours, staleEffectiveDensity);
          const staleGeo = getGeoContext() ?? geo;
          rememberLatestDerived(staleDerived.vectors, staleDerived.forecastTimeMs, staleGeo.mode);
          drawVectors(staleDerived.vectors, staleGeo.project, staleGeo.width, staleGeo.height, staleGeo.clipRect);
          setForecastReadout(staleDerived.forecastTimeMs);
          if (stale.key === cacheKey) {
            state.lastFetchedCacheKey = cacheKey;
            state.isAreaDirty = false;
          } else {
            state.isAreaDirty = true;
          }
          state.lastError = error?.message ?? String(error);
          return;
        }

        clearCanvas();
        if (isRateLimitError(error)) {
          if (Array.isArray(state.lastDerivedVectors) && state.lastDerivedVectors.length) {
            drawVectors(state.lastDerivedVectors, geo.project, geo.width, geo.height, geo.clipRect);
            setForecastReadout(state.lastDerivedForecastTimeMs);
            if (isDailyLimitError(error)) {
              setStatus("Open-Meteo daily limit reached. Keeping last loaded wind.", "warn");
            } else {
              setStatus("Rate limited. Keeping last loaded wind.", "warn");
            }
            state.isAreaDirty = true;
            state.lastError = error?.message ?? String(error);
            return;
          }

          clearLatestDerived();
          if (isDailyLimitError(error)) {
            setStatus("Open-Meteo daily limit reached. Please try again tomorrow.", "error");
          } else {
            setStatus("Rate limited. Try again in a moment.", "error");
          }
        } else {
          clearLatestDerived();
          setStatus("Could not load wind data for this map area.", "error");
        }
        debug("wind fetch failed", error);
        state.isAreaDirty = true;
        state.lastError = error?.message ?? String(error);
        return;
      } finally {
        if (state.fetchController === controller) {
          state.fetchController = null;
          state.activeRequestKey = "";
        }
      }
    }

    const finalOffsetHours = state.settings.offsetHours;
    const finalRequestedDensity = state.settings.densityLevel;
    const finalEffectiveDensity = getEffectiveDensityLevel(finalRequestedDensity);

    const derived = deriveVectorsAtOffset(cached, finalOffsetHours, finalEffectiveDensity);
    const drawGeo = getGeoContext() ?? geo;
    rememberLatestDerived(derived.vectors, derived.forecastTimeMs, drawGeo.mode);
    drawVectors(derived.vectors, drawGeo.project, drawGeo.width, drawGeo.height, drawGeo.clipRect);
    setForecastReadout(derived.forecastTimeMs);
    state.lastFetchedCacheKey = cacheKey;
    state.isAreaDirty = false;

    const liveAreaKey = getAreaKeyFromGeo(drawGeo);
    if (liveAreaKey && liveAreaKey !== cacheKey) {
      state.isAreaDirty = true;
    }

    if (state.isAreaDirty) {
      setStatus("Map moved. Press Refresh to load wind for this area.", "warn");
    } else {
      applyActiveStatusForGeo(drawGeo);
    }

    state.lastError = null;
    debug("Area refresh complete", source, { manual, cacheKey });
  }

  function deriveVectorsAtOffset(cached, offsetHours, densityLevel) {
    const samples = cached?.samples ?? [];
    const series = cached?.series ?? {};
    const sourceGrid = cached?.grid ?? getFetchGridDimensions();
    const bounds = cached?.bounds ?? null;

    const times = Array.isArray(series.times) ? series.times : [];
    const targetTimeMs = getTargetTimeMs(offsetHours);
    const timeIndex = findClosestTimeIndex(times, targetTimeMs);
    const speedsByPoint = Array.isArray(series.speedsByPoint) ? series.speedsByPoint : [];
    const directionsByPoint = Array.isArray(series.directionsByPoint) ? series.directionsByPoint : [];

    const sourceVectors = samples.map((sample, index) => ({
      lat: sample.lat,
      lon: sample.lon,
      speed: speedsByPoint[index]?.[timeIndex],
      direction: directionsByPoint[index]?.[timeIndex]
    }));

    const targetGrid = getGridDimensions(densityLevel);
    const vectors = resampleVectorsByDensity(sourceVectors, sourceGrid, targetGrid, bounds);

    return {
      vectors,
      forecastTimeMs: parseUtcHour(times[timeIndex])
    };
  }

  function resampleVectorsByDensity(sourceVectors, sourceGrid, targetGrid, bounds) {
    if (!Array.isArray(sourceVectors) || !sourceVectors.length) {
      return [];
    }

    const sourceRows = Math.max(1, Number(sourceGrid?.rows) || 1);
    const sourceCols = Math.max(1, Number(sourceGrid?.cols) || 1);
    const targetRows = Math.max(1, Number(targetGrid?.rows) || sourceRows);
    const targetCols = Math.max(1, Number(targetGrid?.cols) || sourceCols);

    if (sourceRows === targetRows && sourceCols === targetCols) {
      return sourceVectors;
    }

    const targetSamples = bounds ? buildSamplePoints(bounds, targetRows, targetCols) : null;
    const sourceCount = sourceVectors.length;
    const result = new Array(targetRows * targetCols);

    for (let row = 0; row < targetRows; row += 1) {
      const rowRatio = targetRows <= 1 ? 0 : row / (targetRows - 1);
      const sourceRow = Math.max(0, Math.min(sourceRows - 1, Math.round(rowRatio * (sourceRows - 1))));

      for (let col = 0; col < targetCols; col += 1) {
        const colRatio = targetCols <= 1 ? 0 : col / (targetCols - 1);
        const sourceCol = Math.max(0, Math.min(sourceCols - 1, Math.round(colRatio * (sourceCols - 1))));

        const sourceIndex = Math.max(0, Math.min(sourceCount - 1, sourceRow * sourceCols + sourceCol));
        const targetIndex = row * targetCols + col;
        const source = sourceVectors[sourceIndex] ?? sourceVectors[sourceCount - 1] ?? {};
        const targetSample = targetSamples?.[targetIndex];

        result[targetIndex] = {
          lat: Number.isFinite(targetSample?.lat) ? targetSample.lat : source.lat,
          lon: Number.isFinite(targetSample?.lon) ? targetSample.lon : source.lon,
          speed: source.speed,
          direction: source.direction
        };
      }
    }

    return result;
  }

  function getGridDimensions(densityLevel) {
    const clampedLevel = Math.max(CONFIG.densityMin, Math.min(CONFIG.densityMax, densityLevel));
    const factorVsLevel5 = clampedLevel / 5;
    const baseRows = CONFIG.gridRowsAtLevel5;
    const baseCols = CONFIG.gridColsAtLevel5;
    const basePoints = baseRows * baseCols;
    const targetPoints = basePoints * factorVsLevel5;
    const aspect = baseCols / baseRows;

    const rows = Math.max(
      CONFIG.minGridRows,
      Math.min(CONFIG.maxGridRows, Math.round(Math.sqrt(targetPoints / aspect)))
    );
    const cols = Math.max(
      CONFIG.minGridCols,
      Math.min(CONFIG.maxGridCols, Math.round(rows * aspect))
    );
    return { rows, cols };
  }

  function getFetchGridDimensions() {
    return getGridDimensions(CONFIG.defaultDensityLevel);
  }

  function buildSamplePoints(bounds, gridRows, gridCols) {
    const points = [];

    let west = bounds.west;
    let east = bounds.east;
    if (east < west) {
      east += 360;
    }

    const north = bounds.north;
    const south = bounds.south;

    for (let row = 0; row < gridRows; row += 1) {
      const latRatio = gridRows === 1 ? 0.5 : row / (gridRows - 1);
      const lat = north - (north - south) * latRatio;

      for (let col = 0; col < gridCols; col += 1) {
        const lonRatio = gridCols === 1 ? 0.5 : col / (gridCols - 1);
        let lon = west + (east - west) * lonRatio;
        if (lon > 180) {
          lon -= 360;
        }
        points.push({ lat, lon });
      }
    }

    return points;
  }

  async function fetchWindSeries(samples, signal) {
    const times = [];
    const speedsByPoint = new Array(samples.length);
    const directionsByPoint = new Array(samples.length);

    for (let start = 0; start < samples.length; start += CONFIG.maxPointsPerRequest) {
      const chunk = samples.slice(start, start + CONFIG.maxPointsPerRequest);
      const latitudes = chunk.map((point) => point.lat.toFixed(4)).join(",");
      const longitudes = chunk.map((point) => point.lon.toFixed(4)).join(",");

      const params = new URLSearchParams({
        latitude: latitudes,
        longitude: longitudes,
        hourly: "wind_speed_10m,wind_direction_10m",
        wind_speed_unit: "kmh",
        timezone: "UTC",
        forecast_days: "2"
      });

      const payload = await fetchJsonWithRetry(`${CONFIG.apiBase}?${params.toString()}`, signal);
      const datasets = Array.isArray(payload) ? payload : [payload];
      if (!datasets.length) {
        throw new Error("Open-Meteo returned no datasets");
      }

      if (!times.length) {
        const defaultTimes = datasets[0]?.hourly?.time;
        if (Array.isArray(defaultTimes)) {
          times.push(...defaultTimes);
        }
      }

      for (let i = 0; i < chunk.length; i += 1) {
        const dataset = datasets[i] ?? datasets[datasets.length - 1] ?? {};
        const datasetTimes = dataset?.hourly?.time;
        if (!times.length && Array.isArray(datasetTimes)) {
          times.push(...datasetTimes);
        }

        const speedSeries = Array.isArray(dataset?.hourly?.wind_speed_10m)
          ? dataset.hourly.wind_speed_10m
          : [];
        const directionSeries = Array.isArray(dataset?.hourly?.wind_direction_10m)
          ? dataset.hourly.wind_direction_10m
          : [];

        speedsByPoint[start + i] = speedSeries;
        directionsByPoint[start + i] = directionSeries;
      }
    }

    return {
      times,
      speedsByPoint,
      directionsByPoint
    };
  }

  function getTargetTimeMs(offsetHours) {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    return now.getTime() + offsetHours * 60 * 60 * 1000;
  }

  function findClosestTimeIndex(times, targetTimeMs) {
    if (!Array.isArray(times) || !times.length) {
      return 0;
    }

    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < times.length; i += 1) {
      const candidateMs = parseUtcHour(times[i]);
      const diff = Math.abs(candidateMs - targetTimeMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  function parseUtcHour(value) {
    if (typeof value !== "string" || !value) {
      return Date.now();
    }
    return Date.parse(`${value}:00Z`);
  }

  function getDirectionProbeDistanceMeters(speedKmh) {
    const speed = Number.isFinite(speedKmh) ? speedKmh : 0;
    return Math.max(600, Math.min(1200, 760 + Math.min(speed, 55) * 8));
  }

  function getProjectedWindUnit(vector, basePoint, projectPoint) {
    if (
      !vector ||
      !Number.isFinite(vector.lat) ||
      !Number.isFinite(vector.lon) ||
      !Number.isFinite(vector.direction) ||
      typeof projectPoint !== "function"
    ) {
      return null;
    }

    const pushBearing = vector.direction + 180;
    const probeMeters = getDirectionProbeDistanceMeters(vector.speed);
    const probe = destinationPoint(vector.lat, vector.lon, pushBearing, probeMeters);

    let projectedProbe;
    try {
      projectedProbe = projectPoint(probe.lon, probe.lat);
    } catch {
      return null;
    }

    if (!projectedProbe || !Number.isFinite(projectedProbe.x) || !Number.isFinite(projectedProbe.y)) {
      return null;
    }

    const dx = projectedProbe.x - basePoint.x;
    const dy = projectedProbe.y - basePoint.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 0.001) {
      return null;
    }

    return {
      ux: dx / length,
      uy: dy / length
    };
  }

  function drawVectors(vectors, projectPoint, width, height, clipRect) {
    if (!state.ctx || !state.canvas || typeof projectPoint !== "function") {
      return;
    }

    clearCanvas();
    const safeClip = {
      left: Number.isFinite(clipRect?.left) ? clipRect.left : 0,
      top: Number.isFinite(clipRect?.top) ? clipRect.top : 0,
      right: Number.isFinite(clipRect?.right) ? clipRect.right : width,
      bottom: Number.isFinite(clipRect?.bottom) ? clipRect.bottom : height
    };

    const clipWidth = Math.max(0, safeClip.right - safeClip.left);
    const clipHeight = Math.max(0, safeClip.bottom - safeClip.top);
    if (clipWidth < 1 || clipHeight < 1) {
      return;
    }

    const mapPitch = getMapPitch() ?? 0;
    const mapBearing = getMapBearing() ?? 0;
    const shouldProjectDirection =
      state.lastGeoMode === "map" &&
      (is3DRequestedFromUrl() || Math.abs(mapPitch) > 0.1 || Math.abs(mapBearing) > 0.1);

    state.ctx.save();
    state.ctx.beginPath();
    state.ctx.rect(safeClip.left, safeClip.top, clipWidth, clipHeight);
    state.ctx.clip();

    for (const vector of vectors) {
      if (!Number.isFinite(vector.speed) || !Number.isFinite(vector.direction)) {
        continue;
      }

      let point;
      try {
        point = projectPoint(vector.lon, vector.lat);
      } catch {
        continue;
      }

      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }

      const x = point.x;
      const y = point.y;
      if (
        x < safeClip.left - 26 ||
        y < safeClip.top - 26 ||
        x > safeClip.right + 26 ||
        y > safeClip.bottom + 26
      ) {
        continue;
      }

      const projectedUnit = shouldProjectDirection
        ? getProjectedWindUnit(vector, point, projectPoint)
        : null;
      drawArrow(state.ctx, x, y, vector.direction, vector.speed, projectedUnit);
    }

    state.ctx.restore();
  }

  function clearCanvas() {
    if (!state.ctx || !state.canvas) {
      return;
    }

    const width = state.canvas.clientWidth || state.canvas.width;
    const height = state.canvas.clientHeight || state.canvas.height;
    state.ctx.clearRect(0, 0, width, height);
  }

  function drawArrow(ctx, x, y, directionDegrees, speedKmh, projectedUnit = null) {
    let ux = projectedUnit?.ux;
    let uy = projectedUnit?.uy;
    if (!Number.isFinite(ux) || !Number.isFinite(uy)) {
      const pushAngle = ((directionDegrees + 180) * Math.PI) / 180;
      ux = Math.cos(pushAngle);
      uy = Math.sin(pushAngle);
    }
    const px = -uy;
    const py = ux;

    const length = 15 + Math.min(speedKmh, 52) * 0.6;
    const tipX = x + ux * (length * 0.5);
    const tipY = y + uy * (length * 0.5);
    const tailX = x - ux * (length * 0.5);
    const tailY = y - uy * (length * 0.5);

    const headLength = Math.max(8, length * 0.36);
    const headHalfWidth = Math.max(4.2, length * 0.13);
    const headBaseX = tipX - ux * headLength;
    const headBaseY = tipY - uy * headLength;

    const leftX = headBaseX + px * headHalfWidth;
    const leftY = headBaseY + py * headHalfWidth;
    const rightX = headBaseX - px * headHalfWidth;
    const rightY = headBaseY - py * headHalfWidth;

    const color = windColor(speedKmh);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.95;

    // Outer shaft for contrast
    ctx.strokeStyle = "rgba(2, 6, 23, 0.8)";
    ctx.lineWidth = 4.8;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headBaseX, headBaseY);
    ctx.stroke();

    // Inner shaft
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headBaseX, headBaseY);
    ctx.stroke();

    // Arrow head outline
    ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();

    // Arrow head fill
    const innerHeadLength = headLength * 0.78;
    const innerHeadHalfWidth = headHalfWidth * 0.72;
    const innerBaseX = tipX - ux * innerHeadLength;
    const innerBaseY = tipY - uy * innerHeadLength;
    const innerLeftX = innerBaseX + px * innerHeadHalfWidth;
    const innerLeftY = innerBaseY + py * innerHeadHalfWidth;
    const innerRightX = innerBaseX - px * innerHeadHalfWidth;
    const innerRightY = innerBaseY - py * innerHeadHalfWidth;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(innerLeftX, innerLeftY);
    ctx.lineTo(innerRightX, innerRightY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  function windColor(speedKmh) {
    if (speedKmh >= 30) {
      return "#f87171";
    }
    if (speedKmh >= 20) {
      return "#f59e0b";
    }
    if (speedKmh >= 10) {
      return "#34d399";
    }
    return "#38bdf8";
  }

  function emitMessageToExtension(type, payload) {
    window.postMessage(
      {
        source: MESSAGE_SOURCE_PAGE,
        type,
        payload
      },
      "*"
    );
  }

  function getUiStatePayload() {
    return {
      enabled: state.settings.enabled,
      statusText: state.statusText,
      statusLevel: state.statusLevel,
      forecastText: state.forecastText,
      offsetHours: state.settings.offsetHours,
      densityLevel: state.settings.densityLevel,
      effectiveDensityLevel: getEffectiveDensityLevel(state.settings.densityLevel),
      lastError: state.lastError
    };
  }

  function emitUiState() {
    const payload = getUiStatePayload();
    const signature = JSON.stringify(payload);
    if (signature === state.lastUiStateSignature) {
      return;
    }
    state.lastUiStateSignature = signature;
    emitMessageToExtension("w4s:ui-state", payload);
  }

  function setForecastReadout(forecastTimeMs) {
    const value = Number.isFinite(forecastTimeMs)
      ? new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(forecastTimeMs))
      : "Unavailable";

    const text = `Forecast: ${value}`;
    if (text === state.forecastText) {
      return;
    }
    state.forecastText = text;
    emitUiState();
  }

  function setStatus(text, level = "idle") {
    const nextText = String(text || "");
    const nextLevel = String(level || "idle");
    if (state.statusText === nextText && state.statusLevel === nextLevel) {
      return;
    }
    state.statusText = nextText;
    state.statusLevel = nextLevel;
    updateStravaToggleButton();
    emitUiState();
  }

  function applySettings(partialSettings, source = "unknown", options = {}) {
    const fetchOnEnable = options.fetchOnEnable !== false;
    const previousSettings = state.settings;
    const nextSettings = normalizeSettings({
      ...state.settings,
      ...partialSettings
    });
    const hasChanged =
      nextSettings.enabled !== state.settings.enabled ||
      nextSettings.offsetHours !== state.settings.offsetHours ||
      nextSettings.densityLevel !== state.settings.densityLevel;

    state.settings = nextSettings;
    debug("Applied settings", source, nextSettings);
    updateStravaToggleButton();
    emitUiState();

    if (!hasChanged) {
      return;
    }

    if (!nextSettings.enabled) {
      if (state.viewRedrawFrameId) {
        window.cancelAnimationFrame(state.viewRedrawFrameId);
        state.viewRedrawFrameId = 0;
      }
      clearLatestDerived();
      if (state.fetchController) {
        state.fetchController.abort();
        state.fetchController = null;
        state.activeRequestKey = "";
      }
      clearCanvas();
      setForecastReadout(Number.NaN);
      setStatus("Wind is off. Click the wind icon near Heatmaps and Segments to enable.", "off");
      state.isAreaDirty = false;
      return;
    }

    if (!previousSettings.enabled && nextSettings.enabled) {
      state.isAreaDirty = false;
      setStatus("Initializing map detection...", "loading");
      if (fetchOnEnable) {
        requestAreaRefresh("enable", {
          manual: false,
          allowCache: true,
          allowNetwork: true,
          immediate: true
        });
      } else {
        refreshViewState("enable-no-auto-fetch");
      }
      return;
    }

    requestAreaRefresh("settings-change", {
      manual: false,
      allowCache: true,
      allowNetwork: false,
      immediate: true
    });
  }

  function handleExtensionBridgeMessage(event) {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE_EXT || typeof data.type !== "string") {
      return;
    }

    if (data.type === "w4s:apply-settings") {
      applySettings(data.payload, "extension");
      return;
    }

    if (data.type === "w4s:request-ui-state") {
      emitUiState();
    }
  }

  function getFallbackSignature() {
    const mapContainer = findMapViewportElement();
    const width = mapContainer?.clientWidth ?? 0;
    const height = mapContainer?.clientHeight ?? 0;
    const rect = mapContainer?.getBoundingClientRect();
    const left = rect ? rect.left.toFixed(1) : "x";
    const top = rect ? rect.top.toFixed(1) : "y";
    return `${location.hash}|${width}x${height}|${left},${top}|${state.map ? "map" : "nomap"}`;
  }

  function runMapDiscovery() {
    try {
      startButtonMountWatcher();
      if (!isRouteBuilderUrl()) {
        detachStravaToggleButton();
        return;
      }

      if (!state.map) {
        state.mapDetectCounter += 1;
        patchMapboxCtorIfAvailable();
        detectMapObjectFallback(state.mapDetectCounter % 5 === 0);
      }

      ensureStravaToggleButton();
      ensureOverlay();
      mountOverlayToBestContainer();

      const signature = getFallbackSignature();
      if (signature !== state.lastFallbackSignature) {
        state.lastFallbackSignature = signature;
        handleViewportChanged("fallback-signature");
      } else {
        refreshViewState("map-discovery");
      }
    } catch (error) {
      rememberError("runMapDiscovery", error);
    }
  }

  function startMapWatcher() {
    runMapDiscovery();

    state.mapPollId = window.setInterval(() => {
      try {
        runMapDiscovery();
      } catch (error) {
        rememberError("map watcher", error);
      }
    }, CONFIG.mapScanMs);
  }

  function startUrlWatcher() {
    state.urlPollId = window.setInterval(() => {
      if (location.href === state.lastUrl) {
        return;
      }

      state.lastUrl = location.href;
      debug("URL changed", state.lastUrl);

      if (isRouteBuilderUrl()) {
        ensureStravaToggleButton();
        ensureOverlay();
        runMapDiscovery();
        handleViewportChanged("url-change");
      } else {
        destroyOverlay();
        detachStravaToggleButton();
      }
    }, CONFIG.urlPollMs);
  }

  function startViewportWatcher() {
    window.addEventListener("hashchange", () => {
      handleViewportChanged("hashchange");
    });

    window.addEventListener("resize", () => {
      handleViewportChanged("window-resize");
    });
  }

  function exposeDebugState() {
    window.__W4S_DEBUG__ = {
      getState: () => ({
        routeUrl: isRouteBuilderUrl(),
        hasMap: Boolean(state.map),
        hasOverlay: Boolean(state.overlayRoot),
        hasStravaToggleButton: Boolean(state.stravaToggleButton && state.stravaToggleButton.isConnected),
        hasStravaRefreshButton: Boolean(state.stravaRefreshButton && state.stravaRefreshButton.isConnected),
        mountedContainer: state.mountedContainer?.className ?? state.mountedContainer?.tagName ?? null,
        hasCanvas: Boolean(state.canvas),
        geoMode: state.lastGeoMode,
        lastDerivedMode: state.lastDerivedMode,
        is3DRequested: is3DRequestedFromUrl(),
        mapPitch: getMapPitch(),
        mapBearing: getMapBearing(),
        hasLatestVectors: Boolean(Array.isArray(state.lastDerivedVectors) && state.lastDerivedVectors.length),
        enabled: state.settings.enabled,
        densityLevel: state.settings.densityLevel,
        offsetHours: state.settings.offsetHours,
        effectiveDensityLevel: getEffectiveDensityLevel(state.settings.densityLevel),
        densityCapUntilMs: state.densityCapUntilMs,
        isAreaDirty: state.isAreaDirty,
        lastFetchedCacheKey: state.lastFetchedCacheKey,
        lastManualRefreshAtMs: state.lastManualRefreshAtMs,
        refreshButtonDisabled: Boolean(state.stravaRefreshButton?.disabled),
        statusLevel: state.statusLevel,
        statusText: state.statusText,
        forecastText: state.forecastText,
        lastError: state.lastError,
        buttonAnchorSignature: state.lastButtonAnchorSignature,
        settings: { ...state.settings },
        hash: location.hash,
        url: location.href
      })
    };
  }

  ensureInlineStyles();
  window.addEventListener("message", handleExtensionBridgeMessage);
  startButtonMountWatcher();
  exposeDebugState();
  debug("page script booted", location.href);

  if (isRouteBuilderUrl()) {
    ensureStravaToggleButton();
    ensureOverlay();
    setStatus("Wind is off. Click the wind icon near Heatmaps and Segments to enable.", "off");
    refreshViewState("boot");
  }

  emitUiState();

  startMapWatcher();
  startUrlWatcher();
  startViewportWatcher();
})();
