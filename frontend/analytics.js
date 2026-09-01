const API_BASE = "http://localhost:3000";

// ---- in-memory state -------------------------------------------------
let summaryData = {};
let topContentData = [];
let platformData = [];
let trendData = [];
let metricsData = [];

let contentOptions = [];   // from GET /content   -> {content_id, title}
let platformOptions = [];  // from GET /platforms -> {platform_id, platform_name}

let trendChart = null;     // Chart.js instance
let editingMetricId = null; // null = "add" mode, otherwise metric_id being edited

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAnalytics);

    const addBtn = document.getElementById("addMetricBtn");
    if (addBtn) addBtn.addEventListener("click", () => openMetricModal());

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
        const [summaryRes, topRes, platformRes, trendRes, metricsRes] = await Promise.all([
            fetch(`${API_BASE}/analytics/summary`),
            fetch(`${API_BASE}/analytics/top-content`),
            fetch(`${API_BASE}/analytics/platform-performance`),
            fetch(`${API_BASE}/analytics/performance-over-time`),
            fetch(`${API_BASE}/performance-metrics`),
        ]);

        summaryData = await expectOk(summaryRes, "Could not load the analytics summary.");
        topContentData = await expectOk(topRes, "Could not load top-performing content.");
        platformData = await expectOk(platformRes, "Could not load platform performance.");
        trendData = await expectOk(trendRes, "Could not load the performance trend.");
        metricsData = await expectOk(metricsRes, "Could not load performance records.");

        renderSummary();
        renderTrendChart();
        renderPlatformTable();
        renderTopContent();
        renderMetricsTable();
    } catch (error) {
        console.error("Analytics load error:", error);
        showPageError(error.message || "Unable to load analytics data. Please try again.");
    } finally {
        setAnalyticsLoading(false);
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
    setMetricValue("kpiShares", summaryData.total_shares);
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
// PERFORMANCE OVER TIME CHART  (GET /analytics/performance-over-time)
// ============================================

function renderTrendChart() {
    const canvas = document.getElementById("trendChart");
    const emptyState = document.getElementById("trendEmpty");
    if (!canvas) return;

    if (!Array.isArray(trendData) || trendData.length === 0) {
        canvas.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
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

    trendChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Views",
                data: views,
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
                        label: (ctx) => `${formatNumber(ctx.parsed.y)} views`,
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
            <td>${formatNumber(row.total_shares)}</td>
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
                    ${formatNumber(item.comments)} comments ·
                    ${formatNumber(item.shares)} shares
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
            <td>${formatNumber(metric.shares)}</td>
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