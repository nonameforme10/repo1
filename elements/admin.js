import { db, ref, get } from "/elements/firebase.js";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function checkAdminAccess(userOrUid) {
  const uid = typeof userOrUid === "string"
    ? cleanString(userOrUid)
    : cleanString(userOrUid?.uid);

  if (!uid) return false;

  try {
    const snap = await get(ref(db, `admins/${uid}`));
    return snap.exists() && snap.val() === true;
  } catch {
    return false;
  }
}
