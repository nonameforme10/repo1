import { firestore } from "/elements/firebase.js";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  setDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const DEFAULT_CHAT_ROOM_ID = "main";
const DEFAULT_CLUB_ID = "english";
const DEFAULT_TEACHER_ID = "Abdurahim";

function cleanId(value, fallback = "") {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
}

function nowMs() {
  return Date.now();
}

function phoneIndexRef(phoneKeyDigits) {
  return doc(firestore, "phones", cleanId(phoneKeyDigits));
}

async function claimPhoneOrThrow(phoneKeyDigits, uid) {
  const key = cleanId(phoneKeyDigits);
  const ownerUid = cleanId(uid);
  if (!key || !ownerUid) throw new Error("phone_claim_invalid");

  await runTransaction(firestore, async (tx) => {
    const ref = phoneIndexRef(key);
    const snap = await tx.get(ref);
    const existingUid = snap.exists() ? cleanId(snap.data()?.uid) : "";

    if (existingUid && existingUid !== ownerUid) {
      throw new Error("phone_taken");
    }

    const ts = nowMs();
    tx.set(
      ref,
      {
        phoneKey: key,
        uid: ownerUid,
        updatedAtMs: ts,
        createdAtMs: snap.exists() ? snap.data()?.createdAtMs || ts : ts,
      },
      { merge: true }
    );
  });
}

async function releasePhoneIfOwned(phoneKeyDigits, uid) {
  const key = cleanId(phoneKeyDigits);
  const ownerUid = cleanId(uid);
  if (!key || !ownerUid) return;

  await runTransaction(firestore, async (tx) => {
    const ref = phoneIndexRef(key);
    const snap = await tx.get(ref);
    const existingUid = snap.exists() ? cleanId(snap.data()?.uid) : "";
    if (existingUid === ownerUid) {
      tx.delete(ref);
    }
  });
}

async function getPhoneOwnerUid(phoneKeyDigits) {
  const key = cleanId(phoneKeyDigits);
  if (!key) return "";
  const snap = await getDoc(phoneIndexRef(key));
  return snap.exists() ? cleanId(snap.data()?.uid) : "";
}

function globalChatRoomRef(roomId = DEFAULT_CHAT_ROOM_ID) {
  return doc(firestore, "global_chat", cleanId(roomId, DEFAULT_CHAT_ROOM_ID));
}

function globalChatMessagesCollection(roomId = DEFAULT_CHAT_ROOM_ID) {
  return collection(globalChatRoomRef(roomId), "messages");
}

function globalChatMessageRef(messageId, roomId = DEFAULT_CHAT_ROOM_ID) {
  return doc(globalChatMessagesCollection(roomId), cleanId(messageId));
}

function globalChatTypingCollection(roomId = DEFAULT_CHAT_ROOM_ID) {
  return collection(globalChatRoomRef(roomId), "typing");
}

function globalChatTypingRef(uid, roomId = DEFAULT_CHAT_ROOM_ID) {
  return doc(globalChatTypingCollection(roomId), cleanId(uid));
}

async function ensureGlobalChatRoom(roomId = DEFAULT_CHAT_ROOM_ID) {
  const ref = globalChatRoomRef(roomId);
  await setDoc(
    ref,
    {
      roomId: cleanId(roomId, DEFAULT_CHAT_ROOM_ID),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );
  return ref;
}

function onlineClubDocRef(clubId = DEFAULT_CLUB_ID) {
  return doc(firestore, "online", cleanId(clubId, DEFAULT_CLUB_ID));
}

function onlineTeacherDocRef(clubId = DEFAULT_CLUB_ID, teacherId = DEFAULT_TEACHER_ID) {
  return doc(
    collection(onlineClubDocRef(clubId), "teachers"),
    cleanId(teacherId, DEFAULT_TEACHER_ID)
  );
}

function onlineModulesCollection(clubId = DEFAULT_CLUB_ID, teacherId = DEFAULT_TEACHER_ID) {
  return collection(onlineTeacherDocRef(clubId, teacherId), "modules");
}

function onlineModuleRef(clubId = DEFAULT_CLUB_ID, teacherId = DEFAULT_TEACHER_ID, moduleId) {
  return doc(onlineModulesCollection(clubId, teacherId), cleanId(moduleId));
}

function onlineCommentsCollection(
  clubId = DEFAULT_CLUB_ID,
  teacherId = DEFAULT_TEACHER_ID,
  moduleId
) {
  return collection(onlineModuleRef(clubId, teacherId, moduleId), "comments");
}

function onlineCommentRef(
  clubId = DEFAULT_CLUB_ID,
  teacherId = DEFAULT_TEACHER_ID,
  moduleId,
  commentId
) {
  return doc(onlineCommentsCollection(clubId, teacherId, moduleId), cleanId(commentId));
}

async function ensureOnlineTeacherTree(clubId = DEFAULT_CLUB_ID, teacherId = DEFAULT_TEACHER_ID) {
  const club = cleanId(clubId, DEFAULT_CLUB_ID);
  const teacher = cleanId(teacherId, DEFAULT_TEACHER_ID);
  const ts = nowMs();

  await Promise.all([
    setDoc(
      onlineClubDocRef(club),
      {
        clubId: club,
        updatedAtMs: ts,
      },
      { merge: true }
    ),
    setDoc(
      onlineTeacherDocRef(club, teacher),
      {
        clubId: club,
        teacherId: teacher,
        updatedAtMs: ts,
      },
      { merge: true }
    ),
  ]);
}

export {
  claimPhoneOrThrow,
  ensureGlobalChatRoom,
  ensureOnlineTeacherTree,
  getPhoneOwnerUid,
  globalChatMessageRef,
  globalChatMessagesCollection,
  globalChatTypingCollection,
  globalChatTypingRef,
  onlineCommentRef,
  onlineCommentsCollection,
  onlineModuleRef,
  onlineModulesCollection,
  releasePhoneIfOwned,
};
