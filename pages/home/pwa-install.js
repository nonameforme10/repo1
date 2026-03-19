(() => {
  "use strict";

  if (window.__EDUVENTURE_HOME_PWA_INSTALL__) return;
  window.__EDUVENTURE_HOME_PWA_INSTALL__ = true;

  const PROMO_DISMISS_KEY = "eduventure_pwa_promo_dismissed_v1";

  function init() {
    const button = document.getElementById("installAppButton");
    const hint = document.getElementById("installAppHint");
    const label = button?.querySelector("[data-install-label]");

    const promo = document.getElementById("pwaPromo");
    const promoClose = document.getElementById("pwaPromoClose");
    const promoEyebrow = document.getElementById("pwaPromoEyebrow");
    const promoTitle = document.getElementById("pwaPromoTitle");
    const promoText = document.getElementById("pwaPromoText");
    const promoAction = document.getElementById("pwaPromoAction");
    const promoSecondary = document.getElementById("pwaPromoSecondary");
    const promoActionLabel = promoAction?.querySelector("[data-promo-action-label]");
    const promoChipLabels = [
      document.querySelector("#pwaPromoChipOne [data-promo-chip-label]"),
      document.querySelector("#pwaPromoChipTwo [data-promo-chip-label]"),
      document.querySelector("#pwaPromoChipThree [data-promo-chip-label]"),
    ];

    if (!button || !hint || !label) return;

    let actionInFlight = false;
    let currentPromoKey = "";
    let dismissedPromoKey = "";

    try {
      dismissedPromoKey = sessionStorage.getItem(PROMO_DISMISS_KEY) || "";
    } catch {}

    const refreshIcons = () => {
      if (typeof lucide !== "undefined") {
        lucide.createIcons();
      }
    };

    const setHint = (message) => {
      hint.textContent = message;
      hint.hidden = !message;
    };

    const setDismissedPromoKey = (value) => {
      dismissedPromoKey = value || "";

      try {
        if (dismissedPromoKey) {
          sessionStorage.setItem(PROMO_DISMISS_KEY, dismissedPromoKey);
        } else {
          sessionStorage.removeItem(PROMO_DISMISS_KEY);
        }
      } catch {}
    };

    const hideButton = () => {
      button.hidden = true;
      button.disabled = true;
      label.textContent = "Install app";
      refreshIcons();
    };

    const hidePromo = () => {
      if (!promo) return;

      promo.hidden = true;
    };

    const applyPromoConfig = (config) => {
      if (
        !promo ||
        !promoEyebrow ||
        !promoTitle ||
        !promoText ||
        !promoAction ||
        !promoActionLabel ||
        !promoSecondary ||
        !promoClose
      ) {
        return;
      }

      currentPromoKey = config.key;

      promo.hidden = false;
      promoEyebrow.textContent = config.eyebrow;
      promoTitle.textContent = config.title;
      promoText.textContent = config.text;
      promoActionLabel.textContent = config.actionLabel;
      promoAction.disabled = !!config.actionDisabled;
      promoAction.hidden = !!config.hideAction;
      promoSecondary.hidden = !config.allowDismiss;
      promoClose.hidden = !config.allowDismiss;

      if (config.allowDismiss) {
        promoSecondary.textContent = config.secondaryLabel || "Later";
      }

      promoChipLabels.forEach((chip, index) => {
        if (chip) {
          chip.textContent = config.chips[index] || "";
        }
      });

      refreshIcons();
    };

    const getPromoConfig = (state) => {
      if (state.updating) {
        return {
          key: "updating",
          eyebrow: "Download in progress",
          title: "Updating EduVenture",
          text: "The newest app version is downloading now. EduVenture will refresh as soon as it is ready.",
          chips: ["Fresh fixes", "Better speed", "Latest content"],
          actionLabel: "Downloading",
          actionDisabled: true,
          allowDismiss: false,
          forceVisible: true,
        };
      }

      if (state.installed && state.updateAvailable) {
        return {
          key: "update-ready",
          eyebrow: "New update ready",
          title: "A better EduVenture is here",
          text: "Download the latest update for fresh improvements, smoother loading, and the newest study experience.",
          chips: ["New fixes", "Fresh content", "Smoother speed"],
          actionLabel: "Download update",
          actionDisabled: actionInFlight,
          allowDismiss: true,
          secondaryLabel: "Later",
        };
      }

      if (state.canPrompt) {
        return {
          key: "install-ready",
          eyebrow: "Install available",
          title: "Download EduVenture as an app",
          text: "Keep lessons one tap away with faster launch, a cleaner study view, and simpler updates on your device.",
          chips: ["Fast launch", "Offline ready", "Easy updates"],
          actionLabel: actionInFlight ? "Preparing" : "Download",
          actionDisabled: actionInFlight,
          allowDismiss: true,
          secondaryLabel: "Later",
        };
      }

      return null;
    };

    const updatePromo = (state) => {
      const config = getPromoConfig(state);

      if (!config) {
        currentPromoKey = "";
        hidePromo();
        return;
      }

      if (dismissedPromoKey && dismissedPromoKey !== config.key) {
        setDismissedPromoKey("");
      }

      if (dismissedPromoKey === config.key && !config.forceVisible) {
        currentPromoKey = config.key;
        hidePromo();
        return;
      }

      applyPromoConfig(config);
    };

    const updateHero = (state) => {
      if (state.updating) {
        button.hidden = false;
        button.disabled = true;
        label.textContent = "Updating app";
        setHint("Downloading the latest update. EduVenture will refresh when it is ready.");
        refreshIcons();
        return;
      }

      if (state.installed && state.updateAvailable) {
        button.hidden = false;
        button.disabled = actionInFlight;
        label.textContent = "Download update";
        setHint("A new EduVenture version is ready. Download it to update the installed app.");
        refreshIcons();
        return;
      }

      if (state.installed) {
        hideButton();
        setHint(
          state.checkingForUpdate
            ? "EduVenture is installed. Checking for updates in the background."
            : "EduVenture is installed and up to date."
        );
        return;
      }

      if (state.canPrompt) {
        button.hidden = false;
        button.disabled = actionInFlight;
        label.textContent = actionInFlight ? "Preparing" : "Install app";
        setHint("Install EduVenture for quick access.");
        refreshIcons();
        return;
      }

      if (state.isIOS) {
        hideButton();
        setHint("On iPhone or iPad, open this page in Safari, tap Share, then choose Add to Home Screen.");
        return;
      }

      button.hidden = false;
      button.disabled = true;
      label.textContent = "Install app";
      setHint("When your browser allows install, this button will activate. You can also open the browser menu and choose Install app.");
      refreshIcons();
    };

    const updateUI = (state = window.EDUVENTURE_PWA?.getState?.() || {}) => {
      updateHero(state);
      updatePromo(state);
    };

    const runPrimaryAction = async () => {
      const api = window.EDUVENTURE_PWA;
      if (!api || actionInFlight) return;

      const state = api.getState?.() || {};
      if (state.updating) return;

      actionInFlight = true;
      updateUI(state);

      try {
        if (state.installed) {
          const result = await api.downloadUpdate();

          if (result?.outcome === "updated") {
            setHint("Downloading the newest version now. EduVenture will refresh once the update is applied.");
          } else if (result?.outcome === "no-update") {
            setHint("EduVenture is already up to date.");
          } else if (result?.outcome === "failed") {
            setHint("The update could not be prepared. Please try again in a moment.");
          } else if (result?.reason === "not-installed") {
            setHint("Install EduVenture first, then you can download app updates here.");
          } else if (result?.reason === "sw-unavailable") {
            setHint("The update service is not ready yet. Reload the page and try again.");
          } else if (result?.outcome === "error") {
            setHint("Couldn't check for updates right now. Please try again when your connection is stable.");
          }
        } else {
          const result = await api.promptInstall();

          if (result?.outcome === "accepted") {
            setHint("Install accepted. EduVenture should appear on your device shortly.");
            setDismissedPromoKey("");
          } else if (result?.outcome === "dismissed") {
            setHint("Install was dismissed. You can try again whenever the button becomes active.");
          } else if (result?.reason === "ios-manual-install") {
            setHint("On iPhone or iPad, open this page in Safari, tap Share, then choose Add to Home Screen.");
          }
        }
      } finally {
        actionInFlight = false;
        updateUI(api.getState?.() || {});
      }
    };

    button.addEventListener("click", () => {
      if (button.disabled) return;
      runPrimaryAction();
    });

    promoAction?.addEventListener("click", () => {
      if (promoAction.disabled) return;
      runPrimaryAction();
    });

    const dismissPromo = () => {
      if (!currentPromoKey) {
        hidePromo();
        return;
      }

      setDismissedPromoKey(currentPromoKey);
      hidePromo();
    };

    promoClose?.addEventListener("click", dismissPromo);
    promoSecondary?.addEventListener("click", dismissPromo);

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
