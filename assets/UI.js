(() => {
  "use strict";

  const FLAG = "__EDUVENTURE_ASSETS_UI_SHIM__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const ensure = () => {
    if (globalThis.__EDUVENTURE_UI_LOADED__) return;

    const alreadyQueued = [...document.scripts].some((s) =>
      String(s.src || "").includes("/elements/UI.js")
    );
    if (alreadyQueued) return;

    const s = document.createElement("script");
    s.src = "/elements/UI.js";
    s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensure);
  } else {
    ensure();
  }
})();

