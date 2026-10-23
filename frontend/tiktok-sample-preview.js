// ============================================================
// TIKTOK SAMPLE PREVIEW  (frontend-only, illustrative)
//
// REMOVAL: delete this file, delete the <script src="tiktok-sample-preview.js">
// tag at the bottom of analytics.html, and delete the block in analytics.html
// between "BEGIN TIKTOK SAMPLE PREVIEW" and "END TIKTOK SAMPLE PREVIEW".
// Nothing else depends on it.
//
// Strict separation:
//  - The figures below are made up. They are NOT fetched from the backend,
//    NOT saved to the database and NOT retrieved from TikTok.
//  - This file makes no network requests, no OAuth calls and sets no
//    "Connected" status. It does not touch analytics.js state, the real
//    analytics totals, recommendations, platform comparisons or exports.
//  - Share counts are intentionally not part of the sample data.
// ============================================================

(function () {
    "use strict";

    const TIKTOK_SAMPLE_PREVIEW_DATA = Object.freeze([
        Object.freeze({ title: "Sample entry: 3 quick editing tips", views: 18400, likes: 1520, comments: 96 }),
        Object.freeze({ title: "Sample entry: Day in the life of a creator", views: 9750, likes: 830, comments: 41 }),
        Object.freeze({ title: "Sample entry: Behind the scenes of a shoot", views: 5120, likes: 402, comments: 27 }),
        Object.freeze({ title: "Sample entry: Answering your questions", views: 2380, likes: 191, comments: 18 }),
    ]);

    const toggleBtn = document.getElementById("tiktokSampleToggleBtn");
    const panel = document.getElementById("tiktokSamplePanel");
    const tableBody = document.getElementById("tiktokSampleTableBody");
    const bars = document.getElementById("tiktokSampleBars");
    if (!toggleBtn || !panel || !tableBody || !bars) return;

    const SHOW_LABEL = "Show TikTok sample preview";
    const HIDE_LABEL = "Hide TikTok sample preview";
    let rendered = false;

    function formatSample(value) {
        return Number(value).toLocaleString("en-US");
    }

    function appendCell(row, text, className) {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text;
        row.appendChild(cell);
    }

    // Built with textContent only (no innerHTML), so nothing is ever parsed as markup.
    function renderSamplePreview() {
        if (rendered) return;

        const maxViews = Math.max(...TIKTOK_SAMPLE_PREVIEW_DATA.map(entry => entry.views));

        TIKTOK_SAMPLE_PREVIEW_DATA.forEach(entry => {
            const row = document.createElement("tr");
            appendCell(row, entry.title);
            appendCell(row, formatSample(entry.views), "tiktok-sample-num");
            appendCell(row, formatSample(entry.likes), "tiktok-sample-num");
            appendCell(row, formatSample(entry.comments), "tiktok-sample-num");
            tableBody.appendChild(row);

            // Compact visual summary: plain CSS bars (no Chart.js instance to manage).
            const barRow = document.createElement("div");
            barRow.className = "tiktok-sample-bar-row";

            const label = document.createElement("div");
            label.className = "tiktok-sample-bar-label";
            label.textContent = entry.title.replace("Sample entry: ", "");

            const track = document.createElement("div");
            track.className = "tiktok-sample-bar-track";

            const fill = document.createElement("div");
            fill.className = "tiktok-sample-bar-fill";
            fill.style.width = `${Math.max(2, Math.round((entry.views / maxViews) * 100))}%`;
            fill.setAttribute("role", "img");
            fill.setAttribute("aria-label", `Sample views: ${formatSample(entry.views)}`);

            const value = document.createElement("span");
            value.className = "tiktok-sample-bar-value";
            value.textContent = `${formatSample(entry.views)} sample views`;

            track.appendChild(fill);
            barRow.appendChild(label);
            barRow.appendChild(track);
            barRow.appendChild(value);
            bars.appendChild(barRow);
        });

        rendered = true;
    }

    toggleBtn.addEventListener("click", () => {
        const willOpen = panel.hasAttribute("hidden");

        if (willOpen) {
            renderSamplePreview();
            panel.removeAttribute("hidden");
        } else {
            panel.setAttribute("hidden", "");
        }

        toggleBtn.setAttribute("aria-expanded", String(willOpen));
        toggleBtn.textContent = willOpen ? HIDE_LABEL : SHOW_LABEL;
    });
})();