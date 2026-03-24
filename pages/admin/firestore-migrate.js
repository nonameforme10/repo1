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

async function migratePhones(writer) {
  const phones = sanitizeObject((await getRtdbValue("phones")) || {});
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
  const onlineRoot = sanitizeObject((await getRtdbValue("online")) || {});
  let moduleCount = 0;
  let commentCount = 0;

  for (const [clubId, clubValue] of Object.entries(onlineRoot)) {
    if (!clubId || !clubValue || typeof clubValue !== "object") continue;

    await writer.queueSet(doc(firestore, "online", clubId), {
      clubId,
      updatedAtMs: Date.now(),
      migratedFrom: "rtdb",
    }, { merge: true });

    for (const [teacherId, teacherValue] of Object.entries(clubValue)) {
      if (!teacherId || !teacherValue || typeof teacherValue !== "object") continue;

      await writer.queueSet(doc(collection(doc(firestore, "online", clubId), "teachers"), teacherId), {
        clubId,
        teacherId,
        updatedAtMs: Date.now(),
        migratedFrom: "rtdb",
      }, { merge: true });

      const modules = sanitizeObject(teacherValue.modules || {});
      for (const [moduleId, payload] of Object.entries(modules)) {
        if (!moduleId || !payload || typeof payload !== "object") continue;
        await writer.queueSet(doc(onlineModulesCollection(clubId, teacherId), moduleId), {
          ...payload,
          migratedFrom: "rtdb",
        });
        moduleCount += 1;
      }

      const commentsByModule = sanitizeObject(teacherValue.comments || {});
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
    }
  }

  log(`Queued ${moduleCount} online modules and ${commentCount} online comments.`);
}

async function seedCurrentAdmin(writer) {
  if (!currentUser?.uid) return;

  await writer.queueSet(doc(firestore, "admins", currentUser.uid), {
    active: true,
    email: String(currentUser.email || ""),
    syncedFrom: "rtdb",
    syncedAtMs: Date.now(),
  }, { merge: true });

  log(`Queued Firestore admin doc for ${currentUser.uid}.`);
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
    await seedCurrentAdmin(writer);
    await migratePhones(writer);
    await migrateGlobalChat(writer);
    await migrateOnline(writer);
    await writer.flush();

    setStatus("Migration completed. Verify the Firestore collections, then you can remove the old RTDB branches.", "success");
    log("Migration finished successfully.");
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
