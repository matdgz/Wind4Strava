(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const HAS_TABS_BRIDGE = Boolean(ext?.tabs?.query && ext?.tabs?.sendMessage);

  const ROUTE_PATTERN = /^https:\/\/(?:www\.)?strava\.com\/(?:routes\/new(?:\/.*)?|routes\/\d+\/edit|maps(?:\/.*)?)(?:\?.*)?$/i;
  const DEFAULT_SETTINGS = {
    enabled: false,
    offsetHours: 0,
    densityLevel: 5
  };

  const els = {
    root: document.querySelector(".popup"),
    toggleButton: document.getElementById("toggle-button"),
    offsetSlider: document.getElementById("offset-slider"),
    densitySlider: document.getElementById("density-slider"),
    offsetReadout: document.getElementById("offset-readout"),
    densityReadout: document.getElementById("density-readout"),
    routeWarning: document.getElementById("route-warning")
  };

  const state = {
    tabId: null,
    settings: { ...DEFAULT_SETTINGS },
    pollId: null,
    writing: false
  };

  function clampOffsetHours(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.offsetHours;
    }
    const stepped = Math.round(numeric / 2) * 2;
    return Math.max(0, Math.min(24, stepped));
  }

  function clampDensityLevel(value) {
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
      densityLevel: clampDensityLevel(value?.densityLevel)
    };
  }

  function formatOffset(value) {
    const hours = clampOffsetHours(value);
    return hours === 0 ? "Now" : `+${hours}h`;
  }

  function setDisabled(disabled) {
    els.root?.classList.toggle("is-disabled", disabled);
    for (const control of [els.toggleButton, els.offsetSlider, els.densitySlider]) {
      if (!control) {
        continue;
      }
      control.disabled = disabled;
    }
  }

  function render() {
    const settings = state.settings;

    if (els.toggleButton) {
      const on = Boolean(settings.enabled);
      els.toggleButton.textContent = on ? "ON" : "OFF";
      els.toggleButton.classList.toggle("is-on", on);
      els.toggleButton.setAttribute("aria-pressed", String(on));
    }

    if (els.offsetSlider) {
      els.offsetSlider.value = String(settings.offsetHours);
    }
    if (els.offsetReadout) {
      els.offsetReadout.textContent = formatOffset(settings.offsetHours);
    }

    if (els.densitySlider) {
      els.densitySlider.value = String(settings.densityLevel);
    }

    if (els.densityReadout) {
      els.densityReadout.textContent = `${settings.densityLevel}/10`;
    }

  }

  function tabsQueryActive() {
    if (!HAS_TABS_BRIDGE) {
      return Promise.resolve([]);
    }

    try {
      const maybePromise = ext.tabs.query({ active: true, currentWindow: true });
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise.then((tabs) => (Array.isArray(tabs) ? tabs : []));
      }
    } catch {
      // fall through to callback path
    }

    return new Promise((resolve, reject) => {
      try {
        ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const err = ext.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(Array.isArray(tabs) ? tabs : []);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendMessageToTab(tabId, message) {
    if (!HAS_TABS_BRIDGE) {
      return Promise.reject(new Error("Tabs bridge unavailable"));
    }

    try {
      const maybePromise = ext.tabs.sendMessage(tabId, message);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch {
      // fall through to callback path
    }

    return new Promise((resolve, reject) => {
      try {
        ext.tabs.sendMessage(tabId, message, (response) => {
          const err = ext.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchUiState() {
    if (!state.tabId) {
      return;
    }

    try {
      const response = await sendMessageToTab(state.tabId, { type: "w4s:get-ui-state" });
      if (!response?.ok) {
        return;
      }

      state.settings = normalizeSettings(response.settings || state.settings);
      render();
    } catch {
      // no-op: popup controls remain usable locally
    }
  }

  async function updateSettings(patch) {
    if (!state.tabId) {
      return;
    }

    const merged = normalizeSettings({
      ...state.settings,
      ...patch
    });
    state.settings = merged;
    render();

    try {
      state.writing = true;
      const response = await sendMessageToTab(state.tabId, {
        type: "w4s:update-settings",
        payload: patch,
        source: "popup"
      });
      if (response?.ok) {
        state.settings = normalizeSettings(response.settings || merged);
      }
    } catch {
      // no-op: keep local optimistic UI
    } finally {
      state.writing = false;
      render();
    }
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    };
  }

  const debouncedOffsetUpdate = debounce((value) => {
    void updateSettings({ offsetHours: value });
  }, 140);

  const debouncedDensityUpdate = debounce((value) => {
    void updateSettings({ densityLevel: value });
  }, 140);

  function attachEvents() {
    els.toggleButton?.addEventListener("click", () => {
      if (!state.tabId || state.writing) {
        return;
      }
      void updateSettings({ enabled: !state.settings.enabled });
    });

    els.offsetSlider?.addEventListener("input", (event) => {
      const next = clampOffsetHours(event.target.value);
      state.settings = normalizeSettings({ ...state.settings, offsetHours: next });
      render();
      debouncedOffsetUpdate(next);
    });

    els.densitySlider?.addEventListener("input", (event) => {
      const next = clampDensityLevel(event.target.value);
      state.settings = normalizeSettings({ ...state.settings, densityLevel: next });
      render();
      debouncedDensityUpdate(next);
    });
  }

  async function resolveTargetTab() {
    if (!HAS_TABS_BRIDGE) {
      return null;
    }

    try {
      const tabs = await tabsQueryActive();
      const active = tabs[0];
      if (!active?.id || !ROUTE_PATTERN.test(active.url || "")) {
        return null;
      }
      return active;
    } catch {
      return null;
    }
  }

  function startPolling() {
    if (!HAS_TABS_BRIDGE) {
      return;
    }
    if (state.pollId) {
      window.clearInterval(state.pollId);
    }
    state.pollId = window.setInterval(() => {
      void fetchUiState();
    }, 1500);
  }

  function initStaticUi() {
    attachEvents();
    render();
  }

  async function initTabBridge() {
    const activeTab = await resolveTargetTab();
    if (!activeTab) {
      setDisabled(true);
      if (els.routeWarning) {
        els.routeWarning.hidden = false;
      }
      return;
    }

    state.tabId = activeTab.id;
    if (els.routeWarning) {
      els.routeWarning.hidden = true;
    }
    setDisabled(false);

    await fetchUiState();
    startPolling();
  }

  async function init() {
    initStaticUi();
    await initTabBridge();
  }

  window.addEventListener("unload", () => {
    if (state.pollId) {
      window.clearInterval(state.pollId);
      state.pollId = null;
    }
  });

  void init();
})();
