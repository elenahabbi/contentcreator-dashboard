const API_BASE = "http://localhost:3000";

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    loadPostsConsistency();
    loadDashboardSummary();
});

// ============================================
// POSTING CONSISTENCY (existing, unchanged)
// Small posting-consistency KPI (Posts card). Kept intentionally minimal —
// full breakdown/trend/platform detail lives on the Analytics page.
// ============================================

async function loadPostsConsistency() {
    const valueEl = document.getElementById("postsConsistencyValue");
    const subEl = document.getElementById("postsConsistencySub");
    if (!valueEl || !subEl) return;

    try {
        const response = await fetch(`${API_BASE}/analytics/consistency`);
        if (!response.ok) throw new Error("Request failed");
        const data = await response.json();

        if (!data.eligibleContent) {
            valueEl.textContent = "—";
            subEl.textContent = "No completed publishing deadlines yet.";
            return;
        }

        valueEl.textContent = `${data.consistencyPercentage}%`;
        subEl.textContent = `${data.missedCount} missed post${data.missedCount === 1 ? "" : "s"}`;
    } catch (error) {
        console.error("Could not load posting consistency:", error);
        valueEl.textContent = "—";
        subEl.textContent = "Could not load posting consistency.";
    }
}

// ============================================
// DASHBOARD SUMMARY  (GET /dashboard/summary)
// One request powers the content summary cards, upcoming content list,
// platform overview, and recent performance snapshot below.
// ============================================

async function loadDashboardSummary() {
    clearDashboardError();

    try {
        const response = await fetch(`${API_BASE}/dashboard/summary`);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || "Could not load the dashboard summary.");
        }
        const data = await response.json();

        renderContentSummary(data.contentSummary);
        renderUpcomingContent(data.upcomingContent);
        renderPlatformOverview(data.platforms);
        renderPerformanceSnapshot(data.latestPerformance);
    } catch (error) {
        console.error("Dashboard summary load error:", error);
        showDashboardError(error.message || "Unable to load the dashboard. Please try again.");
    }
}

// ---- Content summary cards ----

function renderContentSummary(summary) {
    const safe = summary || { total: 0, draft: 0, scheduled: 0, published: 0 };
    setText("summaryTotal", formatNumber(safe.total));
    setText("summaryDraft", formatNumber(safe.draft));
    setText("summaryScheduled", formatNumber(safe.scheduled));
    setText("summaryPublished", formatNumber(safe.published));
}

// ---- Upcoming content ----

function renderUpcomingContent(items) {
    const list = document.getElementById("upcomingContentList");
    const empty = document.getElementById("upcomingEmpty");
    if (!list) return;

    if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = "";
        if (empty) empty.classList.remove("is-hidden");
        return;
    }

    if (empty) empty.classList.add("is-hidden");

    list.innerHTML = items.map(item => `
        <li class="dashboard-upcoming-item">
            <div>
                <div class="dashboard-upcoming-title">${escapeHTML(item.content_title || "Untitled")}</div>
                <div class="dashboard-upcoming-meta">${formatDateTime(item.scheduled_date)}</div>
            </div>
            <span class="platform-pill">${escapeHTML(item.platform_name || "Unknown")}</span>
        </li>
    `).join("");
}

// ---- Platform overview ----

function renderPlatformOverview(platforms) {
    const youtube = (platforms && platforms.youtube) || { connected: false, hasData: false, subscriberCount: null };
    const badge = document.getElementById("platformYoutubeStatus");
    if (!badge) return;

    if (!youtube.connected) {
        badge.textContent = "Not Connected";
        badge.className = "platform-status-badge platform-status-badge--off";
    } else if (!youtube.hasData) {
        badge.textContent = "Connected — No Data Yet";
        badge.className = "platform-status-badge platform-status-badge--pending";
    } else {
        badge.textContent = `${formatNumber(youtube.subscriberCount)} Subscribers`;
        badge.className = "platform-status-badge platform-status-badge--ok";
    }

    // TikTok/Instagram badges are static in dashboard.html — no API for
    // them exists yet, so there is nothing to fetch or render here.
}

// ---- Recent performance snapshot ----

function renderPerformanceSnapshot(latest) {
    const grid = document.getElementById("performanceGrid");
    const empty = document.getElementById("performanceEmpty");
    if (!grid) return;

    if (!latest) {
        grid.classList.add("is-hidden");
        if (empty) empty.classList.remove("is-hidden");
        return;
    }

    grid.classList.remove("is-hidden");
    if (empty) empty.classList.add("is-hidden");

    const meta = document.getElementById("performanceMeta");
    if (meta) {
        meta.textContent =
            `${latest.content_title || "Untitled"} · ${latest.platform_name || "Unknown"} · ` +
            `synced ${formatDateTime(latest.recorded_at)}`;
    }

    setText("performanceViews", formatNumber(latest.views));
    setText("performanceLikes", formatNumber(latest.likes));
    setText("performanceComments", formatNumber(latest.comments));
    setText("performanceEngagement", formatPercent(latest.engagement_rate));
}

// ============================================
// ERROR BANNER
// ============================================

function showDashboardError(message) {
    const banner = document.getElementById("dashboardError");
    if (!banner) return;
    banner.textContent = message;
    banner.classList.remove("is-hidden");
}

function clearDashboardError() {
    const banner = document.getElementById("dashboardError");
    if (!banner) return;
    banner.textContent = "";
    banner.classList.add("is-hidden");
}

// ============================================
// FORMATTING HELPERS
// ============================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
}

// engagement_rate already arrives as a percentage number (e.g. 12.95
// means 12.95%) — never multiply or append twice.
function formatPercent(value) {
    return `${Number(value || 0).toFixed(2)}%`;
}

function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}