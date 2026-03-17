import { auth, rtdb } from "/elements/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { syncLeaderboardSnapshot } from "/pages/elements/leaderboard.sync.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const leaderboardCountEl = $("#leaderboardCount");
const topXpValueEl = $("#topXpValue");
const topTrueAnswersValueEl = $("#topTrueAnswersValue");
const leaderboardStateEl = $("#leaderboardState");

const xpLeaderNameEl = $("#xpLeaderName");
const xpLeaderMetaEl = $("#xpLeaderMeta");
const accuracyLeaderNameEl = $("#accuracyLeaderName");
const accuracyLeaderMetaEl = $("#accuracyLeaderMeta");
const myRankValueEl = $("#myRankValue");
const myRankMetaEl = $("#myRankMeta");

const leaderboardEmptyEl = $("#leaderboardEmpty");
const leaderboardLoginStateEl = $("#leaderboardLoginState");
const leaderboardContentEl = $("#leaderboardContent");
const podiumGridEl = $("#podiumGrid");
const leaderboardTableBodyEl = $("#leaderboardTableBody");

let currentUser = null;
let currentSort = "xp";
let leaderboardRows = [];
let unsubscribeLeaderboard = null;

function safeText(value) {
  return (value ?? "").toString();
}

function safeCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function accuracyFor(row) {
  const total = safeCount(row.totalAnswers);
  if (total <= 0) return 0;
  return Math.round((safeCount(row.trueAnswers) / total) * 100);
}

function metricValue(row, sortKey) {
  switch (sortKey) {
    case "trueAnswers":
      return safeCount(row.trueAnswers);
    case "accuracy":
      return accuracyFor(row);
    case "tests":
      return safeCount(row.testsCompleted);
    case "badges":
      return safeCount(row.challengeBadges);
    case "xp":
    default:
      return safeCount(row.totalXp);
  }
}

function metricLabel(sortKey) {
  switch (sortKey) {
    case "trueAnswers":
      return "True answers";
    case "accuracy":
      return "Accuracy";
    case "tests":
      return "Tests completed";
    case "badges":
      return "Challenge badges";
    case "xp":
    default:
      return "XP";
  }
}

function metricDisplay(row, sortKey) {
  switch (sortKey) {
    case "accuracy":
      return `${accuracyFor(row)}%`;
    case "tests":
      return `${safeCount(row.testsCompleted)}`;
    case "badges":
      return `${safeCount(row.challengeBadges)}`;
    case "trueAnswers":
      return `${safeCount(row.trueAnswers)}`;
    case "xp":
    default:
      return `${safeCount(row.totalXp)} XP`;
  }
}

function normalizeRow(uid, raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    uid,
    name: safeText(row.name || "Student").trim() || "Student",
    group_name: safeText(row.group_name || "Ungrouped").trim() || "Ungrouped",
    totalXp: safeCount(row.totalXp),
    challengeXp: safeCount(row.challengeXp),
    trueAnswers: safeCount(row.trueAnswers),
    wrongAnswers: safeCount(row.wrongAnswers),
    totalAnswers: safeCount(row.totalAnswers),
    testsCompleted: safeCount(row.testsCompleted),
    challengesApproved: safeCount(row.challengesApproved),
    challengeBadges: safeCount(row.challengeBadges),
    readingsCompleted: safeCount(row.readingsCompleted),
    listeningsCompleted: safeCount(row.listeningsCompleted)
  };
}

function sumResultTree(resultsTree) {
  const totals = {
    trueAnswers: 0,
    wrongAnswers: 0,
    totalAnswers: 0,
    testsCompleted: 0
  };

  const modes = resultsTree && typeof resultsTree === "object" ? Object.keys(resultsTree) : [];
  for (const mode of modes) {
    const tests = resultsTree?.[mode];
    if (!tests || typeof tests !== "object") continue;

    for (const testId of Object.keys(tests)) {
      const result = tests?.[testId];
      if (!result || typeof result !== "object") continue;

      totals.testsCompleted += 1;
      totals.trueAnswers += safeCount(result.correct);
      totals.wrongAnswers += safeCount(result.wrong);
      totals.totalAnswers += safeCount(result.total);
    }
  }

  return totals;
}

async function ensureCurrentUserLeaderboardSnapshot(user) {
  if (!user?.uid) return;

  try {
    const uid = user.uid;
    const [profileSnap, statsSnap, resultsSnap] = await Promise.all([
      get(ref(rtdb, `students/${uid}/profile`)),
      get(ref(rtdb, `students/${uid}/stats`)),
      get(ref(rtdb, `students/${uid}/results`))
    ]);

    const profile = profileSnap.exists() ? (profileSnap.val() || {}) : {};
    const stats = statsSnap.exists() ? (statsSnap.val() || {}) : {};
    const resultTotals = sumResultTree(resultsSnap.exists() ? (resultsSnap.val() || {}) : {});

    await syncLeaderboardSnapshot(
      rtdb,
      uid,
      {
        name: profile.name || profile.fullName || user.displayName || "Student",
        group_name: profile.group_name || profile.group || "Ungrouped"
      },
      {
        totalXp: safeCount(stats.challengeXp),
        challengeXp: safeCount(stats.challengeXp),
        challengeBadges: safeCount(stats.challengeBadges),
        challengesApproved: safeCount(stats.challengesApproved),
        readingsCompleted: safeCount(stats.readingsCompleted),
        listeningsCompleted: safeCount(stats.listeningsCompleted),
        trueAnswers: resultTotals.trueAnswers,
        wrongAnswers: resultTotals.wrongAnswers,
        totalAnswers: resultTotals.totalAnswers,
        testsCompleted: resultTotals.testsCompleted
      }
    );
  } catch (error) {
    console.warn("Could not backfill current user leaderboard snapshot:", error);
  }
}

function sortRows(rows, sortKey) {
  return [...rows].sort((a, b) => {
    const metricDiff = metricValue(b, sortKey) - metricValue(a, sortKey);
    if (metricDiff !== 0) return metricDiff;

    const xpDiff = safeCount(b.totalXp) - safeCount(a.totalXp);
    if (xpDiff !== 0) return xpDiff;

    const trueAnswerDiff = safeCount(b.trueAnswers) - safeCount(a.trueAnswers);
    if (trueAnswerDiff !== 0) return trueAnswerDiff;

    return safeText(a.name).localeCompare(safeText(b.name));
  });
}

function findLeader(rows, sortKey) {
  return sortRows(rows, sortKey)[0] || null;
}

function renderHero(sortedRows) {
  const xpLeader = findLeader(leaderboardRows, "xp");
  const trueLeader = findLeader(leaderboardRows, "trueAnswers");

  if (leaderboardCountEl) leaderboardCountEl.textContent = String(leaderboardRows.length);
  if (topXpValueEl) topXpValueEl.textContent = xpLeader ? `${xpLeader.totalXp} XP` : "0 XP";
  if (topTrueAnswersValueEl) topTrueAnswersValueEl.textContent = trueLeader ? String(trueLeader.trueAnswers) : "0";

  if (xpLeaderNameEl) xpLeaderNameEl.textContent = xpLeader ? xpLeader.name : "No data yet";
  if (xpLeaderMetaEl) xpLeaderMetaEl.textContent = xpLeader
    ? `${xpLeader.group_name} · ${xpLeader.totalXp} XP · ${xpLeader.challengeBadges} badges`
    : "Waiting for ranked data.";

  const accuracyLeader = sortRows(
    leaderboardRows.filter((row) => row.totalAnswers > 0),
    "accuracy"
  )[0] || null;

  if (accuracyLeaderNameEl) accuracyLeaderNameEl.textContent = accuracyLeader ? accuracyLeader.name : "No data yet";
  if (accuracyLeaderMetaEl) accuracyLeaderMetaEl.textContent = accuracyLeader
    ? `${accuracyLeader.group_name} · ${accuracyFor(accuracyLeader)}% accuracy across ${accuracyLeader.totalAnswers} answers`
    : "Waiting for ranked data.";

  if (!currentUser) {
    if (myRankValueEl) myRankValueEl.textContent = "Sign in";
    if (myRankMetaEl) myRankMetaEl.textContent = "Login to highlight your leaderboard position.";
    return;
  }

  const myIndex = sortedRows.findIndex((row) => row.uid === currentUser.uid);
  if (myIndex === -1) {
    if (myRankValueEl) myRankValueEl.textContent = "Unranked";
    if (myRankMetaEl) myRankMetaEl.textContent = "You will appear here once your stats sync into the leaderboard.";
    return;
  }

  const me = sortedRows[myIndex];
  if (myRankValueEl) myRankValueEl.textContent = `#${myIndex + 1}`;
  if (myRankMetaEl) {
    myRankMetaEl.textContent = `${me.name} · ${metricDisplay(me, currentSort)} in ${metricLabel(currentSort).toLowerCase()}.`;
  }
}

function renderPodium(sortedRows) {
  if (!podiumGridEl) return;
  const topThree = sortedRows.slice(0, 3);
  podiumGridEl.innerHTML = "";

  topThree.forEach((row, index) => {
    const card = document.createElement("article");
    card.className = `podium-card rank-${index + 1}`;
    card.innerHTML = `
      <div class="podium-rank">Rank #${index + 1}</div>
      <h4 class="podium-name">${escapeHtml(row.name)}</h4>
      <div class="podium-group">${escapeHtml(row.group_name)}</div>
      <div class="podium-score">${escapeHtml(metricDisplay(row, currentSort))}</div>
      <div class="podium-sub">
        ${escapeHtml(`${row.trueAnswers} true answers · ${row.testsCompleted} tests · ${row.challengeBadges} badges`)}
      </div>
    `;
    podiumGridEl.appendChild(card);
  });
}

function renderTable(sortedRows) {
  if (!leaderboardTableBodyEl) return;
  leaderboardTableBodyEl.innerHTML = "";

  sortedRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (currentUser && row.uid === currentUser.uid) tr.classList.add("current-user");

    tr.innerHTML = `
      <td><span class="rank-badge">#${index + 1}</span></td>
      <td>
        <div class="student-meta">
          <span class="student-name">${escapeHtml(row.name)}</span>
          <span class="student-group">${escapeHtml(row.group_name)}</span>
        </div>
      </td>
      <td><span class="metric-strong">${row.totalXp}</span> <span class="metric-soft">XP</span></td>
      <td><span class="metric-strong">${row.trueAnswers}</span></td>
      <td><span class="metric-strong">${accuracyFor(row)}%</span></td>
      <td><span class="metric-strong">${row.testsCompleted}</span></td>
      <td><span class="metric-strong">${row.challengeBadges}</span></td>
    `;

    leaderboardTableBodyEl.appendChild(tr);
  });
}

function renderLeaderboard() {
  const sortedRows = sortRows(leaderboardRows, currentSort);

  renderHero(sortedRows);

  if (leaderboardStateEl) {
    leaderboardStateEl.textContent = leaderboardRows.length
      ? `Showing ${metricLabel(currentSort).toLowerCase()} rankings in real time.`
      : "No ranked students yet. Results will appear here as data syncs in.";
  }

  if (leaderboardEmptyEl) leaderboardEmptyEl.classList.toggle("hidden", leaderboardRows.length > 0 || !currentUser);
  if (leaderboardLoginStateEl) leaderboardLoginStateEl.classList.toggle("hidden", !!currentUser);
  if (leaderboardContentEl) leaderboardContentEl.classList.toggle("hidden", !leaderboardRows.length || !currentUser);

  if (!leaderboardRows.length || !currentUser) {
    if (podiumGridEl) podiumGridEl.innerHTML = "";
    if (leaderboardTableBodyEl) leaderboardTableBodyEl.innerHTML = "";
    try { window.lucide?.createIcons?.(); } catch {}
    return;
  }

  renderPodium(sortedRows);
  renderTable(sortedRows);
  try { window.lucide?.createIcons?.(); } catch {}
}

function subscribeLeaderboard() {
  if (typeof unsubscribeLeaderboard === "function") unsubscribeLeaderboard();

  unsubscribeLeaderboard = onValue(
    ref(rtdb, "leaderboards/users"),
    (snap) => {
      const value = snap.val() || {};
      leaderboardRows = Object.keys(value).map((uid) => normalizeRow(uid, value[uid]));
      renderLeaderboard();
    },
    (error) => {
      console.warn("Leaderboard load failed:", error);
      leaderboardRows = [];
      if (leaderboardStateEl) {
        leaderboardStateEl.textContent = "Could not load the leaderboard right now.";
      }
      renderLeaderboard();
    }
  );
}

function bindSortChips() {
  $$(".sort-chip").forEach((button) => {
    button.addEventListener("click", () => {
      currentSort = safeText(button.dataset.sort || "xp");
      $$(".sort-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
      renderLeaderboard();
    });
  });
}

bindSortChips();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!currentUser) {
    if (typeof unsubscribeLeaderboard === "function") {
      unsubscribeLeaderboard();
      unsubscribeLeaderboard = null;
    }
    leaderboardRows = [];
    if (leaderboardStateEl) {
      leaderboardStateEl.textContent = "Login to load the live leaderboard.";
    }
    renderLeaderboard();
    return;
  }

  if (leaderboardStateEl) {
    leaderboardStateEl.textContent = "Syncing your leaderboard data...";
  }
  await ensureCurrentUserLeaderboardSnapshot(user);
  if (leaderboardStateEl) {
    leaderboardStateEl.textContent = "Loading live leaderboard...";
  }
  subscribeLeaderboard();
});
