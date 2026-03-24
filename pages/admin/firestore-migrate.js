import { auth, firestore, rtdb } from "/elements/firebase.js";
import { checkAdminAccess } from "/elements/admin.js";
import {
  globalChatMessagesCollection,
  globalChatTypingCollection,
  onlineCommentsCollection,
  onlineModulesCollection,
} from "/elements/firestore-data.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import {
  collection,
  doc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const runBtn = document.getElementById("runMigrationBtn");
const statusBox = document.getElementById("statusBox");
const logBox = document.getElementById("logBox");
const DEFAULT_CLUB_ID = "english";
const DEFAULT_TEACHER_ID = "Abdurahim";

let currentUser = null;
let running = false;

function setStatus(message, type = "") {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = type ? `status ${type}` : "status";
}

function log(message = "") {
  if (!logBox) return;
  const stamp = new Date().toLocaleTimeString("en-GB");
  const line = `[${stamp}] ${message}`;
  logBox.textContent = logBox.textContent === "Migration log will appear here."
    ? line
    : `${logBox.textContent}\n${line}`;
  logBox.scrollTop = logBox.scrollHeight;
}

function sanitizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item));
  }
  if (!value || typeof value !== "object") return value;

  const out = {};
  Object.entries(value).forEach(([key, child]) => {
    if (typeof child === "undefined") return;
    out[key] = sanitizeObject(child);
  });
  return out;
}

function createBatchWriter() {
  let batch = writeBatch(firestore);
  let ops = 0;
  let commitCount = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    commitCount += 1;
    batch = writeBatch(firestore);
    ops = 0;
    log(`Committed Firestore batch ${commitCount}.`);
  }

  async function queueSet(refToWrite, payload, options) {
    batch.set(refToWrite, sanitizeObject(payload), options);
    ops += 1;
    if (ops >= 400) {
      await flush();
    }
  }

  return {
    flush,
    queueSet,
  };
}

async function getRtdbValue(path) {
  const snap = await get(ref(rtdb, path));
  return snap.exists() ? snap.val() : null;
}

async function getRtdbValueSafe(path) {
  try {
    return { value: await getRtdbValue(path), denied: false, error: null };
  } catch (error) {
    const message = String(error?.message || "");
    const denied = /permission denied/i.test(message);
    return { value: null, denied, error };
  }
}

async function migratePhones(writer) {
  const result = await getRtdbValueSafe("phones");
  if (result.denied) {
    log("Skipped phones: RTDB rules block listing /phones. Chat and online can still migrate.");
    log("To migrate phones too, temporarily allow admin read on /phones in RTDB rules, then run this page again.");
    return { skipped: true, reason: "permission-denied" };
  }
  if (result.error) {
    throw result.error;
  }

  const phones = sanitizeObject(result.value || {});
  let count = 0;

  for (const [phoneKey, uid] of Object.entries(phones)) {
    if (!phoneKey || !uid) continue;
    const ts = Date.now();
    await writer.queueSet(doc(firestore, "phones", phoneKey), {
      phoneKey,
      uid: String(uid),
      createdAtMs: ts,
      updatedAtMs: ts,
      migratedFrom: "rtdb",
    });
    count += 1;
  }

  log(`Queued ${count} phone index documents.`);
  return { skipped: false, count };
}

async function migrateGlobalChat(writer) {
  const messages = sanitizeObject((await getRtdbValue("global_chat/messages")) || {});
  const typing = sanitizeObject((await getRtdbValue("global_chat/typing")) || {});
  const hasAnyData = Object.keys(messages).length > 0 || Object.keys(typing).length > 0;

  if (!hasAnyData) {
    log("No RTDB global chat data found.");
    return;
  }

  await writer.queueSet(doc(firestore, "global_chat", "main"), {
    roomId: "main",
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  let messageCount = 0;
  for (const [messageId, payload] of Object.entries(messages)) {
    if (!messageId || !payload || typeof payload !== "object") continue;
    await writer.queueSet(doc(globalChatMessagesCollection(), messageId), {
      ...payload,
      migratedFrom: "rtdb",
    });
    messageCount += 1;
  }

  let typingCount = 0;
  for (const [uid, payload] of Object.entries(typing)) {
    if (!uid || !payload || typeof payload !== "object") continue;
    await writer.queueSet(doc(globalChatTypingCollection(), uid), {
      ...payload,
      uid,
      migratedFrom: "rtdb",
    });
    typingCount += 1;
  }

  log(`Queued ${messageCount} chat messages and ${typingCount} typing documents.`);
}

async function migrateOnline(writer) {
  const clubId = DEFAULT_CLUB_ID;
  const teacherId = DEFAULT_TEACHER_ID;
  const modulesResult = await getRtdbValueSafe(`online/${clubId}/${teacherId}/modules`);
  const commentsResult = await getRtdbValueSafe(`online/${clubId}/${teacherId}/comments`);

  if (modulesResult.error && !modulesResult.denied) throw modulesResult.error;
  if (commentsResult.error && !commentsResult.denied) throw commentsResult.error;

  if (modulesResult.denied) {
    log(`Skipped online modules: RTDB read denied for online/${clubId}/${teacherId}/modules.`);
    return { skipped: true, reason: "permission-denied" };
  }

  await writer.queueSet(doc(firestore, "online", clubId), {
    clubId,
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  await writer.queueSet(doc(collection(doc(firestore, "online", clubId), "teachers"), teacherId), {
    clubId,
    teacherId,
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  let moduleCount = 0;
  let commentCount = 0;
  const modules = sanitizeObject(modulesResult.value || {});
  const commentsByModule = sanitizeObject(commentsResult.value || {});

  for (const [moduleId, payload] of Object.entries(modules)) {
    if (!moduleId || !payload || typeof payload !== "object") continue;
    await writer.queueSet(doc(onlineModulesCollection(clubId, teacherId), moduleId), {
      ...payload,
      migratedFrom: "rtdb",
    });
    moduleCount += 1;
  }

  for (const [moduleId, comments] of Object.entries(commentsByModule)) {
    if (!moduleId || !comments || typeof comments !== "object") continue;
    for (const [commentId, payload] of Object.entries(comments)) {
      if (!commentId || !payload || typeof payload !== "object") continue;
      await writer.queueSet(doc(onlineCommentsCollection(clubId, teacherId, moduleId), commentId), {
        ...payload,
        migratedFrom: "rtdb",
      });
      commentCount += 1;
    }
  }

  log(`Queued ${moduleCount} online modules and ${commentCount} online comments from ${clubId}/${teacherId}.`);
  return { skipped: false, moduleCount, commentCount };
}

async function seedFirestoreAdmins(writer) {
  const result = await getRtdbValueSafe("admins");
  if (result.error && !result.denied) throw result.error;

  const admins = sanitizeObject(result.value || {});
  let count = 0;

  for (const [uid, active] of Object.entries(admins)) {
    if (!uid || active !== true) continue;
    await writer.queueSet(doc(firestore, "admins", uid), {
      active: true,
      syncedFrom: "rtdb",
      syncedAtMs: Date.now(),
    }, { merge: true });
    count += 1;
  }

  if (!count && currentUser?.uid) {
    await writer.queueSet(doc(firestore, "admins", currentUser.uid), {
      active: true,
      email: String(currentUser.email || ""),
      syncedFrom: "rtdb",
      syncedAtMs: Date.now(),
    }, { merge: true });
    count = 1;
  }

  log(`Queued ${count} Firestore admin document${count === 1 ? "" : "s"}.`);
}

async function runMigration() {
  if (!currentUser?.uid || running) return;
  running = true;
  runBtn.disabled = true;
  setStatus("Migration is running. Keep this page open until it finishes.", "");
  log("Starting migration...");

  try {
    const isAdmin = await checkAdminAccess(currentUser);
    if (!isAdmin) {
      throw new Error("This account is not an admin in RTDB.");
    }

    const writer = createBatchWriter();
    await seedFirestoreAdmins(writer);
    await writer.flush();
    await migrateGlobalChat(writer);
    const onlineResult = await migrateOnline(writer);
    const phonesResult = await migratePhones(writer);
    await writer.flush();

    if (phonesResult?.skipped) {
      setStatus("Chat and online migrated. Phones were skipped because RTDB rules block listing /phones.", "success");
      log("Migration finished with phones skipped.");
      if (onlineResult?.skipped) {
        log("Online was also skipped. Check RTDB read rules for the online branch.");
      }
    } else {
      setStatus("Migration completed. Verify the Firestore collections, then you can remove the old RTDB branches.", "success");
      log("Migration finished successfully.");
    }
  } catch (error) {
    console.error("Firestore migration failed:", error);
    setStatus(`Migration failed: ${error?.message || error}`, "error");
    log(`Migration failed: ${error?.message || error}`);
  } finally {
    running = false;
    runBtn.disabled = false;
    runBtn.textContent = "Run migration again";
  }
}

runBtn?.addEventListener("click", () => {
  runMigration().catch((error) => {
    console.error(error);
  });
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!currentUser) {
    setStatus("Please sign in with an admin account to run this migration.", "error");
    runBtn.disabled = true;
    runBtn.textContent = "Go sign in first";
    return;
  }

  try {
    const isAdmin = await checkAdminAccess(currentUser);
    if (!isAdmin) {
      setStatus("Signed in, but this account is not marked as an admin.", "error");
      runBtn.disabled = true;
      runBtn.textContent = "Admin access required";
      log(`Authenticated as ${currentUser.uid}, but admin access was not granted.`);
      return;
    }

    setStatus("Admin access confirmed. You can run the migration now.", "");
    runBtn.disabled = false;
    runBtn.textContent = "Run Firestore migration";
    log(`Authenticated as admin ${currentUser.uid}.`);
  } catch (error) {
    console.error(error);
    setStatus("Could not verify admin access.", "error");
    runBtn.disabled = true;
    runBtn.textContent = "Admin check failed";
  }
});
