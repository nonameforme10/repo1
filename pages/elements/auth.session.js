const AUTH_HINT_KEY = "eduventure_auth_hint_v1";
const AUTH_HINT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const AUTH_RECOVERY_GRACE_MS = 3500;

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function clearAuthHint() {
  safeRemove(AUTH_HINT_KEY);
}

export function readAuthHint() {
  const raw = safeGet(AUTH_HINT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      clearAuthHint();
      return null;
    }

    const updatedAt = Number(parsed.updatedAt || 0);
    if (!updatedAt || Date.now() - updatedAt > AUTH_HINT_MAX_AGE_MS) {
      clearAuthHint();
      return null;
    }

    return parsed;
  } catch {
    clearAuthHint();
    return null;
  }
}

export function hasRecentAuthHint() {
  return !!readAuthHint();
}

export function getAuthRecoveryGraceMs() {
  return AUTH_RECOVERY_GRACE_MS;
}

export function writeAuthHint(user, profile = {}) {
  const uid = String(user?.uid || "").trim();
  if (!uid) {
    clearAuthHint();
    return null;
  }

  const payload = {
    uid,
    email: String(profile?.email || user?.email || "").trim(),
    name: String(profile?.name || user?.displayName || "").trim(),
    group_name: String(profile?.group_name || profile?.group || "").trim(),
    signedIn: true,
    updatedAt: Date.now(),
  };

  safeSet(AUTH_HINT_KEY, JSON.stringify(payload));
  return payload;
}
