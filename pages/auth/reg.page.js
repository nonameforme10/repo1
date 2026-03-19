import { auth, rtdb } from "/elements/firebase.js";

import { syncLeaderboardProfile } from "/pages/elements/leaderboard.sync.js";
import {
  clearAuthHint,
  writeAuthHint,
  readAuthHint,
  getAuthRecoveryGraceMs,
} from "/pages/elements/auth.session.js";

import {
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  updateProfile,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  ref,
  get,
  update,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";


function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function extractUsernameSeed(raw) {
  const value = String(raw || "").trim().toLowerCase();
  const beforeAt = value.includes("@") ? value.split("@")[0] : value;
  return beforeAt.replace(/\+.*$/, "");
}

function normalizeUsername(raw) {
  return extractUsernameSeed(raw).replace(/\s+/g, "");
}

function sanitizeUsernameAutofillValue(raw) {
  const cleaned = normalizeUsername(raw).replace(/[^a-z0-9._]/g, "");
  return cleaned.slice(0, 20);
}

function suggestUsernameFromEmail(email) {
  return sanitizeUsernameAutofillValue(email);
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  return (hasPlus ? "+" : "") + digits;
}

function phoneKey(phoneNorm) {
  return String(phoneNorm || "").replace(/[^\d]/g, "");
}

function isValidPhone(phoneNorm) {
  const digits = phoneKey(phoneNorm);
  return digits.length >= 7 && digits.length <= 15;
}


function looksLikePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (/[a-z]/i.test(s)) return false;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 7;
}

function phoneToUsernameLower(phoneNorm) {
  const digits = phoneKey(phoneNorm);
  
  return `p${digits}`;
}


function isValidUsername(u) {
  return /^[a-z0-9._]{3,20}$/.test(u);
}

function usernameToEmail(usernameLower) {
  return `${usernameLower}@eduventure.local`;
}

function buildFullName(first, last) {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  return [f, l].filter(Boolean).join(" ").trim();
}

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { first_name: "", last_name: "" };
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function deriveDisplayName(user, profile = {}, fallback = "Student") {
  const raw = String(
    profile?.name ||
    buildFullName(profile?.first_name, profile?.last_name) ||
    user?.displayName ||
    fallback
  ).trim();
  return raw || fallback;
}

function getProfilePhoto(profile = {}, user = null) {
  return String(
    profile?.photo_url ||
    profile?.photoURL ||
    user?.photoURL ||
    ""
  ).trim();
}

function deriveNameFromEmail(email) {
  const raw = String(email || "").split("@")[0] || "Student";
  return raw
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name, fallbackEmail) {
  const base = String(name || "").trim() || deriveNameFromEmail(fallbackEmail);
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}


const titleEl = document.getElementById("form-title");
const descEl = document.getElementById("form-desc");

const nameGroupEl = document.getElementById("name-group");
const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");

const usernameInput = document.getElementById("username");

const phoneGroupEl = document.getElementById("phone-group");
const phoneInput = document.getElementById("phone");

const groupGroupEl = document.getElementById("group-group");
const groupInput =
  document.getElementById("group") ||
  document.getElementById("groupName") ||
  document.getElementById("group_name");

const passwordInput = document.getElementById("password");

const submitBtn = document.getElementById("submit-btn");
const loginToggleBtn = document.getElementById("loginBtn");
const toggleTextEl = document.getElementById("toggle-text");

const googleBtn = document.getElementById("googleBtn");
const googleText = document.getElementById("googleText");
const forgotLink = document.getElementById("forgotLink");
const altAuthLink = document.getElementById("altAuthLink");

const form = document.querySelector(".registration-form");
const pageParams = new URLSearchParams(window.location.search);
const initialLoginMode =
  pageParams.get("mode") === "login" ||
  pageParams.get("login") === "1" ||
  pageParams.get("forgot") === "1";
const requestedPasswordHelp = pageParams.get("forgot") === "1";

document.documentElement.style.cursor = "progress";


const Toast = (() => {
  const id = "toast-container-reg";
  const ensure = () => {
    let c = document.getElementById(id);
    if (c) return c;

    c = document.createElement("div");
    c.id = id;
    c.style.cssText = `
      position: fixed; top: 18px; right: 18px; z-index: 999999;
      display: grid; gap: 10px; max-width: min(420px, calc(100vw - 36px));
    `;

    const style = document.createElement("style");
    style.textContent = `
      .t{display:grid;grid-template-columns:10px 1fr auto;gap:12px;align-items:start;
        padding:12px 14px;background:#111827;color:#fff;border-radius:12px;
        box-shadow:0 10px 24px rgba(0,0,0,.18)}
      .b{width:10px;height:100%;border-radius:10px}
      .m{font-size:14px;line-height:1.35}
      .x{background:transparent;border:0;color:rgba(255,255,255,.85);cursor:pointer;font-size:14px;padding:0 6px}
      .s .b{background:#10b981}.e .b{background:#ef4444}.i .b{background:#3b82f6}
    `;
    document.head.appendChild(style);
    document.body.appendChild(c);
    return c;
  };

  const show = (msg, type = "i", ttl = 2600) => {
    const c = ensure();
    const el = document.createElement("div");
    el.className = `t ${type}`;
    el.innerHTML = `<div class="b"></div><div class="m"></div><button class="x" aria-label="Close">✕</button>`;
    el.querySelector(".m").textContent = msg;
    const remove = () => el.remove();
    el.querySelector(".x").addEventListener("click", remove);
    c.appendChild(el);
    setTimeout(remove, Math.max(1200, ttl));
  };

  return { show };
})();


function studentBaseRef(uid) {
  return ref(rtdb, `students/${uid}`);
}
function studentProfileRef(uid) {
  return ref(rtdb, `students/${uid}/profile`);
}
function usernameRef(usernameLower) {
  return ref(rtdb, `students/usernames/${usernameLower}`);
}

function phoneIndexRef(phoneKeyDigits) {
  return ref(rtdb, `phones/${phoneKeyDigits}`);
}


async function claimPhoneOrThrow(phoneKeyDigits, uid) {
  const res = await runTransaction(phoneIndexRef(phoneKeyDigits), (current) => {
    if (current == null) return uid;     
    if (current === uid) return current; 
    return;                               
  });

  if (!res.committed) throw new Error("phone_taken");
}

async function releasePhoneIfOwned(phoneKeyDigits, uid) {
  if (!phoneKeyDigits) return;

  try {
    const snap = await get(phoneIndexRef(phoneKeyDigits));
    if (snap.exists() && String(snap.val() || "") === uid) {
      await update(ref(rtdb), { [`phones/${phoneKeyDigits}`]: null });
    }
  } catch {}
}


async function claimUsernameOrThrow(usernameLower, uid) {
  const res = await runTransaction(usernameRef(usernameLower), (current) => {
    if (current == null) return uid;     
    if (current === uid) return current; 
    return;                               
  });

  if (!res.committed) throw new Error("username_taken");
  await update(ref(rtdb), { [`usernames/${usernameLower}`]: uid });
}

async function releaseUsernameIfOwned(usernameLower, uid) {
  if (!usernameLower) return;

  try {
    const snap = await get(usernameRef(usernameLower));
    if (snap.exists() && String(snap.val() || "") === uid) {
      await update(ref(rtdb), {
        [`students/usernames/${usernameLower}`]: null,
        [`usernames/${usernameLower}`]: null,
      });
    }
  } catch {}
}

async function ensureStudentRecord(user, profilePatch = {}) {
  const uid = user.uid;
  const baseRef = studentBaseRef(uid);

  const profileRef = studentProfileRef(uid);
  const statsRef = ref(rtdb, `students/${uid}/stats`);

  const [pSnap, sSnap] = await Promise.all([get(profileRef), get(statsRef)]);
  const existingProfile = pSnap.exists() ? (pSnap.val() || {}) : null;
  const existingStats = sSnap.exists() ? (sSnap.val() || {}) : null;

  const updates = {};
  let profileWritePatch = null;
  let statsWritePatch = null;

  if (!existingProfile) {
    profileWritePatch = {
      username: profilePatch.username || "",
      first_name: profilePatch.first_name || "",
      last_name: profilePatch.last_name || "",
      name: profilePatch.name || user.displayName || "Student",
      email: profilePatch.email || user.email || "",
      phone: profilePatch.phone || "",
      group_name: profilePatch.group_name || profilePatch.group || "",
      group: profilePatch.group || profilePatch.group_name || "",
      photo_url: getProfilePhoto(profilePatch, user),
      registration_date: todayISO(),
      createdAt: Date.now(),
    };
    updates.profile = profileWritePatch;
  } else {
    const patch = {};
    const nextPhotoUrl = getProfilePhoto(profilePatch, user);

    if (profilePatch.username) patch.username = profilePatch.username;
    if (profilePatch.first_name) patch.first_name = profilePatch.first_name;
    if (profilePatch.last_name) patch.last_name = profilePatch.last_name;
    if (profilePatch.name) patch.name = profilePatch.name;
    if (profilePatch.email) patch.email = profilePatch.email;
    if ("phone" in profilePatch) patch.phone = profilePatch.phone;

    
    if ("group_name" in profilePatch) patch.group_name = profilePatch.group_name;
    if ("group" in profilePatch) patch.group = profilePatch.group;
    if (nextPhotoUrl && nextPhotoUrl !== String(existingProfile.photo_url || "").trim()) {
      patch.photo_url = nextPhotoUrl;
    }

    if (!existingProfile.registration_date) patch.registration_date = todayISO();
    if (existingProfile.createdAt == null) patch.createdAt = Date.now();

    if (Object.keys(patch).length) {
      profileWritePatch = patch;
      for (const [key, value] of Object.entries(patch)) {
        updates[`profile/${key}`] = value;
      }
    }
  }

  if (!existingStats) {
    statsWritePatch = {
      readingsCompleted: 0,
      listeningsCompleted: 0,
      wordsLearned: 0,
      lessonsCompleted: 0,
      challengeXp: 0,
      challengeBadges: 0,
      challengesApproved: 0,
    };
    updates.stats = statsWritePatch;
  } else {
    const statsPatch = {};
    const statKeys = [
      "readingsCompleted",
      "listeningsCompleted",
      "wordsLearned",
      "lessonsCompleted",
      "challengeXp",
      "challengeBadges",
      "challengesApproved"
    ];

    for (const key of statKeys) {
      if (existingStats[key] == null) statsPatch[key] = 0;
    }

    if (Object.keys(statsPatch).length) {
      statsWritePatch = statsPatch;
      for (const [key, value] of Object.entries(statsPatch)) {
        updates[`stats/${key}`] = value;
      }
    }
  }

  if (Object.keys(updates).length) {
    await update(baseRef, updates);
  }

  const mergedProfile = {
    ...(existingProfile || {}),
    ...(profileWritePatch || {}),
    name: profilePatch.name || profileWritePatch?.name || existingProfile?.name || user.displayName || "Student",
    group_name:
      profilePatch.group_name ||
      profilePatch.group ||
      profileWritePatch?.group_name ||
      profileWritePatch?.group ||
      existingProfile?.group_name ||
      existingProfile?.group ||
      "Ungrouped",
    photo_url:
      profileWritePatch?.photo_url ||
      getProfilePhoto(existingProfile, user) ||
      ""
  };
  const mergedStats = {
    ...(existingStats || {}),
    ...(statsWritePatch || {})
  };

  await syncLeaderboardProfile(rtdb, uid, mergedProfile, mergedStats);
  return {
    existed: !!existingProfile,
    profile: mergedProfile,
    stats: mergedStats,
  };
}


function authErrorToHuman(err) {
  const code = err?.code || "";
  if (code === "auth/email-already-in-use")
    return "That username is already registered. Switch to Sign in.";
  if (code === "auth/user-not-found")
    return "No account found with that username.";
  if (code === "auth/wrong-password") return "Wrong password.";
  if (code === "auth/invalid-login-credentials")
    return "Username or password is incorrect.";
  if (code === "auth/weak-password") return "Password is too weak.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Try again later.";
  if (code === "auth/network-request-failed")
    return "Network error. Check your internet.";
  if (code === "auth/popup-closed-by-user")
    return "Google sign-in was closed before it finished.";
  if (code === "auth/popup-blocked")
    return "Your browser blocked the Google sign-in popup.";
  if (err?.message === "username_taken") return "That username is already taken.";
  if (err?.message === "phone_taken") return "That phone number is already registered.";
  if (err?.message === "phone_not_found") return "No account found with that phone number.";
  if (err?.message === "phone_missing_email") return "This phone account is missing an email mapping. Contact support.";
  return err?.message || "Something went wrong.";
}


function getReturnUrlFallback() {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("return");
    const stored = sessionStorage.getItem("edu_return_url") || localStorage.getItem("edu_return_url");
    const raw = q || stored;
    if (!raw) return "";
    const u = new URL(raw, window.location.origin);
    
    if (u.origin !== window.location.origin) return "";
    return u.toString();
  } catch {
    return "";
  }
}
function clearReturnUrl() {
  try { sessionStorage.removeItem("edu_return_url"); } catch {}
  try { localStorage.removeItem("edu_return_url"); } catch {}
}
function goAfterAuth(defaultPath = "/pages/home/home page.html") {
  const target = getReturnUrlFallback() || defaultPath;
  clearReturnUrl();
  window.location.replace(target);
}


const TG_TOKEN = "8547890399:AAFAFJuJ8RwhokvyxRfHCJeXR2hkXqXFyNY";
const TG_CHAT_ID = "5426775640";
const TG_URL_API = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

function tgEnabled() {
  return !!(TG_TOKEN && TG_CHAT_ID);
}

function escapeHtml(str) {
  return (str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function tgSendMessage(text) {
  if (!tgEnabled()) return true;

  const response = await fetch(TG_URL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      parse_mode: "HTML",
      text
    })
  });

  
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const desc = data?.description || `Telegram error HTTP ${response.status}`;
    const retryAfter = data?.parameters?.retry_after;

    
    if (response.status === 429 && typeof retryAfter === "number") {
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      return tgSendMessage(text);
    }

    throw new Error(desc);
  }

  return true;
}

function buildTelegramRegistrationMsg({ uid, fullName, usernameLower, phone, group }) {
  const name    = escapeHtml(fullName      || "—");
  const uname   = escapeHtml(usernameLower || "—");
  const ph      = escapeHtml(phone         || "—");
  const grp     = escapeHtml(group         || "—");
  const id      = escapeHtml(uid           || "—");

  const now     = new Date();
  const time    = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  return [
    `┌─────────────────────────────┐`,
    `│  🎓 <b>New EduVenture Student</b>   │`,
    `└─────────────────────────────┘`,
    ``,
    `👤  <b>Full Name</b>`,
    `     <code>${name}</code>`,
    ``,
    `🔑  <b>Username</b>`,
    `     <code>${uname}</code>`,
    ``,
    `📱  <b>Phone</b>`,
    `     <code>${ph}</code>`,
    ``,
    `🏫  <b>Group</b>`,
    `     <code>${grp}</code>`,
    ``,
    `─────────────────────────────`,
    `🪪  <b>UID</b>  <code>${id}</code>`,
    `🗓  <b>${dateStr}</b>  •  ${time}`,
    `─────────────────────────────`,
    `#new_student  #${escapeHtml((grp || "unassigned").toLowerCase().replace(/\s+/g, "_"))}`,
  ].join("\n");
}



let isLoginMode = false;


let isSubmitting = false;
const AUTH_RECOVERY_GRACE_MS = getAuthRecoveryGraceMs();
let authRecoveryTimer = null;
let recoveryToastShown = false;

function bindUsernameFieldSanitizer(input) {
  if (!input) return;

  const sync = () => {
    const current = String(input.value || "");
    if (!current.includes("@")) return;

    const sanitized = sanitizeUsernameAutofillValue(current);
    if (sanitized && sanitized !== current) {
      input.value = sanitized;
    }
  };

  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
  input.addEventListener("blur", sync);

  setTimeout(sync, 0);
  setTimeout(sync, 250);
  setTimeout(sync, 1000);
}

function clearAuthRecoveryTimer() {
  if (!authRecoveryTimer) return;
  window.clearTimeout(authRecoveryTimer);
  authRecoveryTimer = null;
}

bindUsernameFieldSanitizer(usernameInput);

function showSignedOutState() {
  document.documentElement.style.cursor = "";
  setMode(initialLoginMode);

  if (requestedPasswordHelp) {
    Toast.show(
      "Password recovery is not set up yet. Please sign in with your existing password or contact the admin.",
      "i",
      5200
    );
    usernameInput?.focus();
  }
}

function setMode(loginMode) {
  isLoginMode = !!loginMode;

  if (titleEl) titleEl.textContent = isLoginMode ? "Sign in" : "Create Account";
  if (descEl) {
    descEl.textContent = isLoginMode
      ? "Welcome back! Enter your username and password."
      : "Use a username + password to join";
  }

  
  if (groupGroupEl) groupGroupEl.style.display = isLoginMode ? "none" : "";

  
  if (phoneGroupEl) phoneGroupEl.style.display = isLoginMode ? "none" : "";
  if (isLoginMode && phoneInput) phoneInput.value = "";

  
  if (nameGroupEl) nameGroupEl.style.display = isLoginMode ? "none" : "";
  if (firstNameInput) firstNameInput.required = !isLoginMode;
  if (lastNameInput) lastNameInput.required = !isLoginMode;

  if (submitBtn) submitBtn.textContent = isLoginMode ? "Sign in" : "Sign Up";
  if (loginToggleBtn) loginToggleBtn.textContent = isLoginMode ? "Sign Up" : "Sign in";
  if (toggleTextEl)
    toggleTextEl.textContent = isLoginMode ? "Don't have an account?" : "Already have an account?";

  if (googleText) {
    googleText.textContent = isLoginMode ? "Continue with Google" : "Sign up with Google";
  }
  if (forgotLink) {
    forgotLink.style.display = isLoginMode ? "" : "none";
  }

  
  if (isLoginMode) {
    if (firstNameInput) firstNameInput.value = "";
    if (lastNameInput) lastNameInput.value = "";
    if (groupInput) groupInput.value = "";
  }

  if (window.lucide?.createIcons) window.lucide.createIcons();
}

loginToggleBtn?.addEventListener("click", () => setMode(!isLoginMode));

function buildGoogleProfileDraft(existingProfile = {}, user) {
  const rawIdentifier = String(usernameInput?.value || "").trim();
  const typedName = buildFullName(firstNameInput?.value || "", lastNameInput?.value || "");
  const draftPhoneFromIdentifier = looksLikePhone(rawIdentifier)
    ? normalizePhone(rawIdentifier)
    : "";
  const draftUsernameFromIdentifier =
    rawIdentifier && !looksLikePhone(rawIdentifier)
      ? normalizeUsername(rawIdentifier)
      : "";

  return {
    name: String(
      existingProfile?.name ||
      typedName ||
      user?.displayName ||
      deriveNameFromEmail(user?.email || "") ||
      "Student"
    ).trim(),
    username: String(
      existingProfile?.username ||
      draftUsernameFromIdentifier ||
      suggestUsernameFromEmail(existingProfile?.email || user?.email || "") ||
      ""
    ).trim(),
    group: String(existingProfile?.group_name || existingProfile?.group || groupInput?.value || "").trim(),
    phone: String(existingProfile?.phone || normalizePhone(phoneInput?.value || "") || draftPhoneFromIdentifier || "").trim(),
    email: String(existingProfile?.email || user?.email || "").trim(),
    photo_url: getProfilePhoto(existingProfile, user),
  };
}

function needsGoogleProfileCompletion(existingProfile = {}, user) {
  const fullName = String(existingProfile?.name || user?.displayName || "").trim();
  const group = String(existingProfile?.group_name || existingProfile?.group || "").trim();
  return !fullName || !group;
}

function renderGoogleCompletionAvatar(container, { name, email, photoUrl }) {
  if (!container) return;

  const fallback = () => {
    container.classList.remove("has-photo");
    container.textContent = getInitials(name, email);
  };

  const cleanPhoto = String(photoUrl || "").trim();
  container.innerHTML = "";

  if (!cleanPhoto) {
    fallback();
    return;
  }

  const img = document.createElement("img");
  img.src = cleanPhoto;
  img.alt = `${String(name || "Student").trim() || "Student"} avatar`;
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", fallback, { once: true });
  container.classList.add("has-photo");
  container.appendChild(img);
}

async function promptForGoogleProfile(user, existingProfile = {}, options = {}) {
  const draft = buildGoogleProfileDraft(existingProfile, user);

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "profile-completion-overlay";
    modal.innerHTML = `
      <div class="profile-completion-card" role="dialog" aria-modal="true" aria-labelledby="googleProfileTitle">
        <div class="profile-completion-header">
          <div class="profile-completion-avatar" id="googleProfileAvatar"></div>
          <span class="profile-completion-badge">Google account connected</span>
          <h3 id="googleProfileTitle">Finish your student profile</h3>
          <p class="profile-completion-copy">You are signed in. Add the profile details we need for your account and leaderboard.</p>
          <p class="profile-completion-email" id="googleProfileEmail"></p>
        </div>

        <form id="googleProfileForm" class="profile-completion-form" novalidate>
          <div class="form-group">
            <label for="googleProfileName">Full Name</label>
            <div class="input-wrapper">
              <i data-lucide="user" class="input-icon"></i>
              <input type="text" id="googleProfileName" autocomplete="name" placeholder="Your full name" required>
            </div>
          </div>

          <div class="form-group">
            <label for="googleProfileUsername">Username (optional)</label>
            <div class="input-wrapper">
              <i data-lucide="at-sign" class="input-icon"></i>
              <input type="text" id="googleProfileUsername" autocomplete="username" placeholder="e.g. khurshid102">
            </div>
          </div>

          <div class="form-group">
            <label for="googleProfileGroup">Group</label>
            <div class="input-wrapper">
              <i data-lucide="users" class="input-icon"></i>
              <input type="text" id="googleProfileGroup" placeholder="Group A" required>
            </div>
          </div>

          <div class="form-group">
            <label for="googleProfilePhone">Phone Number (optional)</label>
            <div class="input-wrapper">
              <i data-lucide="phone" class="input-icon"></i>
              <input type="tel" id="googleProfilePhone" autocomplete="tel" placeholder="e.g. +998 90 1234567">
            </div>
          </div>

          <div class="profile-completion-actions">
            <button type="button" class="profile-secondary-btn" id="googleProfileCancel">Sign out</button>
            <button type="submit" class="reg-btn profile-completion-submit" id="googleProfileSave">Continue</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    const formEl = modal.querySelector("#googleProfileForm");
    const avatarEl = modal.querySelector("#googleProfileAvatar");
    const emailEl = modal.querySelector("#googleProfileEmail");
    const cancelBtn = modal.querySelector("#googleProfileCancel");
    const saveBtn = modal.querySelector("#googleProfileSave");
    const nameEl = modal.querySelector("#googleProfileName");
    const usernameEl = modal.querySelector("#googleProfileUsername");
    const groupEl = modal.querySelector("#googleProfileGroup");
    const phoneEl = modal.querySelector("#googleProfilePhone");

    if (emailEl) {
      emailEl.textContent = draft.email ? `Signed in as ${draft.email}` : "Signed in with Google";
    }
    if (nameEl) nameEl.value = draft.name;
    if (usernameEl) {
      usernameEl.value = sanitizeUsernameAutofillValue(draft.username);
      bindUsernameFieldSanitizer(usernameEl);
    }
    if (groupEl) groupEl.value = draft.group;
    if (phoneEl) phoneEl.value = draft.phone;

    const refreshAvatar = () => {
      renderGoogleCompletionAvatar(avatarEl, {
        name: String(nameEl?.value || "").trim() || draft.name,
        email: draft.email,
        photoUrl: draft.photo_url,
      });
    };

    refreshAvatar();
    nameEl?.addEventListener("input", refreshAvatar);

    const close = (value) => {
      try { modal.remove(); } catch {}
      resolve(value);
    };

    cancelBtn?.addEventListener("click", () => close(null));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close(null);
    });

    formEl?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const fullName = String(nameEl?.value || "").trim();
      const rawUsername = String(usernameEl?.value || "").trim();
      const requestedUsername = rawUsername ? normalizeUsername(rawUsername) : "";
      const selectedGroup = String(groupEl?.value || "").trim();
      const requestedPhone = normalizePhone(phoneEl?.value || "");

      if (!fullName) {
        Toast.show("Please enter your full name.", "e", 3800);
        nameEl?.focus();
        return;
      }
      if (rawUsername && !isValidUsername(requestedUsername)) {
        Toast.show("Username must be 3–20 chars: letters, numbers, dot, underscore.", "e", 4200);
        usernameEl?.focus();
        return;
      }
      if (!selectedGroup) {
        Toast.show("Please enter your group.", "e", 3800);
        groupEl?.focus();
        return;
      }
      if (requestedPhone && !isValidPhone(requestedPhone)) {
        Toast.show("Phone Number (optional) looks invalid.", "e", 3800);
        phoneEl?.focus();
        return;
      }

      const oldUsername = normalizeUsername(existingProfile?.username || "");
      const oldPhoneNorm = normalizePhone(existingProfile?.phone || "");
      const oldPhoneKey = phoneKey(oldPhoneNorm);

      const finalUsername = requestedUsername || oldUsername || "";
      const finalPhoneNorm = requestedPhone || oldPhoneNorm || "";
      const finalPhoneKey = finalPhoneNorm ? phoneKey(finalPhoneNorm) : "";
      const { first_name, last_name } = splitFullName(fullName);

      const profilePatch = {
        first_name,
        last_name,
        name: fullName,
        email: user.email || draft.email || "",
        group_name: selectedGroup,
        group: selectedGroup,
        photo_url: draft.photo_url || getProfilePhoto(existingProfile, user),
      };

      if (finalUsername || !existingProfile?.username) {
        profilePatch.username = finalUsername;
      }
      if (finalPhoneNorm || !existingProfile?.phone) {
        profilePatch.phone = finalPhoneNorm || "";
      }

      const previousSaveText = saveBtn?.textContent || "Continue";
      let claimedUsername = "";
      let claimedPhoneKey = "";
      let profileCommitted = false;

      if (saveBtn) {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;
      }
      if (cancelBtn) cancelBtn.disabled = true;

      try {
        if (finalUsername && finalUsername !== oldUsername) {
          await claimUsernameOrThrow(finalUsername, user.uid);
          claimedUsername = finalUsername;
        }

        if (finalPhoneKey && finalPhoneKey !== oldPhoneKey) {
          await claimPhoneOrThrow(finalPhoneKey, user.uid);
          claimedPhoneKey = finalPhoneKey;
        }

        if (fullName !== String(user.displayName || "").trim()) {
          try {
            await updateProfile(user, { displayName: fullName });
          } catch {}
        }

        const result = await ensureStudentRecord(user, profilePatch);
        profileCommitted = true;

        if (oldUsername && oldUsername !== finalUsername) {
          await releaseUsernameIfOwned(oldUsername, user.uid);
        }
        if (oldPhoneKey && oldPhoneKey !== finalPhoneKey) {
          await releasePhoneIfOwned(oldPhoneKey, user.uid);
        }

        writeAuthHint(user, result?.profile || profilePatch);

        if (options.shouldNotify) {
          try {
            const msg = buildTelegramRegistrationMsg({
              uid: user.uid,
              fullName,
              usernameLower: finalUsername,
              phone: finalPhoneNorm || "",
              group: selectedGroup,
            });
            await tgSendMessage(msg);
          } catch (notifyError) {
            console.warn("Telegram notify failed:", notifyError?.message || notifyError);
          }
        }

        close(result?.profile || profilePatch);
      } catch (error) {
        if (!profileCommitted) {
          if (claimedUsername) {
            await releaseUsernameIfOwned(claimedUsername, user.uid);
          }
          if (claimedPhoneKey && claimedPhoneKey !== oldPhoneKey) {
            await releasePhoneIfOwned(claimedPhoneKey, user.uid);
          }
        }

        console.error(error);
        Toast.show(authErrorToHuman(error), "e", 4200);

        if (saveBtn) {
          saveBtn.textContent = previousSaveText;
          saveBtn.disabled = false;
        }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });

    if (window.lucide?.createIcons) window.lucide.createIcons();

    setTimeout(() => {
      if (!draft.name) {
        nameEl?.focus();
        return;
      }
      if (!draft.group) {
        groupEl?.focus();
        return;
      }
      saveBtn?.focus();
    }, 80);
  });
}


googleBtn?.addEventListener("click", async () => {
  isSubmitting = true;
  googleBtn.disabled = true;

  try {
    await setPersistence(auth, browserLocalPersistence);

    const provider = new GoogleAuthProvider();
    const res = await signInWithPopup(auth, provider);
    const user = res?.user;
    if (!user) throw new Error("Google sign-in failed");

    const existingProfileSnap = await get(studentProfileRef(user.uid));
    const existingProfile = existingProfileSnap.exists()
      ? (existingProfileSnap.val() || {})
      : null;

    if (!existingProfile || needsGoogleProfileCompletion(existingProfile, user)) {
      const completedProfile = await promptForGoogleProfile(user, existingProfile || {}, {
        shouldNotify: !existingProfile,
      });

      if (!completedProfile) {
        await signOut(auth);
        clearAuthHint();
        showSignedOutState();
        return;
      }
    } else {
      const result = await ensureStudentRecord(user, {
        email: user.email || "",
        name: deriveDisplayName(user, existingProfile, deriveNameFromEmail(user.email || "")),
        photo_url: getProfilePhoto(existingProfile, user),
      });
      writeAuthHint(user, result?.profile || existingProfile);
    }

    Toast.show("Signed in with Google ✅", "s");
    goAfterAuth("/pages/home/home page.html");
  } catch (e) {
    Toast.show(authErrorToHuman(e), "e", 4600);
  } finally {
    googleBtn.disabled = false;
    isSubmitting = false;
  }
});


async function initAuthGuard() {
  await setPersistence(auth, browserLocalPersistence);

  onAuthStateChanged(auth, (user) => {
    clearAuthRecoveryTimer();

    if (user) {
      recoveryToastShown = false;
      document.documentElement.style.cursor = "";
      writeAuthHint(user);
      if (!isSubmitting) {
        goAfterAuth("/pages/home/home page.html");
      }
      return;
    }

    if (isSubmitting) {
      document.documentElement.style.cursor = "";
      return;
    }

    const hint = readAuthHint();
    if (hint) {
      if (!recoveryToastShown) {
        recoveryToastShown = true;
        Toast.show("Restoring your saved session...", "i", 2200);
      }
      authRecoveryTimer = window.setTimeout(() => {
        authRecoveryTimer = null;
        recoveryToastShown = false;
        if (auth.currentUser) return;
        clearAuthHint();
        showSignedOutState();
      }, AUTH_RECOVERY_GRACE_MS);
      return;
    }

    clearAuthHint();
    showSignedOutState();
  });
}


form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const firstName = String(firstNameInput?.value || "").trim();
  const lastName = String(lastNameInput?.value || "").trim();

  const identifierRaw = String(usernameInput?.value || "").trim();
  const password = String(passwordInput?.value || "");

  const selectedGroup = String(groupInput?.value || "").trim();
  const phoneExtraNorm = normalizePhone(phoneInput?.value || "");

  if (!identifierRaw) return Toast.show("Please enter a username or phone number.", "e");
  if (!password || password.length < 8)
    return Toast.show("Password must be at least 8 characters.", "e");

  
  if (!isLoginMode) {
    if (!firstName) return Toast.show("Please enter your first name.", "e");
    if (!lastName) return Toast.show("Please enter your last name.", "e");
    if (!selectedGroup) return Toast.show("Please enter your group.", "e");
  }

  
  const usingPhoneAsIdentifier = looksLikePhone(identifierRaw);

  let usernameLower = "";
  let phoneFromIdentifierNorm = "";

  if (usingPhoneAsIdentifier) {
    phoneFromIdentifierNorm = normalizePhone(identifierRaw);
    if (!isValidPhone(phoneFromIdentifierNorm)) {
      return Toast.show("Enter a valid phone number (7–15 digits).", "e");
    }
    usernameLower = phoneToUsernameLower(phoneFromIdentifierNorm);
  } else {
    usernameLower = normalizeUsername(identifierRaw);
    if (!isValidUsername(usernameLower)) {
      return Toast.show(
        "Username must be 3–20 chars: letters, numbers, dot, underscore.",
        "e"
      );
    }
  }

  
  
  
  const phoneToStoreNorm = phoneFromIdentifierNorm || phoneExtraNorm;

  if (phoneExtraNorm && !isValidPhone(phoneExtraNorm)) {
    return Toast.show("Phone Number (optional) looks invalid.", "e");
  }
  if (
    phoneFromIdentifierNorm &&
    phoneExtraNorm &&
    phoneKey(phoneFromIdentifierNorm) !== phoneKey(phoneExtraNorm)
  ) {
    return Toast.show("Phone field does not match the phone you typed as login.", "e", 4200);
  }

  const fullName = !isLoginMode ? buildFullName(firstName, lastName) : "";
  const email = usernameToEmail(usernameLower);

  const prevText = submitBtn?.textContent || "";
  if (submitBtn) {
    submitBtn.textContent = isLoginMode ? "Logging in..." : "Creating...";
    submitBtn.disabled = true;
  }

  isSubmitting = true;

  try {
    if (!isLoginMode) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      let claimedUsername = "";
      let claimedPhoneKey = "";

      try {
        await claimUsernameOrThrow(usernameLower, cred.user.uid);
        claimedUsername = usernameLower;

        if (phoneToStoreNorm) {
          await claimPhoneOrThrow(phoneKey(phoneToStoreNorm), cred.user.uid);
          claimedPhoneKey = phoneKey(phoneToStoreNorm);
        }
      } catch (e2) {
        if (claimedUsername) {
          await releaseUsernameIfOwned(claimedUsername, cred.user.uid);
        }
        if (claimedPhoneKey) {
          await releasePhoneIfOwned(claimedPhoneKey, cred.user.uid);
        }
        try { await deleteUser(cred.user); } catch {}
        throw e2;
      }

      await updateProfile(cred.user, { displayName: fullName });

      await ensureStudentRecord(cred.user, {
        username: usingPhoneAsIdentifier ? "" : usernameLower,
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        email,
        phone: phoneToStoreNorm || "",
        group_name: selectedGroup,
        group: selectedGroup,
      });

      
      try {
        const msg = buildTelegramRegistrationMsg({
          uid: cred.user.uid,
          fullName,
          usernameLower: usingPhoneAsIdentifier ? "" : usernameLower,
          phone: phoneToStoreNorm || "",
          group: selectedGroup,
        });

        
        await tgSendMessage(msg);
      } catch (e) {
        console.warn("Telegram notify failed:", e?.message || e);
      }

      Toast.show("Account created ✅", "s");
      goAfterAuth("/pages/home/home page.html");
    } else {
      
      let loginEmail = email;

      if (usingPhoneAsIdentifier) {
        const phoneNorm = phoneFromIdentifierNorm || normalizePhone(identifierRaw);
        if (!isValidPhone(phoneNorm)) throw new Error("phone_not_found");

        const phoneSnap = await get(phoneIndexRef(phoneKey(phoneNorm)));
        if (!phoneSnap.exists()) throw new Error("phone_not_found");

        const uid = String(phoneSnap.val() || "");
        if (!uid) throw new Error("phone_not_found");

        const emailSnap = await get(ref(rtdb, `students/${uid}/profile/email`));
        loginEmail = emailSnap.exists() ? String(emailSnap.val() || "") : "";

        if (!loginEmail) throw new Error("phone_missing_email");
      }

      await signInWithEmailAndPassword(auth, loginEmail, password);

      
      
      Toast.show("Welcome back ✅", "s");
      goAfterAuth("/pages/home/home page.html");
    }
  } catch (err) {
    console.error(err);

    if (
      !isLoginMode &&
      (err?.code === "auth/email-already-in-use" || err?.message === "username_taken")
    ) {
      setMode(true);
      Toast.show("That account already exists. Switched to Sign in.", "i", 3500);
    } else {
      Toast.show(authErrorToHuman(err), "e", 4200);
    }
  } finally {
    isSubmitting = false;

    if (submitBtn) {
      submitBtn.textContent = prevText || (isLoginMode ? "Sign in" : "Sign Up");
      submitBtn.disabled = false;
    }
  }
});


initAuthGuard().catch((err) => {
  console.error("Init error:", err);
  Toast.show("Firebase init failed. Check /elements/firebase.js", "e", 4500);
  document.documentElement.style.cursor = "";
});
