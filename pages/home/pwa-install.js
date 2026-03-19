(() => {
  "use strict";

  if (window.__EDUVENTURE_HOME_PWA_INSTALL__) return;
  window.__EDUVENTURE_HOME_PWA_INSTALL__ = true;

  const PROMO_DISMISS_KEY = "eduventure_pwa_promo_dismissed_v1";

  function init() {
    const promo = document.getElementById("pwaPromo");
    const promoClose = document.getElementById("pwaPromoClose");
    const promoEyebrow = document.getElementById("pwaPromoEyebrow");
    const promoTitle = document.getElementById("pwaPromoTitle");
    const promoText = document.getElementById("pwaPromoText");
    const promoAction = document.getElementById("pwaPromoAction");
    const promoSecondary = document.getElementById("pwaPromoSecondary");
    const promoGif = promo.querySelector(".pwa-promo-gif");
    const promoActionLabel = promoAction?.querySelector("[data-promo-action-label]");
    const promoChipLabels = [
      document.querySelector("#pwaPromoChipOne [data-promo-chip-label]"),
      document.querySelector("#pwaPromoChipTwo [data-promo-chip-label]"),
      document.querySelector("#pwaPromoChipThree [data-promo-chip-label]"),
    ];

    if (
      !promo ||
      !promoClose ||
      !promoEyebrow ||
      !promoTitle ||
      !promoText ||
      !promoAction ||
      !promoActionLabel ||
      !promoSecondary
    ) {
      return;
    }

    let actionInFlight = false;
    let currentPromoKey = "";
    let dismissedPromoKey = "";
    let transientPromo = null;
    let transientTimer = 0;

    try {
      dismissedPromoKey = sessionStorage.getItem(PROMO_DISMISS_KEY) || "";
    } catch {}

    const refreshIcons = () => {
      if (typeof lucide !== "undefined") {
        lucide.createIcons();
      }
    };

    const ensurePromoMediaLoaded = () => {
      const src = promoGif?.dataset?.src;
      if (!promoGif || !src || promoGif.getAttribute("src")) return;
      promoGif.src = src;
    };

    const setPromoVisibility = (visible) => {
      if (visible) {
        ensurePromoMediaLoaded();
      }

      promo.hidden = !visible;
      promo.style.display = visible ? "" : "none";

      if (!visible) {
        delete promo.dataset.promoState;
      }
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

    const clearTransientPromo = () => {
      transientPromo = null;

      if (transientTimer) {
        window.clearTimeout(transientTimer);
        transientTimer = 0;
      }
    };

    const hidePromo = () => {
      setPromoVisibility(false);
    };

    const applyPromoConfig = (config) => {
      currentPromoKey = config.key;
      promo.dataset.promoState = config.key;

      setPromoVisibility(true);
      promoEyebrow.textContent = config.eyebrow;
      promoTitle.textContent = config.title;
      promoText.textContent = config.text;
      promoActionLabel.textContent = config.actionLabel || "";
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

    const showTransientPromo = (config, durationMs = 4500) => {
      clearTransientPromo();
      transientPromo = config;
      setDismissedPromoKey("");
      updateUI(window.EDUVENTURE_PWA?.getState?.() || {});

      if (durationMs > 0) {
        transientTimer = window.setTimeout(() => {
          clearTransientPromo();
          updateUI(window.EDUVENTURE_PWA?.getState?.() || {});
        }, durationMs);
      }
    };

    const getPromoConfig = (state) => {
      if (state.canPrompt) {
        return {
          key: "install-ready",
          eyebrow: "Install available",
          title: "Get the EduVenture app",
          text: "Add EduVenture to your device for faster launch, cleaner study sessions, and easy updates.",
          chips: ["Fast launch", "Offline ready", "Easy updates"],
          actionLabel: actionInFlight ? "Preparing" : "Download",
          actionDisabled: actionInFlight,
          allowDismiss: true,
          secondaryLabel: "Later",
        };
      }

      if (!state.installed && state.isIOS) {
        return {
          key: "ios-install",
          eyebrow: "Install on iPhone",
          title: "Add EduVenture to Home Screen",
          text: "Open this page in Safari, tap Share, then choose Add to Home Screen.",
          chips: ["Home screen access", "Full-screen app", "Easy launch"],
          actionLabel: "",
          hideAction: true,
          allowDismiss: true,
          secondaryLabel: "Close",
        };
      }

      return transientPromo;
    };

    const updateUI = (state = window.EDUVENTURE_PWA?.getState?.() || {}) => {
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

    const runPrimaryAction = async () => {
      const api = window.EDUVENTURE_PWA;
      if (!api || actionInFlight) return;

      const state = api.getState?.() || {};
      if (state.installed || state.updating) return;

      if (!state.installed && state.isIOS && !state.canPrompt) {
        showTransientPromo(
          {
            key: "ios-install-help",
            eyebrow: "Install on iPhone",
            title: "Add EduVenture to Home Screen",
            text: "Open this page in Safari, tap Share, then choose Add to Home Screen.",
            chips: ["Home screen access", "Full-screen app", "Easy launch"],
            actionLabel: "",
            hideAction: true,
            allowDismiss: true,
            secondaryLabel: "Close",
          },
          0
        );
        return;
      }

      actionInFlight = true;
      updateUI(state);

      try {
        const result = await api.promptInstall();

        if (result?.outcome === "accepted") {
          showTransientPromo(
            {
              key: "install-accepted",
              eyebrow: "Install accepted",
              title: "Finishing setup",
              text: "EduVenture should appear on your device shortly.",
              chips: ["Almost ready", "Quick access", "Easy updates"],
              actionLabel: "",
              hideAction: true,
              allowDismiss: true,
              secondaryLabel: "Close",
            },
            4000
          );
        } else if (result?.outcome === "dismissed") {
          showTransientPromo(
            {
              key: "install-dismissed",
              eyebrow: "Install dismissed",
              title: "You can install later",
              text: "When your browser allows install again, this promo will be ready here.",
              chips: ["Try again later", "No changes made", "Still available"],
              actionLabel: "",
              hideAction: true,
              allowDismiss: true,
              secondaryLabel: "Close",
            },
            4000
          );
        } else if (result?.reason === "ios-manual-install") {
          showTransientPromo(
            {
              key: "ios-install-help",
              eyebrow: "Install on iPhone",
              title: "Add EduVenture to Home Screen",
              text: "Open this page in Safari, tap Share, then choose Add to Home Screen.",
              chips: ["Home screen access", "Full-screen app", "Easy launch"],
              actionLabel: "",
              hideAction: true,
              allowDismiss: true,
              secondaryLabel: "Close",
            },
            0
          );
        }
      } finally {
        actionInFlight = false;
        updateUI(api.getState?.() || {});
      }
    };

    promoAction.addEventListener("click", () => {
      if (promoAction.disabled || promoAction.hidden) return;
      runPrimaryAction();
    });

    const dismissPromo = () => {
      if (transientPromo && currentPromoKey === transientPromo.key) {
        clearTransientPromo();
        hidePromo();
        return;
      }

      if (!currentPromoKey) {
        hidePromo();
        return;
      }

      setDismissedPromoKey(currentPromoKey);
      hidePromo();
    };

    promoClose.addEventListener("click", dismissPromo);
    promoSecondary.addEventListener("click", dismissPromo);

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
