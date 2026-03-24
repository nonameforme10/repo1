import { auth, rtdb } from "/elements/firebase.js";
import { onlineModulesCollection } from "/elements/firestore-data.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  dailyReminder: true,
  weeklyProgress: true,
  newContentAlerts: true,
  reminderHour: 19,
});

const NOTIFICATION_CHECK_MIN_INTERVAL_MS = 60 * 1000;
const NOTIFICATION_INTERVAL_MS = 10 * 60 * 1000;
const LOCAL_STATE_PREFIX = "eduventure_notification_runtime_v2_";
const DEFAULT_CLUB_ID = "english";
const DEFAULT_TEACHER_ID = "Abdurahim";
const SETTINGS_URL = "/pages/account/account.html#settings";
const HOME_URL = "/pages/home/home%20page.html";
const LESSONS_URL = "/lessons/online.html";
const CHALLENGES_URL = "/pages/challenges/weekly_challanges.html";
const PWA_ICON_URL = "/assets/pwa-icon-192.png";
const PWA_BADGE_URL = "/assets/pwa-icon-192.png";

const runtime =
  window.__EDUVENTURE_NOTIFICATIONS_RUNTIME__ ||
  (window.__EDUVENTURE_NOTIFICATIONS_RUNTIME__ = {
    booted: false,
    user: null,
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    lastCheckAt: 0,
    intervalId: 0,
  });

window.__EDUVENTURE_NOTIFICATIONS_MODULE__ = true;

const isAuthRoute =
  location.pathname.startsWith("/pages/auth/") ||
  location.pathname.startsWith("/auth/") ||
  location.pathname.startsWith("/__/auth/");

function safeJsonParse(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeHour(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return DEFAULT_NOTIFICATION_PREFERENCES.reminderHour;
  return Math.min(22, Math.max(6, num));
}

function normalizeNotificationPreferences(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    dailyReminder: raw.dailyReminder !== false,
    weeklyProgress: raw.weeklyProgress !== false,
    newContentAlerts: raw.newContentAlerts !== false,
    reminderHour: normalizeHour(raw.reminderHour),
  };
}

function notificationPrefsRef(uid) {
  return ref(rtdb, `students/${uid}/preferences/notifications`);
}

function statsRef(uid) {
  return ref(rtdb, `students/${uid}/stats`);
}

function progressRef(uid) {
  return ref(rtdb, `students/${uid}/progress`);
}

function modulesRef() {
  const clubId = document.body?.dataset?.club || DEFAULT_CLUB_ID;
  const teacherId = document.body?.dataset?.teacher || DEFAULT_TEACHER_ID;
  return onlineModulesCollection(clubId, teacherId);
}

function challengesRef() {
  const clubId = document.body?.dataset?.club || DEFAULT_CLUB_ID;
  return ref(rtdb, `weeklyChallenges/${clubId}/items`);
}

function getPermissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission || "default";
}

function isNotificationSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function getNotificationState() {
  return {
    supported: isNotificationSupported(),
    permission: getPermissionState(),
    userId: runtime.user?.uid || "",
    preferences: { ...runtime.preferences },
  };
}

function emitState() {
  const detail = getNotificationState();
  window.dispatchEvent(new CustomEvent("eduventure:notification-state", { detail }));
  return detail;
}

function localStateKey(uid) {
  return `${LOCAL_STATE_PREFIX}${uid}`;
}

function readLocalState(uid) {
  if (!uid) return {};
  try {
    return safeJsonParse(localStorage.getItem(localStateKey(uid)) || "", {}) || {};
  } catch {
    return {};
  }
}

function writeLocalState(uid, value) {
  if (!uid) return;
  try {
    localStorage.setItem(localStateKey(uid), JSON.stringify(value || {}));
  } catch {}
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function mapToArray(mapObj) {
  if (Array.isArray(mapObj)) return mapObj.slice();
  if (!mapObj || typeof mapObj !== "object") return [];
  return Object.keys(mapObj).map((id) => ({ id, ...mapObj[id] }));
}

async function loadModulesContent() {
  const snap = await getDocs(modulesRef());
  return snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }));
}

function pickStatsSnapshot(stats = {}) {
  return {
    readingsCompleted: Math.max(0, Number(stats.readingsCompleted || 0)),
    listeningsCompleted: Math.max(0, Number(stats.listeningsCompleted || 0)),
    lessonsCompleted: Math.max(0, Number(stats.lessonsCompleted || 0)),
    wordsLearned: Math.max(0, Number(stats.wordsLearned || 0)),
    challengeXp: Math.max(0, Number(stats.challengeXp || 0)),
  };
}

function diffStats(current = {}, baseline = {}) {
  const next = pickStatsSnapshot(current);
  const prev = pickStatsSnapshot(baseline);
  return {
    readingsCompleted: Math.max(0, next.readingsCompleted - prev.readingsCompleted),
    listeningsCompleted: Math.max(0, next.listeningsCompleted - prev.listeningsCompleted),
    lessonsCompleted: Math.max(0, next.lessonsCompleted - prev.lessonsCompleted),
    wordsLearned: Math.max(0, next.wordsLearned - prev.wordsLearned),
    challengeXp: Math.max(0, next.challengeXp - prev.challengeXp),
  };
}

function formatWeeklySummary(delta) {
  const parts = [];
  if (delta.readingsCompleted > 0) parts.push(`${delta.readingsCompleted} readings`);
  if (delta.listeningsCompleted > 0) parts.push(`${delta.listeningsCompleted} listenings`);
  if (delta.lessonsCompleted > 0) parts.push(`${delta.lessonsCompleted} lessons`);
  if (delta.wordsLearned > 0) parts.push(`${delta.wordsLearned} words`);
  if (delta.challengeXp > 0) parts.push(`${delta.challengeXp} XP`);

  if (!parts.length) {
    return "A fresh week just started. Open EduVenture and keep your momentum going.";
  }

  return `Last week you completed ${parts.join(", ")}. Keep the streak alive this week.`;
}

function scanMaxTimestamp(value, keyHint = "") {
  let max = 0;
  const key = String(keyHint || "");

  if (Array.isArray(value)) {
    for (const item of value) {
      max = Math.max(max, scanMaxTimestamp(item));
    }
    return max;
  }

  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      max = Math.max(max, scanMaxTimestamp(childValue, childKey));
    }
    return max;
  }

  const maybeTs = Number(value);
  if (!Number.isFinite(maybeTs) || maybeTs <= 0) return 0;

  if (
    /(?:updatedAt|updatedAtMs|lastAttemptAtMs|completedAtMs|openedAtMs|reviewedAtMs|submittedAtMs)$/i.test(
      key
    )
  ) {
    return maybeTs;
  }

  return 0;
}

function extractContentItems(modulesRaw, challengesRaw) {
  const modules = mapToArray(modulesRaw)
    .map((entry) => ({
      kind: "lesson",
      title: String(entry.title || "New online lesson").trim() || "New online lesson",
      createdAtMs: Math.max(0, Number(entry.createdAtMs || 0)),
      url: LESSONS_URL,
    }))
    .filter((entry) => entry.createdAtMs > 0);

  const challenges = mapToArray(challengesRaw)
    .map((entry) => ({
      kind: "challenge",
      title: String(entry.title || "New weekly challenge").trim() || "New weekly challenge",
      createdAtMs: Math.max(0, Number(entry.createdAtMs || 0)),
      url: CHALLENGES_URL,
    }))
    .filter((entry) => entry.createdAtMs > 0);

  return [...modules, ...challenges].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function buildContentSummary(items) {
  if (!items.length) {
    return {
      body: "Fresh learning content is waiting for you in EduVenture.",
      url: LESSONS_URL,
    };
  }

  if (items.length === 1) {
    const item = items[0];
    const label = item.kind === "challenge" ? "weekly challenge" : "online lesson";
    return {
      body: `A new ${label} is live: ${item.title}`,
      url: item.url,
    };
  }

  const names = items
    .slice(0, 2)
    .map((item) => item.title)
    .join(" and ");

  return {
    body: `${items.length} new items are live, including ${names}.`,
    url: items[0]?.kind === "challenge" ? CHALLENGES_URL : LESSONS_URL,
  };
}

async function getNotificationRegistration() {
  if (!("serviceWorker" in navigator)) return null;

  try {
    await window.EDUVENTURE_SW_UPDATES?.ensureRegistration?.();
  } catch {}

  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => window.setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

async function showSystemNotification({ title, body, url, tag }) {
  if (!isNotificationSupported() || getPermissionState() !== "granted") {
    return false;
  }

  const registration = await getNotificationRegistration();
  if (!registration?.showNotification) {
    return false;
  }

  await registration.showNotification(title, {
    body,
    icon: PWA_ICON_URL,
    badge: PWA_BADGE_URL,
    tag,
    renotify: false,
    data: {
      url: url || HOME_URL,
    },
  });

  return true;
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    emitState();
    return { outcome: "unsupported", permission: "unsupported" };
  }

  const permission = await Notification.requestPermission();

  if (runtime.user?.uid) {
    try {
      await update(notificationPrefsRef(runtime.user.uid), {
        permission,
        updatedAtMs: Date.now(),
      });
    } catch {}
  }

  emitState();
  return { outcome: permission, permission };
}

async function loadNotificationPreferences(uid) {
  if (!uid) {
    runtime.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    emitState();
    return runtime.preferences;
  }

  try {
    const snap = await get(notificationPrefsRef(uid));
    runtime.preferences = normalizeNotificationPreferences(snap.exists() ? snap.val() || {} : {});
  } catch {
    runtime.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  emitState();
  return runtime.preferences;
}

async function saveNotificationPreferences(uid, patch = {}) {
  if (!uid) {
    throw new Error("notification-user-required");
  }

  const previous = { ...runtime.preferences };
  const next = normalizeNotificationPreferences({ ...runtime.preferences, ...patch });

  runtime.preferences = next;
  emitState();

  try {
    await update(notificationPrefsRef(uid), {
      ...next,
      permission: getPermissionState(),
      updatedAtMs: Date.now(),
    });
  } catch (error) {
    runtime.preferences = previous;
    emitState();
    throw error;
  }

  return next;
}

async function showTestNotification() {
  return showSystemNotification({
    title: "EduVenture notifications are live",
    body: "Daily reminders, weekly progress reports, and new content alerts are now ready.",
    url: SETTINGS_URL,
    tag: "eduventure-test-notification",
  });
}

async function runNotificationChecksNow(options = {}) {
  const force = !!options.force;
  const now = Date.now();
  const user = runtime.user;

  if (!user?.uid) {
    return { outcome: "no-user" };
  }

  if (!force && runtime.lastCheckAt && now - runtime.lastCheckAt < NOTIFICATION_CHECK_MIN_INTERVAL_MS) {
    return { outcome: "throttled" };
  }

  runtime.lastCheckAt = now;

  const prefs = normalizeNotificationPreferences(runtime.preferences);
  const uid = user.uid;
  const permission = getPermissionState();
  const canNotify = prefs.enabled && permission === "granted" && isNotificationSupported();

  const needsDaily = prefs.dailyReminder;
  const needsWeekly = prefs.weeklyProgress;
  const needsContent = prefs.newContentAlerts;

  const requests = [];
  const requestIndex = {};

  if (needsDaily) {
    requestIndex.progress = requests.length;
    requests.push(get(progressRef(uid)));
  }
  if (needsWeekly) {
    requestIndex.stats = requests.length;
    requests.push(get(statsRef(uid)));
  }
  if (needsContent) {
    requestIndex.modules = requests.length;
    requests.push(loadModulesContent());
    requestIndex.challenges = requests.length;
    requests.push(get(challengesRef()));
  }

  const responses = requests.length ? await Promise.all(requests) : [];
  const localState = readLocalState(uid);
  const nextLocalState = { ...localState };
  const notificationsShown = [];

  if (needsWeekly) {
    const stats = pickStatsSnapshot(responses[requestIndex.stats]?.val?.() || {});
    const currentWeekKey = isoWeekKey();
    const baseline = nextLocalState.weeklyBaseline;

    if (!baseline?.weekKey || !baseline?.stats) {
      nextLocalState.weeklyBaseline = {
        weekKey: currentWeekKey,
        stats,
      };
    } else if (baseline.weekKey !== currentWeekKey) {
      const previousWeekKey = baseline.weekKey;
      const weeklyDelta = diffStats(stats, baseline.stats);

      if (canNotify && nextLocalState.lastWeeklyReportWeekKey !== previousWeekKey) {
        const shown = await showSystemNotification({
          title: "Your weekly progress report",
          body: formatWeeklySummary(weeklyDelta),
          url: "/pages/account/account.html#overview",
          tag: `eduventure-weekly-${previousWeekKey}`,
        });

        if (shown) {
          nextLocalState.lastWeeklyReportWeekKey = previousWeekKey;
          notificationsShown.push("weekly-progress");
        }
      }

      nextLocalState.weeklyBaseline = {
        weekKey: currentWeekKey,
        stats,
      };
    }
  }

  if (needsContent) {
    const contentItems = extractContentItems(
      responses[requestIndex.modules] || [],
      responses[requestIndex.challenges]?.val?.() || {}
    );
    const latestContentAtMs = Math.max(0, Number(contentItems[0]?.createdAtMs || 0));

    if (!nextLocalState.lastContentAlertedAtMs) {
      nextLocalState.lastContentAlertedAtMs = latestContentAtMs;
    } else if (canNotify && latestContentAtMs > Number(nextLocalState.lastContentAlertedAtMs || 0)) {
      const freshItems = contentItems.filter(
        (item) => item.createdAtMs > Number(nextLocalState.lastContentAlertedAtMs || 0)
      );
      const summary = buildContentSummary(freshItems);
      const shown = await showSystemNotification({
        title: "New content is available",
        body: summary.body,
        url: summary.url,
        tag: `eduventure-content-${latestContentAtMs}`,
      });

      if (shown) {
        nextLocalState.lastContentAlertedAtMs = latestContentAtMs;
        notificationsShown.push("new-content");
      }
    }
  }

  if (needsDaily) {
    const progress = responses[requestIndex.progress]?.val?.() || {};
    const lastActivityAtMs = scanMaxTimestamp(progress);
    const lastActivityDay = lastActivityAtMs ? todayKey(new Date(lastActivityAtMs)) : "";
    const today = todayKey();
    const currentHour = new Date().getHours();

    if (
      canNotify &&
      currentHour >= prefs.reminderHour &&
      lastActivityDay !== today &&
      nextLocalState.lastDailyReminderDate !== today
    ) {
      const shown = await showSystemNotification({
        title: "Time for your daily English practice",
        body: "You have not studied yet today. Open EduVenture and keep your streak moving.",
        url: HOME_URL,
        tag: `eduventure-daily-${today}`,
      });

      if (shown) {
        nextLocalState.lastDailyReminderDate = today;
        notificationsShown.push("daily-reminder");
      }
    }
  }

  writeLocalState(uid, nextLocalState);
  return {
    outcome: notificationsShown.length ? "notified" : "checked",
    notificationsShown,
  };
}

function startRecurringChecks() {
  if (runtime.intervalId) return;
  runtime.intervalId = window.setInterval(() => {
    runNotificationChecksNow().catch(() => {});
  }, NOTIFICATION_INTERVAL_MS);
}

function bootNotificationModule() {
  if (runtime.booted || isAuthRoute) {
    emitState();
    return;
  }

  runtime.booted = true;
  emitState();
  startRecurringChecks();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runNotificationChecksNow().catch(() => {});
    }
  });

  window.addEventListener("focus", () => {
    runNotificationChecksNow().catch(() => {});
  });

  window.addEventListener("online", () => {
    runNotificationChecksNow({ force: true }).catch(() => {});
  });

  onAuthStateChanged(auth, async (user) => {
    runtime.user = user || null;
    runtime.lastCheckAt = 0;

    if (!user?.uid) {
      runtime.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
      emitState();
      return;
    }

    await loadNotificationPreferences(user.uid);
    await runNotificationChecksNow({ force: true }).catch(() => {});
  });
}

bootNotificationModule();

const api = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationState,
  requestNotificationPermission,
  loadNotificationPreferences,
  saveNotificationPreferences,
  runNotificationChecksNow,
  showTestNotification,
};

window.EDUVENTURE_NOTIFICATIONS = api;

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationState,
  requestNotificationPermission,
  loadNotificationPreferences,
  saveNotificationPreferences,
  runNotificationChecksNow,
  showTestNotification,
};
