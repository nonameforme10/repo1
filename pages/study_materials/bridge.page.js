









import { auth, db, ref, get, runTransaction, update } from "/elements/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";


try {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
} catch {}




const DEFAULT_PARTS_BY_MODE = {
  reading: ["pass1", "pass2", "pass3"],
  listening: ["sec1", "sec2", "sec3", "sec4"],
};


const DB_ROOT_BY_MODE = {
  reading: "readings",
  listening: "listening",
};


function storagePrefix(mode, testId, partId) {
  return `${mode}_${testId}_${partId}`; 
}



function $(id) { return document.getElementById(id); }

function normalize(s) {
  return String(s ?? "").trim().toLowerCase();
}

function parseParams() {
  const u = new URL(location.href);
  const mode = normalize(u.searchParams.get("mode"));  
  const test = normalize(u.searchParams.get("test"));  
  const rawParts = u.searchParams.get("parts");        
  return { mode, test, rawParts };
}

function bridgeKey(mode, testId, suffix) {
  return `bridge_${mode}_${testId}_${suffix}`;
}

function isLocked(mode, testId) {
  return localStorage.getItem(bridgeKey(mode, testId, "locked")) === "true";
}

function setLocked(mode, testId, parts) {
  localStorage.setItem(bridgeKey(mode, testId, "locked"), "true");
  localStorage.setItem(bridgeKey(mode, testId, "startedAt"), new Date().toISOString());
  
  localStorage.setItem(bridgeKey(mode, testId, "parts"), JSON.stringify(parts));
  localStorage.setItem(bridgeKey(mode, testId, "last"), parts[parts.length - 1] || "");
}

function clearAttempt(mode, testId) {
  
  const parts = getParts(mode, testId);
  for (const partId of parts) {
    const pfx = storagePrefix(mode, testId, partId);
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(pfx + "_")) localStorage.removeItem(k);
    });
  }
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(`bridge_${mode}_${testId}_`)) localStorage.removeItem(k);
  });
}

function getParts(mode, testId) {
  const stored = localStorage.getItem(bridgeKey(mode, testId, "parts"));
  if (stored) {
    try {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {}
  }
  return DEFAULT_PARTS_BY_MODE[mode] || [];
}

function validateAndNormalizeParts(mode, rawParts) {
  const fallback = DEFAULT_PARTS_BY_MODE[mode] || [];
  if (!rawParts) return fallback;

  const items = rawParts
    .split(",")
    .map(s => normalize(s))
    .filter(Boolean);

  const okRe = mode === "reading" ? /^pass\d+$/ : /^sec\d+$/;
  const valid = items.filter(p => okRe.test(p));

  return valid.length ? valid : fallback;
}

function partSubmitted(mode, testId, partId) {
  const pfx = storagePrefix(mode, testId, partId);
  return localStorage.getItem(`${pfx}_submitted`) === "true";
}

function nextIncompletePart(mode, testId) {
  const parts = getParts(mode, testId);
  for (const partId of parts) {
    if (!partSubmitted(mode, testId, partId)) return partId;
  }
  return null;
}

function allDone(mode, testId) {
  const parts = getParts(mode, testId);
  return parts.length > 0 && parts.every(p => partSubmitted(mode, testId, p));
}


function buildPartUrl(mode, testId, partId) {
  if (mode === "reading") {
    return `/reading/${testId}/${partId}/${partId}.html`;
  }
  if (mode === "listening") {
    const m = String(partId).match(/sec(\d+)/i);
    const n = m ? m[1] : "1";
    return `/listenings/${testId}/${partId}/part${n}.html`;
  }
  return "/pages/study_materials/study_materials.html";
}


function normalizeAnswerKey(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 1; i < raw.length; i++) {
      out[String(i)] = Array.isArray(raw[i]) ? raw[i] : [raw[i]];
    }
    return out;
  }
  return raw;
}



async function computeTotals(mode, testId) {
  const parts = getParts(mode, testId);
  const dbRoot = DB_ROOT_BY_MODE[mode];

  
  const cachedTotalsRaw = localStorage.getItem(bridgeKey(mode, testId, "totalsJson"));
  if (cachedTotalsRaw) {
    try {
      const cached = JSON.parse(cachedTotalsRaw);
      if (cached && typeof cached.correct === "number" && typeof cached.total === "number") {
        return cached;
      }
    } catch {}
  }

  let correct = 0;
  let wrong = 0;
  let total = 0;
  const perPart = {};

  
  const keyPromises = parts.map(async (partId) => {
    const pfx = storagePrefix(mode, testId, partId);
    const cacheKey = `${pfx}_answer_key_v1`;

    
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return { partId, answerKey: normalizeAnswerKey(JSON.parse(cached)) };
    } catch {}

    
    const dbPath = `${dbRoot}/${testId}/${partId}/questions`;
    const snap = await get(ref(db, dbPath));
    if (!snap.exists()) return { partId, error: `Answer key missing at ${dbPath}` };

    const raw = snap.val();

    
    try { sessionStorage.setItem(cacheKey, JSON.stringify(raw)); } catch {}

    return { partId, answerKey: normalizeAnswerKey(raw) };
  });

  const settled = await Promise.allSettled(keyPromises);

  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const { partId, answerKey, error } = s.value;

    if (error || !answerKey) {
      perPart[partId] = { error: error || "Answer key missing" };
      continue;
    }

    const pfx = storagePrefix(mode, testId, partId);
    const qids = Object.keys(answerKey);

    let c = 0;
    let w = 0;

    for (const qid of qids) {
      const accepted = (answerKey[qid] || []).map(normalize);
      const saved = localStorage.getItem(`${pfx}_${String(qid).trim()}`) || "";
      const user = normalize(saved);

      if (user && accepted.includes(user)) c++;
      else w++;
    }

    perPart[partId] = { correct: c, wrong: w, total: qids.length };

    correct += c;
    wrong += w;
    total += qids.length;
  }

  const out = { correct, wrong, total, perPart };
  try {
    localStorage.setItem(bridgeKey(mode, testId, "totalsJson"), JSON.stringify(out));
  } catch {}
  return out;
}


async function pushResultsToFirebase(uid, mode, testId, totals) {
  const now = new Date().toISOString();

  
  const resultPath = `students/${uid}/results/${mode}/${testId}`;

  
  
  const progressBase = `students/${uid}/progress/${mode}/${testId}`;

  const updates = {};

  
  updates[resultPath] = {
    correct: totals.correct,
    wrong: totals.wrong,
    total: totals.total,
    perPart: totals.perPart,
    completedAt: now,
    mode,
    testId,
  };

  
  for (const [partId, v] of Object.entries(totals.perPart || {})) {
    if (v && v.error) {
      updates[`${progressBase}/${partId}`] = {
        error: String(v.error),
        total: Number(v.total || 0),
        correct: Number(v.correct || 0),
        incorrect: Number(v.wrong || 0),
        updatedAt: now,
      };
    } else {
      updates[`${progressBase}/${partId}`] = {
        total: Number(v?.total || 0),
        correct: Number(v?.correct || 0),
        incorrect: Number(v?.wrong || 0),
        updatedAt: now,
      };
    }
  }

  
  await update(ref(db), updates);

  
  const statsField = mode === "reading" ? "readingsCompleted" : "listeningsCompleted";
  const statRef = ref(db, `students/${uid}/stats/${statsField}`);

  await runTransaction(statRef, (cur) => {
    const n = Number(cur || 0);
    return n + 1;
  });
}



function renderParts(mode, testId) {
  const parts = getParts(mode, testId);
  const list = $("partsList");
  list.innerHTML = "";

  parts.forEach((partId) => {
    const done = partSubmitted(mode, testId, partId);

    const row = document.createElement("div");
    row.className = "part-row";

    const left = document.createElement("div");
    left.className = "part-left";
    left.textContent = partId.toUpperCase();

    const badge = document.createElement("span");
    badge.className = "badge " + (done ? "done" : (isLocked(mode, testId) ? "inprogress" : "todo"));
    badge.textContent = done ? "DONE" : (isLocked(mode, testId) ? "IN PROGRESS" : "NOT STARTED");

    row.appendChild(left);
    row.appendChild(badge);
    list.appendChild(row);
  });
}

function setHeader(mode, testId) {
  $("bridgeTitle").textContent = `${mode.toUpperCase()} • ${testId.toUpperCase()}`;
  $("bridgeSub").textContent = `Finish all parts, then return here to see your final result.`;
  $("bridgePill").textContent = `MODE: ${mode.toUpperCase()} • MODULE: ${testId.toUpperCase()}`;
  $("partsTitle").textContent = mode === "reading" ? "Reading passes" : "Listening sections";
}

function setWarning(mode, testId) {
  const w = $("warningBox");
  const locked = isLocked(mode, testId);
  const done = allDone(mode, testId);

  w.style.display = "block";

  if (!locked && !done) {
    w.innerHTML = `
      <b>Important:</b> Once you press <b>Start</b>, this module becomes locked.
      Finish all parts in order.
    `;
    return;
  }

  if (locked && !done) {
    const nxt = nextIncompletePart(mode, testId);
    w.innerHTML = `
      <b>Module locked:</b> Continue from the next unfinished part (${String(nxt || "").toUpperCase()}).
    `;
    return;
  }

  w.innerHTML = `<b>Completed:</b> All parts are submitted. Your totals are saved to Firebase once.`;
}

function setHint(mode, testId) {
  const hint = $("hintBox");
  const locked = isLocked(mode, testId);
  const done = allDone(mode, testId);
  const next = nextIncompletePart(mode, testId);

  if (!locked && !done) {
    hint.textContent = "Start will open the first part.";
    return;
  }
  if (locked && !done) {
    hint.textContent = `Continue will open: ${String(next || "").toUpperCase()}.`;
    return;
  }
  hint.textContent = "Done. You can review (open last part) or go back.";
}



function isAdminUnlocked(mode, testId) {
  return localStorage.getItem(bridgeKey(mode, testId, "admin")) === "true";
}

function enableAdminUnlockHotkey(mode, testId) {
  let buf = "";
  let lastTs = 0;

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.altKey)) return;
    const now = Date.now();
    if (now - lastTs > 1200) buf = "";
    lastTs = now;

    if (e.key.length === 1) buf += e.key.toUpperCase();
    if (buf.length > 10) buf = buf.slice(-10);

    if (buf.endsWith("RESET")) {
      localStorage.setItem(bridgeKey(mode, testId, "admin"), "true");
      alert("✅ Admin unlock enabled on Bridge. Reset button is now visible.");
      setButtons(mode, testId);
      setHint(mode, testId);
      buf = "";
    }
  });
}


function setButtons(mode, testId) {
  const primary = $("primaryBtn");
  const secondary = $("secondaryBtn");
  const reset = $("resetBtn");

  const fallback = "/pages/study_materials/study_materials.html";
  const returnUrlKey = bridgeKey(mode, testId, "returnUrl");

  secondary.textContent = "Back";
  secondary.onclick = () => {
    const saved = localStorage.getItem(returnUrlKey);
    location.href = saved || fallback;
  };

  const done = allDone(mode, testId);
  const locked = isLocked(mode, testId);
  const parts = getParts(mode, testId);

  
  const admin = isAdminUnlocked(mode, testId);
  reset.style.display = admin ? "inline-flex" : "none";

  if (admin) {
    reset.onclick = () => {
      const typed = prompt('Type RESET to clear this module attempt (local only):');
      if (typed !== "RESET") return;
      clearAttempt(mode, testId);
      location.reload();
    };
  }

  if (!locked && !done) {
    primary.textContent = "Start module";
    primary.onclick = () => {
      const ok = confirm(
        `Start ${mode.toUpperCase()} ${testId.toUpperCase()}?\n\n` +
        `After starting, you should finish all parts in order.\n` +
        `Press OK to lock and begin.`
      );
      if (!ok) return;

      const sessionParts = parts.length ? parts : (DEFAULT_PARTS_BY_MODE[mode] || []);
      setLocked(mode, testId, sessionParts);

      const first = nextIncompletePart(mode, testId) || sessionParts[0];
      try {
  sessionStorage.setItem("lock_back_to_bridge", "1");
  sessionStorage.setItem("bridge_return_url", location.href);
} catch {}
location.href = buildPartUrl(mode, testId, first);
    };
    return;
  }

  if (locked && !done) {
    primary.textContent = "Continue";
    primary.onclick = () => {
      const nxt = nextIncompletePart(mode, testId);
      if (!nxt) return;
      try {
  sessionStorage.setItem("lock_back_to_bridge", "1");
  sessionStorage.setItem("bridge_return_url", location.href);
} catch {}
location.href = buildPartUrl(mode, testId, nxt);
    };
    return;
  }

  primary.textContent = "Open module (review)";
  primary.onclick = () => {
    const last = parts[parts.length - 1];
    try {
  sessionStorage.setItem("lock_back_to_bridge", "1");
  sessionStorage.setItem("bridge_return_url", location.href);
} catch {}
location.href = buildPartUrl(mode, testId, last);
  };
}



async function main() {
  const { mode, test, rawParts } = parseParams();

  
  if (!DEFAULT_PARTS_BY_MODE[mode] || !/^test\d+$/i.test(test)) {
    $("bridgeTitle").textContent = "Invalid link";
    $("bridgeSub").textContent = "Missing or wrong query params. Use ?mode=reading&test=test1";
    $("primaryBtn").disabled = true;
    $("secondaryBtn").textContent = "Go to Study Materials";
    $("secondaryBtn").onclick = () => (location.href = "/pages/study_materials/study_materials.html");
    $("resetBtn").style.display = "none";
    return;
  }

  
  const returnUrlKey = bridgeKey(mode, test, "returnUrl");
  if (!localStorage.getItem(returnUrlKey)) {
    const refUrl = document.referrer || "";
    const sameOrigin = refUrl.startsWith(location.origin);
    const looksLikeMenu = refUrl.includes("/pages/study_materials/");
    const isPart =
      refUrl.includes("/reading/") ||
      refUrl.includes("/listenings/") ||
      refUrl.includes("/pages/study_materials/bridge.html");

    if (sameOrigin && looksLikeMenu && !isPart) {
      localStorage.setItem(returnUrlKey, refUrl);
    }
  }

  
  
  if (!isLocked(mode, test)) {
    const overrideParts = validateAndNormalizeParts(mode, rawParts);
    localStorage.setItem(bridgeKey(mode, test, "parts"), JSON.stringify(overrideParts));
    localStorage.setItem(bridgeKey(mode, test, "last"), overrideParts[overrideParts.length - 1] || "");
  }

  enableAdminUnlockHotkey(mode, test);

  setHeader(mode, test);
  renderParts(mode, test);
  setWarning(mode, test);
  setButtons(mode, test);
  setHint(mode, test);

  
  const cached = localStorage.getItem(bridgeKey(mode, test, "summaryText"));
  if (cached) $("summaryBox").textContent = cached;

  
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "/index.html";
      return;
    }

    if (allDone(mode, test)) {
      const alreadyPushed = localStorage.getItem(bridgeKey(mode, test, "pushed")) === "true";

      const totals = await computeTotals(mode, test);
      const summaryText = `✅ Final: ${totals.correct} correct • ${totals.wrong} wrong • total ${totals.total}`;
      $("summaryBox").textContent = summaryText;
      localStorage.setItem(bridgeKey(mode, test, "summaryText"), summaryText);

      if (!alreadyPushed) {
        try {
          await pushResultsToFirebase(user.uid, mode, test, totals);
          localStorage.setItem(bridgeKey(mode, test, "pushed"), "true");
          
          localStorage.setItem(`bridge_${mode}_${test}_pushed_${user.uid}`, "true");
        } catch (e) {
          console.error(e);
          $("summaryBox").textContent = summaryText + " (Firebase save failed — check console)";
        }
      }
    } else {
      $("summaryBox").textContent = "Finish all parts, then click “End test” on the final page to come back here.";
    }
  });
}

main();
