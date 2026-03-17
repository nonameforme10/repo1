const FIRST_VISIT_SPLASH_MS = 1200;
const REPEAT_VISIT_SPLASH_MS = 220;
const FADE_MS = 380;
const SPLASH_SESSION_KEY = "eduventure_splash_seen_v1";

document.addEventListener("DOMContentLoaded", () => {
  const splashScreen = document.getElementById("splash-screen");

  let hasSeenSplash = false;
  try {
    hasSeenSplash = sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
    sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
  } catch {}

  const splashDelay = hasSeenSplash ? REPEAT_VISIT_SPLASH_MS : FIRST_VISIT_SPLASH_MS;

  setTimeout(() => {
    if (splashScreen) splashScreen.classList.add("fade-out");

    setTimeout(() => {
      window.location.href = new URL("./pages/home/home%20page.html", window.location.href).pathname;
    }, FADE_MS);
  }, splashDelay);
});
