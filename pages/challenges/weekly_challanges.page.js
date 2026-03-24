import { auth, db } from "/elements/firebase.js";
import { checkAdminAccess } from "/elements/admin.js";
import {
  weeklyChallengeItemRef,
  weeklyChallengesItemsCollection,
} from "/elements/firestore-data.js";
import { awardChallengeLeaderboard } from "/pages/elements/leaderboard.sync.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  addDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  ref,
  get,
  set,
  push,
  remove,
  update,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ─────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────── */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function safeText(value) {
  return (value ?? "").toString();
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToLinkedHtml(value) {
  const raw = safeText(value);
  if (!raw) return "";

  const urlRegex = /https?:\/\/[^\s<>"'`]+/gi;
  let html = "";
  let lastIndex = 0;
  let match = urlRegex.exec(raw);

  while (match) {
    const url = match[0];
    const start = match.index;
    html += escapeHtml(raw.slice(lastIndex, start));

    if (isValidUrl(url)) {
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    } else {
      html += escapeHtml(url);
    }

    lastIndex = start + url.length;
    match = urlRegex.exec(raw);
  }

  html += escapeHtml(raw.slice(lastIndex));
  return html;
}

function nowMs() {
  return Date.now();
}

function mapToArray(mapObj) {
  if (!mapObj || typeof mapObj !== "object") return [];
  return Object.keys(mapObj).sort().map((id) => ({ id, ...mapObj[id] }));
}

function buildTextMap(values, prefix) {
  const result = {};
  values.forEach((value, index) => {
    const clean = safeText(value).trim();
    if (!clean) return;
    const key = `${prefix}${String(index).padStart(3, "0")}`;
    result[key] = { text: clean };
  });
  return Object.keys(result).length ? result : null;
}

function linesToHtml(value, emptyText = "No details added yet.") {
  const clean = safeText(value).trim();
  if (!clean) return `<p>${escapeHtml(emptyText)}</p>`;
  return `<p>${textToLinkedHtml(clean).replace(/\n/g, "<br>")}</p>`;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return "No deadline";
  try {
    return new Date(num).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return "No deadline";
  }
}

function formatDateTime(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return "Unknown time";
  try {
    return new Date(num).toLocaleString();
  } catch {
    return "Unknown time";
  }
}

function toDueAtMs(dateValue) {
  const clean = safeText(dateValue).trim();
  if (!clean) return null;
  const ms = new Date(`${clean}T23:59:59`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function challengeState(challenge) {
  const dueAtMs = Number(challenge?.dueAtMs || 0);
  if (Number.isFinite(dueAtMs) && dueAtMs > 0 && dueAtMs < nowMs()) return "closed";
  return "active";
}

function normalizeStatus(status) {
  const clean = safeText(status).trim().toLowerCase();
  return clean || "pending";
}

function statusLabel(status) {
  switch (normalizeStatus(status)) {
    case "approved":   return "Approved";
    case "needs_work": return "Needs work";
    case "rejected":   return "Rejected";
    case "closed":     return "Closed";
    default:           return "Pending";
  }
}

function proofCounts(proofs) {
  const all = Array.isArray(proofs) ? proofs : [];
  return {
    total: all.length,
    approved: all.filter((p) => normalizeStatus(p.status) === "approved").length
  };
}

function compareChallenges(a, b) {
  const aState = challengeState(a) === "active" ? 0 : 1;
  const bState = challengeState(b) === "active" ? 0 : 1;
  if (aState !== bState) return aState - bState;
  const aDue = Number(a?.dueAtMs || Number.MAX_SAFE_INTEGER);
  const bDue = Number(b?.dueAtMs || Number.MAX_SAFE_INTEGER);
  if (aDue !== bDue) return aDue - bDue;
  return Number(b?.createdAtMs || 0) - Number(a?.createdAtMs || 0);
}

/* ─────────────────────────────────────────────
   TOAST NOTIFICATIONS
   Replaces all alert() calls with non-blocking
   bottom-right toasts styled via the CSS.
───────────────────────────────────────────── */
function showToast(message, type = "") {
  const zone = $("#toastZone");
  if (!zone) return;

  const icons = { success: "✅", error: "❌", "": "ℹ️" };
  const el = document.createElement("div");
  el.className = `toast${type ? ` toast-${type}` : ""}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] ?? "ℹ️"}</span><span>${escapeHtml(message)}</span>`;
  zone.appendChild(el);

  // Trigger animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("show"));
  });

  // Auto-dismiss
  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, 3400);
}

/* ─────────────────────────────────────────────
   FIREBASE CONFIG
───────────────────────────────────────────── */
const CLUB_ID        = document.body?.dataset?.club || "english";
const LEGACY_CHALLENGES_PATH = `weeklyChallenges/${CLUB_ID}/items`;
const CHALLENGES_COLLECTION = weeklyChallengesItemsCollection(CLUB_ID);
const COMMENTS_PATH   = (cid) => `weeklyChallenges/${CLUB_ID}/comments/${cid}`;
const PROOFS_PATH     = (cid) => `weeklyChallenges/${CLUB_ID}/proofs/${cid}`;
const STUDENT_CHALLENGE_PROGRESS_PATH = (uid, cid) => `students/${uid}/progress/challenges/${cid}`;
const STUDENT_STATS_PATH = (uid) => `students/${uid}/stats`;
const DEFAULT_CHALLENGE_APPROVAL_XP = 20;
const CHALLENGE_REJECT_PENALTY_XP = 10;
const CHALLENGE_NEEDS_WORK_PENALTY_XP = 5;

function selectedChallenge() {
  return challenges.find((c) => c.id === selectedChallengeId) || null;
}

function challengeTitleForProgress(challenge, fallback = "Weekly challenge") {
  const text = safeText(challenge?.title || fallback).trim();
  return (text || "Weekly challenge").slice(0, 180);
}

function challengeRewardForProgress(challenge, fallback = "") {
  return safeText(challenge?.reward || fallback).trim().slice(0, 200);
}

function parseChallengeRewardXp(rewardText) {
  const text = safeText(rewardText).trim();
  const match = text.match(/(\d{1,5})\s*xp\b/i);
  const xp = Number(match?.[1]);
  if (Number.isFinite(xp) && xp > 0) return Math.min(xp, 10000);
  return DEFAULT_CHALLENGE_APPROVAL_XP;
}

function getChallengeRewardXp(challenge, fallbackRewardText = "") {
  const explicitXp = Number(challenge?.xpReward);
  if (Number.isFinite(explicitXp) && explicitXp >= 0) {
    return Math.min(10000, Math.round(explicitXp));
  }
  return parseChallengeRewardXp(challenge?.reward || fallbackRewardText || "");
}

function hasExplicitChallengeXp(challenge) {
  const explicitXp = Number(challenge?.xpReward);
  return Number.isFinite(explicitXp) && explicitXp >= 0;
}

function formatChallengeRewardDisplay(challenge) {
  const rewardText = safeText(challenge?.reward || "").trim();
  const hasExplicitXp = hasExplicitChallengeXp(challenge);
  if (hasExplicitXp && rewardText) return `${rewardText} - ${getChallengeRewardXp(challenge)} XP`;
  if (hasExplicitXp) return `${getChallengeRewardXp(challenge)} XP`;
  if (rewardText) return rewardText;
  return "Not set";
}

async function markChallengeProgressPending(uid, challenge, proofUrl = "") {
  if (!uid || !selectedChallengeId) return;
  const now = nowMs();
  const progressRef = ref(db, STUDENT_CHALLENGE_PROGRESS_PATH(uid, selectedChallengeId));

  await runTransaction(progressRef, (current) => {
    const prev = current && typeof current === "object" ? current : {};
    return {
      ...prev,
      challengeId: selectedChallengeId,
      clubId: CLUB_ID,
      bucket: "weekly_challenges",
      challengeTitle: challengeTitleForProgress(challenge, prev.challengeTitle || "Weekly challenge"),
      rewardText: challengeRewardForProgress(challenge, prev.rewardText || ""),
      status: "pending",
      statusLabel: statusLabel("pending"),
      submittedAtMs: now,
      updatedAtMs: now,
      reviewedAtMs: null,
      reviewerUid: "",
      proofUrl: safeText(proofUrl || prev.proofUrl || "").trim().slice(0, 1200)
    };
  });
}

async function syncChallengeReviewToStudentProgress(uid, status, challenge) {
  if (!uid || !selectedChallengeId) return { grantedXp: 0, badgeGranted: false, penaltyAdded: 0 };

  const normalized = normalizeStatus(status);
  const now = nowMs();
  const grantToken = `${safeText(currentUser?.uid || "admin")}:${now}:${Math.random().toString(36).slice(2, 8)}`;
  const penaltyToken = `${grantToken}:penalty`;
  const progressRef = ref(db, STUDENT_CHALLENGE_PROGRESS_PATH(uid, selectedChallengeId));

  const tx = await runTransaction(progressRef, (current) => {
    const prev = current && typeof current === "object" ? current : {};
    const prevStatus = normalizeStatus(prev.status);
    const alreadyRewarded = !!prev.badgeAwarded || Number(prev.xpAwarded || 0) > 0;

    let xpAwarded = Number(prev.xpAwarded || 0);
    let badgeAwarded = !!prev.badgeAwarded;
    let rewardGrantToken = safeText(prev.rewardGrantToken || "");
    let rewardBaseXp = Math.max(0, Number(prev.rewardBaseXp || 0));
    let rewardPenaltyApplied = Math.max(0, Number(prev.rewardPenaltyApplied || 0));
    let penaltyXp = Math.max(0, Number(prev.penaltyXp || 0));
    let penaltyAdded = 0;
    let penaltyGrantToken = safeText(prev.penaltyGrantToken || "");

    if (prevStatus === "pending" && normalized === "rejected") {
      penaltyAdded = CHALLENGE_REJECT_PENALTY_XP;
      penaltyXp += penaltyAdded;
      penaltyGrantToken = penaltyToken;
    }
    if (prevStatus === "pending" && normalized === "needs_work") {
      penaltyAdded = CHALLENGE_NEEDS_WORK_PENALTY_XP;
      penaltyXp += penaltyAdded;
      penaltyGrantToken = penaltyToken;
    }

    if (normalized === "approved" && !alreadyRewarded) {
      rewardBaseXp = getChallengeRewardXp(challenge, prev.rewardText || "");
      rewardPenaltyApplied = Math.min(rewardBaseXp, Math.max(0, penaltyXp));
      xpAwarded = Math.max(0, rewardBaseXp - rewardPenaltyApplied);
      badgeAwarded = true;
      rewardGrantToken = grantToken;
    }

    return {
      ...prev,
      challengeId: selectedChallengeId,
      clubId: CLUB_ID,
      bucket: "weekly_challenges",
      challengeTitle: challengeTitleForProgress(challenge, prev.challengeTitle || "Weekly challenge"),
      rewardText: challengeRewardForProgress(challenge, prev.rewardText || ""),
      status: normalized,
      statusLabel: statusLabel(normalized),
      reviewedAtMs: now,
      updatedAtMs: now,
      reviewerUid: safeText(currentUser?.uid || ""),
      submittedAtMs: Number(prev.submittedAtMs || 0) || now,
      xpAwarded,
      badgeAwarded,
      rewardGrantToken,
      rewardBaseXp,
      rewardPenaltyApplied,
      penaltyXp,
      penaltyAdded,
      penaltyGrantToken
    };
  });

  const next = tx?.snapshot?.val() || {};
  const grantedByThisReview = safeText(next.rewardGrantToken || "") === grantToken;
  const grantedXp = grantedByThisReview ? Math.max(0, Number(next.xpAwarded || 0)) : 0;
  const badgeGranted = grantedByThisReview && !!next.badgeAwarded;
  const penaltyAdded = safeText(next.penaltyGrantToken || "") === penaltyToken
    ? Math.max(0, Number(next.penaltyAdded || 0))
    : 0;
  return { grantedXp, badgeGranted, penaltyAdded };
}

async function grantChallengeRewardsToStudentStats(uid, xpGain, badgeGain) {
  if (!uid) return;
  const xp = Number(xpGain || 0);
  const badges = Number(badgeGain || 0);
  if (xp <= 0 && badges <= 0) return;

  const statsRef = ref(db, STUDENT_STATS_PATH(uid));
  await runTransaction(statsRef, (current) => {
    const prev = current && typeof current === "object" ? current : {};
    const next = { ...prev };

    const baseXp = Math.max(0, Number(prev.challengeXp || 0));
    const baseBadges = Math.max(0, Number(prev.challengeBadges || 0));
    const baseApproved = Math.max(0, Number(prev.challengesApproved || 0));

    next.challengeXp = baseXp + Math.max(0, xp);
    next.challengeBadges = baseBadges + Math.max(0, badges);
    next.challengesApproved = baseApproved + 1;
    return next;
  });
}

/* ─────────────────────────────────────────────
   APP STATE
───────────────────────────────────────────── */
let currentUser          = null;
let isAdmin              = false;
let firestoreChallenges  = [];
let legacyChallenges     = [];
let challenges           = [];
let selectedChallengeId  = null;
let currentComments      = [];
let currentProofs        = [];
let unsubscribeChallenges = null;
let unsubscribeLegacyChallenges = null;
let unsubscribeComments  = null;
let unsubscribeProofs    = null;
let proofFormDirty       = false;
let activeTabId          = "overviewPanel";
let searchQuery          = "";

/* ─────────────────────────────────────────────
   DOM REFERENCES
───────────────────────────────────────────── */
const heroChallengeCountEl      = $("#heroChallengeCount");
const heroOpenCountEl           = $("#heroOpenCount");
const heroRoleTextEl            = $("#heroRoleText");
const heroNoteEl                = $("#heroNote");

const challengeListStateEl      = $("#challengeListState");
const challengeListEl           = $("#challengeList");
const challengeEmptyEl          = $("#challengeEmpty");
const challengeDetailEl         = $("#challengeDetail");

const challengeStatusBadgeEl    = $("#challengeStatusBadge");
const challengeDueBadgeEl       = $("#challengeDueBadge");
const challengeTitleEl          = $("#challengeTitle");
const challengeSummaryEl        = $("#challengeSummary");
const challengeDeleteBtn        = $("#challengeDeleteBtn");
const challengeRewardEl         = $("#challengeReward");
const challengeRequirementCountEl  = $("#challengeRequirementCount");
const challengeSubmissionCountEl   = $("#challengeSubmissionCount");
const challengeApprovedCountEl     = $("#challengeApprovedCount");
const challengeNotesEl          = $("#challengeNotes");
const challengeRequirementsEl   = $("#challengeRequirements");

const proofGuideTextEl          = $("#proofGuideText");
const proofAuthStateEl          = $("#proofAuthState");
const proofTextEl               = $("#proofText");
const proofUrlEl                = $("#proofUrl");
const proofSubmitBtn            = $("#proofSubmitBtn");
const proofClearBtn             = $("#proofClearBtn");
const myProofStatusEl           = $("#myProofStatus");
const adminQueueControlEl       = $("#adminQueueControl");
const adminProofPendingBadgeEl  = $("#adminProofPendingBadge");
const openAdminProofPanelBtn    = $("#openAdminProofPanelBtn");
const adminProofModalEl         = $("#adminProofModal");
const adminProofModalCloseBtn   = $("#adminProofModalClose");
const adminProofModalTitleEl    = $("#adminProofModalTitle");
const adminProofModalSubtitleEl = $("#adminProofModalSubtitle");
const adminProofModalCountEl    = $("#adminProofModalCount");
const adminProofListEl          = $("#adminProofList");

const commentAuthStateEl        = $("#commentAuthState");
const commentTextEl             = $("#commentText");
const commentSendBtn            = $("#commentSendBtn");
const commentListEl             = $("#commentList");

const challengeModalEl          = $("#challengeModal");
const challengeModalCloseBtn    = $("#challengeModalClose");
const challengeTitleInput       = $("#challengeTitleInput");
const challengeSummaryInput     = $("#challengeSummaryInput");
const challengeRewardInput      = $("#challengeRewardInput");
const challengeXpRewardInput    = $("#challengeXpRewardInput");
const challengeDueDateInput     = $("#challengeDueDateInput");
const challengeProofGuideInput  = $("#challengeProofGuideInput");
const challengeNotesInput       = $("#challengeNotesInput");
const requirementFieldsEl       = $("#requirementFields");
const addRequirementBtn         = $("#addRequirementBtn");
const challengeSaveBtn          = $("#challengeSaveBtn");
const challengeClearBtn         = $("#challengeClearBtn");
const challengeModalStatusEl    = $("#challengeModalStatus");
const challengeSearchEl         = $("#challengeSearch");

/* ─────────────────────────────────────────────
   MODAL STATUS
───────────────────────────────────────────── */
function showModalStatus(message, type = "") {
  if (!challengeModalStatusEl) return;
  challengeModalStatusEl.textContent = safeText(message);
  challengeModalStatusEl.className = `modal-status${type ? ` ${type}` : ""}${message ? "" : " hidden"}`;
  if (!message) challengeModalStatusEl.classList.add("hidden");
}

/* ─────────────────────────────────────────────
   REQUIREMENT FIELDS (modal)
───────────────────────────────────────────── */
function addRequirementField(value = "") {
  if (!requirementFieldsEl) return;
  const row = document.createElement("div");
  row.className = "requirement-editor-row";
  row.innerHTML = `
    <input class="input-field requirement-input" type="text" placeholder="Requirement" value="${escapeHtml(value)}">
    <button class="remove-row-btn" type="button" aria-label="Remove requirement">✕</button>
  `;
  row.querySelector(".remove-row-btn").addEventListener("click", () => {
    row.remove();
    ensureRequirementField();
  });
  requirementFieldsEl.appendChild(row);
}

function ensureRequirementField() {
  if (!requirementFieldsEl) return;
  if (!requirementFieldsEl.querySelector(".requirement-input")) addRequirementField("");
}

function getRequirementValues() {
  return $$("#requirementFields .requirement-input")
    .map((input) => safeText(input.value).trim())
    .filter(Boolean);
}

function clearChallengeModal() {
  if (challengeTitleInput)      challengeTitleInput.value     = "";
  if (challengeSummaryInput)    challengeSummaryInput.value   = "";
  if (challengeRewardInput)     challengeRewardInput.value    = "";
  if (challengeXpRewardInput)   challengeXpRewardInput.value  = "";
  if (challengeDueDateInput)    challengeDueDateInput.value   = "";
  if (challengeProofGuideInput) challengeProofGuideInput.value = "";
  if (challengeNotesInput)      challengeNotesInput.value     = "";
  if (requirementFieldsEl)      requirementFieldsEl.innerHTML = "";
  ensureRequirementField();
  showModalStatus("");
}

/* ─────────────────────────────────────────────
   MODAL OPEN / CLOSE
───────────────────────────────────────────── */
function openChallengeModal() {
  if (!challengeModalEl || !isAdmin) return;
  challengeModalEl.classList.add("open");
  challengeModalEl.setAttribute("aria-hidden", "false");
  if (!challengeTitleInput?.value) clearChallengeModal();
  // Focus first input for accessibility
  setTimeout(() => challengeTitleInput?.focus(), 60);
}

function closeChallengeModal() {
  if (!challengeModalEl) return;
  challengeModalEl.classList.remove("open");
  challengeModalEl.setAttribute("aria-hidden", "true");
  showModalStatus("");
}

function openAdminProofModal() {
  if (!adminProofModalEl || !isAdmin || !selectedChallengeId) return;
  adminProofModalEl.classList.add("open");
  adminProofModalEl.setAttribute("aria-hidden", "false");
  renderAdminProofList();
}

function closeAdminProofModal() {
  if (!adminProofModalEl) return;
  adminProofModalEl.classList.remove("open");
  adminProofModalEl.setAttribute("aria-hidden", "true");
}

/* ─────────────────────────────────────────────
   FIREBASE HELPERS
───────────────────────────────────────────── */
async function checkAdmin(uid) {
  return checkAdminAccess(uid);
}

async function loadMyProfile() {
  if (!currentUser) return {};
  try {
    const snap = await get(ref(db, `students/${currentUser.uid}/profile`));
    return snap.exists() ? (snap.val() || {}) : {};
  } catch {
    return {};
  }
}

function redirectToLogin() {
  const ret = location.href;
  try { sessionStorage.setItem("edu_return_url", ret); } catch {}
  try { localStorage.setItem("edu_return_url", ret); } catch {}
  location.replace(`/pages/auth/reg.html?return=${encodeURIComponent(ret)}`);
}

function requireLoggedIn() {
  if (currentUser) return true;
  redirectToLogin();
  return false;
}

/* ─────────────────────────────────────────────
   HERO STATS
───────────────────────────────────────────── */
function updateHeroStats() {
  const openCount = challenges.filter((c) => challengeState(c) === "active").length;
  if (heroChallengeCountEl) heroChallengeCountEl.textContent = String(challenges.length);
  if (heroOpenCountEl)      heroOpenCountEl.textContent      = String(openCount);
  if (heroRoleTextEl)       heroRoleTextEl.textContent       = currentUser ? (isAdmin ? "Admin" : "Student") : "Guest";

  if (heroNoteEl) {
    heroNoteEl.textContent = isAdmin
      ? "Admin mode is enabled. You can publish new challenges, delete them, and review proof submissions."
      : currentUser
        ? "You can open any challenge, submit proof, and leave comments. Only admins can publish or delete challenges."
        : "Browse challenges freely. Login is only required for proof submissions and comments.";
  }
}

function setInteractionHints() {
  if (challengeListStateEl) {
    challengeListStateEl.textContent = isAdmin
      ? "Admin mode is enabled. Use the Add card to publish a challenge."
      : currentUser
        ? "Open a challenge, submit proof, and leave comments."
        : "Browse challenges freely. Login when you are ready to interact.";
  }

  if (proofAuthStateEl) {
    proofAuthStateEl.innerHTML = currentUser
      ? `Logged in as <strong>${isAdmin ? "admin" : "student"}</strong>. Your proof is saved per challenge.`
      : `<a href="/pages/auth/reg.html">Login or register</a> to submit proof.`;
  }

  if (commentAuthStateEl) {
    commentAuthStateEl.innerHTML = currentUser
      ? "You can comment on the selected challenge."
      : `<a href="/pages/auth/reg.html">Login or register</a> to leave comments.`;
  }
}

/* ─────────────────────────────────────────────
   TABS
───────────────────────────────────────────── */
function activateTab(targetId) {
  activeTabId = targetId;
  $$(".challenge-tab").forEach((btn) => {
    const active = btn.dataset.target === targetId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  $$(".challenge-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });
}

function bindTabs() {
  $$(".challenge-tab").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.target));
  });
}

/* ─────────────────────────────────────────────
   RENDER: CHALLENGE LIST
───────────────────────────────────────────── */
function renderChallengeList() {
  if (!challengeListEl) return;
  challengeListEl.innerHTML = "";

  const sorted = [...challenges].sort(compareChallenges);

  // Apply live search filter
  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? sorted.filter((c) =>
        safeText(c.title).toLowerCase().includes(query) ||
        safeText(c.summary).toLowerCase().includes(query)
      )
    : sorted;

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "challenge-list-empty";
    empty.textContent = query
      ? `No challenges match "${query}".`
      : isAdmin
        ? "No challenges yet. Publish the first one below."
        : "No challenges have been posted yet.";
    challengeListEl.appendChild(empty);
  }

  filtered.forEach((challenge) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `challenge-card${selectedChallengeId === challenge.id ? " selected" : ""}`;
    const state = challengeState(challenge);
    const reqCount = mapToArray(challenge.requirements).filter((r) => safeText(r.text).trim()).length;
    const reward  = formatChallengeRewardDisplay(challenge);
    const dueText = Number(challenge.dueAtMs || 0) ? formatDate(challenge.dueAtMs) : "Flexible";

    card.innerHTML = `
      <div class="challenge-card-head">
        <span class="status-pill ${state}">${state === "active" ? "Open" : "Closed"}</span>
        <span class="status-pill closed">${reqCount} req</span>
      </div>
      <h3 class="challenge-card-title">${escapeHtml(safeText(challenge.title || "Untitled challenge"))}</h3>
      <p class="challenge-card-summary">${escapeHtml(safeText(challenge.summary || "No summary yet."))}</p>
      <div class="challenge-card-meta">
        <span>📅 ${escapeHtml(dueText)}</span>
        <span>🎯 ${escapeHtml(reward.length > 28 ? reward.slice(0, 26) + "…" : reward)}</span>
      </div>
    `;

    card.addEventListener("click", () => selectChallenge(challenge.id));
    challengeListEl.appendChild(card);
  });

  if (isAdmin) {
    const addCard = document.createElement("button");
    addCard.type = "button";
    addCard.className = "add-challenge-card";
    addCard.innerHTML = `<div class="plus">+</div><div>Add weekly challenge</div>`;
    addCard.addEventListener("click", openChallengeModal);
    challengeListEl.appendChild(addCard);
  }
}

/* ─────────────────────────────────────────────
   RENDER: REQUIREMENTS
───────────────────────────────────────────── */
function renderChallengeRequirements(challenge) {
  if (!challengeRequirementsEl) return;
  const requirements = mapToArray(challenge?.requirements)
    .map((item) => safeText(item.text).trim())
    .filter(Boolean);

  challengeRequirementsEl.innerHTML = requirements.length
    ? requirements
        .map((text, index) => `
          <div class="requirement-item">
            <span class="requirement-index">${index + 1}</span>
            <div>${escapeHtml(text)}</div>
          </div>
        `)
        .join("")
    : `<div class="requirement-item"><div>No requirements were added to this challenge yet.</div></div>`;

  if (challengeRequirementCountEl) challengeRequirementCountEl.textContent = String(requirements.length);
}

/* ─────────────────────────────────────────────
   RENDER: OVERVIEW
───────────────────────────────────────────── */
function renderOverview(challenge) {
  if (!challengeNotesEl) return;
  const parts = [];
  parts.push(linesToHtml(challenge?.summary || "", "No summary has been added yet."));
  const extra = safeText(challenge?.notes || "").trim();
  if (extra) {
    parts.push(`<p><strong>Extra notes</strong></p>`);
    parts.push(linesToHtml(extra, ""));
  }
  challengeNotesEl.innerHTML = parts.join("");
}

/* ─────────────────────────────────────────────
   RENDER: PROOF PANEL
───────────────────────────────────────────── */
function getProofSubmissionPolicy(myProof) {
  if (!currentUser) {
    return {
      canSubmit: false,
      reason: `Please <a href="/pages/auth/reg.html">login or register</a> to submit proof.`,
      submitLabel: "Submit proof"
    };
  }

  if (!myProof) {
    return {
      canSubmit: true,
      reason: "No proof submitted yet. Complete the task and submit your first proof.",
      submitLabel: "Submit proof"
    };
  }

  const status = normalizeStatus(myProof.status);
  if (status === "approved") {
    return {
      canSubmit: false,
      reason: "This challenge is already approved for you. Additional submissions are locked.",
      submitLabel: "Approved"
    };
  }

  if (status === "pending") {
    return {
      canSubmit: false,
      reason: "Your proof is pending admin review. Wait for a decision to submit again.",
      submitLabel: "Waiting for review"
    };
  }

  if (status === "rejected") {
    return {
      canSubmit: true,
      reason: `Rejected review adds a <strong>${CHALLENGE_REJECT_PENALTY_XP} XP</strong> penalty to your final reward when approved.`,
      submitLabel: "Resubmit proof"
    };
  }

  if (status === "needs_work") {
    return {
      canSubmit: true,
      reason: `Needs work adds a <strong>${CHALLENGE_NEEDS_WORK_PENALTY_XP} XP</strong> penalty to your final reward when approved.`,
      submitLabel: "Resubmit proof"
    };
  }

  return {
    canSubmit: true,
    reason: "",
    submitLabel: "Submit proof"
  };
}

function maybeHydrateProofForm(myProof, force = false) {
  if (!proofTextEl || !proofUrlEl) return;
  if (!force && proofFormDirty) return;
  proofTextEl.value  = safeText(myProof?.text || "");
  proofUrlEl.value   = safeText(myProof?.url  || "");
  proofFormDirty = false;
}

function renderMyProofStatus(myProof) {
  if (!myProofStatusEl) return;

  if (!currentUser) {
    myProofStatusEl.innerHTML = `
      <strong>Not signed in</strong>
      <p>Login to submit proof for this challenge.</p>
    `;
    return;
  }

  if (!myProof) {
    myProofStatusEl.innerHTML = `
      <strong>No proof submitted yet</strong>
      <p>Complete the challenge and submit your evidence above.</p>
    `;
    return;
  }

  const status     = normalizeStatus(myProof.status);
  const reviewNote = safeText(myProof.reviewNote || "").trim();
  const penaltyXp  = Math.max(0, Number(myProof.penaltyXp || 0));
  const penaltyLine = penaltyXp > 0
    ? `<p>Penalty on final approval reward: <strong>-${penaltyXp} XP</strong></p>`
    : "";
  const lockLine = status === "pending"
    ? `<p>Submission is locked until admin marks it as <strong>Needs work</strong> or <strong>Rejected</strong>.</p>`
    : status === "approved"
      ? `<p>This challenge is already approved. Further submissions are permanently locked.</p>`
      : `<p>You can update your work and submit again.</p>`;

  myProofStatusEl.innerHTML = `
    <div class="comment-meta">
      <strong>Your current proof</strong>
      <span class="status-pill ${status}">${statusLabel(status)}</span>
    </div>
    <p>Submitted: ${escapeHtml(formatDateTime(myProof.submittedAtMs))}</p>
    ${lockLine}
    ${penaltyLine}
    ${reviewNote ? `<p>📌 Review note: ${textToLinkedHtml(reviewNote).replace(/\n/g, "<br>")}</p>` : ""}
  `;
}

/*
function renderAdminProofListLegacy__unused() {
  return;
  if (!adminProofSectionEl || !adminProofListEl) return;
  if (!isAdmin) {
    adminProofSectionEl.classList.add("hidden");
    adminProofListEl.innerHTML = "";
    return;
  }

  adminProofSectionEl.classList.remove("hidden");
  if (!currentProofs.length) {
    adminProofListEl.innerHTML = `<div class="proof-card"><strong>No proof submissions yet</strong></div>`;
    return;
  }

  adminProofListEl.innerHTML = "";
  [...currentProofs]
    .sort((a, b) => Number(b.submittedAtMs || 0) - Number(a.submittedAtMs || 0))
    .forEach((proof) => {
      const status     = normalizeStatus(proof.status);
      const card       = document.createElement("div");
      card.className   = "proof-card";

      const link       = safeText(proof.url        || "").trim();
      const reviewNote = safeText(proof.reviewNote  || "").trim();
      const name       = safeText(proof.name        || "Student");
      const group      = safeText(proof.group_name  || "");

      card.innerHTML = `
        <div class="comment-meta">
          <div>
            <div class="proof-author">
              ${escapeHtml(name)}
              ${group ? `<span class="comment-time"> (${escapeHtml(group)})</span>` : ""}
            </div>
            <div class="proof-meta">${escapeHtml(formatDateTime(proof.submittedAtMs))}</div>
          </div>
          <span class="status-pill ${status}">${statusLabel(status)}</span>
        </div>
        <p>${textToLinkedHtml(safeText(proof.text || "")).replace(/\n/g, "<br>") || "No proof text provided."}</p>
        ${link ? `<p class="proof-link"><a href="${escapeHtml(link)}" target="_blank" rel="noopener">🔗 Open proof link</a></p>` : ""}
        ${reviewNote ? `<p>📌 Review note: ${textToLinkedHtml(reviewNote).replace(/\n/g, "<br>")}</p>` : ""}
      `;

      // Action buttons
      const actions = document.createElement("div");
      actions.className = "proof-review-actions";

      const makeBtn = (label, className, cb) => {
        const btn = document.createElement("button");
        btn.type      = "button";
        btn.className = className;
        btn.textContent = label;
        btn.addEventListener("click", cb);
        return btn;
      };

      const uid = proof.uid || proof.id;
      actions.appendChild(makeBtn("✓ Approve",    "primary-btn", () => reviewProof(uid, "approved")));
      actions.appendChild(makeBtn("⚠ Needs work", "ghost-btn",   () => reviewProof(uid, "needs_work")));
      actions.appendChild(makeBtn("✕ Reject",     "ghost-btn danger", () => reviewProof(uid, "rejected")));
      actions.appendChild(makeBtn("✏ Edit note",  "ghost-btn",   () => editProofNote(uid, proof.reviewNote || "")));
      actions.appendChild(makeBtn("🗑 Delete",     "ghost-btn danger", () => deleteProof(uid)));

      card.appendChild(actions);
      adminProofListEl.appendChild(card);
    });
}

*/
function renderAdminProofList() {
  if (!adminProofListEl) return;

  const challenge = selectedChallenge();
  const challengeTitle = safeText(challenge?.title || "Selected challenge").trim() || "Selected challenge";
  const pendingProofs = [...currentProofs]
    .filter((proof) => normalizeStatus(proof.status) === "pending")
    .sort((a, b) => Number(b.submittedAtMs || 0) - Number(a.submittedAtMs || 0));

  if (adminQueueControlEl) {
    adminQueueControlEl.classList.toggle("hidden", !isAdmin);
  }
  if (adminProofPendingBadgeEl) {
    adminProofPendingBadgeEl.textContent = `${pendingProofs.length} pending`;
  }
  if (adminProofModalCountEl) {
    adminProofModalCountEl.textContent = `${pendingProofs.length} pending`;
  }
  if (adminProofModalTitleEl) {
    adminProofModalTitleEl.textContent = "Proof review queue";
  }
  if (adminProofModalSubtitleEl) {
    adminProofModalSubtitleEl.textContent = challenge
      ? `Pending submissions for "${challengeTitle}".`
      : "Select a challenge to review pending submissions.";
  }
  if (openAdminProofPanelBtn) {
    openAdminProofPanelBtn.disabled = !selectedChallengeId;
  }

  if (!isAdmin) {
    closeAdminProofModal();
    adminProofListEl.innerHTML = "";
    return;
  }

  if (!selectedChallengeId || !challenge) {
    adminProofListEl.innerHTML = `
      <div class="proof-card">
        <strong>Select a challenge first</strong>
        <p>Open any challenge, then review pending proof requests here.</p>
      </div>
    `;
    return;
  }

  if (!pendingProofs.length) {
    adminProofListEl.innerHTML = `
      <div class="proof-card">
        <strong>Queue is clear</strong>
        <p>All student submissions for this challenge have been reviewed.</p>
      </div>
    `;
    return;
  }

  adminProofListEl.innerHTML = "";
  pendingProofs.forEach((proof) => {
    const status = normalizeStatus(proof.status);
    const card = document.createElement("div");
    card.className = "proof-card";

    const link = safeText(proof.url || "").trim();
    const reviewNote = safeText(proof.reviewNote || "").trim();
    const name = safeText(proof.name || "Student");
    const group = safeText(proof.group_name || "");

    card.innerHTML = `
      <div class="comment-meta">
        <div>
          <div class="proof-author">
            ${escapeHtml(name)}
            ${group ? `<span class="comment-time"> (${escapeHtml(group)})</span>` : ""}
          </div>
          <div class="proof-meta">${escapeHtml(formatDateTime(proof.submittedAtMs))}</div>
        </div>
        <span class="status-pill ${status}">${statusLabel(status)}</span>
      </div>
      <p>${textToLinkedHtml(safeText(proof.text || "")).replace(/\n/g, "<br>") || "No proof text provided."}</p>
      ${link ? `<p class="proof-link"><a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open proof link</a></p>` : ""}
      ${reviewNote ? `<p>Review note: ${textToLinkedHtml(reviewNote).replace(/\n/g, "<br>")}</p>` : ""}
    `;

    const actions = document.createElement("div");
    actions.className = "proof-review-actions";

    const makeBtn = (label, className, cb) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener("click", cb);
      return btn;
    };

    const uid = proof.uid || proof.id;
    actions.appendChild(makeBtn("Approve", "primary-btn", () => reviewProof(uid, "approved")));
    actions.appendChild(makeBtn("Needs work", "ghost-btn", () => reviewProof(uid, "needs_work")));
    actions.appendChild(makeBtn("Reject", "ghost-btn danger", () => reviewProof(uid, "rejected")));
    actions.appendChild(makeBtn("Edit note", "ghost-btn", () => editProofNote(uid, proof.reviewNote || "")));
    actions.appendChild(makeBtn("Delete", "ghost-btn danger", () => deleteProof(uid)));

    card.appendChild(actions);
    adminProofListEl.appendChild(card);
  });
}

function renderProofPanel(challenge) {
  const myProof = currentUser
    ? currentProofs.find((p) => safeText(p.uid || p.id) === safeText(currentUser.uid))
    : null;

  if (proofGuideTextEl) {
    const fallback = "Submit a short summary and a proof link that clearly shows you completed the challenge.";
    const guideText = safeText(challenge?.proofGuide || "").trim() || fallback;
    proofGuideTextEl.innerHTML = textToLinkedHtml(guideText).replace(/\n/g, "<br>");
  }

  maybeHydrateProofForm(myProof, false);
  renderMyProofStatus(myProof);
  renderAdminProofList();

  const submitPolicy = getProofSubmissionPolicy(myProof);
  if (proofSubmitBtn) {
    proofSubmitBtn.disabled = !submitPolicy.canSubmit;
    proofSubmitBtn.textContent = submitPolicy.submitLabel;
  }
  if (proofClearBtn) proofClearBtn.disabled = !submitPolicy.canSubmit;
  if (proofTextEl) proofTextEl.disabled = !submitPolicy.canSubmit;
  if (proofUrlEl) proofUrlEl.disabled = !submitPolicy.canSubmit;
  if (proofAuthStateEl && currentUser) {
    proofAuthStateEl.innerHTML = submitPolicy.reason || "You can submit your proof for this challenge.";
  }

  const counts = proofCounts(currentProofs);
  if (challengeSubmissionCountEl) challengeSubmissionCountEl.textContent = String(counts.total);
  if (challengeApprovedCountEl)   challengeApprovedCountEl.textContent   = String(counts.approved);
}

/* ─────────────────────────────────────────────
   RENDER: COMMENTS
───────────────────────────────────────────── */
function renderComments() {
  if (!commentListEl) return;

  if (!currentComments.length) {
    commentListEl.innerHTML = `
      <div class="comment-card">
        <strong>No comments yet</strong>
        <p>Be the first to comment on this challenge.</p>
      </div>
    `;
    return;
  }

  commentListEl.innerHTML = "";
  [...currentComments]
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    .forEach((comment) => {
      const card  = document.createElement("div");
      card.className = "comment-card";

      const name  = safeText(comment.name       || "User");
      const group = safeText(comment.group_name || "");
      const badge = comment.isAdmin ? `<span class="status-pill closed" style="margin-left:6px;">admin</span>` : "";

      card.innerHTML = `
        <div class="comment-meta">
          <div class="comment-author">
            ${escapeHtml(name)}
            ${group ? ` <span class="comment-time">(${escapeHtml(group)})</span>` : ""}
            ${badge}
          </div>
          <div class="comment-time">${escapeHtml(formatDateTime(comment.createdAtMs))}</div>
        </div>
        <p>${textToLinkedHtml(safeText(comment.text || "")).replace(/\n/g, "<br>")}</p>
      `;

      if (currentUser && (safeText(comment.uid) === safeText(currentUser.uid) || isAdmin)) {
        const actions = document.createElement("div");
        actions.className = "comment-actions";
        const deleteBtn = document.createElement("button");
        deleteBtn.type      = "button";
        deleteBtn.className = "ghost-btn danger";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => deleteComment(comment.id));
        actions.appendChild(deleteBtn);
        card.appendChild(actions);
      }

      commentListEl.appendChild(card);
    });
}

/* ─────────────────────────────────────────────
   RENDER: SELECTED CHALLENGE
───────────────────────────────────────────── */
function renderSelectedChallenge() {
  const challenge = challenges.find((c) => c.id === selectedChallengeId) || null;
  if (!challenge) {
    if (challengeDetailEl)  challengeDetailEl.classList.add("hidden");
    if (challengeEmptyEl)   challengeEmptyEl.classList.remove("hidden");
    if (challengeDeleteBtn) challengeDeleteBtn.classList.add("hidden");
    return;
  }

  if (challengeEmptyEl)  challengeEmptyEl.classList.add("hidden");
  if (challengeDetailEl) challengeDetailEl.classList.remove("hidden");

  const state  = challengeState(challenge);
  const reward = formatChallengeRewardDisplay(challenge);
  const dueText = Number(challenge.dueAtMs || 0) ? formatDate(challenge.dueAtMs) : "";

  if (challengeStatusBadgeEl) {
    challengeStatusBadgeEl.textContent = state === "active" ? "Active" : "Closed";
    challengeStatusBadgeEl.className   = `status-badge${state === "closed" ? " closed" : ""}`;
  }

  if (challengeDueBadgeEl) {
    if (dueText) {
      challengeDueBadgeEl.textContent = `Due ${dueText}`;
      challengeDueBadgeEl.classList.remove("hidden");
    } else {
      challengeDueBadgeEl.classList.add("hidden");
    }
  }

  if (challengeTitleEl)   challengeTitleEl.textContent   = safeText(challenge.title   || "Untitled challenge");
  if (challengeSummaryEl) challengeSummaryEl.textContent = safeText(challenge.summary || "");
  if (challengeRewardEl)  challengeRewardEl.textContent  = reward;

  renderOverview(challenge);
  renderChallengeRequirements(challenge);
  renderProofPanel(challenge);
  renderComments();
  activateTab(activeTabId);

  if (challengeDeleteBtn) challengeDeleteBtn.classList.toggle("hidden", !isAdmin);
}

/* ─────────────────────────────────────────────
   SELECT CHALLENGE
───────────────────────────────────────────── */
function selectChallenge(challengeId) {
  closeAdminProofModal();
  selectedChallengeId = challengeId;
  proofFormDirty = false;
  renderChallengeList();
  renderSelectedChallenge();
  subscribeToComments(challengeId);
  subscribeToProofs(challengeId);
}

/* ─────────────────────────────────────────────
   REALTIME SUBSCRIPTIONS
───────────────────────────────────────────── */
function subscribeToComments(challengeId) {
  if (typeof unsubscribeComments === "function") unsubscribeComments();
  currentComments = [];
  renderComments();

  unsubscribeComments = onValue(
    ref(db, COMMENTS_PATH(challengeId)),
    (snap) => {
      const val = snap.val() || {};
      currentComments = Object.keys(val).map((id) => ({ id, ...val[id] }));
      renderComments();
    },
    () => {
      currentComments = [];
      renderComments();
    }
  );
}

function subscribeToProofs(challengeId) {
  if (typeof unsubscribeProofs === "function") unsubscribeProofs();
  currentProofs = [];
  renderSelectedChallenge();

  unsubscribeProofs = onValue(
    ref(db, PROOFS_PATH(challengeId)),
    (snap) => {
      const val = snap.val() || {};
      currentProofs = Object.keys(val).map((id) => ({ id, ...val[id] }));
      renderSelectedChallenge();
    },
    () => {
      currentProofs = [];
      renderSelectedChallenge();
    }
  );
}

function syncChallengeBoard(loadFailed = false) {
  const merged = new Map();

  legacyChallenges.forEach((challenge) => {
    if (!challenge?.id) return;
    merged.set(challenge.id, challenge);
  });

  firestoreChallenges.forEach((challenge) => {
    if (!challenge?.id) return;
    merged.set(challenge.id, challenge);
  });

  challenges = Array.from(merged.values()).sort(compareChallenges);

  updateHeroStats();
  renderChallengeList();

  const stillExists = challenges.some((c) => c.id === selectedChallengeId);
  if (!stillExists) {
    selectedChallengeId = challenges[0]?.id || null;
    currentComments = [];
    currentProofs   = [];
    if (typeof unsubscribeComments === "function") unsubscribeComments();
    if (typeof unsubscribeProofs   === "function") unsubscribeProofs();
    unsubscribeComments = null;
    unsubscribeProofs   = null;
    if (selectedChallengeId) {
      selectChallenge(selectedChallengeId);
    } else {
      renderSelectedChallenge();
    }
  } else {
    renderSelectedChallenge();
  }

  if (loadFailed && !challenges.length && challengeListStateEl) {
    challengeListStateEl.textContent = "Challenge board could not be loaded.";
  }
}

function startRealtimeChallenges() {
  if (typeof unsubscribeChallenges === "function") unsubscribeChallenges();
  if (typeof unsubscribeLegacyChallenges === "function") unsubscribeLegacyChallenges();

  unsubscribeChallenges = onSnapshot(
    query(CHALLENGES_COLLECTION, orderBy("createdAtMs", "desc")),
    (snap) => {
      firestoreChallenges = snap.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))
        .sort(compareChallenges);
      syncChallengeBoard();
    },
    () => {
      firestoreChallenges = [];
      syncChallengeBoard(true);
    }
  );

  unsubscribeLegacyChallenges = onValue(
    ref(db, LEGACY_CHALLENGES_PATH),
    (snap) => {
      const val = snap.val() || {};
      legacyChallenges = Object.keys(val)
        .map((id) => ({ id, ...val[id] }))
        .sort(compareChallenges);
      syncChallengeBoard();
    },
    () => {
      legacyChallenges = [];
      syncChallengeBoard(true);
    }
  );
}

/* ─────────────────────────────────────────────
   ACTIONS: PUBLISH CHALLENGE
───────────────────────────────────────────── */
async function publishChallenge() {
  if (!isAdmin) {
    showToast("Only admins can publish challenges.", "error");
    return;
  }

  const title    = safeText(challengeTitleInput?.value).trim();
  const summary  = safeText(challengeSummaryInput?.value).trim();
  const reward   = safeText(challengeRewardInput?.value).trim();
  const rewardXpRaw = safeText(challengeXpRewardInput?.value).trim();
  const dueDate  = safeText(challengeDueDateInput?.value).trim();
  const guide    = safeText(challengeProofGuideInput?.value).trim();
  const notes    = safeText(challengeNotesInput?.value).trim();
  const reqs     = getRequirementValues();
  const rewardXp = Number(rewardXpRaw);

  if (!title) {
    showModalStatus("Challenge title is required.", "error");
    return;
  }
  if (!reqs.length) {
    showModalStatus("Add at least one requirement.", "error");
    return;
  }
  if (rewardXpRaw === "" || !Number.isFinite(rewardXp) || rewardXp < 0) {
    showModalStatus("Set a valid XP reward for this challenge.", "error");
    return;
  }

  const payload = {
    title, summary, reward, dueDate,
    xpReward:  Math.min(10000, Math.round(rewardXp)),
    dueAtMs:    toDueAtMs(dueDate),
    proofGuide: guide,
    notes,
    requirements:   buildTextMap(reqs, "r"),
    createdAtMs:    nowMs(),
    createdByUid:   currentUser?.uid || ""
  };

  // Strip nulls / empty strings
  Object.keys(payload).forEach((key) => {
    if (payload[key] === null || payload[key] === "") delete payload[key];
  });

  challengeSaveBtn.disabled = true;
  challengeSaveBtn.textContent = "Publishing...";
  showModalStatus("Publishing challenge...", "");

  try {
    const newRef = await addDoc(CHALLENGES_COLLECTION, payload);
    showModalStatus("Challenge published.", "success");
    proofFormDirty = false;
    clearChallengeModal();
    closeChallengeModal();
    selectedChallengeId = newRef.id;
    showToast("Challenge published successfully! 🎉", "success");
  } catch (error) {
    showModalStatus(error?.message || "Failed to publish challenge.", "error");
    showToast("Failed to publish challenge.", "error");
  } finally {
    challengeSaveBtn.disabled = false;
    challengeSaveBtn.textContent = "Publish challenge";
  }
}

/* ─────────────────────────────────────────────
   ACTIONS: DELETE CHALLENGE
───────────────────────────────────────────── */
async function deleteChallenge() {
  if (!isAdmin || !selectedChallengeId) return;
  const challenge = challenges.find((c) => c.id === selectedChallengeId);
  if (!challenge) return;

  if (!confirm(`Delete "${safeText(challenge.title || "this challenge")}" and all related proofs and comments?`)) return;

  try {
    const id = selectedChallengeId;
    await Promise.all([
      deleteDoc(weeklyChallengeItemRef(CLUB_ID, id)),
      remove(ref(db, `${LEGACY_CHALLENGES_PATH}/${id}`)),
      remove(ref(db, COMMENTS_PATH(id))),
      remove(ref(db, PROOFS_PATH(id)))
    ]);
    showToast("Challenge deleted.", "");
  } catch (error) {
    showToast(error?.message || "Failed to delete challenge.", "error");
  }
}

/* ─────────────────────────────────────────────
   ACTIONS: SUBMIT PROOF
───────────────────────────────────────────── */
async function submitProof() {
  if (!selectedChallengeId) return;
  if (!requireLoggedIn()) return;

  const existingProof = currentProofs.find((proof) => safeText(proof.uid || proof.id) === safeText(currentUser?.uid || ""));
  const submitPolicy = getProofSubmissionPolicy(existingProof || null);
  if (!submitPolicy.canSubmit) {
    showToast("You cannot submit right now. Wait for admin review or update after decision.", "error");
    return;
  }

  const text = safeText(proofTextEl?.value).trim();
  const url  = safeText(proofUrlEl?.value).trim();

  if (!text) {
    showToast("Describe your completed work before submitting proof.", "error");
    proofTextEl?.focus();
    return;
  }
  if (url && !isValidUrl(url)) {
    showToast("Proof link must be a valid http or https URL.", "error");
    proofUrlEl?.focus();
    return;
  }

  proofSubmitBtn.disabled     = true;
  proofSubmitBtn.textContent  = "Submitting…";

  try {
    const profile = await loadMyProfile();
    const challenge = selectedChallenge();
    const normalizedGroupName = safeText(profile.group_name || profile.group || profile.class || "").trim().slice(0, 40) || "Ungrouped";
    const payload = {
      uid:          currentUser.uid,
      name:         safeText(profile.fullName || profile.name || currentUser.displayName || currentUser.email?.split("@")[0] || "Student").slice(0, 80),
      group_name:   normalizedGroupName,
      text, url,
      status:       "pending",
      reviewNote:   "",
      submittedAtMs: nowMs(),
      reviewedAtMs:  null,
      reviewerUid:   null
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === null || payload[key] === "") delete payload[key];
    });

    await set(ref(db, `${PROOFS_PATH(selectedChallengeId)}/${currentUser.uid}`), payload);
    if (existingProof) {
      existingProof.text = payload.text;
      existingProof.url = payload.url || "";
      existingProof.status = "pending";
      existingProof.reviewNote = "";
      existingProof.submittedAtMs = payload.submittedAtMs;
      existingProof.reviewedAtMs = null;
      existingProof.reviewerUid = "";
    } else {
      currentProofs.push({ ...payload });
    }
    try {
      await markChallengeProgressPending(currentUser.uid, challenge, url);
    } catch (progressErr) {
      console.warn("Could not sync challenge progress on submit:", progressErr);
    }
    proofFormDirty = false;
    showToast("Proof submitted! Waiting for admin review.", "success");
  } catch (error) {
    showToast(error?.message || "Failed to submit proof.", "error");
  } finally {
    const liveMyProof = currentUser
      ? currentProofs.find((proof) => safeText(proof.uid || proof.id) === safeText(currentUser.uid))
      : null;
    const livePolicy = getProofSubmissionPolicy(liveMyProof || null);
    proofSubmitBtn.disabled = !livePolicy.canSubmit;
    proofSubmitBtn.textContent = livePolicy.submitLabel;
  }
}

/* ─────────────────────────────────────────────
   ACTIONS: ADMIN PROOF REVIEW
───────────────────────────────────────────── */
async function editProofNote(uid, currentNote) {
  if (!isAdmin || !selectedChallengeId || !uid) return;
  const nextNote = prompt("Review note for student:", safeText(currentNote || ""));
  if (nextNote === null) return;

  try {
    await update(ref(db, `${PROOFS_PATH(selectedChallengeId)}/${uid}`), {
      reviewNote:   safeText(nextNote).trim(),
      reviewedAtMs: nowMs(),
      reviewerUid:  currentUser?.uid || ""
    });
    showToast("Review note saved.", "success");
  } catch (error) {
    showToast(error?.message || "Failed to save review note.", "error");
  }
}

async function reviewProof(uid, status) {
  if (!isAdmin || !selectedChallengeId || !uid) return;

  try {
    const reviewedAtMs = nowMs();
    const challenge = selectedChallenge();

    await update(ref(db, `${PROOFS_PATH(selectedChallengeId)}/${uid}`), {
      status,
      reviewedAtMs,
      reviewerUid:  currentUser?.uid || ""
    });

    const localProof = currentProofs.find((proof) => safeText(proof.uid || proof.id) === safeText(uid));
    if (localProof) {
      localProof.status = status;
      localProof.reviewedAtMs = reviewedAtMs;
      localProof.reviewerUid = currentUser?.uid || "";
    }
    renderProofPanel(challenge);

    let rewardNote = "";
    try {
      const { grantedXp, badgeGranted, penaltyAdded } = await syncChallengeReviewToStudentProgress(uid, status, challenge);
      if (grantedXp > 0 || badgeGranted) {
        await grantChallengeRewardsToStudentStats(uid, grantedXp, badgeGranted ? 1 : 0);
        await awardChallengeLeaderboard(
          db,
          uid,
          {
            name: localProof?.name || "Student",
            group_name: localProof?.group_name || "Ungrouped"
          },
          {
            xp: grantedXp,
            badgeCount: badgeGranted ? 1 : 0,
            approvedCount: 1
          }
        );
      }
      if (grantedXp > 0) {
        rewardNote = ` +${grantedXp} XP${badgeGranted ? " and badge awarded." : "."}`;
      } else if (penaltyAdded > 0) {
        rewardNote = ` Final approval reward reduced by ${penaltyAdded} XP.`;
      } else {
        rewardNote = "";
      }
    } catch (syncError) {
      console.warn("Proof status saved but reward/history sync failed:", syncError);
      rewardNote = " Status saved, but XP/badge sync failed.";
    }
    showToast(`Proof marked as "${statusLabel(status)}".${rewardNote}`, "success");
  } catch (error) {
    showToast(error?.message || "Failed to update proof status.", "error");
  }
}

async function deleteProof(uid) {
  if (!isAdmin || !selectedChallengeId || !uid) return;
  if (!confirm("Delete this proof submission?")) return;

  try {
    await remove(ref(db, `${PROOFS_PATH(selectedChallengeId)}/${uid}`));
    currentProofs = currentProofs.filter((proof) => safeText(proof.uid || proof.id) !== safeText(uid));
    renderProofPanel(selectedChallenge());
    showToast("Proof submission deleted.", "");
  } catch (error) {
    showToast(error?.message || "Failed to delete proof.", "error");
  }
}

/* ─────────────────────────────────────────────
   ACTIONS: COMMENTS
───────────────────────────────────────────── */
async function sendComment() {
  if (!selectedChallengeId) return;
  if (!requireLoggedIn()) return;

  const text = safeText(commentTextEl?.value).trim();
  if (!text) return;

  commentSendBtn.disabled    = true;
  commentSendBtn.textContent = "Sending…";

  try {
    const profile    = await loadMyProfile();
    const normalizedGroupName = safeText(profile.group_name || profile.group || profile.class || "").trim().slice(0, 40) || "Ungrouped";
    const commentRef = push(ref(db, COMMENTS_PATH(selectedChallengeId)));
    await set(commentRef, {
      uid:          currentUser.uid,
      name:         safeText(profile.fullName || profile.name || currentUser.displayName || currentUser.email?.split("@")[0] || "User").slice(0, 80),
      group_name:   normalizedGroupName,
      text,
      createdAtMs:  nowMs(),
      isAdmin:      !!isAdmin
    });
    commentTextEl.value = "";
    showToast("Comment posted.", "success");
  } catch (error) {
    showToast(error?.message || "Failed to send comment.", "error");
  } finally {
    commentSendBtn.disabled    = false;
    commentSendBtn.textContent = "Send comment";
  }
}

async function deleteComment(commentId) {
  if (!selectedChallengeId || !commentId) return;
  if (!confirm("Delete this comment?")) return;

  try {
    await remove(ref(db, `${COMMENTS_PATH(selectedChallengeId)}/${commentId}`));
    showToast("Comment deleted.", "");
  } catch (error) {
    showToast(error?.message || "Failed to delete comment.", "error");
  }
}

/* ─────────────────────────────────────────────
   BIND ALL EVENTS
───────────────────────────────────────────── */
function bindModal() {
  challengeModalCloseBtn?.addEventListener("click", closeChallengeModal);
  challengeModalEl?.addEventListener("click", (e) => {
    if (e.target === challengeModalEl) closeChallengeModal();
  });
  adminProofModalCloseBtn?.addEventListener("click", closeAdminProofModal);
  adminProofModalEl?.addEventListener("click", (e) => {
    if (e.target === adminProofModalEl) closeAdminProofModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (adminProofModalEl?.classList.contains("open")) closeAdminProofModal();
    if (challengeModalEl?.classList.contains("open")) closeChallengeModal();
  });
  addRequirementBtn?.addEventListener("click", () => addRequirementField(""));
  challengeClearBtn?.addEventListener("click", clearChallengeModal);
  challengeSaveBtn?.addEventListener("click", publishChallenge);
}

function bindInteractions() {
  proofSubmitBtn?.addEventListener("click", submitProof);
  proofClearBtn?.addEventListener("click", () => {
    if (proofTextEl) proofTextEl.value = "";
    if (proofUrlEl)  proofUrlEl.value  = "";
    proofFormDirty = false;
  });
  proofTextEl?.addEventListener("input", () => { proofFormDirty = true; });
  proofUrlEl?.addEventListener("input",  () => { proofFormDirty = true; });
  openAdminProofPanelBtn?.addEventListener("click", openAdminProofModal);

  commentSendBtn?.addEventListener("click", sendComment);
  commentTextEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendComment();
  });

  challengeDeleteBtn?.addEventListener("click", deleteChallenge);

  // Live search
  challengeSearchEl?.addEventListener("input", (e) => {
    searchQuery = safeText(e.target.value);
    renderChallengeList();
  });
}

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
function init() {
  ensureRequirementField();
  bindTabs();
  bindModal();
  bindInteractions();
  updateHeroStats();
  setInteractionHints();
  renderChallengeList();
  renderSelectedChallenge();
  startRealtimeChallenges();
  try { window.lucide?.createIcons?.(); } catch {}
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isAdmin     = currentUser ? await checkAdmin(currentUser) : false;
  updateHeroStats();
  setInteractionHints();
  renderChallengeList();
  renderSelectedChallenge();
});

init();
