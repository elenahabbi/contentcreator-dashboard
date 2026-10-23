// ---- in-memory state -------------------------------------------------
let summaryData = {};
let topContentData = [];
let platformData = [];
let trendData = [];
let metricsData = [];
let followerData = {};
let subscriberChart = null;
let consistencyData = {};
let platformConsistencyData = [];
let trendConsistencyData = [];
let consistencyTrendChart = null;

let connectionData = {};

let contentOptions = [];   // from GET /content   -> {content_id, title}
let platformOptions = [];  // from GET /platforms -> {platform_id, platform_name}

let trendChart = null;     // Chart.js instance

// A line/bar "over time" chart needs at least this many real data points
// before it is drawn; with fewer, a chart would imply a trend that the data
// cannot support, so an explanatory message with the real values is shown.
const MIN_TREND_POINTS = 3;
let editingMetricId = null; // null = "add" mode, otherwise metric_id being edited

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAnalytics);

    const addBtn = document.getElementById("addMetricBtn");
    if (addBtn) addBtn.addEventListener("click", () => openMetricModal());

    const syncSubscribersBtn = document.getElementById("syncSubscribersBtn");
    if (syncSubscribersBtn) {
        syncSubscribersBtn.addEventListener("click", syncYouTubeSubscribers);
    }

        const connectChannelBtn = document.getElementById("connectChannelBtn");
    if (connectChannelBtn) connectChannelBtn.addEventListener("click", connectYouTubeChannel);

    const switchChannelBtn = document.getElementById("switchChannelBtn");
    if (switchChannelBtn) switchChannelBtn.addEventListener("click", showSwitchChannelForm);

    const disconnectChannelBtn = document.getElementById("disconnectChannelBtn");
    if (disconnectChannelBtn) disconnectChannelBtn.addEventListener("click", disconnectYouTubeChannel);

    const connectYoutubeAccountBtn = document.getElementById("connectYoutubeAccountBtn");
    if (connectYoutubeAccountBtn) {
        connectYoutubeAccountBtn.addEventListener("click", () => {
            // Full-page navigation (not fetch) — the OAuth round-trip with
            // Google has to happen as real page loads, not an XHR/fetch call.
            window.location.href = `${API_BASE}/auth/youtube`;
        });
    }

    handleYoutubeConnectionRedirect();
    loadYoutubeConnectionStatus();

    const closeBtn = document.getElementById("closeMetricModal");
    if (closeBtn) closeBtn.addEventListener("click", closeMetricModal);

    const cancelBtn = document.getElementById("cancelMetricForm");
    if (cancelBtn) cancelBtn.addEventListener("click", closeMetricModal);

    const modal = document.getElementById("metricModal");
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeMetricModal();
        });
    }

    const form = document.getElementById("metricForm");
    if (form) form.addEventListener("submit", submitMetricForm);

    setupGoalForm();
    loadFormOptions();
    loadAnalytics();
});

// ============================================
// LOADING — analytics + metrics list together
// ============================================

async function loadAnalytics() {
    setAnalyticsLoading(true);
    clearPageError();

    try {
        const [
            summaryRes, topRes, platformRes, trendRes, metricsRes, followerRes,
            consistencyRes, consistencyPlatformRes, consistencyTrendRes, connectionRes,
        ] = await Promise.all([
            fetch(`${API_BASE}/analytics/summary`),
            fetch(`${API_BASE}/analytics/top-content`),
            fetch(`${API_BASE}/analytics/platform-performance`),
            fetch(`${API_BASE}/analytics/performance-over-time`),
            fetch(`${API_BASE}/performance-metrics`),
            fetch(`${API_BASE}/api/analytics/followers`),
            fetch(`${API_BASE}/analytics/consistency`),
            fetch(`${API_BASE}/analytics/consistency/by-platform`),
            fetch(`${API_BASE}/analytics/consistency/trend`),
            fetch(`${API_BASE}/api/youtube/connection`, {
                credentials: "include",
            }),
        ]);

        summaryData = await expectOk(summaryRes, "Could not load the analytics summary.");
        topContentData = await expectOk(topRes, "Could not load top-performing content.");
        platformData = await expectOk(platformRes, "Could not load platform performance.");
        trendData = await expectOk(trendRes, "Could not load the performance trend.");
        metricsData = await expectOk(metricsRes, "Could not load performance records.");
        followerData = await expectOk(followerRes, "Could not load YouTube subscriber analytics.");
        consistencyData = await expectOk(consistencyRes, "Could not load posting consistency.");
        platformConsistencyData = await expectOk(consistencyPlatformRes, "Could not load platform consistency.");
        trendConsistencyData = await expectOk(consistencyTrendRes, "Could not load the consistency trend.");
        // GET /api/youtube/connection intentionally isn't run through
        // expectOk() — it always returns 200 with a connected:false body
        // instead of an HTTP error status (see server.js), so treating a
        // non-OK response here as fatal would only apply to a genuine
        // network/server failure, not "no channel connected yet".
        connectionData = connectionRes.ok ? await connectionRes.json() : {};

        // ROOT CAUSE (PARTS 6 & 7 — "Performance Over Time" stayed blank
        // and "Top Performing Content" stayed stuck on "Loading top
        // content…"): these render*() calls used to run one after another
        // with no isolation. If any single one threw partway through
        // (e.g. a Chart.js instantiation failing because the CDN script
        // didn't load, or any other unexpected runtime error), every
        // render*() call still queued after it in this list — including
        // totally unrelated widgets like the trend chart and top-content
        // list — silently never ran at all, leaving their initial
        // "Loading…"/blank markup on screen forever, while widgets earlier
        // in the list (KPI cards, connection status) already looked fine.
        // That's an internal rendering failure, not a failed fetch — the
        // page-level error banner (catch block below) never fires for it
        // either, since the exception is caught right here per-widget
        // instead of bubbling past this point. Each widget now renders
        // (or fails) independently, exactly like a real loading/empty/
        // error state should.
        runRenderStep("KPI summary", renderSummary);
        runRenderStep("posting consistency", renderConsistency);
        runRenderStep("YouTube connection status", renderConnectionStatus);
        runRenderStep("subscriber analytics", renderSubscriberAnalytics);
        runRenderStep("consistency by platform", renderConsistencyPlatformTable);
        runRenderStep("consistency trend chart", renderConsistencyTrendChart);
        runRenderStep("performance over time chart", renderTrendChart);
        runRenderStep("platform performance table", renderPlatformTable);
        runRenderStep("top performing content", renderTopContent);
        runRenderStep("performance metrics table", renderMetricsTable);
        // Independent of the Promise.all above: a failure here must not
        // blank the rest of the page.
        loadGoalProgress();
    } catch (error) {
        console.error("Analytics load error:", error);
        showPageError(error.message || "Unable to load analytics data. Please try again.");
    } finally {
        setAnalyticsLoading(false);
    }
}

// Runs one widget's render function in isolation: a bug or unexpected
// runtime error in one widget is logged and otherwise contained, instead
// of aborting every widget queued after it in loadAnalytics() above.
function runRenderStep(label, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`Analytics widget "${label}" failed to render:`, error);
    }
}

// ============================================
// YOUTUBE CHANNEL CONNECTION
// (GET/POST/DELETE /api/youtube/channel, /api/youtube/connection)
// ============================================

// Shows which YouTube channel the backend currently considers connected
// (from GET /api/youtube/connection), and toggles between the connect
// form (nothing connected, or connecting a new one) and the linked-info
// view (a confirmed channel is active) — mirrors the video-connect
// pattern already used on the Content Planner page.
function renderConnectionStatus() {
    const connectForm = document.getElementById("youtubeChannelConnectForm");
    const linkedInfo = document.getElementById("youtubeChannelLinkedInfo");
    const errorEl = document.getElementById("youtubeChannelError");
    if (!connectForm || !linkedInfo) return;

    if (connectionData.connected) {
        connectForm.style.display = "none";
        linkedInfo.style.display = "block";
        setText("youtubeChannelNameText", connectionData.channelName || "Unknown name");
        setText("youtubeChannelIdText", connectionData.channelId);
        if (errorEl) errorEl.textContent = "";
    } else {
        connectForm.style.display = "flex";
        linkedInfo.style.display = "none";
        if (errorEl) {
            errorEl.textContent = connectionData.channelId
                ? `Channel ${connectionData.channelId} is configured but could not be confirmed${connectionData.error ? `: ${connectionData.error}` : "."}`
                : "";
        }
    }
}

async function connectYouTubeChannel() {
    const input = document.getElementById("youtubeChannelIdInput");
    const button = document.getElementById("connectChannelBtn");
    const errorEl = document.getElementById("youtubeChannelError");
    if (!input) return;

    const channelId = input.value.trim();
    if (errorEl) {
        errorEl.textContent = "";
        errorEl.classList.remove("success");
    }

    if (!channelId) {
        if (errorEl) errorEl.textContent = "Paste a YouTube channel ID first.";
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Connecting…";
    }

    if (errorEl) errorEl.textContent = "Checking that channel with YouTube…";

    try {
        const response = await fetch(`${API_BASE}/api/youtube/channel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ channel_id: channelId }),
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                body.message ||
                `Could not connect that channel (HTTP ${response.status}).`
            );
        }

        connectionData = body;
        input.value = "";

        // Update the YouTube connection UI immediately.
        renderConnectionStatus();

        if (errorEl) {
            errorEl.textContent =
                body.message || "YouTube channel connected successfully.";
            errorEl.classList.add("success");
        }

        // Refresh analytics independently. A failure in an unrelated
        // analytics widget must not make a successful channel connection
        // appear to have failed.
        loadAnalytics().catch((error) => {
            console.error(
                "Analytics refresh after YouTube connection failed:",
                error
            );
        });
    } catch (error) {
        console.error("YouTube channel connect error:", error);

        if (errorEl) {
            errorEl.classList.remove("success");
            errorEl.textContent =
                error.message ||
                "Could not connect that channel. Please try again.";
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Connect";
        }
    }
}

// Reveals the connect form again over the linked-info view, pre-filled
// with nothing, so the person can paste a different channel's ID. The
// currently connected channel stays connected until they submit a new one.
function showSwitchChannelForm() {
    const connectForm = document.getElementById("youtubeChannelConnectForm");
    const linkedInfo = document.getElementById("youtubeChannelLinkedInfo");
    const errorEl = document.getElementById("youtubeChannelError");
    if (connectForm) connectForm.style.display = "flex";
    if (linkedInfo) linkedInfo.style.display = "none";
    if (errorEl) errorEl.textContent = "";
}

async function disconnectYouTubeChannel() {
    if (!confirm("Disconnect this YouTube channel? Historical analytics will be kept.")) return;

    const button = document.getElementById("disconnectChannelBtn");
    const errorEl = document.getElementById("youtubeChannelError");
    if (button) button.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/youtube/channel`, {
            method: "DELETE",
            credentials: "include",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body.message || "Could not disconnect the channel.");
        }
        await loadAnalytics();
    } catch (error) {
        console.error("YouTube channel disconnect error:", error);
        if (errorEl) errorEl.textContent = error.message || "Could not disconnect the channel. Please try again.";
    } finally {
        if (button) button.disabled = false;
    }
}

// Loads the dropdown data used by the Add/Edit Metric form. Kept separate
// from loadAnalytics() so a failure here doesn't block the dashboard, and
// so we don't re-fetch it on every refresh.
async function loadFormOptions() {
    try {
        const [contentRes, platformsRes] = await Promise.all([
            fetch(`${API_BASE}/content`),
            fetch(`${API_BASE}/platforms`),
        ]);

        contentOptions = await expectOk(contentRes, "Could not load content list.");
        platformOptions = await expectOk(platformsRes, "Could not load platforms.");

        populateSelect("metricContent", contentOptions, "content_id", "title", "Select content…");
        populateSelect("metricPlatform", platformOptions, "platform_id", "platform_name", "Select platform…");
    } catch (error) {
        console.error("Error loading form options:", error);
        // Non-fatal: the dashboard itself still works, only "Add Metric" is affected.
        const addBtn = document.getElementById("addMetricBtn");
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.title = "Could not load content/platform lists.";
        }
    }
}

async function expectOk(response, fallbackMessage) {
    if (!response.ok) {
        let message = fallbackMessage;
        try {
            const body = await response.json();
            if (body && body.message) message = body.message;
        } catch (_) {
            // response wasn't JSON — keep the fallback message
        }
        throw new Error(message);
    }
    return response.json();
}

function setAnalyticsLoading(isLoading) {
    const page = document.getElementById("analyticsPage");
    if (page) page.classList.toggle("loading", isLoading);

    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.disabled = isLoading;
}

// ============================================
// KPI CARDS  (GET /analytics/summary)
// ============================================

function renderSummary() {
    setMetricValue("kpiViews", summaryData.total_views);
    setMetricValue("kpiLikes", summaryData.total_likes);
    setMetricValue("kpiComments", summaryData.total_comments);
    setText("kpiEngagement", formatPercent(summaryData.average_engagement_rate));
}

function setMetricValue(elementId, rawValue) {
    const el = document.getElementById(elementId);
    if (!el) return;
    // KPI cards always show the full, exact number with thousands separators
    // (e.g. 13,600) — compact K/M abbreviation is reserved for the chart axis,
    // where a little imprecision is fine but an exact KPI total is not.
    el.textContent = formatNumber(rawValue);
}

// ============================================
// POSTING CONSISTENCY  (GET /analytics/consistency,
// /analytics/consistency/by-platform, /analytics/consistency/trend)
// ============================================

function renderConsistency() {
    const summary = document.getElementById("consistencySummary");
    const note = document.getElementById("consistencyNote");
    const empty = document.getElementById("consistencyEmpty");

    const eligible = consistencyData.eligibleContent || 0;
    const pct = consistencyData.consistencyPercentage;

    // 0% is a real (bad) result, but "no data yet" must never look like 0% —
    // that would misrepresent a creator who simply hasn't hit a deadline yet.
    if (!eligible) {
        if (summary) summary.style.display = "none";
        if (note) note.style.display = "none";
        if (empty) empty.style.display = "block";
        return;
    }

    if (summary) summary.style.display = "flex";
    if (note) note.style.display = "block";
    if (empty) empty.style.display = "none";

    const percentEl = document.getElementById("consistencyPercentage");
    if (percentEl) {
        percentEl.textContent = pct === null || pct === undefined ? "N/A" : `${pct}%`;
    }
    setText("consistencyPublished", formatNumber(consistencyData.publishedCount));
    setText("consistencyMissed", formatNumber(consistencyData.missedCount));
    if (note) {
        note.textContent = `Based on ${formatNumber(eligible)} scheduled post${eligible === 1 ? "" : "s"} whose date has passed. ` +
            "Future and cancelled posts are excluded. This measures whether scheduled posts went out, " +
            "not progress toward a posting goal.";
    }
}

// ============================================
// POSTING GOAL PROGRESS + GOAL SETTINGS  (GET/PUT/DELETE /posting-goal)
// The server stores one goal per creator and works out progress: published
// posts today / this week / this month, against the creator's target. When
// there is no goal (or goal storage isn't set up yet) no percentage is shown
// at all — never a made-up 0% or 100%.
// ============================================

let postingGoal = null;            // { goal_type, target_count, period } or null
let goalStorageAvailable = true;   // false once the API reports the migration hasn't run

const GOAL_MAX_TARGET = { day: 20, week: 50, month: 200 };

function describePostingGoal(goal) {
    if (goal.goal_type === "daily") return "Daily posting (1 post per day)";
    const text = `${formatNumber(goal.target_count)} post${goal.target_count === 1 ? "" : "s"} per ${goal.period}`;
    return goal.goal_type === "custom" ? `${text} (custom)` : text;
}

function renderGoalProgress(data) {
    const valueEl = document.getElementById("goalProgressValue");
    const countEl = document.getElementById("goalProgressCount");
    const countLabelEl = document.getElementById("goalProgressCountLabel");
    const detailEl = document.getElementById("goalProgressDetail");
    const editBtn = document.getElementById("goalEditBtn");
    if (!valueEl || !countEl || !countLabelEl || !detailEl) return;

    postingGoal = data && data.goal ? data.goal : null;
    // Don't re-show the Edit button while the form is open (e.g. after Refresh).
    const goalForm = document.getElementById("goalForm");
    const formOpen = !!goalForm && goalForm.style.display === "flex";
    if (editBtn && !formOpen) editBtn.style.display = "inline-block";

    const progress = data && data.progress ? data.progress : null;

    if (!postingGoal || !progress) {
        valueEl.textContent = "—";
        countEl.textContent = "—";
        countLabelEl.textContent = "Published";
        detailEl.textContent = "You haven't set a posting goal yet. Set one to see how much of it you've reached.";
        if (editBtn) editBtn.textContent = "Set posting goal";
        return;
    }

    valueEl.textContent = `${progress.percentage}%`;
    countEl.textContent = formatNumber(progress.published_count);
    countLabelEl.textContent = `Published ${progress.window_label}`;
    detailEl.textContent =
        `${formatNumber(progress.published_count)} of ${formatNumber(progress.target_count)} ` +
        `post${progress.target_count === 1 ? "" : "s"} published ${progress.window_label}. ` +
        `Goal: ${describePostingGoal(postingGoal)}.` +
        (progress.percentage >= 100 ? " Goal reached." : "");
    if (editBtn) editBtn.textContent = "Edit goal";
}

function renderGoalUnavailable(message) {
    const valueEl = document.getElementById("goalProgressValue");
    const countEl = document.getElementById("goalProgressCount");
    const detailEl = document.getElementById("goalProgressDetail");
    const editBtn = document.getElementById("goalEditBtn");
    if (valueEl) valueEl.textContent = "—";
    if (countEl) countEl.textContent = "—";
    if (detailEl) detailEl.textContent = message;
    if (editBtn) editBtn.style.display = "none";
    closeGoalForm();
}

async function loadGoalProgress() {
    try {
        const response = await fetch(`${API_BASE}/posting-goal`);
        if (response.status === 503) {
            const body = await response.json().catch(() => ({}));
            if (body.code === "POSTING_GOAL_SCHEMA_MISSING") {
                goalStorageAvailable = false;
                renderGoalUnavailable(
                    "Posting goals need a one-time database setup that hasn't been run yet, so a goal can't be saved or measured."
                );
                return;
            }
        }
        if (!response.ok) throw new Error("Request failed");
        goalStorageAvailable = true;
        renderGoalProgress(await response.json());
    } catch (error) {
        console.error("Could not load posting goal progress:", error);
        renderGoalUnavailable("Could not load your posting goal right now. Try refreshing the page.");
    }
}

function goalPeriodForType(type) {
    if (type === "daily") return "day";
    if (type === "weekly") return "week";
    if (type === "monthly") return "month";
    return document.getElementById("goalPeriod").value;
}

function syncGoalFormFields() {
    const type = document.getElementById("goalType").value;
    const countRow = document.getElementById("goalCountRow");
    const periodRow = document.getElementById("goalPeriodRow");
    const countInput = document.getElementById("goalCount");

    if (countRow) countRow.style.display = type === "daily" ? "none" : "flex";
    if (periodRow) periodRow.style.display = type === "custom" ? "flex" : "none";
    if (countInput) countInput.max = String(GOAL_MAX_TARGET[goalPeriodForType(type)]);
}

function showGoalFormError(message) {
    const el = document.getElementById("goalFormError");
    if (el) el.textContent = message || "";
}

function openGoalForm() {
    const form = document.getElementById("goalForm");
    if (!form || !goalStorageAvailable) return;

    showGoalFormError("");
    const typeSelect = document.getElementById("goalType");
    const countInput = document.getElementById("goalCount");
    const periodSelect = document.getElementById("goalPeriod");

    if (postingGoal) {
        typeSelect.value = postingGoal.goal_type;
        countInput.value = postingGoal.goal_type === "daily" ? "" : postingGoal.target_count;
        periodSelect.value = postingGoal.period;
    } else {
        typeSelect.value = "monthly";
        countInput.value = "";
        periodSelect.value = "month";
    }

    const removeBtn = document.getElementById("goalRemoveBtn");
    if (removeBtn) removeBtn.style.display = postingGoal ? "inline-block" : "none";

    syncGoalFormFields();
    form.style.display = "flex";
    const editBtn = document.getElementById("goalEditBtn");
    if (editBtn) editBtn.style.display = "none";
    typeSelect.focus();
}

function closeGoalForm() {
    const form = document.getElementById("goalForm");
    if (form) form.style.display = "none";
    const editBtn = document.getElementById("goalEditBtn");
    if (editBtn && goalStorageAvailable) editBtn.style.display = "inline-block";
}

async function submitGoalForm(event) {
    event.preventDefault();
    showGoalFormError("");

    const type = document.getElementById("goalType").value;
    const saveBtn = document.getElementById("goalSaveBtn");
    const payload = { goal_type: type };

    if (type !== "daily") {
        const rawCount = document.getElementById("goalCount").value.trim();
        const count = Number(rawCount);
        const period = goalPeriodForType(type);
        const max = GOAL_MAX_TARGET[period];
        if (rawCount === "" || !Number.isInteger(count) || count < 1 || count > max) {
            showGoalFormError(`Enter a whole number of posts per ${period} between 1 and ${max}.`);
            return;
        }
        payload.target_count = count;
    }
    if (type === "custom") payload.period = document.getElementById("goalPeriod").value;

    if (saveBtn) saveBtn.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/posting-goal`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body.message || "Could not save your posting goal.");
        }
        renderGoalProgress(body);
        closeGoalForm();
    } catch (error) {
        showGoalFormError(error.message || "Could not save your posting goal.");
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function removePostingGoal() {
    if (!window.confirm("Remove your posting goal? Your published posts and schedule are not affected.")) return;

    const removeBtn = document.getElementById("goalRemoveBtn");
    if (removeBtn) removeBtn.disabled = true;
    showGoalFormError("");
    try {
        const response = await fetch(`${API_BASE}/posting-goal`, { method: "DELETE" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || "Could not remove your posting goal.");
        renderGoalProgress(body);
        closeGoalForm();
    } catch (error) {
        showGoalFormError(error.message || "Could not remove your posting goal.");
    } finally {
        if (removeBtn) removeBtn.disabled = false;
    }
}

function setupGoalForm() {
    const editBtn = document.getElementById("goalEditBtn");
    if (editBtn) editBtn.addEventListener("click", openGoalForm);

    const typeSelect = document.getElementById("goalType");
    if (typeSelect) typeSelect.addEventListener("change", syncGoalFormFields);

    const periodSelect = document.getElementById("goalPeriod");
    if (periodSelect) periodSelect.addEventListener("change", syncGoalFormFields);

    const form = document.getElementById("goalForm");
    if (form) form.addEventListener("submit", submitGoalForm);

    const cancelBtn = document.getElementById("goalCancelBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", closeGoalForm);

    const removeBtn = document.getElementById("goalRemoveBtn");
    if (removeBtn) removeBtn.addEventListener("click", removePostingGoal);
}

function renderConsistencyPlatformTable() {
    const tbody = document.getElementById("consistencyPlatformTableBody");
    const emptyState = document.getElementById("consistencyPlatformEmpty");
    if (!tbody) return;

    if (!Array.isArray(platformConsistencyData) || platformConsistencyData.length === 0) {
        tbody.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = platformConsistencyData.map(row => `
        <tr>
            <td><span class="platform-pill">${escapeHTML(row.platform || "Unknown")}</span></td>
            <td>${formatNumber(row.publishedCount)}</td>
            <td>${formatNumber(row.missedCount)}</td>
            <td>${row.consistencyPercentage === null ? "N/A" : formatPercent(row.consistencyPercentage)}</td>
        </tr>
    `).join("");
}

function renderConsistencyTrendChart() {
    const canvas = document.getElementById("consistencyTrendChart");
    const emptyState = document.getElementById("consistencyTrendEmpty");
    if (!canvas) return;

    const adherenceRows = Array.isArray(trendConsistencyData) ? trendConsistencyData : [];
    const adherencePoints = adherenceRows.filter(
        row => row.consistencyPercentage !== null && row.consistencyPercentage !== undefined
    );
    if (adherencePoints.length < MIN_TREND_POINTS) {
        if (emptyState) {
            emptyState.textContent = adherencePoints.length === 0
                ? "No completed publishing deadlines yet, so there is no schedule adherence history to chart."
                : `Only ${adherencePoints.length} period${adherencePoints.length === 1 ? "" : "s"} with completed deadlines so far ` +
                  `(${adherencePoints.map(row => `${row.period}: ${row.consistencyPercentage}%`).join(", ")}). ` +
                  `A chart over time needs at least ${MIN_TREND_POINTS} periods, so no trend is shown yet.`;
        }
        canvas.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        if (consistencyTrendChart) {
            consistencyTrendChart.destroy();
            consistencyTrendChart = null;
        }
        return;
    }

    // See the matching guard in renderTrendChart() (PART 6) for why this
    // check exists.
    if (typeof Chart === "undefined") {
        canvas.style.display = "none";
        if (emptyState) {
            emptyState.textContent = "Could not load the chart library. Try refreshing the page.";
            emptyState.style.display = "block";
        }
        return;
    }

    canvas.style.display = "block";
    if (emptyState) emptyState.style.display = "none";

    const labels = trendConsistencyData.map(row => row.period);
    // null stays null (Chart.js leaves a gap) — "no data" must never be drawn as 0%.
    const values = trendConsistencyData.map(row => row.consistencyPercentage === null ? null : row.consistencyPercentage);

    if (consistencyTrendChart) {
        consistencyTrendChart.data.labels = labels;
        consistencyTrendChart.data.datasets[0].data = values;
        consistencyTrendChart.update();
        return;
    }

    consistencyTrendChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Schedule adherence %",
                data: values,
                backgroundColor: "#8D93CB",
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y}% schedule adherence`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#7a6f6f" },
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: "#f0e1d4" },
                    ticks: {
                        color: "#7a6f6f",
                        callback: (value) => `${value}%`,
                    },
                },
            },
        },
    });
}

// ============================================
// YOUTUBE SUBSCRIBER ANALYTICS
// (GET /api/analytics/followers)
// ============================================

function renderSubscriberAnalytics() {
    const current = followerData.currentSubscribers;
    const growth = followerData.subscriberGrowth;
    const rate = followerData.growthRate;
    const history = Array.isArray(followerData.history) ? followerData.history : [];

    setText(
        "subscriberCurrent",
        current === null || current === undefined ? "—" : formatNumber(current)
    );
    // "Since last sync" — the change between the two most recent snapshots
    // only. Two identical back-to-back syncs correctly show 0 here; that
    // is not history being lost, see subscriberAllTimeGrowth below for the
    // full trend across every retained snapshot.
    setText(
        "subscriberGrowth",
        growth === null || growth === undefined ? "N/A" : formatSignedNumber(growth)
    );
    setText(
        "subscriberGrowthRate",
        rate === null || rate === undefined ? "N/A" : `${Number(rate).toFixed(2)}%`
    );

    // "All-time" — change from the very first retained snapshot to the
    // latest one, computed from the same history array the chart uses.
    // Nothing new is fetched or stored for this; it only reframes data the
    // backend already sent, per the existing follower_metrics history.
    const allTimeEl = document.getElementById("subscriberAllTimeGrowth");
    if (allTimeEl) {
        if (history.length >= 2) {
            const first = Number(history[0].follower_count) || 0;
            const last = Number(history[history.length - 1].follower_count) || 0;
            allTimeEl.textContent = formatSignedNumber(last - first);
        } else {
            allTimeEl.textContent = "N/A";
        }
    }

    renderSubscriberChart();
}

// ============================================
// YOUTUBE ACCOUNT CONNECTION (Google OAuth)
// ============================================

// Reads the ?youtube=connected|error|config_missing query param that
// /auth/youtube/callback redirects back with, shows a one-time status
// message, then strips the param so a page refresh doesn't repeat it.
function handleYoutubeConnectionRedirect() {
    const params = new URLSearchParams(window.location.search);
    const youtubeParam = params.get("youtube");
    if (!youtubeParam) return;

    const message = document.getElementById("youtubeConnectionMessage");
    if (message) {
        if (youtubeParam === "connected") {
            message.textContent = "YouTube account connected successfully.";
            message.className = "subscriber-sync-message success";
        } else if (youtubeParam === "config_missing") {
            message.textContent = "YouTube connection isn't configured on the server yet.";
            message.className = "subscriber-sync-message error";
        } else {
            message.textContent = "Could not connect your YouTube account. Please try again.";
            message.className = "subscriber-sync-message error";
        }
    }

    params.delete("youtube");
    const newSearch = params.toString();
    const newUrl =
        window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
}

// Asks the backend whether YouTube is connected and shows the right UI
// state — "Connect YouTube" button, or a connected indicator. Never
// receives or handles an OAuth token; only a boolean + channel ID.
async function loadYoutubeConnectionStatus() {
    const badge = document.getElementById("youtubeConnectionBadge");
    const connectBtn = document.getElementById("connectYoutubeAccountBtn");
    if (!badge) return;

    try {
        const response = await fetch(`${API_BASE}/youtube/connection-status`, {
            credentials: "include",
        });
        if (!response.ok) throw new Error("Could not check YouTube connection status.");
        const data = await response.json();

        if (data.connected) {
            badge.textContent = "YouTube Connected";
            badge.className = "youtube-connection-badge youtube-connection-badge--connected";
            if (connectBtn) connectBtn.classList.add("is-hidden");
        } else {
            badge.textContent = "YouTube Not Connected";
            badge.className = "youtube-connection-badge youtube-connection-badge--not-connected";
            if (connectBtn) connectBtn.classList.remove("is-hidden");
        }
    } catch (error) {
        console.error("YouTube connection status error:", error);
        badge.textContent = "Could not check YouTube connection";
        badge.className = "youtube-connection-badge youtube-connection-badge--not-connected";
        if (connectBtn) connectBtn.classList.remove("is-hidden");
    }
}

async function syncYouTubeSubscribers() {
    const button = document.getElementById("syncSubscribersBtn");
    const message = document.getElementById("subscriberSyncMessage");

    if (button) {
        button.disabled = true;
        button.textContent = "Syncing…";
    }
    if (message) {
        message.textContent = "Fetching the latest public subscriber count from YouTube…";
        message.className = "subscriber-sync-message";
    }

    try {
        const response = await fetch(`${API_BASE}/api/analytics/youtube/subscribers/sync`, {
            method: "POST",
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body.message || "Could not sync YouTube subscribers.");
        }

        if (message) {
            message.textContent = body.duplicate
                ? "Already synced within the last 60 seconds. No duplicate snapshot was created."
                : `YouTube subscribers synced: ${formatNumber(body.follower_count)}.`;
            message.className = "subscriber-sync-message success";
        }

        await loadAnalytics();
    } catch (error) {
        console.error("YouTube subscriber sync error:", error);
        if (message) {
            message.textContent = error.message || "Could not sync YouTube subscribers. Please try again.";
            message.className = "subscriber-sync-message error";
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Sync YouTube Subscribers";
        }
    }
}

function renderSubscriberChart() {
    const canvas = document.getElementById("subscriberChart");
    const emptyState = document.getElementById("subscriberEmpty");
    const history = Array.isArray(followerData.history) ? followerData.history : [];

    if (!canvas) return;

    if (history.length < MIN_TREND_POINTS) {
        if (emptyState) {
            emptyState.textContent = history.length === 0
                ? "No subscriber history yet. Sync your YouTube subscribers to record the first snapshot."
                : `Only ${history.length} subscriber snapshot${history.length === 1 ? "" : "s"} recorded so far. ` +
                  `A chart over time needs at least ${MIN_TREND_POINTS} syncs; until then the figures above are the real values.`;
        }
        canvas.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        if (subscriberChart) {
            subscriberChart.destroy();
            subscriberChart = null;
        }
        return;
    }

    // See the matching guard in renderTrendChart() (PART 6) for why this
    // check exists.
    if (typeof Chart === "undefined") {
        canvas.style.display = "none";
        if (emptyState) {
            emptyState.textContent = "Could not load the chart library. Try refreshing the page.";
            emptyState.style.display = "block";
        }
        return;
    }

    canvas.style.display = "block";
    if (emptyState) emptyState.style.display = "none";

    const labels = history.map(row => formatDateTime(row.recorded_at));
    const subscribers = history.map(row => Number(row.follower_count) || 0);

    if (subscriberChart) {
        subscriberChart.data.labels = labels;
        subscriberChart.data.datasets[0].data = subscribers;
        subscriberChart.update();
        return;
    }

    subscriberChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Subscribers",
                data: subscribers,
                borderColor: "#8D93CB",
                backgroundColor: "rgba(141, 147, 203, 0.15)",
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                pointBackgroundColor: "#8D93CB",
                fill: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${formatNumber(ctx.parsed.y)} subscribers`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#7a6f6f" },
                },
                y: {
                    beginAtZero: false,
                    grid: { color: "#f0e1d4" },
                    ticks: {
                        color: "#7a6f6f",
                        callback: (value) => formatCompactNumber(value),
                    },
                },
            },
        },
    });
}

// ============================================
// PERFORMANCE OVER TIME CHART  (GET /analytics/performance-over-time)
// ============================================

function renderTrendChart() {
    const canvas = document.getElementById("trendChart");
    const emptyState = document.getElementById("trendEmpty");
    if (!canvas) return;

    const syncRows = Array.isArray(trendData) ? trendData : [];
    if (syncRows.length < MIN_TREND_POINTS) {
        if (emptyState) {
            const latest = syncRows[syncRows.length - 1];
            emptyState.textContent = syncRows.length === 0
                ? "No performance data available yet. Sync a video's analytics from the Content Planner to record the first snapshot."
                : `Only ${syncRows.length} sync date${syncRows.length === 1 ? "" : "s"} recorded so far ` +
                  `(latest: ${formatDateLabel(latest.date)}, ${formatNumber(latest.views)} lifetime views recorded). ` +
                  `A chart needs at least ${MIN_TREND_POINTS} sync dates. These totals are lifetime snapshots, not views gained per day.`;
        }
        canvas.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
        }
        return;
    }

    // Defence in depth for PART 6: if the Chart.js CDN script (loaded in
    // analytics.html) ever fails to load, don't leave the canvas visible
    // but un-drawn (an "unexplained blank div" in every practical sense) —
    // fall back to a clear, worded empty state instead. loadAnalytics()'s
    // per-widget isolation (see runRenderStep) already stops this from
    // taking down other widgets, but the div should never look blank on
    // its own either.
    if (typeof Chart === "undefined") {
        canvas.style.display = "none";
        if (emptyState) {
            emptyState.textContent = "Could not load the chart library. Try refreshing the page.";
            emptyState.style.display = "block";
        }
        return;
    }

    canvas.style.display = "block";
    if (emptyState) emptyState.style.display = "none";

    const labels = trendData.map(row => formatDateLabel(row.date));
    const views = trendData.map(row => Number(row.views) || 0);

    if (trendChart) {
        trendChart.data.labels = labels;
        trendChart.data.datasets[0].data = views;
        trendChart.update();
        return;
    }

    // Bars (not a filled line): each bar is a lifetime-total snapshot for one
    // sync date, not a quantity that accumulated during that day.
    trendChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Lifetime views recorded",
                data: views,
                backgroundColor: "#8D93CB",
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${formatNumber(ctx.parsed.y)} lifetime views recorded`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: "#7a6f6f" },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: "#f0e1d4" },
                    ticks: {
                        color: "#7a6f6f",
                        callback: (value) => formatCompactNumber(value),
                    },
                },
            },
        },
    });
}

// ============================================
// PLATFORM PERFORMANCE  (GET /analytics/platform-performance)
// ============================================

function renderPlatformTable() {
    const tbody = document.getElementById("platformTableBody");
    const emptyState = document.getElementById("platformEmpty");
    if (!tbody) return;

    if (!Array.isArray(platformData) || platformData.length === 0) {
        tbody.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = platformData.map(row => `
        <tr>
            <td><span class="platform-pill">${escapeHTML(row.platform_name || "Unknown")}</span></td>
            <td>${formatNumber(row.total_views)}</td>
            <td>${formatNumber(row.total_likes)}</td>
            <td>${formatNumber(row.total_comments)}</td>
            <td>${formatPercent(row.average_engagement_rate)}</td>
        </tr>
    `).join("");
}

// ============================================
// TOP PERFORMING CONTENT  (GET /analytics/top-content)
// ============================================

function renderTopContent() {
    const container = document.getElementById("topContent");
    if (!container) return;

    if (!Array.isArray(topContentData) || topContentData.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                No performance data available yet.<br>
                Add performance data to begin analysing your content.
            </div>
        `;
        return;
    }

    container.innerHTML = topContentData.slice(0, 5).map((item, index) => `
        <div class="top-content-item${index === 0 ? " top-content-first" : ""}">
            <div class="top-content-rank">#${index + 1}</div>
            <div class="top-content-body">
                <div class="top-content-title">${escapeHTML(item.content_title || "Untitled")}</div>
                <div class="top-content-meta">
                    <span class="platform-pill">${escapeHTML(item.platform_name || "Unknown")}</span>
                    ${formatNumber(item.views)} views ·
                    ${formatNumber(item.likes)} likes ·
                    ${formatNumber(item.comments)} comments
                </div>
            </div>
            <div class="top-content-engagement">
                ${formatPercent(item.engagement_rate)}
                <span class="top-content-engagement-label">engagement</span>
            </div>
        </div>
    `).join("");
}

// ============================================
// PERFORMANCE METRICS MANAGEMENT
// (GET/POST/PUT/DELETE /performance-metrics)
// ============================================

function renderMetricsTable() {
    const tbody = document.getElementById("metricsTableBody");
    const emptyState = document.getElementById("metricsEmpty");
    if (!tbody) return;

    if (!Array.isArray(metricsData) || metricsData.length === 0) {
        tbody.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = metricsData.map(metric => `
        <tr>
            <td>${escapeHTML(metric.content_title || "Untitled")}</td>
            <td><span class="platform-pill">${escapeHTML(metric.platform_name || "Unknown")}</span></td>
            <td>${formatNumber(metric.views)}</td>
            <td>${formatNumber(metric.likes)}</td>
            <td>${formatNumber(metric.comments)}</td>
            <td>${formatPercent(metric.engagement_rate)}</td>
            <td>${formatDateTime(metric.recorded_at)}</td>
            <td class="metrics-actions">
                <button type="button" class="edit-metric-btn" data-id="${metric.metric_id}">Edit</button>
                <button type="button" class="delete-metric-btn" data-id="${metric.metric_id}">Delete</button>
            </td>
        </tr>
    `).join("");

    tbody.querySelectorAll(".edit-metric-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const metric = metricsData.find(m => String(m.metric_id) === btn.dataset.id);
            if (metric) openMetricModal(metric);
        });
    });

    tbody.querySelectorAll(".delete-metric-btn").forEach(btn => {
        btn.addEventListener("click", () => deleteMetric(btn.dataset.id));
    });
}

// ---- Add / Edit modal --------------------------------------------------

function openMetricModal(metric) {
    const modal = document.getElementById("metricModal");
    const title = document.getElementById("metricModalTitle");
    const form = document.getElementById("metricForm");
    const contentField = document.getElementById("metricContent");
    const platformField = document.getElementById("metricPlatform");
    const formError = document.getElementById("metricFormError");

    if (!modal || !form) return;

    form.reset();
    if (formError) formError.textContent = "";

    editingMetricId = metric ? metric.metric_id : null;

    if (metric) {
        if (title) title.textContent = "Edit Performance Metric";
        // The content/platform lists load in parallel with the metrics table,
        // so on a slow connection the matching <option> might not exist yet —
        // ensure it does before selecting it, using the names already on the metric.
        ensureOptionExists(contentField, metric.content_id, metric.content_title);
        ensureOptionExists(platformField, metric.platform_id, metric.platform_name);
        contentField.value = metric.content_id;
        platformField.value = metric.platform_id;
        contentField.disabled = true;
        platformField.disabled = true;
        document.getElementById("metricViews").value = metric.views;
        document.getElementById("metricLikes").value = metric.likes;
        document.getElementById("metricComments").value = metric.comments;
        document.getElementById("metricShares").value = metric.shares;
    } else {
        if (title) title.textContent = "Add Performance Metric";
        contentField.disabled = false;
        platformField.disabled = false;
    }

    modal.classList.add("active");
}

function closeMetricModal() {
    const modal = document.getElementById("metricModal");
    if (modal) modal.classList.remove("active");
    editingMetricId = null;
}

async function submitMetricForm(event) {
    event.preventDefault();

    const formError = document.getElementById("metricFormError");
    const submitBtn = document.getElementById("saveMetricBtn");
    if (formError) formError.textContent = "";

    const views = Number(document.getElementById("metricViews").value);
    const likes = Number(document.getElementById("metricLikes").value);
    const comments = Number(document.getElementById("metricComments").value);
    const shares = Number(document.getElementById("metricShares").value);

    const counts = { views, likes, comments, shares };
    for (const [field, value] of Object.entries(counts)) {
        if (!Number.isInteger(value) || value < 0) {
            if (formError) formError.textContent = `${field} must be a whole number that is 0 or greater.`;
            return;
        }
    }

    const payload = { ...counts };

    let url = `${API_BASE}/performance-metrics`;
    let method = "POST";

    if (editingMetricId) {
        url = `${API_BASE}/performance-metrics/${editingMetricId}`;
        method = "PUT";
    } else {
        const contentId = document.getElementById("metricContent").value;
        const platformId = document.getElementById("metricPlatform").value;

        if (!contentId || !platformId) {
            if (formError) formError.textContent = "Please select both content and a platform.";
            return;
        }

        payload.content_id = Number(contentId);
        payload.platform_id = Number(platformId);
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
        const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const detail = Array.isArray(body.errors) ? body.errors.join(" ") : "";
            throw new Error([body.message, detail].filter(Boolean).join(" ") || "Could not save this metric.");
        }

        closeMetricModal();
        await loadAnalytics();
    } catch (error) {
        console.error("Error saving metric:", error);
        if (formError) formError.textContent = error.message || "Could not save this metric. Please try again.";
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function deleteMetric(id) {
    if (!id) return;
    if (!confirm("Delete this performance record? This cannot be undone.")) return;

    try {
        const response = await fetch(`${API_BASE}/performance-metrics/${id}`, { method: "DELETE" });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || "Could not delete this metric.");
        }

        await loadAnalytics();
    } catch (error) {
        console.error("Error deleting metric:", error);
        showPageError(error.message || "Could not delete this metric. Please try again.");
    }
}

// ============================================
// FORM OPTIONS HELPER
// ============================================

function ensureOptionExists(selectEl, value, label) {
    if (!selectEl || value === undefined || value === null) return;
    const exists = Array.from(selectEl.options).some(opt => opt.value === String(value));
    if (!exists) {
        const opt = document.createElement("option");
        opt.value = String(value);
        opt.textContent = label || `#${value}`;
        selectEl.appendChild(opt);
    }
}

function populateSelect(elementId, items, valueField, labelField, placeholder) {
    const select = document.getElementById(elementId);
    if (!select) return;

    const options = [`<option value="">${escapeHTML(placeholder)}</option>`]
        .concat(items.map(item => `
            <option value="${item[valueField]}">${escapeHTML(item[labelField] || `#${item[valueField]}`)}</option>
        `));

    select.innerHTML = options.join("");
}

// ============================================
// PAGE-LEVEL ERROR BANNER
// ============================================

function showPageError(message) {
    const banner = document.getElementById("analyticsError");
    if (!banner) return;
    banner.textContent = message;
    banner.style.display = "block";
}

function clearPageError() {
    const banner = document.getElementById("analyticsError");
    if (!banner) return;
    banner.textContent = "";
    banner.style.display = "none";
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

// Compact display (13.6K / 1.2M) while keeping the exact value available
// via the element's title attribute — see setMetricValue().
function formatCompactNumber(value) {
    const num = Number(value || 0);
    if (Math.abs(num) >= 1_000_000) {
        return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    }
    if (Math.abs(num) >= 10_000) {
        return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    return num.toLocaleString("en-US");
}

// engagement_rate / average_engagement_rate already arrive as percentage
// numbers (e.g. 12.95 means 12.95%) — never multiply or append twice.
function formatPercent(value) {
    return `${Number(value || 0).toFixed(2)}%`;
}

function formatSignedNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "N/A";
    if (num > 0) return `+${formatNumber(num)}`;
    return formatNumber(num);
}

function formatDateLabel(dateValue) {
    if (!dateValue) return "";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return String(dateValue);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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