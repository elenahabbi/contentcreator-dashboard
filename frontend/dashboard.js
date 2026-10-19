

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    loadPostsConsistency();
        loadDashboardSummary();
    loadPlatformsForCompetitorForm();
    setupAddCompetitorForm();
    loadEvents();
    setupEventForm();
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
                renderOpportunities(data.opportunities);
        renderRecommendations(data.recommendations);
        renderSectionErrors(data.sectionErrors);
        renderCompetitorCount(data.competitorsTracked);
    } catch (error) {
        console.error("Dashboard summary load error:", error);
        showDashboardError(error.message || "Unable to load the dashboard. Please try again.");
    }

    // The competitor list itself (name/platform/profile) isn't part of
    // /dashboard/summary — only the count is, to keep that endpoint's
    // response small. Load it separately from the existing GET
    // /competitors route.
    loadCompetitorList();
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
// COMPETITORS
// The dashboard summary only returns a count (renderCompetitorCount,
// below). The list itself, the add-competitor form, and the platform
// dropdown all use the existing GET/POST /competitors and GET
// /platforms routes directly — no new backend endpoints were needed.
// ============================================

function renderCompetitorCount(count) {
    setText("competitorCount", formatNumber(count || 0));
}

async function loadPlatformsForCompetitorForm() {
    const select = document.getElementById("competitorPlatform");
    if (!select) return;
    try {
        const response = await fetch(`${API_BASE}/platforms`);
        if (!response.ok) throw new Error("Request failed");
        const platforms = await response.json();
        for (const platform of platforms) {
            const option = document.createElement("option");
            option.value = platform.platform_id;
            option.textContent = platform.platform_name;
            select.appendChild(option);
        }
    } catch (error) {
        console.error("Could not load platforms for competitor form:", error);
    }
}

async function loadCompetitorList() {
    const list = document.getElementById("competitorList");
    const empty = document.getElementById("competitorEmpty");
    if (!list) return;

    try {
        const response = await fetch(`${API_BASE}/competitors`);
        if (!response.ok) throw new Error("Request failed");
        const competitors = await response.json();

        if (!Array.isArray(competitors) || competitors.length === 0) {
            list.innerHTML = "";
            if (empty) empty.classList.remove("is-hidden");
            return;
        }
        if (empty) empty.classList.add("is-hidden");

        list.innerHTML = competitors.map(c => `
            <li class="dashboard-competitor-item">
                <span>
                    <strong>${escapeHTML(c.name)}</strong>
                    <span class="platform-pill">${escapeHTML(c.platform_name)}</span>
                </span>
                <button class="quick-action-btn quick-action-btn--small" data-competitor-id="${c.competitor_id}">Remove</button>
            </li>
        `).join("");
    } catch (error) {
        console.error("Could not load competitors:", error);
        list.innerHTML = "";
    }
}

function setupAddCompetitorForm() {
    const form = document.getElementById("addCompetitorForm");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const nameInput = document.getElementById("competitorName");
        const platformInput = document.getElementById("competitorPlatform");
        const urlInput = document.getElementById("competitorUrl");
        const errorEl = document.getElementById("competitorFormError");
        if (errorEl) { errorEl.classList.add("is-hidden"); errorEl.textContent = ""; }

        try {
            const response = await fetch(`${API_BASE}/competitors`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: nameInput.value.trim(),
                    platform_id: platformInput.value,
                    profile_url: urlInput.value.trim() || null,
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.message || "Could not add competitor.");
            }
            form.reset();
            // Refreshes both the competitor list and the summary count
            // (and re-runs opportunity detection, since a new competitor
            // can immediately surface new opportunities).
            loadDashboardSummary();
        } catch (error) {
            console.error("Could not add competitor:", error);
            if (errorEl) { errorEl.textContent = error.message || "Could not add competitor."; errorEl.classList.remove("is-hidden"); }
        }
    });

    // Delegated remove-competitor click handler.
    document.getElementById("competitorList")?.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-competitor-id]");
        if (!button) return;
        const id = button.dataset.competitorId;
        button.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/competitors/${id}`, { method: "DELETE" });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.message || "Could not remove competitor.");
            }
            loadCompetitorList();
            loadDashboardSummary();
        } catch (error) {
            console.error(`Could not remove competitor ${id}:`, error);
            showDashboardError(error.message || "Could not remove competitor.");
            button.disabled = false;
        }
    });
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

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}