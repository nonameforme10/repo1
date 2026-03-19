(() => {
  "use strict";

  if (window.__EDUVENTURE_HOME_PWA_INSTALL__) return;
  window.__EDUVENTURE_HOME_PWA_INSTALL__ = true;

  function init() {
    const button = document.getElementById("installAppButton");
    const hint = document.getElementById("installAppHint");
    const label = button?.querySelector("[data-install-label]");

    if (!button || !hint || !label) return;

    const refreshIcons = () => {
      if (typeof lucide !== "undefined") {
        lucide.createIcons();
      }
    };

    const setHint = (message) => {
      hint.textContent = message;
      hint.hidden = !message;
    };

    const updateUI = (state = window.EDUVENTURE_PWA?.getState?.() || {}) => {
      if (state.installed) {
        button.hidden = false;
        button.disabled = true;
        label.textContent = "Installed";
        setHint("EduVenture is already running like an app on this device.");
        refreshIcons();
        return;
      }

      if (state.canPrompt) {
        button.hidden = false;
        button.disabled = false;
        label.textContent = "Install app";
        setHint("Install EduVenture for quick access.");
        refreshIcons();
        return;
      }

      if (state.isIOS) {
        button.hidden = true;
        button.disabled = true;
        label.textContent = "Install app";
        setHint("On iPhone or iPad, open this page in Safari, tap Share, then choose Add to Home Screen.");
        return;
      }

      button.hidden = false;
      button.disabled = true;
      label.textContent = "Install app";
      setHint("When your browser allows install, this button will activate. You can also open the browser menu and choose Install app.");
      refreshIcons();
    };

    button.addEventListener("click", async () => {
      const api = window.EDUVENTURE_PWA;
      if (!api || button.disabled) return;

      const result = await api.promptInstall();

      if (result?.outcome === "accepted") {
        button.hidden = false;
        button.disabled = true;
        label.textContent = "Installing";
        setHint("Install accepted. EduVenture should appear on your device shortly.");
        refreshIcons();
        return;
      } else if (result?.outcome === "dismissed") {
        setHint("Install was dismissed. You can try again whenever the button becomes active.");
      } else if (result?.reason === "ios-manual-install") {
        setHint("On iPhone or iPad, open this page in Safari, tap Share, then choose Add to Home Screen.");
      }

      updateUI(api.getState?.() || {});
    });

    window.addEventListener("eduventure:pwa-state", (event) => {
      updateUI(event.detail || {});
    });

    updateUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
