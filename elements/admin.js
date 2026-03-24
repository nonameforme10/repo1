import { db, firestore, ref, get } from "/elements/firebase.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function checkAdminAccess(userOrUid) {
  const uid = typeof userOrUid === "string"
    ? cleanString(userOrUid)
    : cleanString(userOrUid?.uid);

  if (!uid) return false;

  try {
    const firestoreSnap = await getDoc(doc(firestore, "admins", uid));
    if (firestoreSnap.exists() && firestoreSnap.data()?.active === true) {
      return true;
    }

    const snap = await get(ref(db, `admins/${uid}`));
    const isAdmin = snap.exists() && snap.val() === true;

    if (isAdmin) {
      try {
        await setDoc(
          doc(firestore, "admins", uid),
          {
            active: true,
            syncedFrom: "rtdb",
            syncedAtMs: Date.now(),
          },
          { merge: true }
        );
      } catch {}
    }

    return isAdmin;
  } catch {
    return false;
  }
}
