// PHASE 1 — shared by every protected page (dashboard.html, calendar.html,
// scripts.html, analytics.html, viewscripts.html, write.html).
//
// Include this BEFORE the page's own <script src="....js"> tag, and before
// any of that script's own fetch() calls run, so a logged-out visitor is
// redirected before the page's real data requests fire (and 401).
//
// Two things happen here:
//   1. An immediate GET /auth/me. If it 401s, we redirect to login.html
//      right away — nothing on the page has to render for a logged-out
//      visitor first.
//   2. A small helper, window.wireLogoutButton(), that each page calls
//      once its DOM is ready to hook up a "Log out" button/link with
//      id="logoutBtn" (see the sidebar snippet in the Phase 1 notes).

const API_BASE = "http://localhost:3000";

(async function requireLogin() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (!res.ok) {
      window.location.href = "login.html";
    }
  } catch (err) {
    // Network/server error — treat the same as "not logged in" rather
    // than letting the page render with no data at all.
    window.location.href = "login.html";
  }
})();

window.wireLogoutButton = function wireLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.href = "login.html";
    }
  });
};