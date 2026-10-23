// ---- dashboard.js: replace the existing INIT block ----
document.addEventListener("DOMContentLoaded", async () => {
    const redirected = await redirectIfOnboardingIncomplete();
    if (redirected) return;

    loadPostsConsistency();
    loadGoalChart();
        loadDashboardSummary();
    updateSamplePreviewBadges();
    loadEvents();
    setupEventForm();
});

// ---- dashboard.js: add this function directly below the INIT block ----
// Redirects to onboarding ONLY when the server answers 200 and says setup is
// incomplete. Any failure (network, 5xx, missing table) leaves the dashboard
// usable and shows a small notice, so there is no redirect loop and no lockout.
async function redirectIfOnboardingIncomplete() {
    try {
        const ok = await window.authReady;
        if (!ok) return false;

        const res = await fetch(`${API_BASE}/profile`, { credentials: "include" });
        if (!res.ok) throw new Error(`profile status ${res.status}`);

        const data = await res.json();
        if (data.onboarding_completed === false) {
            window.location.replace("onboarding.html");
            return true;
        }
    } catch (error) {
        console.warn("Could not check profile setup:", error.message);
        const note = document.createElement("div");
        note.setAttribute("role", "status");
        note.style.cssText = "padding:8px 12px;background:#fff6e5;color:#313135;font-size:13px;";
        note.textContent = "We couldn't check your profile setup right now. The dashboard is still available.";
        document.body.prepend(note);
    }
    return false;
}

// ============================================
// SCHEDULE ADHERENCE (formerly labelled "Posting Consistency")
// Of scheduled posts that were due, the share that were published.
// Small KPI (Posts card). Kept intentionally minimal —
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

        // Phase 3: same response also feeds the Published vs Missed graph.
        // Self-contained (own try/catch) so a chart problem can't affect the KPI.
        renderPublishedMissedChart(data);

        if (!data.eligibleContent) {
            valueEl.textContent = "—";
            subEl.textContent = "No completed publishing deadlines yet.";
            return;
        }

        valueEl.textContent = `${data.consistencyPercentage}%`;
        subEl.textContent = `${data.missedCount} missed post${data.missedCount === 1 ? "" : "s"}`;
    } catch (error) {
        console.error("Could not load schedule adherence:", error);
        valueEl.textContent = "—";
        subEl.textContent = "Could not load schedule adherence.";
        showChartMessage("publishedMissed", "Could not load scheduled post results right now. Try refreshing the page.");
    }
}

// ============================================
// DASHBOARD GRAPHS (Phase 3)
// Chart.js is loaded from the same CDN build as analytics.html. Every
// chart is destroyed before it is redrawn, and on page hide, so a refresh
// or a revisit (back/forward cache) never leaves two charts on one canvas.
// Unavailable data is never drawn as zero: each graph shows an explanatory
// message instead.
// ============================================

// Phase 3: general dashboard metrics use the app palette (burgundy / dusty pink /
// blue-grey). Platform colours are used only where a chart compares platforms.
// Only colours changed here; the data and calculations are untouched.
const DASH_CHART_COLORS = {
    published: "#313135",
    target: "#bbc4cd",
    missed: "#e8bfd1",
    outline: "#313135",
    grid: "#e9cfd3",
    text: "#7a6f6f",
};

let goalProgressChart = null;
let publishedMissedChart = null;
let goalChartRequestId = 0;

function destroyDashboardCharts() {
    if (goalProgressChart) {
        goalProgressChart.destroy();
        goalProgressChart = null;
    }
    if (publishedMissedChart) {
        publishedMissedChart.destroy();
        publishedMissedChart = null;
    }
}

window.addEventListener("pagehide", destroyDashboardCharts);

// Destroys any chart already bound to the canvas, including one this file
// lost track of, before a new one is created.
function clearCanvasChart(canvas) {
    if (typeof Chart === "undefined" || !canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
}

// key is "goal" or "publishedMissed" (matches the element IDs in dashboard.html).
function chartElements(key) {
    if (key === "goal") {
        return {
            wrap: document.getElementById("goalChartWrap"),
            canvas: document.getElementById("goalProgressChart"),
            empty: document.getElementById("goalChartEmpty"),
            caption: document.getElementById("goalChartCaption"),
        };
    }
    return {
        wrap: document.getElementById("publishedMissedWrap"),
        canvas: document.getElementById("publishedMissedChart"),
        empty: document.getElementById("publishedMissedEmpty"),
        caption: document.getElementById("publishedMissedCaption"),
    };
}

function showChartMessage(key, message) {
    const el = chartElements(key);
    if (key === "goal" && goalProgressChart) {
        goalProgressChart.destroy();
        goalProgressChart = null;
    }
    if (key !== "goal" && publishedMissedChart) {
        publishedMissedChart.destroy();
        publishedMissedChart = null;
    }
    clearCanvasChart(el.canvas);
    if (el.wrap) el.wrap.classList.add("is-hidden");
    if (el.caption) el.caption.textContent = "";
    if (el.empty) {
        el.empty.textContent = message;
        el.empty.classList.remove("is-hidden");
    }
}

function showChartCanvas(key) {
    const el = chartElements(key);
    if (el.wrap) el.wrap.classList.remove("is-hidden");
    if (el.empty) el.empty.classList.add("is-hidden");
}

function chartLibraryMissing(key) {
    if (typeof Chart !== "undefined") return false;
    showChartMessage(key, "Could not load the chart library. Try refreshing the page.");
    return true;
}

// ---- Posting Goal Progress (GET /posting-goal) ----

async function loadGoalChart() {
    const requestId = ++goalChartRequestId;

    try {
        const response = await fetch(`${API_BASE}/posting-goal`, { credentials: "include" });

        if (response.status === 503) {
            const body = await response.json().catch(() => ({}));
            if (requestId !== goalChartRequestId) return;
            if (body.code === "POSTING_GOAL_SCHEMA_MISSING") {
                showChartMessage("goal", "Posting goals need a one-time database setup that hasn't been run yet, so progress can't be shown.");
                return;
            }
        }
        if (!response.ok) throw new Error("Request failed");

        const data = await response.json();
        if (requestId !== goalChartRequestId) return; // a newer request superseded this one
        renderGoalChart(data);
    } catch (error) {
        if (requestId !== goalChartRequestId) return;
        console.error("Could not load posting goal chart:", error);
        showChartMessage("goal", "Could not load your posting goal right now. Try refreshing the page.");
    }
}

function describeGoalForChart(goal) {
    if (goal.goal_type === "daily") return "Daily posting (1 post per day)";
    const count = Number(goal.target_count);
    const text = `${formatNumber(count)} post${count === 1 ? "" : "s"} per ${goal.period}`;
    return goal.goal_type === "custom" ? `${text} (custom)` : text;
}

function renderGoalChart(data) {
    try {
        const goal = data && data.goal ? data.goal : null;
        const progress = data && data.progress ? data.progress : null;

        if (!goal || !progress) {
            showChartMessage("goal", "No posting goal set yet. Set one on the Analytics page to see your progress here.");
            return;
        }

        const published = Number(progress.published_count);
        const target = Number(progress.target_count);
        if (!Number.isFinite(published) || !Number.isFinite(target) || target < 1) {
            showChartMessage("goal", "Your posting goal progress isn't available right now.");
            return;
        }
        if (chartLibraryMissing("goal")) return;

        const windowLabel = progress.window_label || "in this period";
        const el = chartElements("goal");
        showChartCanvas("goal");

        setText("goalChartSubtitle", `Published posts compared with your target, ${windowLabel}.`);
        if (el.caption) {
            el.caption.textContent =
                `${formatNumber(published)} of ${formatNumber(target)} post${target === 1 ? "" : "s"} published ${windowLabel} ` +
                `(${progress.percentage}%). Goal: ${describeGoalForChart(goal)}.` +
                (published >= target ? " Goal reached." : "");
        }
        if (el.canvas) {
            el.canvas.setAttribute(
                "aria-label",
                `Posting goal: ${published} of ${target} posts published ${windowLabel}.`
            );
        }

        if (goalProgressChart) {
            goalProgressChart.destroy();
            goalProgressChart = null;
        }
        clearCanvasChart(el.canvas);

        goalProgressChart = new Chart(el.canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: [`Published ${windowLabel}`, "Target"],
                datasets: [{
                    data: [published, target],
                    backgroundColor: [DASH_CHART_COLORS.published, DASH_CHART_COLORS.target],
                    borderColor: DASH_CHART_COLORS.outline,
                    borderWidth: 1.5,
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${formatNumber(ctx.parsed.x)} post${ctx.parsed.x === 1 ? "" : "s"}`,
                        },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        suggestedMax: Math.max(published, target),
                        grid: { color: DASH_CHART_COLORS.grid },
                        ticks: { color: DASH_CHART_COLORS.text, precision: 0 },
                        title: { display: true, text: "Posts", color: DASH_CHART_COLORS.text },
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: DASH_CHART_COLORS.text },
                    },
                },
            },
        });
    } catch (error) {
        console.error("Could not draw posting goal chart:", error);
        showChartMessage("goal", "Could not draw the posting goal chart.");
    }
}

// ---- Published vs Missed (data from GET /analytics/consistency) ----

function renderPublishedMissedChart(data) {
    try {
        const published = Number(data && data.publishedCount);
        const missed = Number(data && data.missedCount);
        const eligible = Number(data && data.eligibleContent);

        if (!Number.isFinite(eligible) || !Number.isFinite(published) || !Number.isFinite(missed)) {
            showChartMessage("publishedMissed", "Scheduled post results aren't available right now.");
            return;
        }
        if (eligible === 0) {
            showChartMessage(
                "publishedMissed",
                "No scheduled posts have reached their date yet. Once a scheduled post's date passes, it will appear here as published or missed."
            );
            return;
        }
        if (chartLibraryMissing("publishedMissed")) return;

        const el = chartElements("publishedMissed");
        showChartCanvas("publishedMissed");

        const pct = data.consistencyPercentage;
        if (el.caption) {
            el.caption.textContent =
                `${formatNumber(published)} published and ${formatNumber(missed)} missed, out of ` +
                `${formatNumber(eligible)} scheduled post${eligible === 1 ? "" : "s"} whose date has passed` +
                (pct === null || pct === undefined ? "." : ` (${pct}% published).`);
        }
        if (el.canvas) {
            el.canvas.setAttribute(
                "aria-label",
                `${published} published and ${missed} missed scheduled posts.`
            );
        }

        if (publishedMissedChart) {
            publishedMissedChart.destroy();
            publishedMissedChart = null;
        }
        clearCanvasChart(el.canvas);

        publishedMissedChart = new Chart(el.canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: ["Published", "Missed"],
                datasets: [{
                    data: [published, missed],
                    backgroundColor: [DASH_CHART_COLORS.published, DASH_CHART_COLORS.missed],
                    borderColor: DASH_CHART_COLORS.outline,
                    borderWidth: 1.5,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "58%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: DASH_CHART_COLORS.text },
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${formatNumber(ctx.parsed)} post${ctx.parsed === 1 ? "" : "s"}`,
                        },
                    },
                },
            },
        });
    } catch (error) {
        console.error("Could not draw published vs missed chart:", error);
        showChartMessage("publishedMissed", "Could not draw the published vs missed chart.");
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
        const response = await fetch(`${API_BASE}/dashboard/summary`, { credentials: "include" });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            // "detail" is the real server-side cause (development only).
            if (body.detail) console.error("Dashboard summary server detail:", body.code || "", body.detail);
            throw new Error(body.message || "Could not load the dashboard summary.");
        }
        const data = await response.json();

        renderContentSummary(data.contentSummary);
        renderUpcomingContent(data.upcomingContent);
        renderPlatformOverview(data.platforms);
        renderPerformanceSnapshot(data.latestPerformance);
                renderOpportunities(data.opportunities);
        renderRecommendations(data.recommendations);
        renderSectionErrors(data.sectionErrors);
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
            <span class="platform-pill ${platformPillClass(item.platform_name)}">${escapeHTML(item.platform_name || "Unknown")}</span>
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

    // TikTok/Instagram have no live integration. Their badges say
    // "Sample Data Preview" (static in dashboard.html); see
    // updateSamplePreviewBadges() below.
}

// Downgrades a "Sample Data Preview" badge only when we positively know the
// creator has nothing scheduled for that platform (so no sample exists).
// Read-only GET of an existing endpoint; on any failure the static badge
// text stays as it is. Never marks a platform as connected.
async function updateSamplePreviewBadges() {
    try {
        const response = await fetch(`${API_BASE}/scheduled-content`, { credentials: "include" });
        if (!response.ok) return;
        const rows = await response.json();
        if (!Array.isArray(rows)) return;

        const usable = rows.filter(r => ["Scheduled", "Published"].includes(r.computed_status || r.status));
        const has = name => usable.some(r => r.platform_name === name);

        [["platformTiktokStatus", "TikTok"], ["platformInstagramStatus", "Instagram"]].forEach(([id, name]) => {
            const badge = document.getElementById(id);
            if (badge && !has(name)) badge.textContent = "No sample — nothing scheduled";
        });
    } catch (error) {
        console.warn("Could not check scheduled content for sample badges:", error.message);
    }
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
// MISSED OPPORTUNITIES  (part of GET /dashboard/summary)
// ============================================

function renderOpportunities(items) {
    const list = document.getElementById("opportunityList");
    const empty = document.getElementById("opportunityEmpty");
    if (!list) return;

    if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = "";
        if (empty) empty.classList.remove("is-hidden");
        return;
    }
    if (empty) empty.classList.add("is-hidden");

    list.innerHTML = items.map(item => `
        <li class="dashboard-opportunity-item">
            <div class="dashboard-opportunity-main">
                    <div class="dashboard-opportunity-title">${escapeHTML(item.title || "Untitled opportunity")}</div>
                <div class="dashboard-opportunity-meta">
                    ${escapeHTML(String(item.opportunity_type || "Opportunity").replace(/([a-z])([A-Z])/g, "$1 $2"))}
                    ${item.source ? `· ${escapeHTML(item.source)}` : ""}
                    ${item.opportunity_deadline ? `· Opportunity window closes ${formatDateTime(item.opportunity_deadline)}` : ""}
                </div>
                ${item.description ? `<div class="dashboard-opportunity-desc">${escapeHTML(item.description)}</div>` : ""}
            </div>
                        <div class="dashboard-item-actions">
                <button class="quick-action-btn quick-action-btn--small" data-kind="opportunity" data-id="${item.opportunity_id}" data-status="Actioned">Mark Actioned</button>
                <button class="quick-action-btn quick-action-btn--small" data-kind="opportunity" data-id="${item.opportunity_id}" data-status="Dismissed">Dismiss</button>
            </div>
        </li>
    `).join("");
}

// ============================================
// RECOMMENDATIONS  (part of GET /dashboard/summary)
// ============================================

function renderRecommendations(items) {
    const list = document.getElementById("recommendationList");
    const empty = document.getElementById("recommendationEmpty");
    if (!list) return;

    if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = "";
        if (empty) empty.classList.remove("is-hidden");
        return;
    }
    if (empty) empty.classList.add("is-hidden");

    list.innerHTML = items.map(item => `
        <li class="dashboard-recommendation-item">
            <div class="dashboard-recommendation-type">${escapeHTML(item.recommendation_type || "Recommendation")}</div>
            <div class="dashboard-recommendation-message">${escapeHTML(item.message || "")}</div>
            ${item.reason ? `<div class="dashboard-recommendation-reason">${escapeHTML(item.reason)}</div>` : ""}
            <div class="dashboard-item-actions">
                <button class="quick-action-btn quick-action-btn--small" data-kind="recommendation" data-id="${item.recommendation_id}" data-status="Actioned">Mark Actioned</button>
                <button class="quick-action-btn quick-action-btn--small" data-kind="recommendation" data-id="${item.recommendation_id}" data-status="Dismissed">Dismiss</button>
            </div>
        </li>
    `).join("");
}

// Optional sections (opportunities/recommendations) report their own
// failures in sectionErrors so an empty list is never mistaken for
// "nothing detected". The real error is in the server log.
function renderSectionErrors(sectionErrors) {
    if (!sectionErrors) return;
    const messages = Object.values(sectionErrors).filter(Boolean);
    if (messages.length > 0) showDashboardError(messages.join(" "));
}

// Shared click handler for both opportunity and recommendation action
// buttons — delegated once on each list so re-rendering never loses the
// listener.
document.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-kind][data-id][data-status]");
    if (!button) return;

    const { kind, id, status } = button.dataset;
    const endpoint = kind === "opportunity" ? "opportunities" : "recommendations";
    button.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/${endpoint}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || `Could not update ${kind}.`);
        }
        // Refresh the whole summary so counts/lists stay in sync rather
        // than trying to patch the DOM in two places by hand.
        loadDashboardSummary();
    } catch (error) {
        console.error(`Could not update ${kind} ${id}:`, error);
        showDashboardError(error.message || `Could not update ${kind}.`);
        button.disabled = false;
    }
});

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
// CREATOR EVENTS  (GET/POST/PUT/DELETE /events)
// An event is a date that matters to the creator's content (a holiday, a
// conference, a series launch). It is NOT a scheduled post: those live on
// the calendar page. Events are always loaded from the server, so they
// survive a page refresh; nothing is kept only in browser state.
// ============================================

let creatorEvents = [];
let eventRequestInFlight = false;

// Calls the events API. Resolves with the parsed JSON body only when the
// server really answered 2xx; otherwise throws an Error whose message is
// safe to show. Server-side (5xx) messages can contain database details,
// so they are replaced by a generic sentence here.
async function eventApi(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...options,
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        if (response.status === 401) {
            window.location.href = "login.html";
            throw new Error("Please log in again.");
        }
        if (response.status >= 500) {
            throw new Error("The server could not complete the request. Please try again.");
        }
        throw new Error((body && body.message) || `Request failed (HTTP ${response.status}).`);
    }
    return body;
}

// "2026-10-20" -> "Oct 20, 2026" (same style as the rest of the dashboard).
// Parsed as a local calendar date so it never shifts by a day.
function formatEventDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!match) return "—";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function showEventElement(id, visible, message) {
    const element = document.getElementById(id);
    if (!element) return;
    if (message !== undefined) element.textContent = message;
    element.classList.toggle("is-hidden", !visible);
}

async function loadEvents() {
    const list = document.getElementById("eventList");
    if (!list) return;

    showEventElement("eventLoading", true);
    showEventElement("eventListError", false, "");

    try {
        const events = await eventApi("/events");
        creatorEvents = Array.isArray(events) ? events : [];
        renderEvents();
    } catch (error) {
        console.error("Events load error:", error);
        creatorEvents = [];
        list.innerHTML = "";
        showEventElement("eventEmpty", false);
        showEventElement("eventListError", true, `Could not load your events. ${error.message}`);
    } finally {
        showEventElement("eventLoading", false);
    }
}

function renderEvents() {
    const list = document.getElementById("eventList");
    if (!list) return;

    list.innerHTML = "";
    showEventElement("eventEmpty", creatorEvents.length === 0);

    creatorEvents.forEach((event) => {
        const item = document.createElement("li");
        item.className = "dashboard-opportunity-item";
        if (event.timing === "Past") item.style.opacity = "0.6";

        const timingLabel = event.timing && event.timing !== "Upcoming" ? ` · ${event.timing}` : "";

        item.innerHTML = `
            <div>
                <div class="dashboard-opportunity-title">${escapeHTML(event.title)}</div>
                <div class="dashboard-opportunity-meta">
                    ${escapeHTML(formatEventDate(event.event_date))}${escapeHTML(timingLabel)}
                    ${event.relevance_keywords ? `· Keywords: ${escapeHTML(event.relevance_keywords)}` : ""}
                </div>
                ${event.description ? `<div class="dashboard-opportunity-desc">${escapeHTML(event.description)}</div>` : ""}
            </div>
            <div class="dashboard-item-actions">
                <button type="button" class="quick-action-btn quick-action-btn--small" data-event-action="edit" data-event-id="${event.event_id}">Edit</button>
                <button type="button" class="quick-action-btn quick-action-btn--small" data-event-action="delete" data-event-id="${event.event_id}">Delete</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function resetEventForm() {
    const form = document.getElementById("eventForm");
    if (form) form.reset();
    document.getElementById("eventEditId").value = "";
    document.getElementById("eventSubmitBtn").textContent = "+ Add Event";
    showEventElement("eventCancelEditBtn", false);
    showEventElement("eventFormError", false, "");
}

function startEditingEvent(eventId) {
    const event = creatorEvents.find((e) => String(e.event_id) === String(eventId));
    if (!event) return;

    document.getElementById("eventEditId").value = event.event_id;
    document.getElementById("eventTitleInput").value = event.title || "";
    document.getElementById("eventDateInput").value = String(event.event_date || "").slice(0, 10);
    document.getElementById("eventKeywordsInput").value = event.relevance_keywords || "";
    document.getElementById("eventDescriptionInput").value = event.description || "";
    document.getElementById("eventSubmitBtn").textContent = "Save Changes";
    showEventElement("eventCancelEditBtn", true);
    showEventElement("eventFormError", false, "");
    document.getElementById("eventForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteEvent(eventId) {
    if (eventRequestInFlight) return;
    if (!window.confirm("Delete this event? This cannot be undone.")) return;

    eventRequestInFlight = true;
    showEventElement("eventListError", false, "");
    try {
        await eventApi(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
        if (document.getElementById("eventEditId").value === String(eventId)) resetEventForm();
        await loadEvents();
        loadDashboardSummary(); // opportunities derived from this event expire on the next detection run
    } catch (error) {
        console.error("Event delete error:", error);
        showEventElement("eventListError", true, `Could not delete the event. ${error.message}`);
    } finally {
        eventRequestInFlight = false;
    }
}

function setupEventForm() {
    const form = document.getElementById("eventForm");
    const list = document.getElementById("eventList");
    if (!form || !list) return;

    form.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        if (eventRequestInFlight) return; // ignore repeated clicks while a request is running

        const editId = document.getElementById("eventEditId").value;
        const submitBtn = document.getElementById("eventSubmitBtn");
        const payload = {
            title: document.getElementById("eventTitleInput").value.trim(),
            event_date: document.getElementById("eventDateInput").value,
            relevance_keywords: document.getElementById("eventKeywordsInput").value.trim() || null,
            description: document.getElementById("eventDescriptionInput").value.trim() || null,
        };

        // Quick feedback only; the server validates everything again.
        if (!payload.title || !payload.event_date) {
            showEventElement("eventFormError", true, "Please enter an event title and date.");
            return;
        }

        eventRequestInFlight = true;
        submitBtn.disabled = true;
        showEventElement("eventFormError", false, "");

        try {
            await eventApi(editId ? `/events/${encodeURIComponent(editId)}` : "/events", {
                method: editId ? "PUT" : "POST",
                body: JSON.stringify(payload),
            });
            resetEventForm();
            await loadEvents();
            loadDashboardSummary(); // refresh opportunities/recommendations that depend on events
        } catch (error) {
            console.error("Event save error:", error);
            showEventElement("eventFormError", true, error.message);
        } finally {
            eventRequestInFlight = false;
            submitBtn.disabled = false;
        }
    });

    document.getElementById("eventCancelEditBtn").addEventListener("click", resetEventForm);

    list.addEventListener("click", (clickEvent) => {
        const button = clickEvent.target.closest("[data-event-action]");
        if (!button) return;
        const eventId = button.dataset.eventId;
        if (button.dataset.eventAction === "edit") startEditingEvent(eventId);
        if (button.dataset.eventAction === "delete") deleteEvent(eventId);
    });
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

function formatScore(value) {
    return Number(value || 0).toFixed(1);
}

function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Phase 3: platform name -> modifier class for .platform-pill (colours live in style.css).
function platformPillClass(name) {
    const key = String(name || "").toLowerCase();
    return ["youtube", "tiktok", "instagram"].includes(key) ? `platform-pill--${key}` : "";
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}