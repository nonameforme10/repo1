(function () {
  const LEADERBOARD_HREF = "/pages/leaderboard/leaderboard.html";

  function safeCreateIcons() {
    try {
      window.lucide?.createIcons?.();
    } catch {}
  }

  function buildLeaderboardAnchor(active = false, navClass = "") {
    const anchor = document.createElement("a");
    anchor.href = LEADERBOARD_HREF;
    if (navClass) anchor.className = navClass;
    if (active) anchor.id = "nav-active-page";
    anchor.innerHTML = `<i data-lucide="trophy"></i><span>Leaderboard</span>`;
    return anchor;
  }

  function insertAfterKnownLink(container, anchor) {
    const afterWeekly = container.querySelector('a[href="/pages/challenges/weekly_challanges.html"]');
    const afterGames = container.querySelector('a[href="/pages/games/games.html"]');
    const target = afterWeekly || afterGames;
    if (target?.parentNode) {
      target.parentNode.insertBefore(anchor, target.nextSibling);
      return;
    }
    container.appendChild(anchor);
  }

  function ensureLeaderboardLinks() {
    const isLeaderboardPage = location.pathname.endsWith("/pages/leaderboard/leaderboard.html") || location.pathname.endsWith("/leaderboard.html");

    document.querySelectorAll(".sidebar").forEach((sidebar) => {
      if (sidebar.querySelector(`a[href="${LEADERBOARD_HREF}"]`)) return;
      insertAfterKnownLink(sidebar, buildLeaderboardAnchor(isLeaderboardPage));
    });

    document.querySelectorAll(".nav-bottom").forEach((nav) => {
      if (nav.querySelector(`a[href="${LEADERBOARD_HREF}"]`)) return;
      insertAfterKnownLink(nav, buildLeaderboardAnchor(isLeaderboardPage, "nav-a"));
    });

    document.querySelectorAll(".footer-el ul").forEach((list) => {
      if (list.querySelector(`a[href="${LEADERBOARD_HREF}"]`)) return;
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = LEADERBOARD_HREF;
      anchor.textContent = "Leaderboard";
      item.appendChild(anchor);
      list.appendChild(item);
    });
  }

  function setupMobileMenu() {
    const openBtn = document.getElementById("openMenu");
    const closeBtn = document.getElementById("closeMenu");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");

    if (!sidebar || !overlay) return;

    const setMenuState = (open) => {
      sidebar.classList.toggle("active", open);
      overlay.classList.toggle("active", open);
    };

    openBtn?.addEventListener("click", () => setMenuState(true));
    closeBtn?.addEventListener("click", () => setMenuState(false));
    overlay.addEventListener("click", () => setMenuState(false));
  }

  ensureLeaderboardLinks();
  setupMobileMenu();
  safeCreateIcons();
})();
