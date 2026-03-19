(() => {
  "use strict";

  const FLAG = "__EDUVENTURE_UI_LOADED__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = { at: Date.now() };

  const GREEN = "#00FF41";
  const WHITE = "#E9EEF5";
  const DIM = "#8A8F98";
  const mono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

  const css = {
    banner: `color:${GREEN}; font-weight:800; line-height:1.05; font-family:${mono};`,
    white: `color:${WHITE}; font-family:${mono};`,
    dim: `color:${DIM}; font-family:${mono};`,
    green: `color:${GREEN}; font-weight:800; font-family:${mono};`,
  };

  function lockDocumentTitle(desiredTitle) {
    const head = document.head || document.getElementsByTagName("head")[0];

    const ensureOneTitle = () => {
      const all = head ? head.querySelectorAll("title") : document.querySelectorAll("title");
      let el = all[0];
      if (!el) {
        el = document.createElement("title");
        (head || document.documentElement).appendChild(el);
      }
      for (let i = 1; i < all.length; i++) all[i].remove();
      return el;
    };

    let titleEl = ensureOneTitle();

    titleEl.textContent = desiredTitle;
    document.title = desiredTitle;

    let internal = false;
    const sync = () => {
      if (internal) return;

      if (document.title !== desiredTitle) {
        internal = true;
        document.title = desiredTitle;
        internal = false;
      }
      if (titleEl.textContent !== desiredTitle) {
        internal = true;
        titleEl.textContent = desiredTitle;
        internal = false;
      }
    };

    const titleObserver = new MutationObserver(sync);
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });

    const headObserver = new MutationObserver(() => {
      titleEl = ensureOneTitle();
      sync();
    });
    if (head) headObserver.observe(head, { childList: true, subtree: true });

    return {
      set: (t) => {
        desiredTitle = String(t);
        sync();
      },
      stop: () => {
        titleObserver.disconnect();
        headObserver.disconnect();
      },
    };
  }

  function prettifyFileName(file) {
    return (file || "")
      .replace(/\.html$/i, "")
      .replace(/[._-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function getShortPageName() {
    const pathname = decodeURIComponent(location.pathname || "/");
    const qs = new URLSearchParams(location.search || "");

    if (pathname === "/" || pathname.endsWith("/index.html")) return "";

    if (pathname.endsWith("/pages/study_materials/study_materials.html")) return "Study Materials";
    if (pathname.endsWith("/pages/chat/global.chat.html")) return "Global Chat";

    if (pathname.endsWith("/pages/study_materials/bridge.html")) {
      const mode = (qs.get("mode") || "").trim();
      if (!mode) return "Bridge";
      const niceMode = mode[0].toUpperCase() + mode.slice(1);
      return `Bridge — ${niceMode}`;
    }

    {
      const m = pathname.match(/\/reading\/test\d+\/pass(\d+)\/.+\.html$/i);
      if (m) return `Pass ${m[1]}`;
    }

    {
      const m = pathname.match(/\/listenings?\/test\d+\/sec(\d+)\/.+\.html$/i);
      if (m) return `Section ${m[1]}`;
    }

    const fileOnly = (pathname.split("/").filter(Boolean).pop() || "").trim();
    return prettifyFileName(fileOnly) || "Page";
  }

  function buildEduventureTitle() {
    const base = "EDUVENTURE";
    const page = getShortPageName();
    return page ? `${base} | ${page}` : base;
  }

  const titleLock = lockDocumentTitle(buildEduventureTitle());

  function refreshTitle() {
    titleLock.set(buildEduventureTitle());
  }

  window.addEventListener("popstate", refreshTitle);
  window.addEventListener("hashchange", refreshTitle);

  const _pushState = history.pushState;
  const _replaceState = history.replaceState;

  history.pushState = function (...args) {
    const r = _pushState.apply(this, args);
    refreshTitle();
    return r;
  };
  history.replaceState = function (...args) {
    const r = _replaceState.apply(this, args);
    refreshTitle();
    return r;
  };

  refreshTitle();

  console.log("%c[EDUVENTURE UI] v2.0 (NO COMMANDS) LOADED", css.green);

  const art = String.raw`
 ███████╗██████╗ ██╗   ██╗██╗   ██╗███████╗███╗   ██╗████████╗██╗   ██╗██████╗ ███████╗
 ██╔════╝██╔══██╗██║   ██║██║   ██║██╔════╝████╗  ██║╚══██╔══╝██║   ██║██╔══██╗██╔════╝
 █████╗  ██║  ██║██║   ██║██║   ██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║██████╔╝█████╗
 ██╔══╝  ██║  ██║██║   ██║╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██╔══██╗██╔══╝
 ███████╗██████╔╝╚██████╔╝ ╚████╔╝ ███████╗██║ ╚████║   ██║   ╚██████╔╝██║  ██║███████╗
 ╚══════╝╚═════╝  ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝
  `.trimEnd();

  const makeKey = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = (n) =>
      Array.from({ length: n }, () => chars[(Math.random() * chars.length) | 0]).join("");
    return `EDU-${seg(4)}-${seg(4)}-${seg(4)}-${seg(4)}`;
  };

  const LICENSE = {
    status: "VALID",
    edition: "Student Terminal",
    key: makeKey(),
    issuedTo: "Local Session",
  };

  console.log(`%c${art}`, css.banner);

  console.log("%cBooting %cEDUVENTURE%c interface…", css.white, css.green, css.white);
  console.log("%cLicense verification… %cOK", css.dim, css.green);

  const W = 66;
  const top = "┌" + "─".repeat(W) + "┐";
  const bot = "└" + "─".repeat(W) + "┘";
  const line = (t = "") => `│ ${String(t).padEnd(W - 1, " ")}│`;

  const card =
    top +
    "\n" +
    line("EDUVENTURE LICENSE") +
    "\n" +
    line("") +
    "\n" +
    line(`Status: ${LICENSE.status}`) +
    "\n" +
    line(`Edition: ${LICENSE.edition}`) +
    "\n" +
    line(`Key: ${LICENSE.key}`) +
    "\n" +
    line(`Issued To: ${LICENSE.issuedTo}`) +
    "\n" +
    line("") +
    "\n" +
    bot;

  console.log(`%c${card}`, css.dim);
})();
(function registerEduventureServiceWorker() {
  "use strict";

  if (window.__EDUVENTURE_SW_REG_DONE) return;
  window.__EDUVENTURE_SW_REG_DONE = true;

  const LOG = false;
  const UPDATE_CHECK_EVERY_MIN = 30;
  const UPDATE_WAIT_TIMEOUT_MS = 9000;
  const SILENT_UPDATE_CHECK_MIN_INTERVAL_MS = 60 * 1000;
  const STARTUP_SILENT_UPDATE_DELAY_MS = 2000;
  const FORCE_REFRESH_PARAM = "eduventure-refresh";
  const SW_URL = "/sw.js";
  const SW_SCOPE = "/";

  const log = (...a) => LOG && console.log("[SW-REG]", ...a);
  const warn = (...a) => LOG && console.warn("[SW-REG]", ...a);

  const isLocalhost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";
  const isAuthRoute =
    location.pathname.startsWith("/pages/auth/") ||
    location.pathname.startsWith("/auth/") ||
    location.pathname.startsWith("/__/auth/");

  const runtime = {
    registration: null,
    registerPromise: null,
    intervalId: 0,
    checking: false,
    silentChecking: false,
    lastSilentCheckAt: 0,
    updating: false,
    activationQueued: false,
    reloadOnControllerChange: false,
    reloadTriggered: false,
  };

  function getState() {
    const reg = runtime.registration;

    return {
      supported: true,
      registered: !!reg,
      ready: !!reg?.active,
      hasController: !!navigator.serviceWorker.controller,
      checking: runtime.checking,
      updating: runtime.updating,
      updateReady: !!reg?.waiting,
      installing: !!reg?.installing && reg.installing.state !== "redundant",
    };
  }

  function emitState() {
    const detail = getState();
    window.dispatchEvent(new CustomEvent("eduventure:sw-state", { detail }));
    return detail;
  }

  function buildHardRefreshUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(FORCE_REFRESH_PARAM, String(Date.now()));
    return url.toString();
  }

  function clearHardRefreshMarker() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(FORCE_REFRESH_PARAM)) return;

    url.searchParams.delete(FORCE_REFRESH_PARAM);

    try {
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }

  function triggerHardRefresh() {
    if (runtime.reloadTriggered) return;

    runtime.reloadTriggered = true;
    runtime.reloadOnControllerChange = false;
    window.location.replace(buildHardRefreshUrl());
  }

  function scheduleWaitingWorkerActivation(reg = runtime.registration) {
    if (!reg?.waiting || runtime.updating || runtime.activationQueued) return;

    runtime.activationQueued = true;
    window.setTimeout(() => {
      runtime.activationQueued = false;

      if (!reg?.waiting || runtime.updating) return;

      activateWaitingWorker(reg).catch((err) => {
        warn("Automatic SW activation failed:", err);
      });
    }, 0);
  }

  function bindInstallingWorker(worker) {
    if (!worker || worker.__EDUVENTURE_BOUND__) return;

    worker.__EDUVENTURE_BOUND__ = true;
    worker.addEventListener("statechange", () => {
      emitState();

      if (worker.state === "installed") {
        if (navigator.serviceWorker.controller) {
          log("SW update installed and is ready to apply.");
          scheduleWaitingWorkerActivation(runtime.registration);
        } else {
          log("SW installed for first time.");
        }
        return;
      }

      if (worker.state === "redundant") {
        warn("SW install became redundant.");
      }
    });
  }

  function rememberRegistration(reg) {
    if (!reg) return null;

    runtime.registration = reg;

    if (!reg.__EDUVENTURE_BOUND__) {
      reg.__EDUVENTURE_BOUND__ = true;
      reg.addEventListener("updatefound", () => {
        log("SW update found.");
        bindInstallingWorker(reg.installing);
        emitState();
      });
    }

    if (reg.installing) {
      bindInstallingWorker(reg.installing);
    }

    if (reg.waiting) {
      scheduleWaitingWorkerActivation(reg);
    }

    emitState();
    return reg;
  }

  function startPeriodicUpdateChecks() {
    if (runtime.intervalId || UPDATE_CHECK_EVERY_MIN <= 0) return;

    runtime.intervalId = window.setInterval(() => {
      const reg = runtime.registration;
      if (!reg) return;

      reg
        .update()
        .then(() => rememberRegistration(reg))
        .catch(() => {});
    }, UPDATE_CHECK_EVERY_MIN * 60 * 1000);
  }

  async function checkForUpdateSilently(options = {}) {
    const force = !!options.force;
    const now = Date.now();

    if (runtime.silentChecking || runtime.checking || runtime.updating) {
      return { outcome: "busy" };
    }

    if (
      !force &&
      runtime.lastSilentCheckAt &&
      now - runtime.lastSilentCheckAt < SILENT_UPDATE_CHECK_MIN_INTERVAL_MS
    ) {
      return { outcome: "throttled" };
    }

    runtime.silentChecking = true;
    runtime.lastSilentCheckAt = now;

    try {
      let reg = await ensureRegistration();
      reg = rememberRegistration(reg);

      if (reg.waiting) {
        return activateWaitingWorker(reg);
      }

      await reg.update();
      rememberRegistration(reg);

      return reg.waiting ? activateWaitingWorker(reg) : { outcome: "checked" };
    } catch (err) {
      warn("Silent update check failed:", err);
      return { outcome: "error", error: err };
    } finally {
      runtime.silentChecking = false;
      emitState();
    }
  }

  function waitForControllerChange() {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (changed) => {
        if (settled) return;
        settled = true;
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        window.clearTimeout(timeoutId);
        resolve(changed);
      };

      const onControllerChange = () => finish(true);
      const timeoutId = window.setTimeout(() => finish(false), UPDATE_WAIT_TIMEOUT_MS);

      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, {
        once: true,
      });
    });
  }

  function waitForUpdateResult(reg) {
    return new Promise((resolve) => {
      let settled = false;
      let trackedWorker = null;
      let timeoutId = 0;

      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        reg.removeEventListener("updatefound", onUpdateFound);
        if (trackedWorker) {
          trackedWorker.removeEventListener("statechange", onWorkerStateChange);
        }
        window.clearTimeout(timeoutId);
        resolve(outcome);
      };

      const onWorkerStateChange = () => {
        emitState();

        if (!trackedWorker) return;

        if (trackedWorker.state === "installed") {
          finish(navigator.serviceWorker.controller ? "update-ready" : "installed");
          return;
        }

        if (trackedWorker.state === "redundant") {
          finish("failed");
        }
      };

      const trackWorker = (worker) => {
        if (!worker || worker === trackedWorker) return;

        if (trackedWorker) {
          trackedWorker.removeEventListener("statechange", onWorkerStateChange);
        }

        trackedWorker = worker;
        bindInstallingWorker(worker);
        worker.addEventListener("statechange", onWorkerStateChange);
      };

      const onUpdateFound = () => {
        trackWorker(reg.installing);
        emitState();
      };

      reg.addEventListener("updatefound", onUpdateFound);

      if (reg.waiting) {
        finish("update-ready");
        return;
      }

      if (reg.installing) {
        trackWorker(reg.installing);
      }

      timeoutId = window.setTimeout(() => {
        if (reg.waiting) {
          finish("update-ready");
          return;
        }

        if (trackedWorker?.state === "installed") {
          finish(navigator.serviceWorker.controller ? "update-ready" : "installed");
          return;
        }

        finish("no-update");
      }, UPDATE_WAIT_TIMEOUT_MS);
    });
  }

  async function activateWaitingWorker(reg = runtime.registration) {
    const waiting = reg?.waiting;
    if (!waiting) {
      return { outcome: "no-update" };
    }

    runtime.updating = true;
    runtime.reloadOnControllerChange = true;
    runtime.reloadTriggered = false;
    emitState();

    try {
      const controllerChange = waitForControllerChange();
      waiting.postMessage({ type: "SKIP_WAITING" });

      const changed = await controllerChange;
      if (!changed && runtime.reloadOnControllerChange && !runtime.reloadTriggered) {
        triggerHardRefresh();
      }

      return { outcome: "updated" };
    } catch (err) {
      warn("Could not activate waiting service worker:", err);
      return { outcome: "error", error: err };
    } finally {
      runtime.updating = false;
      emitState();
    }
  }

  async function ensureRegistration() {
    if (runtime.registration) {
      return rememberRegistration(runtime.registration);
    }

    if (runtime.registerPromise) {
      return runtime.registerPromise;
    }

    runtime.registerPromise = navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .then((reg) => {
        rememberRegistration(reg);
        startPeriodicUpdateChecks();
        return reg;
      })
      .catch((err) => {
        warn("Registration failed:", err);
        emitState();
        throw err;
      })
      .finally(() => {
        if (!runtime.registration) {
          runtime.registerPromise = null;
        }
      });

    return runtime.registerPromise;
  }

  async function downloadUpdate() {
    let reg;

    try {
      reg = await ensureRegistration();
    } catch (err) {
      return { outcome: "error", error: err };
    }

    reg = rememberRegistration(reg);

    if (reg.waiting) {
      return activateWaitingWorker(reg);
    }

    runtime.checking = true;
    emitState();

    try {
      const waitForResult = waitForUpdateResult(reg);
      await reg.update();
      rememberRegistration(reg);

      const outcome = await waitForResult;
      if (outcome === "update-ready") {
        runtime.checking = false;
        emitState();
        return activateWaitingWorker(reg);
      }

      return { outcome };
    } catch (err) {
      warn("Update check failed:", err);
      return { outcome: "error", error: err };
    } finally {
      runtime.checking = false;
      emitState();
    }
  }

  const api = {
    getState,
    ensureRegistration,
    checkForUpdateSilently,
    downloadUpdate,
  };

  window.__EDUVENTURE_SW_UPDATES__ = api;
  window.EDUVENTURE_SW_UPDATES = api;

  if (!("serviceWorker" in navigator)) {
    warn("Service workers not supported in this browser.");
    return;
  }

  if (location.protocol !== "https:" && !isLocalhost) {
    warn("SW requires HTTPS (or localhost). Current:", location.protocol);
    return;
  }

  if (isAuthRoute) {
    log("Skipping SW registration on auth route.");
    return;
  }

  clearHardRefreshMarker();

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    emitState();

    if (runtime.reloadOnControllerChange && !runtime.reloadTriggered) {
      triggerHardRefresh();
    }
  });

  function register() {
    ensureRegistration()
      .then(() => {
        window.setTimeout(() => {
          checkForUpdateSilently({ force: true }).catch(() => {});
        }, STARTUP_SILENT_UPDATE_DELAY_MS);
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register);
  } else {
    register();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdateSilently().catch(() => {});
    }
  });

  window.addEventListener("focus", () => {
    checkForUpdateSilently().catch(() => {});
  });

  window.addEventListener("online", () => {
    checkForUpdateSilently({ force: true }).catch(() => {});
  });
})();

(() => {
  "use strict";

  if (window.__EDUVENTURE_CHECKER_LOADER__) return;
  window.__EDUVENTURE_CHECKER_LOADER__ = true;

  const CHECKER_SRC = "/script-internet-checker.js";

  function injectChecker() {
    const already = [...document.scripts].some((s) => (s.src || "").includes(CHECKER_SRC));
    if (already) return;

    const s = document.createElement("script");
    s.src = CHECKER_SRC;
    s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  }

  function scheduleCheckerLoad() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => injectChecker(), { timeout: 3000 });
      return;
    }
    setTimeout(injectChecker, 1200);
  }

  if (document.readyState === "complete") {
    scheduleCheckerLoad();
  } else {
    window.addEventListener("load", scheduleCheckerLoad, { once: true });
  }
})();

(() => {
  "use strict";

  if (window.__EDUVENTURE_PARALLAX__) return;
  window.__EDUVENTURE_PARALLAX__ = true;

  const reduceMotion =
    !!globalThis.matchMedia &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const DEFAULT_SPEED = 0.35;
  const MAX_OFFSET_PX = 90;

  const keywordToPercent = (value) => {
    const v = String(value || "").trim().toLowerCase();
    if (v === "top") return "0%";
    if (v === "center") return "50%";
    if (v === "bottom") return "100%";
    if (v === "left") return "0%";
    if (v === "right") return "100%";
    return v || "50%";
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function getParallaxElements() {
    return Array.from(document.querySelectorAll("[data-parallax]"));
  }

  function ensureBasePosition(el) {
    if (el.dataset.parallaxBaseX && el.dataset.parallaxBaseY) return;

    const cs = getComputedStyle(el);
    el.dataset.parallaxBaseX = keywordToPercent(cs.backgroundPositionX);
    el.dataset.parallaxBaseY = keywordToPercent(cs.backgroundPositionY);
  }

  function computeOffset(el, viewportH) {
    const rect = el.getBoundingClientRect();
    const centerDelta = rect.top + rect.height / 2 - viewportH / 2;
    const progress = centerDelta / viewportH;

    const rawSpeed = parseFloat(el.dataset.parallaxSpeed || "");
    const speed = Number.isFinite(rawSpeed) ? rawSpeed : DEFAULT_SPEED;

    const offset = -progress * clamp(speed, -2, 2) * MAX_OFFSET_PX;
    return clamp(offset, -MAX_OFFSET_PX, MAX_OFFSET_PX);
  }

  function applyParallax(els) {
    const viewportH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    for (const el of els) {
      ensureBasePosition(el);
      const offset = computeOffset(el, viewportH);

      const cs = getComputedStyle(el);
      const hasBg = cs.backgroundImage && cs.backgroundImage !== "none";

      if (hasBg) {
        const baseX = el.dataset.parallaxBaseX || "50%";
        const baseY = el.dataset.parallaxBaseY || "50%";
        el.style.backgroundPosition = `${baseX} calc(${baseY} + ${Math.round(offset)}px)`;
        el.style.willChange = "background-position";
      } else if ("translate" in el.style) {
        el.style.translate = `0px ${Math.round(offset)}px`;
        el.style.willChange = "transform";
      }
    }
  }

  function init() {
    let els = getParallaxElements();
    if (els.length === 0) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        els = getParallaxElements();
        applyParallax(els);
      });
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    schedule();

    window.EDUVENTURE_PARALLAX = {
      refresh: schedule,
      count: () => getParallaxElements().length,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

(function initEduventureFocusTrap() {
  "use strict";

  if (window.__EDUVENTURE_FOCUS_TRAP_ACTIVE__) return;
  window.__EDUVENTURE_FOCUS_TRAP_ACTIVE__ = true;

  const ENABLE_LOGS = false;

  const CONFIG = {
    enableArrowNavigation: true,
    enableTabTrap: true,
    enableFocusVisuals: true,
    wrapAroundEdges: true,
    smoothScroll: true,
    arrowTolerance: 5,
    focusColor: '#8B9FFF',
    focusColorRGB: '139, 159, 255',
    shortcuts: {
      home: true,
      end: true,
      escape: true,
    }
  };

  const log = (...args) => ENABLE_LOGS && console.log("[FOCUS-TRAP]", ...args);

  function getFocusableElements() {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
      'audio[controls]',
      'video[controls]',
    ].join(',');

    return Array.from(document.querySelectorAll(selector)).filter(el => {
      return (
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !el.hasAttribute('aria-hidden')
      );
    });
  }

  function handleTabKey(e) {
    if (!CONFIG.enableTabTrap) return;

    const focusableElements = getFocusableElements();

    if (focusableElements.length === 0) {
      e.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (e.shiftKey) {
      if (activeElement === firstElement || !focusableElements.includes(activeElement)) {
        e.preventDefault();
        lastElement.focus();
        log("Shift+Tab: Wrapped to last element");
      }
    } else {
      if (activeElement === lastElement || !focusableElements.includes(activeElement)) {
        e.preventDefault();
        firstElement.focus();
        log("Tab: Wrapped to first element");
      }
    }
  }

  function handleHomeEndKeys(e) {
    if (e.key === 'Home' && CONFIG.shortcuts.home) {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        e.preventDefault();
        focusableElements[0].focus();
        log("Home: Jumped to first element");
        if (CONFIG.smoothScroll) {
          focusableElements[0].scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }
    } else if (e.key === 'End' && CONFIG.shortcuts.end) {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        e.preventDefault();
        const lastElement = focusableElements[focusableElements.length - 1];
        lastElement.focus();
        log("End: Jumped to last element");
        if (CONFIG.smoothScroll) {
          lastElement.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
          });
        }
      }
    }
  }

  function handleArrowKeys(e) {
    if (!CONFIG.enableArrowNavigation) return;

    const key = e.key;

    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const activeType = document.activeElement?.type?.toLowerCase();

    const isTextInput =
      activeTag === 'textarea' ||
      document.activeElement?.isContentEditable ||
      (activeTag === 'input' && ['text', 'email', 'password', 'search', 'url', 'tel'].includes(activeType));

    if (isTextInput) {
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      return;
    }

    e.preventDefault();

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const currentElement = document.activeElement;
    const currentIndex = focusableElements.indexOf(currentElement);

    if (currentIndex === -1) {
      focusableElements[0].focus();
      log(`${key}: Focused first element (nothing was focused)`);
      return;
    }

    const currentRect = currentElement.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestElement = null;
    let bestScore = Infinity;

    focusableElements.forEach(element => {
      if (element === currentElement) return;

      const rect = element.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isInDirection = false;
      let primaryDistance = 0;
      let secondaryDistance = 0;
      const tolerance = CONFIG.arrowTolerance;

      switch (key) {
        case 'ArrowUp':
          isInDirection = dy < -tolerance;
          primaryDistance = Math.abs(dy);
          secondaryDistance = Math.abs(dx);
          break;
        case 'ArrowDown':
          isInDirection = dy > tolerance;
          primaryDistance = Math.abs(dy);
          secondaryDistance = Math.abs(dx);
          break;
        case 'ArrowLeft':
          isInDirection = dx < -tolerance;
          primaryDistance = Math.abs(dx);
          secondaryDistance = Math.abs(dy);
          break;
        case 'ArrowRight':
          isInDirection = dx > tolerance;
          primaryDistance = Math.abs(dx);
          secondaryDistance = Math.abs(dy);
          break;
      }

      if (!isInDirection) return;

      const score = primaryDistance + (secondaryDistance * 0.5);

      if (score < bestScore) {
        bestScore = score;
        bestElement = element;
      }
    });

    if (bestElement) {
      bestElement.focus();
      log(`${key}: Navigated to element at distance ${bestScore.toFixed(1)}px`);

      if (CONFIG.smoothScroll) {
        bestElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest'
        });
      }
    } else if (CONFIG.wrapAroundEdges) {
      let wrapElement = null;

      switch (key) {
        case 'ArrowUp':
          wrapElement = focusableElements.reduce((bottom, el) => {
            const rect = el.getBoundingClientRect();
            const bottomRect = bottom.getBoundingClientRect();
            return rect.top > bottomRect.top ? el : bottom;
          });
          break;
        case 'ArrowDown':
          wrapElement = focusableElements.reduce((top, el) => {
            const rect = el.getBoundingClientRect();
            const topRect = top.getBoundingClientRect();
            return rect.top < topRect.top ? el : top;
          });
          break;
        case 'ArrowLeft':
          wrapElement = focusableElements.reduce((right, el) => {
            const rect = el.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rect.left > rightRect.left ? el : right;
          });
          break;
        case 'ArrowRight':
          wrapElement = focusableElements.reduce((left, el) => {
            const rect = el.getBoundingClientRect();
            const leftRect = left.getBoundingClientRect();
            return rect.left < leftRect.left ? el : left;
          });
          break;
      }

      if (wrapElement && wrapElement !== currentElement) {
        wrapElement.focus();
        log(`${key}: Wrapped to opposite edge`);
        if (CONFIG.smoothScroll) {
          wrapElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest'
          });
        }
      } else {
        log(`${key}: No element found in that direction, staying put`);
      }
    } else {
      log(`${key}: No element found in that direction, staying put`);
    }
  }

  function handleEscapeKey(e) {
    if (e.key === 'Escape' && CONFIG.shortcuts.escape && document.activeElement) {
      document.activeElement.blur();
      log("Escape: Blurred active element");
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Tab') {
      handleTabKey(e);
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      handleArrowKeys(e);
    }

    if (['Home', 'End'].includes(e.key)) {
      handleHomeEndKeys(e);
    }

    if (e.key === 'Escape') {
      handleEscapeKey(e);
    }
  }

  function handleFocusOut(e) {
    setTimeout(() => {
      if (!document.hasFocus()) {
        const focusableElements = getFocusableElements();
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
          log("Focus left document, returned to first element");
        }
      }
    }, 0);
  }

  function init() {
    if (CONFIG.enableFocusVisuals) {
      const style = document.createElement('style');
      style.id = 'eduventure-focus-trap-styles';
      style.textContent = `
        /* EDUVENTURE Focus Trap - Visual Focus Indicators */
        
        /* Enhanced focus ring for keyboard navigation - matches site theme */
        *:focus-visible {
          outline: 2px solid ${CONFIG.focusColor} !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.15) !important;
          transition: outline 0.15s ease, box-shadow 0.15s ease !important;
        }
        
        /* Remove focus ring for mouse clicks (preserve for keyboard only) */
        *:focus:not(:focus-visible) {
          outline: none;
        }
        
        /* Special handling for buttons and interactive elements */
        button:focus-visible, 
        a:focus-visible,
        input:focus-visible,
        select:focus-visible,
        textarea:focus-visible {
          outline: 2px solid ${CONFIG.focusColor} !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.2) !important;
        }
        
        /* Subtle glow for dark backgrounds */
        .dark *:focus-visible,
        [data-theme="dark"] *:focus-visible,
        header *:focus-visible,
        nav *:focus-visible {
          outline: 2px solid ${CONFIG.focusColor} !important;
          box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.25), 
                      0 0 12px rgba(${CONFIG.focusColorRGB}, 0.4) !important;
        }
        
        /* Smooth focus transitions */
        * {
          scroll-behavior: ${CONFIG.smoothScroll ? 'smooth' : 'auto'};
        }
        
        /* Ensure body is focusable when needed */
        body[tabindex] {
          outline: none;
        }
      `;

      if (!document.getElementById('eduventure-focus-trap-styles')) {
        (document.head || document.documentElement).appendChild(style);
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);

    window.addEventListener('blur', handleFocusOut);

    const ensureFocusable = () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        document.body.setAttribute('tabindex', '0');
        log("No focusable elements found, made body focusable");
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureFocusable);
    } else {
      ensureFocusable();
    }

    const observer = new MutationObserver(ensureFocusable);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EDUVENTURE_FOCUS_TRAP = {
    disable: () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', handleFocusOut);
      log("Focus trap disabled");
    },
    enable: () => {
      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('blur', handleFocusOut);
      log("Focus trap enabled");
    },
    isActive: () => window.__EDUVENTURE_FOCUS_TRAP_ACTIVE__,

    config: CONFIG,

    focusFirst: () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
        log("Manually focused first element");
        return true;
      }
      return false;
    },
    focusLast: () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        const lastElement = focusableElements[focusableElements.length - 1];
        lastElement.focus();
        log("Manually focused last element");
        return true;
      }
      return false;
    },
    getFocusableCount: () => getFocusableElements().length,

    setArrowNavigation: (enabled) => {
      CONFIG.enableArrowNavigation = !!enabled;
      log(`Arrow navigation ${enabled ? 'enabled' : 'disabled'}`);
    },
    setTabTrap: (enabled) => {
      CONFIG.enableTabTrap = !!enabled;
      log(`Tab trap ${enabled ? 'enabled' : 'disabled'}`);
    },
    setFocusVisuals: (enabled) => {
      CONFIG.enableFocusVisuals = !!enabled;
      const styleEl = document.getElementById('eduventure-focus-trap-styles');
      if (styleEl) {
        styleEl.disabled = !enabled;
      }
      log(`Focus visuals ${enabled ? 'enabled' : 'disabled'}`);
    },

    setFocusColor: (hexColor, rgbString) => {
      CONFIG.focusColor = hexColor;
      if (rgbString) {
        CONFIG.focusColorRGB = rgbString;
      } else {
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        CONFIG.focusColorRGB = `${r}, ${g}, ${b}`;
      }

      const oldStyle = document.getElementById('eduventure-focus-trap-styles');
      if (oldStyle) {
        oldStyle.remove();
      }

      if (CONFIG.enableFocusVisuals) {
        const style = document.createElement('style');
        style.id = 'eduventure-focus-trap-styles';
        style.textContent = `
          *:focus-visible {
            outline: 2px solid ${CONFIG.focusColor} !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.15) !important;
            transition: outline 0.15s ease, box-shadow 0.15s ease !important;
          }
          *:focus:not(:focus-visible) { outline: none; }
          button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
            outline: 2px solid ${CONFIG.focusColor} !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.2) !important;
          }
          .dark *:focus-visible, [data-theme="dark"] *:focus-visible, header *:focus-visible, nav *:focus-visible {
            outline: 2px solid ${CONFIG.focusColor} !important;
            box-shadow: 0 0 0 4px rgba(${CONFIG.focusColorRGB}, 0.25), 0 0 12px rgba(${CONFIG.focusColorRGB}, 0.4) !important;
          }
          * { scroll-behavior: ${CONFIG.smoothScroll ? 'smooth' : 'auto'}; }
          body[tabindex] { outline: none; }
        `;
        (document.head || document.documentElement).appendChild(style);
      }

      log(`Focus color changed to ${hexColor}`);
    }
  };

})();

(function initEduventurePwaSupport() {
  "use strict";

  if (window.__EDUVENTURE_PWA__) return;

  const DISPLAY_MODE_QUERY = "(display-mode: standalone)";
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isSafari =
    /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua) ||
    ((/iphone|ipad|ipod/i.test(ua) || /macintosh/i.test(ua)) &&
      navigator.vendor === "Apple Computer, Inc.");
  const INSTALL_HINT_KEY = "eduventure_pwa_installed_hint_v1";

  let deferredPrompt = null;
  let installHint = false;

  try {
    installHint = localStorage.getItem(INSTALL_HINT_KEY) === "1";
  } catch {}

  function setInstallHint(installed) {
    installHint = !!installed;

    try {
      if (installHint) {
        localStorage.setItem(INSTALL_HINT_KEY, "1");
      } else {
        localStorage.removeItem(INSTALL_HINT_KEY);
      }
    } catch {}
  }

  function isInstalled() {
    const installedNow =
      !!window.matchMedia?.(DISPLAY_MODE_QUERY).matches || window.navigator.standalone === true;

    if (installedNow && !installHint) {
      setInstallHint(true);
    }

    return installedNow || installHint;
  }

  const getSwState = () => window.EDUVENTURE_SW_UPDATES?.getState?.() || {};

  function getState() {
    const installed = isInstalled();
    const sw = getSwState();

    return {
      canPrompt: !!deferredPrompt && !installed,
      installed,
      isIOS,
      isSafari,
      canUpdate: !!sw.supported && (sw.registered || sw.ready || sw.hasController),
      updateAvailable: !!sw.updateReady,
      checkingForUpdate: !!sw.checking,
      updating: !!sw.updating,
    };
  }

  async function promptInstall() {
    if (isInstalled()) {
      return { outcome: "installed" };
    }

    if (!deferredPrompt) {
      return { outcome: "unavailable", reason: isIOS ? "ios-manual-install" : "prompt-unavailable" };
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => ({ outcome: "dismissed" }));

    if (choice?.outcome === "accepted") {
      setInstallHint(true);
    }

    emitState();
    return choice;
  }

  async function downloadUpdate() {
    if (!isInstalled()) {
      return { outcome: "unavailable", reason: "not-installed" };
    }

    const swApi = window.EDUVENTURE_SW_UPDATES;
    if (!swApi?.downloadUpdate) {
      return { outcome: "unavailable", reason: "sw-unavailable" };
    }

    const result = await swApi.downloadUpdate();
    emitState();
    return result;
  }

  function emitState() {
    const detail = getState();
    window.dispatchEvent(new CustomEvent("eduventure:pwa-state", { detail }));
  }

  window.__EDUVENTURE_PWA__ = {
    getState,
    promptInstall,
    downloadUpdate,
  };
  window.EDUVENTURE_PWA = window.__EDUVENTURE_PWA__;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setInstallHint(false);
    emitState();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setInstallHint(true);
    emitState();
  });

  window.addEventListener("eduventure:sw-state", () => {
    emitState();
  });

  if (window.matchMedia) {
    const media = window.matchMedia(DISPLAY_MODE_QUERY);
    const sync = () => emitState();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
    } else if (typeof media.addListener === "function") {
      media.addListener(sync);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", emitState, { once: true });
  } else {
    emitState();
  }
})();
