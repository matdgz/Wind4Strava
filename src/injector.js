(() => {
  const SENTINEL = "__W4S_INJECTOR_READY__";
  if (window[SENTINEL]) {
    return;
  }
  window[SENTINEL] = true;

  const ext = globalThis.browser ?? globalThis.chrome;
  const runtime = ext?.runtime;
  const localStorage = ext?.storage?.local;
  if (!runtime?.getURL) {
    return;
  }

  const SETTINGS_KEY = "w4s.settings.v1";
  const SETTINGS_BOOTSTRAP_KEY = "w4s.settings.bootstrap.v1";
  const PAGE_SOURCE = "w4s-page";
  const EXT_SOURCE = "w4s-ext";
  const ROUTE_PATTERN = /^https:\/\/(?:www\.)?strava\.com\/(?:routes\/new(?:\/.*)?|routes\/\d+\/edit|maps(?:\/.*)?)(?:\?.*)?$/i;
  const DEFAULT_SETTINGS = {
    enabled: false,
    offsetHours: 0,
    densityLevel: 5
  };

  let lastUrl = "";
  let scriptTagCooldown = 0;
  let cachedSettings = { ...DEFAULT_SETTINGS };
  let cachedUiState = {
    enabled: false,
    statusText: "Wind is off. Click the wind icon near Heatmaps and Segments to enable.",
    statusLevel: "off",
    forecastText: "Forecast: Unavailable",
    offsetHours: 0,
    densityLevel: 5,
    effectiveDensityLevel: 5,
    lastError: null
  };

  function isRouteUrl(url) {
    return typeof url === "string" && ROUTE_PATTERN.test(url);
  }

  function clampOffsetHours(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.offsetHours;
    }
    const stepped = Math.round(numeric / 2) * 2;
    return Math.max(0, Math.min(24, stepped));
  }

  function clampDensity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.densityLevel;
    }
    return Math.max(1, Math.min(10, Math.round(numeric)));
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
      densityLevel: clampDensity(value?.densityLevel)
    };
  }

  function normalizeUiState(value) {
    if (!value || typeof value !== "object") {
      return {
        ...cachedUiState,
        enabled: cachedSettings.enabled,
        offsetHours: cachedSettings.offsetHours,
        densityLevel: cachedSettings.densityLevel
      };
    }

    const statusLevel = typeof value.statusLevel === "string" ? value.statusLevel : "idle";
    return {
      enabled: Boolean(value.enabled),
      statusText: typeof value.statusText === "string" ? value.statusText : "",
      statusLevel,
      forecastText: typeof value.forecastText === "string" ? value.forecastText : "Forecast: Unavailable",
      offsetHours: clampOffsetHours(value.offsetHours),
      densityLevel: clampDensity(value.densityLevel),
      effectiveDensityLevel: clampDensity(value.effectiveDensityLevel),
      lastError: typeof value.lastError === "string" ? value.lastError : null
    };
  }

  async function storageGet(key) {
    if (!localStorage) {
      return undefined;
    }
    try {
      const result = await localStorage.get(key);
      return result?.[key];
    } catch {
      // fall through to callback path
    }
    return new Promise((resolve) => {
      try {
        localStorage.get(key, (result) => {
          resolve(result?.[key]);
        });
      } catch {
        resolve(undefined);
      }
    });
  }

  async function storageSet(key, value) {
    if (!localStorage) {
      return;
    }
    try {
      await localStorage.set({ [key]: value });
      return;
    } catch {
      // fall through to callback path
    }
    await new Promise((resolve) => {
      try {
        localStorage.set({ [key]: value }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  async function loadSettings() {
    const stored = await storageGet(SETTINGS_KEY);
    const bootstrapApplied = await storageGet(SETTINGS_BOOTSTRAP_KEY);

    let normalized = normalizeSettings(stored ?? DEFAULT_SETTINGS);
    let storedNeedsRepair =
      !stored ||
      typeof stored !== "object" ||
      stored.enabled !== normalized.enabled ||
      stored.offsetHours !== normalized.offsetHours ||
      stored.densityLevel !== normalized.densityLevel;

    // One-time bootstrap: enforce OFF default once after upgrade/install.
    if (!bootstrapApplied) {
      if (normalized.enabled) {
        normalized = { ...normalized, enabled: false };
        storedNeedsRepair = true;
      }
      await storageSet(SETTINGS_BOOTSTRAP_KEY, true);
    }

    cachedSettings = normalized;
    if (storedNeedsRepair) {
      await storageSet(SETTINGS_KEY, normalized);
    }

    return normalized;
  }

  async function saveSettings(settings) {
    cachedSettings = normalizeSettings(settings);
    await storageSet(SETTINGS_KEY, cachedSettings);
    return cachedSettings;
  }

  function postToPage(type, payload) {
    window.postMessage(
      {
        source: EXT_SOURCE,
        type,
        payload
      },
      "*"
    );
  }

  function broadcastSettingsToPage() {
    postToPage("w4s:apply-settings", cachedSettings);
  }

  function requestUiStateFromPage() {
    postToPage("w4s:request-ui-state");
  }

  function injectPageScript() {
    const now = Date.now();
    if (now - scriptTagCooldown < 250) {
      return;
    }
    scriptTagCooldown = now;

    const script = document.createElement("script");
    script.src = runtime.getURL("src/page-script.js");
    script.async = false;
    script.onload = () => {
      script.remove();
      broadcastSettingsToPage();
      requestUiStateFromPage();
      console.debug("[W4S] page script injected via content script");
    };
    script.onerror = () => {
      console.debug("[W4S] page script injection blocked (likely CSP); background fallback should inject.");
    };

    const parent = document.head ?? document.documentElement;
    if (parent) {
      parent.appendChild(script);
    }
  }

  function pushStateToPage() {
    if (!isRouteUrl(location.href)) {
      return;
    }
    broadcastSettingsToPage();
    requestUiStateFromPage();
  }

  async function tryInjectForCurrentUrl() {
    const url = location.href;
    if (url === lastUrl) {
      return;
    }
    lastUrl = url;

    if (!isRouteUrl(url)) {
      return;
    }

    // Product decision: always start OFF when entering Strava map/route pages.
    if (cachedSettings.enabled) {
      cachedSettings = normalizeSettings({
        ...cachedSettings,
        enabled: false
      });
      await storageSet(SETTINGS_KEY, cachedSettings);
    }

    injectPageScript();
    window.setTimeout(pushStateToPage, 120);
    window.setTimeout(pushStateToPage, 700);
  }

  async function applyAndBroadcastSettings(settings) {
    await saveSettings(settings);
    pushStateToPage();
  }

  function buildResponse() {
    return {
      ok: true,
      settings: { ...cachedSettings },
      uiState: {
        ...cachedUiState,
        enabled: cachedSettings.enabled,
        offsetHours: cachedSettings.offsetHours,
        densityLevel: cachedSettings.densityLevel
      },
      routeUrl: isRouteUrl(location.href),
      url: location.href
    };
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "w4s:get-ui-state") {
      void (async () => {
        try {
          await loadSettings();
          pushStateToPage();
          sendResponse(buildResponse());
        } catch (error) {
          sendResponse({
            ok: false,
            error: error?.message || String(error)
          });
        }
      })();
      return true;
    }

    if (message.type === "w4s:update-settings") {
      void (async () => {
        try {
          const merged = normalizeSettings({
            ...cachedSettings,
            ...(message.payload || {})
          });
          await applyAndBroadcastSettings(merged);
          sendResponse(buildResponse());
        } catch (error) {
          sendResponse({
            ok: false,
            error: error?.message || String(error)
          });
        }
      })();
      return true;
    }

    return false;
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || typeof data.type !== "string") {
      return;
    }

    if (data.type === "w4s:ui-state") {
      cachedUiState = normalizeUiState(data.payload);
      return;
    }

    if (data.type === "w4s:user-toggle") {
      const toggled = normalizeSettings({
        ...cachedSettings,
        enabled: normalizeEnabled(data.payload?.enabled)
      });
      void applyAndBroadcastSettings(toggled);
    }
  });

  if (ext?.storage?.onChanged) {
    ext.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes?.[SETTINGS_KEY]) {
        return;
      }
      cachedSettings = normalizeSettings(changes[SETTINGS_KEY].newValue ?? DEFAULT_SETTINGS);
      pushStateToPage();
    });
  }

  void (async () => {
    await loadSettings();
    await tryInjectForCurrentUrl();
    pushStateToPage();
  })();

  window.setInterval(() => {
    void tryInjectForCurrentUrl();
  }, 900);
})();
