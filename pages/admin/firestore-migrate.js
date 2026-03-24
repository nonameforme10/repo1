import { auth, firestore, rtdb } from "/elements/firebase.js";
import { checkAdminAccess } from "/elements/admin.js";
import {
  globalChatMessagesCollection,
  globalChatTypingCollection,
  onlineCommentsCollection,
  onlineModulesCollection,
} from "/elements/firestore-data.js";
import {
  listeningSectionDocRef,
  listeningTestDocRef,
  readingPartDocRef,
  readingTestDocRef,
  vocabularyModuleDocRef,
  vocabularyTypeDocRef,
} from "/elements/study-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import {
  collection,
  doc,
  getDoc,
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
    return value
      .map((item) => sanitizeObject(item))
      .filter((item) => typeof item !== "undefined");
  }
  if (!value || typeof value !== "object") return value;

  const out = {};
  Object.entries(value).forEach(([key, child]) => {
    if (typeof child === "undefined") return;
    out[key] = sanitizeObject(child);
  });
  return out;
}

function normalizeLegacyAnswerKey(raw) {
  if (!raw || typeof raw !== "object") return {};

  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 1; i < raw.length; i += 1) {
      const item = sanitizeObject(raw[i]);
      if (item == null) continue;
      out[String(i)] = Array.isArray(item)
        ? item.filter((child) => child != null)
        : [item];
    }
    return out;
  }

  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    const clean = sanitizeObject(value);
    if (clean == null) return;
    out[key] = Array.isArray(clean)
      ? clean.filter((child) => child != null)
      : clean;
  });
  return out;
}

function createBatchWriter() {
  let batch = writeBatch(firestore);
  let ops = 0;
  let commitCount = 0;
  const existingCache = new Map();

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

  async function queueSetIfMissing(refToWrite, payload, options) {
    const key = String(refToWrite?.path || "");
    if (key) {
      if (!existingCache.has(key)) {
        const snap = await getDoc(refToWrite);
        existingCache.set(key, snap.exists());
      }
      if (existingCache.get(key) === true) {
        return false;
      }
    }

    await queueSet(refToWrite, payload, options);
    if (key) existingCache.set(key, true);
    return true;
  }

  return {
    flush,
    queueSet,
    queueSetIfMissing,
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

const rtdbExistsCache = new Map();

async function rtdbPathExists(path) {
  if (rtdbExistsCache.has(path)) return rtdbExistsCache.get(path);
  const snap = await get(ref(rtdb, path));
  const exists = snap.exists();
  rtdbExistsCache.set(path, exists);
  return exists;
}

function safeKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function extractLegacyQuestions(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.questions && typeof payload.questions === "object") {
    return normalizeLegacyAnswerKey(payload.questions);
  }
  return normalizeLegacyAnswerKey(payload);
}

function extractLegacyVocabularyWords(payload) {
  if (!payload || typeof payload !== "object") return {};

  const out = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (key === "pendingRooms") return;
    if (!value || typeof value !== "object") return;
    if (!("eng" in value) && !("uzb" in value) && !("rus" in value) && !("transcription" in value)) return;
    out[key] = sanitizeObject(value);
  });
  return out;
}

function extractLegacyPendingRooms(payload) {
  const rooms = payload?.pendingRooms;
  return rooms && typeof rooms === "object" ? sanitizeObject(rooms) : {};
}

function countVocabularyWords(wordsMap) {
  return Object.values(wordsMap || {}).filter((value) => value && typeof value === "object").length;
}

function extractPasswordNode(passwords, moduleId) {
  if (!passwords || typeof passwords !== "object") return null;
  const byName = passwords[moduleId];
  const byKey = passwords[safeKey(moduleId)];
  const node = byName || byKey;
  return node && typeof node === "object" ? sanitizeObject(node) : null;
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
  let skippedExisting = 0;

  for (const [phoneKey, uid] of Object.entries(phones)) {
    if (!phoneKey || !uid) continue;
    const ts = Date.now();
    const queued = await writer.queueSetIfMissing(doc(firestore, "phones", phoneKey), {
      phoneKey,
      uid: String(uid),
      createdAtMs: ts,
      updatedAtMs: ts,
      migratedFrom: "rtdb",
    });
    if (queued) count += 1;
    else skippedExisting += 1;
  }

  log(`Queued ${count} phone index documents${skippedExisting ? ` and skipped ${skippedExisting} existing.` : "."}`);
  return { skipped: false, count, skippedExisting };
}

async function migrateGlobalChat(writer) {
  const messages = sanitizeObject((await getRtdbValue("global_chat/messages")) || {});
  const typing = sanitizeObject((await getRtdbValue("global_chat/typing")) || {});
  const hasAnyData = Object.keys(messages).length > 0 || Object.keys(typing).length > 0;

  if (!hasAnyData) {
    log("No RTDB global chat data found.");
    return;
  }

  const roomQueued = await writer.queueSetIfMissing(doc(firestore, "global_chat", "main"), {
    roomId: "main",
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  let messageCount = 0;
  let skippedMessages = 0;
  for (const [messageId, payload] of Object.entries(messages)) {
    if (!messageId || !payload || typeof payload !== "object") continue;
    const queued = await writer.queueSetIfMissing(doc(globalChatMessagesCollection(), messageId), {
      ...payload,
      migratedFrom: "rtdb",
    });
    if (queued) messageCount += 1;
    else skippedMessages += 1;
  }

  let typingCount = 0;
  let skippedTyping = 0;
  for (const [uid, payload] of Object.entries(typing)) {
    if (!uid || !payload || typeof payload !== "object") continue;
    const queued = await writer.queueSetIfMissing(doc(globalChatTypingCollection(), uid), {
      ...payload,
      uid,
      migratedFrom: "rtdb",
    });
    if (queued) typingCount += 1;
    else skippedTyping += 1;
  }

  log(
    `Queued ${messageCount} chat messages and ${typingCount} typing documents` +
    `${roomQueued ? "" : " (room doc already existed)"}` +
    `${skippedMessages || skippedTyping ? `, skipped ${skippedMessages + skippedTyping} existing child docs.` : "."}`
  );
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

  const clubQueued = await writer.queueSetIfMissing(doc(firestore, "online", clubId), {
    clubId,
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  const teacherQueued = await writer.queueSetIfMissing(doc(collection(doc(firestore, "online", clubId), "teachers"), teacherId), {
    clubId,
    teacherId,
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  let moduleCount = 0;
  let commentCount = 0;
  let skippedExisting = 0;
  const modules = sanitizeObject(modulesResult.value || {});
  const commentsByModule = sanitizeObject(commentsResult.value || {});

  for (const [moduleId, payload] of Object.entries(modules)) {
    if (!moduleId || !payload || typeof payload !== "object") continue;
    const queued = await writer.queueSetIfMissing(doc(onlineModulesCollection(clubId, teacherId), moduleId), {
      ...payload,
      migratedFrom: "rtdb",
    });
    if (queued) moduleCount += 1;
    else skippedExisting += 1;
  }

  for (const [moduleId, comments] of Object.entries(commentsByModule)) {
    if (!moduleId || !comments || typeof comments !== "object") continue;
    for (const [commentId, payload] of Object.entries(comments)) {
      if (!commentId || !payload || typeof payload !== "object") continue;
      const queued = await writer.queueSetIfMissing(doc(onlineCommentsCollection(clubId, teacherId, moduleId), commentId), {
        ...payload,
        migratedFrom: "rtdb",
      });
      if (queued) commentCount += 1;
      else skippedExisting += 1;
    }
  }

  log(
    `Queued ${moduleCount} online modules and ${commentCount} online comments from ${clubId}/${teacherId}` +
    `${(!clubQueued || !teacherQueued) ? " (some parent docs already existed)" : ""}` +
    `${skippedExisting ? `, skipped ${skippedExisting} existing docs.` : "."}`
  );
  return { skipped: false, moduleCount, commentCount, skippedExisting };
}

async function migrateReadings(writer) {
  const result = await getRtdbValueSafe("readings");
  if (result.denied) {
    log("Skipped readings: RTDB read denied for /readings.");
    return { skipped: true, reason: "permission-denied" };
  }
  if (result.error) throw result.error;

  const tests = sanitizeObject(result.value || {});
  let testCount = 0;
  let partCount = 0;
  let skippedExisting = 0;

  for (const [testId, parts] of Object.entries(tests)) {
    if (!testId || !parts || typeof parts !== "object") continue;
    const testQueued = await writer.queueSetIfMissing(readingTestDocRef(testId), {
      testId,
      updatedAtMs: Date.now(),
      migratedFrom: "rtdb",
    }, { merge: true });
    if (testQueued) testCount += 1;
    else skippedExisting += 1;

    for (const [partId, payload] of Object.entries(parts)) {
      if (!partId || !payload || typeof payload !== "object") continue;
      const questions = extractLegacyQuestions(payload);
      const queued = await writer.queueSetIfMissing(readingPartDocRef(testId, partId), {
        testId,
        partId,
        questions,
        updatedAtMs: Date.now(),
        migratedFrom: "rtdb",
      }, { merge: true });
      if (queued) partCount += 1;
      else skippedExisting += 1;
    }
  }

  log(`Queued ${testCount} reading tests and ${partCount} reading parts${skippedExisting ? `, skipped ${skippedExisting} existing docs.` : "."}`);
  return { skipped: false, testCount, partCount, skippedExisting };
}

async function migrateListening(writer) {
  const result = await getRtdbValueSafe("listening");
  if (result.denied) {
    log("Skipped listening: RTDB read denied for /listening.");
    return { skipped: true, reason: "permission-denied" };
  }
  if (result.error) throw result.error;

  const tests = sanitizeObject(result.value || {});
  let testCount = 0;
  let sectionCount = 0;
  let skippedExisting = 0;

  for (const [testId, sections] of Object.entries(tests)) {
    if (!testId || !sections || typeof sections !== "object") continue;
    const testQueued = await writer.queueSetIfMissing(listeningTestDocRef(testId), {
      testId,
      updatedAtMs: Date.now(),
      migratedFrom: "rtdb",
    }, { merge: true });
    if (testQueued) testCount += 1;
    else skippedExisting += 1;

    for (const [sectionId, payload] of Object.entries(sections)) {
      if (!sectionId || !payload || typeof payload !== "object") continue;
      const questions = extractLegacyQuestions(payload);
      const queued = await writer.queueSetIfMissing(listeningSectionDocRef(testId, sectionId), {
        testId,
        sectionId,
        questions,
        updatedAtMs: Date.now(),
        migratedFrom: "rtdb",
      }, { merge: true });
      if (queued) sectionCount += 1;
      else skippedExisting += 1;
    }
  }

  log(`Queued ${testCount} listening tests and ${sectionCount} listening sections${skippedExisting ? `, skipped ${skippedExisting} existing docs.` : "."}`);
  return { skipped: false, testCount, sectionCount, skippedExisting };
}

async function migrateVocabularyType(writer, type, modules, passwords = {}) {
  const typeQueued = await writer.queueSetIfMissing(vocabularyTypeDocRef(type), {
    type,
    updatedAtMs: Date.now(),
    migratedFrom: "rtdb",
  }, { merge: true });

  let moduleCount = 0;
  let wordCount = 0;
  let skippedExisting = typeQueued ? 0 : 1;

  for (const [moduleId, payload] of Object.entries(modules || {})) {
    if (!moduleId || !payload || typeof payload !== "object") continue;
    const words = extractLegacyVocabularyWords(payload);
    const password = type === "listeningwords" ? extractPasswordNode(passwords, moduleId) : null;
    const count = countVocabularyWords(words);

    const queued = await writer.queueSetIfMissing(vocabularyModuleDocRef(type, moduleId), {
      moduleId,
      type,
      words,
      wordCount: count,
      updatedAtMs: Date.now(),
      migratedFrom: "rtdb",
      ...(password ? { password } : {}),
    }, { merge: true });

    if (queued) {
      moduleCount += 1;
      wordCount += count;
    } else {
      skippedExisting += 1;
    }
  }

  return { moduleCount, wordCount, skippedExisting };
}

async function migrateVocabularyRooms(type, modules) {
  let moduleCount = 0;
  let roomCount = 0;
  let skippedExisting = 0;

  for (const [moduleId, payload] of Object.entries(modules || {})) {
    if (!moduleId || !payload || typeof payload !== "object") continue;
    const pendingRooms = extractLegacyPendingRooms(payload);
    const entries = Object.entries(pendingRooms).filter(
      ([roomId, roomPayload]) => roomId && roomPayload && typeof roomPayload === "object"
    );
    if (!entries.length) continue;

    for (const [roomId, roomPayload] of entries) {
      try {
        const path = `vocabularyRooms/${type}/${moduleId}/pendingRooms/${roomId}`;
        if (await rtdbPathExists(path)) {
          skippedExisting += 1;
          continue;
        }
        await set(
          ref(rtdb, path),
          sanitizeObject(roomPayload)
        );
        rtdbExistsCache.set(path, true);
      } catch (error) {
        const message = String(error?.message || "");
        if (/permission denied/i.test(message)) {
          log(
            `Skipped vocabularyRooms/${type}/${moduleId}: RTDB write denied. ` +
            "Deploy the updated RTDB rules before rerunning if you want live rooms copied."
          );
          return { skipped: true, reason: "permission-denied", moduleCount, roomCount };
        }
        throw error;
      }

      roomCount += 1;
    }

    moduleCount += 1;
  }

  if (roomCount > 0) {
    log(`Copied ${roomCount} pending vocabulary room${roomCount === 1 ? "" : "s"} into vocabularyRooms.`);
  }
  if (skippedExisting > 0) {
    log(`Skipped ${skippedExisting} existing vocabulary room${skippedExisting === 1 ? "" : "s"} in vocabularyRooms/${type}.`);
  }

  return { skipped: false, moduleCount, roomCount, skippedExisting };
}

async function migrateVocabularies(writer) {
  const unitwordsResult = await getRtdbValueSafe("vocabularies/unitwords");
  const listeningwordsResult = await getRtdbValueSafe("vocabularies/listeningwords");
  const passwordsResult = await getRtdbValueSafe("vocabularies/listeningwords_passwords");

  if (unitwordsResult.error && !unitwordsResult.denied) throw unitwordsResult.error;
  if (listeningwordsResult.error && !listeningwordsResult.denied) throw listeningwordsResult.error;
  if (passwordsResult.error && !passwordsResult.denied) throw passwordsResult.error;

  const skipped = [];
  if (unitwordsResult.denied) skipped.push("unitwords");
  if (listeningwordsResult.denied) skipped.push("listeningwords");
  if (passwordsResult.denied) skipped.push("listeningwords_passwords");
  if (skipped.length) {
    log(`Skipped vocabularies branches: ${skipped.join(", ")}.`);
  }

  const unitwords = sanitizeObject(unitwordsResult.value || {});
  const listeningwords = sanitizeObject(listeningwordsResult.value || {});
  const passwords = sanitizeObject(passwordsResult.value || {});

  const unitResult = await migrateVocabularyType(writer, "unitwords", unitwords);
  const listeningResult = await migrateVocabularyType(writer, "listeningwords", listeningwords, passwords);
  const unitRoomsResult = await migrateVocabularyRooms("unitwords", unitwords);
  const listeningRoomsResult = await migrateVocabularyRooms("listeningwords", listeningwords);

  log(
    `Queued ${unitResult.moduleCount} unit vocabulary modules, ` +
    `${listeningResult.moduleCount} listening vocabulary modules, and ` +
    `${unitResult.wordCount + listeningResult.wordCount} vocabulary words` +
    `${(unitResult.skippedExisting || listeningResult.skippedExisting)
      ? `, skipped ${unitResult.skippedExisting + listeningResult.skippedExisting} existing Firestore vocab docs.`
      : "."}`
  );

  return {
    skipped: skipped.length > 0 || unitRoomsResult.skipped || listeningRoomsResult.skipped,
    skippedBranches: [
      ...skipped,
      ...(unitRoomsResult.skipped ? ["vocabularyRooms/unitwords"] : []),
      ...(listeningRoomsResult.skipped ? ["vocabularyRooms/listeningwords"] : []),
    ],
    unitResult,
    listeningResult,
    unitRoomsResult,
    listeningRoomsResult,
  };
}

async function seedFirestoreAdmins(writer) {
  const result = await getRtdbValueSafe("admins");
  if (result.error && !result.denied) throw result.error;

  const admins = sanitizeObject(result.value || {});
  let count = 0;
  let skippedExisting = 0;
  let sawAnyAdmin = false;

  for (const [uid, active] of Object.entries(admins)) {
    if (!uid || active !== true) continue;
    sawAnyAdmin = true;
    const queued = await writer.queueSetIfMissing(doc(firestore, "admins", uid), {
      active: true,
      syncedFrom: "rtdb",
      syncedAtMs: Date.now(),
    }, { merge: true });
    if (queued) count += 1;
    else skippedExisting += 1;
  }

  if (!sawAnyAdmin && currentUser?.uid) {
    const queued = await writer.queueSetIfMissing(doc(firestore, "admins", currentUser.uid), {
      active: true,
      email: String(currentUser.email || ""),
      syncedFrom: "rtdb",
      syncedAtMs: Date.now(),
    }, { merge: true });
    if (queued) count = 1;
    else skippedExisting += 1;
  }

  log(`Queued ${count} Firestore admin document${count === 1 ? "" : "s"}${skippedExisting ? ` and skipped ${skippedExisting} existing.` : "."}`);
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
    const readingsResult = await migrateReadings(writer);
    const listeningResult = await migrateListening(writer);
    const vocabulariesResult = await migrateVocabularies(writer);
    await writer.flush();

    const skipped = [];
    if (phonesResult?.skipped) skipped.push("phones");
    if (onlineResult?.skipped) skipped.push("online");
    if (readingsResult?.skipped) skipped.push("readings");
    if (listeningResult?.skipped) skipped.push("listening");
    if (vocabulariesResult?.skipped) skipped.push(...(vocabulariesResult.skippedBranches || []));

    if (skipped.length) {
      setStatus(`Migration completed with skipped branches: ${skipped.join(", ")}. Check the log before deleting old RTDB data.`, "success");
      log(`Migration finished with skipped branches: ${skipped.join(", ")}.`);
    } else {
      setStatus("Migration completed. Verify Firestore for chat, online, phones, readings, listening, and vocabularies, then you can remove the old RTDB branches.", "success");
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
