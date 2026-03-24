import { firestore } from "/elements/firebase.js";
import {
  collection,
  doc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const READING_ROOT = "readings";
const LISTENING_ROOT = "listening";
const VOCABULARY_ROOT = "vocabularies";
const VOCABULARY_ROOMS_ROOT = "vocabularyRooms";

function cleanId(value, fallback = "") {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
}

function cleanVocabularyType(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  return cleaned === "unitwords" || cleaned === "listeningwords" ? cleaned : "";
}

function normalizeAnswerKey(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 1; i < raw.length; i += 1) {
      if (raw[i] == null) continue;
      out[String(i)] = Array.isArray(raw[i]) ? raw[i] : [raw[i]];
    }
    return out;
  }
  return raw;
}

function readingTestDocRef(testId) {
  return doc(firestore, READING_ROOT, cleanId(testId));
}

function readingPartsCollection(testId) {
  return collection(readingTestDocRef(testId), "parts");
}

function readingPartDocRef(testId, partId) {
  return doc(readingPartsCollection(testId), cleanId(partId));
}

function listeningTestDocRef(testId) {
  return doc(firestore, LISTENING_ROOT, cleanId(testId));
}

function listeningSectionsCollection(testId) {
  return collection(listeningTestDocRef(testId), "sections");
}

function listeningSectionDocRef(testId, sectionId) {
  return doc(listeningSectionsCollection(testId), cleanId(sectionId));
}

function vocabularyTypeDocRef(type) {
  return doc(firestore, VOCABULARY_ROOT, cleanVocabularyType(type));
}

function vocabularyModulesCollection(type) {
  return collection(vocabularyTypeDocRef(type), "modules");
}

function vocabularyModuleDocRef(type, moduleId) {
  return doc(vocabularyModulesCollection(type), cleanId(moduleId));
}

function extractQuestionsMap(data) {
  return normalizeAnswerKey(data?.questions || {});
}

function extractVocabularyWords(data) {
  const words = data?.words;
  return words && typeof words === "object" ? words : {};
}

function extractVocabularyPassword(data) {
  const password = data?.password;
  return password && typeof password === "object" ? password : null;
}

function vocabularyRoomsBasePath(type, moduleId) {
  return `${VOCABULARY_ROOMS_ROOT}/${cleanVocabularyType(type)}/${cleanId(moduleId)}/pendingRooms`;
}

export {
  cleanVocabularyType,
  extractQuestionsMap,
  extractVocabularyPassword,
  extractVocabularyWords,
  listeningSectionDocRef,
  listeningSectionsCollection,
  listeningTestDocRef,
  readingPartDocRef,
  readingPartsCollection,
  readingTestDocRef,
  vocabularyModuleDocRef,
  vocabularyModulesCollection,
  vocabularyRoomsBasePath,
  vocabularyTypeDocRef,
};
