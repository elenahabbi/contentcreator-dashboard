const API_BASE = "http://localhost:3000";

// ---- in-memory state -------------------------------------------------
let summaryData = {};
let topContentData = [];
let platformData = [];
let trendData = [];
let metricsData = [];

let trendChart = null;     // Chart.js instance

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAnalytics);

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
// PERFORMANCE METRICS LIST
// (GET/DELETE /performance-metrics)
//
// Read-only apart from deleting a bad snapshot: metrics are recorded by
// syncing a linked published video from the Content Planner, never typed
// in here.
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
                <button type="button" class="delete-metric-btn" data-id="${metric.metric_id}">Delete</button>
            </td>
        </tr>
    `).join("");

    tbody.querySelectorAll(".delete-metric-btn").forEach(btn => {
        btn.addEventListener("click", () => deleteMetric(btn.dataset.id));
    });
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