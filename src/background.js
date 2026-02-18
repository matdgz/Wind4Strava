(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  if (!ext?.runtime || !ext?.tabs) {
    return;
  }

  const ROUTE_URL_PATTERN = /^https:\/\/(?:www\.)?strava\.com\/(?:routes\/new(?:\/.*)?|routes\/\d+\/edit|maps(?:\/.*)?)(?:\?.*)?$/i;

  function isRouteUrl(url) {
    return typeof url === "string" && ROUTE_URL_PATTERN.test(url);
  }

  function tabsQuery(queryInfo) {
    try {
      const maybePromise = ext.tabs.query(queryInfo);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch {
      // fall through to callback path
    }

    return new Promise((resolve, reject) => {
      try {
        ext.tabs.query(queryInfo, (tabs) => {
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

  function tabsGet(tabId) {
    try {
      const maybePromise = ext.tabs.get(tabId);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch {
      // fall through to callback path
    }

    return new Promise((resolve, reject) => {
      try {
        ext.tabs.get(tabId, (tab) => {
          const err = ext.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function executeScript(details) {
    if (!ext.scripting?.executeScript) {
      return Promise.reject(new Error("scripting API unavailable"));
    }

    try {
      const maybePromise = ext.scripting.executeScript(details);
      if (maybePromise && typeof maybePromise.then === "function") {
        return maybePromise;
      }
    } catch {
      // fall through to callback path
    }

    return new Promise((resolve, reject) => {
      try {
        ext.scripting.executeScript(details, (result) => {
          const err = ext.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function injectMainScript(tabId) {
    try {
      await executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["src/page-script.js"]
      });
      return true;
    } catch (error) {
      console.debug("[W4S] MAIN world injection failed", error);
      return false;
    }
  }

  async function injectViaTag(tabId) {
    try {
      await executeScript({
        target: { tabId },
        func: () => {
          const marker = "__W4S_BG_TAG_INJECTED__";
          if (window[marker]) {
            return;
          }
          window[marker] = true;

          const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
          if (!runtime?.getURL) {
            return;
          }

          const script = document.createElement("script");
          script.src = runtime.getURL("src/page-script.js");
          script.async = false;
          script.onload = () => script.remove();
          script.onerror = () => {
            console.debug("[W4S] tag injection blocked by CSP");
          };

          const parent = document.head ?? document.documentElement;
          if (parent) {
            parent.appendChild(script);
          }
        }
      });
    } catch (error) {
      console.debug("[W4S] tag injection failed", error);
    }
  }

  async function injectIntoTab(tabId) {
    if (!tabId || !ext.scripting?.executeScript) {
      return;
    }

    const mainInjected = await injectMainScript(tabId);
    if (!mainInjected) {
      await injectViaTag(tabId);
    }
  }

  async function injectOpenRouteTabs() {
    try {
      const tabs = await tabsQuery({
        url: ["https://strava.com/*", "https://*.strava.com/*"]
      });

      for (const tab of tabs) {
        if (!tab?.id || !isRouteUrl(tab.url)) {
          continue;
        }
        await injectIntoTab(tab.id);
      }
    } catch (error) {
      console.debug("[W4S] injectOpenRouteTabs failed", error);
    }
  }

  async function maybeInjectTab(tabId, url) {
    if (!isRouteUrl(url)) {
      return;
    }
    await injectIntoTab(tabId);
  }

  if (ext.tabs.onUpdated) {
    ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== "complete") {
        return;
      }
      void maybeInjectTab(tabId, tab?.url);
    });
  }

  if (ext.tabs.onActivated) {
    ext.tabs.onActivated.addListener(async ({ tabId }) => {
      try {
        const tab = await tabsGet(tabId);
        await maybeInjectTab(tabId, tab?.url);
      } catch (error) {
        console.debug("[W4S] onActivated lookup failed", error);
      }
    });
  }

  if (ext.runtime.onInstalled) {
    ext.runtime.onInstalled.addListener(() => {
      void injectOpenRouteTabs();
    });
  }

  if (ext.runtime.onStartup) {
    ext.runtime.onStartup.addListener(() => {
      void injectOpenRouteTabs();
    });
  }

  void injectOpenRouteTabs();
})();
