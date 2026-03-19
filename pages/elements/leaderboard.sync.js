import {
  ref,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const LEADERBOARD_USER_PATH = (uid) => `leaderboards/users/${uid}`;

function toSafeText(value) {
  return (value ?? "").toString();
}

function clampCount(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.min(1000000000, Math.round(num));
}

function normalizeName(profile = {}, fallback = "Student") {
  const raw = toSafeText(
    profile.name ||
    profile.fullName ||
    profile.displayName ||
    fallback
  ).trim();
  return (raw || fallback).slice(0, 80);
}

function normalizeGroup(profile = {}, fallback = "Ungrouped") {
  const raw = toSafeText(
    profile.group_name ||
    profile.group ||
    profile.groupName ||
    fallback
  ).trim();
  return (raw || fallback).slice(0, 40);
}

function normalizePhotoUrl(profile = {}, fallback = "") {
  const raw = toSafeText(
    profile.photo_url ||
    profile.photoURL ||
    profile.avatarUrl ||
    fallback
  ).trim();
  return raw.slice(0, 1200);
}

function buildBaseEntry(previous, uid, profile = {}) {
  const prev = previous && typeof previous === "object" ? previous : {};
  const challengeXp = clampCount(prev.challengeXp, 0);
  return {
    uid,
    name: normalizeName(profile, prev.name || "Student"),
    group_name: normalizeGroup(profile, prev.group_name || "Ungrouped"),
    photo_url: normalizePhotoUrl(profile, prev.photo_url || ""),
    totalXp: clampCount(prev.totalXp, challengeXp),
    challengeXp,
    trueAnswers: clampCount(prev.trueAnswers, 0),
    wrongAnswers: clampCount(prev.wrongAnswers, 0),
    totalAnswers: clampCount(prev.totalAnswers, 0),
    testsCompleted: clampCount(prev.testsCompleted, 0),
    challengesApproved: clampCount(prev.challengesApproved, 0),
    challengeBadges: clampCount(prev.challengeBadges, 0),
    readingsCompleted: clampCount(prev.readingsCompleted, 0),
    listeningsCompleted: clampCount(prev.listeningsCompleted, 0),
    updatedAtMs: Date.now()
  };
}

export async function syncLeaderboardProfile(db, uid, profile = {}, stats = {}) {
  if (!db || !uid) return;

  await runTransaction(ref(db, LEADERBOARD_USER_PATH(uid)), (current) => {
    const next = buildBaseEntry(current, uid, profile);

    if (stats.challengeXp != null) {
      const challengeXp = clampCount(stats.challengeXp, next.challengeXp);
      next.challengeXp = challengeXp;
      next.totalXp = challengeXp;
    }
    if (stats.challengeBadges != null) {
      next.challengeBadges = clampCount(stats.challengeBadges, next.challengeBadges);
    }
    if (stats.challengesApproved != null) {
      next.challengesApproved = clampCount(stats.challengesApproved, next.challengesApproved);
    }
    if (stats.readingsCompleted != null) {
      next.readingsCompleted = clampCount(stats.readingsCompleted, next.readingsCompleted);
    }
    if (stats.listeningsCompleted != null) {
      next.listeningsCompleted = clampCount(stats.listeningsCompleted, next.listeningsCompleted);
    }

    return next;
  });
}

export async function awardChallengeLeaderboard(db, uid, profile = {}, options = {}) {
  if (!db || !uid) return;

  const xp = clampCount(options.xp, 0);
  const badgeCount = clampCount(options.badgeCount, 0);
  const approvedCount = clampCount(options.approvedCount, 1);

  await runTransaction(ref(db, LEADERBOARD_USER_PATH(uid)), (current) => {
    const next = buildBaseEntry(current, uid, profile);
    next.challengeXp += xp;
    next.totalXp += xp;
    next.challengeBadges += badgeCount;
    next.challengesApproved += approvedCount;
    next.updatedAtMs = Date.now();
    return next;
  });
}

export async function recordTestLeaderboard(db, uid, profile = {}, options = {}) {
  if (!db || !uid) return;

  const correct = clampCount(options.correct, 0);
  const wrong = clampCount(options.wrong, 0);
  const total = clampCount(options.total, correct + wrong);
  const mode = toSafeText(options.mode).trim().toLowerCase();

  await runTransaction(ref(db, LEADERBOARD_USER_PATH(uid)), (current) => {
    const next = buildBaseEntry(current, uid, profile);
    next.trueAnswers += correct;
    next.wrongAnswers += wrong;
    next.totalAnswers += total;
    next.testsCompleted += 1;
    if (mode === "reading") next.readingsCompleted += 1;
    if (mode === "listening") next.listeningsCompleted += 1;
    next.updatedAtMs = Date.now();
    return next;
  });
}

export async function syncLeaderboardSnapshot(db, uid, profile = {}, snapshot = {}) {
  if (!db || !uid) return;

  await runTransaction(ref(db, LEADERBOARD_USER_PATH(uid)), (current) => {
    const next = buildBaseEntry(current, uid, profile);
    const numericKeys = [
      "totalXp",
      "challengeXp",
      "trueAnswers",
      "wrongAnswers",
      "totalAnswers",
      "testsCompleted",
      "challengesApproved",
      "challengeBadges",
      "readingsCompleted",
      "listeningsCompleted"
    ];

    for (const key of numericKeys) {
      if (snapshot[key] != null) {
        next[key] = clampCount(snapshot[key], next[key]);
      }
    }

    next.name = normalizeName(profile, next.name || "Student");
    next.group_name = normalizeGroup(profile, next.group_name || "Ungrouped");
    next.updatedAtMs = Date.now();
    return next;
  });
}
