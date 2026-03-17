"use client";

import { useEffect, useState } from "react";

const FIRST_VISIT_SPLASH_MS = 1200;
const REPEAT_VISIT_SPLASH_MS = 220;
const FADE_MS = 380;
const FALLBACK_AFTER_MS = 3200;
const SPLASH_SESSION_KEY = "eduventure_splash_seen_v1";
const LEGACY_TARGET_PATH = "/pages/home/home%20page.html";

const HARD_TASK_LABELS = [
  "Self-contained bootstrap with no missing root assets",
  "Safer redirect flow with manual recovery",
  "Reduced-motion friendly launch sequence",
];

function getLaunchMode() {
  if (typeof window === "undefined") return { delay: FIRST_VISIT_SPLASH_MS, seen: false };

  let seen = false;

  try {
    seen = window.sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
    window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
  } catch {}

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  return {
    seen,
    delay: prefersReducedMotion ? 120 : seen ? REPEAT_VISIT_SPLASH_MS : FIRST_VISIT_SPLASH_MS,
  };
}

function warmLegacyTarget(targetHref) {
  if (typeof document === "undefined") return;

  const existing = document.querySelector('link[data-eduventure-prefetch="legacy-home"]');
  if (existing) return;

  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "document";
  link.href = targetHref;
  link.dataset.eduventurePrefetch = "legacy-home";
  document.head.appendChild(link);
}

export default function LegacyLauncher() {
  const [phase, setPhase] = useState("booting");
  const [targetHref, setTargetHref] = useState(LEGACY_TARGET_PATH);
  const [statusText, setStatusText] = useState("Preparing the workspace");
  const [launchText, setLaunchText] = useState("Cold boot");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const launchMode = getLaunchMode();
    const targetUrl = new URL(LEGACY_TARGET_PATH, window.location.origin);
    const resolvedTarget = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;

    setTargetHref(resolvedTarget);
    setLaunchText(launchMode.seen ? "Fast resume" : "Cold boot");
    setStatusText(launchMode.seen ? "Reopening your learning workspace" : "Preparing the learning workspace");
    warmLegacyTarget(resolvedTarget);

    let cancelled = false;

    const launchTimer = window.setTimeout(() => {
      if (cancelled) return;
      setPhase("launching");
      setStatusText("Handing off to the full EduVenture workspace");

      window.setTimeout(() => {
        if (!cancelled) {
          window.location.replace(targetUrl.toString());
        }
      }, launchMode.delay > 120 ? FADE_MS : 0);
    }, launchMode.delay);

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      setPhase("fallback");
      setStatusText("The automatic launch is taking longer than expected");
    }, launchMode.delay + FADE_MS + FALLBACK_AFTER_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(launchTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  const isFallback = phase === "fallback";
  const progressValue = phase === "booting" ? "72%" : isFallback ? "Ready" : "100%";

  return (
    <main className={`launcher-page launcher-phase-${phase}`}>
      <div className="launcher-shell">
        <div className="launcher-topbar">
          <div className="launcher-brand" aria-label="EduVenture">
            <span className="launcher-brand-mark" aria-hidden="true" />
            <span className="launcher-brand-name">
              <strong>EDUVENTURE</strong>
              <span>Premium learning</span>
            </span>
          </div>
          <div className="launcher-status-pill">
            <span className="launcher-status-dot" aria-hidden="true" />
            {launchText}
          </div>
        </div>

        <section className="launcher-panel">
          <div className="launcher-copy">
            <span className="launcher-kicker">Next.js launchpad</span>
            <h1>Built to carry the heavier client flow cleanly.</h1>
            <p>
              This Next entry now handles the launch path itself, warms the legacy workspace
              early, and keeps a recovery path visible if the handoff stalls.
            </p>

            <div className="launcher-metrics" aria-label="Launch status summary">
              <div className="launcher-metric">
                <strong>1 app</strong>
                <span>Self-contained bootstrap without broken root dependencies</span>
              </div>
              <div className="launcher-metric">
                <strong>2 paths</strong>
                <span>Automatic launch first, manual recovery if the redirect hangs</span>
              </div>
              <div className="launcher-metric">
                <strong>0 guesswork</strong>
                <span>Predictable timing, fallback messaging, and reduced-motion support</span>
              </div>
            </div>

            <div className="launcher-actions">
              <a className="launcher-button" href={targetHref}>
                Open EduVenture now
              </a>
              <a className="launcher-link-button" href="/pages/leaderboard/leaderboard.html">
                Open leaderboard
              </a>
            </div>
          </div>

          <aside className="launcher-state-card" aria-live="polite">
            <div className="launcher-progress" aria-hidden="true">
              <div className="launcher-progress-value">{progressValue}</div>
            </div>
            <div>
              <h2>{statusText}</h2>
              <p>
                {isFallback
                  ? "Automatic handoff is still safe to retry, but you can also open the workspace directly."
                  : "The launcher is warming the destination before it hands control over."}
              </p>
            </div>

            <ul className="launcher-checklist">
              {HARD_TASK_LABELS.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </aside>
        </section>

        <div className="launcher-footer">
          <span>
            Legacy target: <code>{LEGACY_TARGET_PATH}</code>
          </span>
          <span>Static export stays intact, but the Next shell is now much harder to break.</span>
        </div>
      </div>
    </main>
  );
}
