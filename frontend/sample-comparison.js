// ============================================================
// CROSS-PLATFORM SAMPLE COMPARISON  (frontend-only, illustrative)
//
// Replaces tiktok-sample-preview.js (Phase 1), which used invented titles.
//
// REMOVAL: delete this file, its <script src="sample-comparison.js"> tag at
// the bottom of analytics.html, and the block in analytics.html between
// "BEGIN CROSS-PLATFORM SAMPLE COMPARISON" and "END CROSS-PLATFORM SAMPLE
// COMPARISON". Nothing else depends on it.
//
// What is real and what is not
//  - REAL: the content titles, which platforms the creator scheduled each
//    item for (GET /scheduled-content) and the creator's own recorded
//    YouTube figures (GET /performance-metrics). These are read only.
//  - SAMPLE: every TikTok and Instagram figure. They are assumptions for a
//    demonstration, derived deterministically below from the same item's
//    YouTube figures. They are NOT fetched from the backend, NOT saved to
//    the database and NOT retrieved from TikTok or Instagram.
//
// Strict separation
//  - No new content titles, topics, events or activities are invented.
//    A sample exists only for a content item the creator has scheduled for
//    that platform. Otherwise the page says no sample is available.
//  - This file makes only GET requests to existing endpoints. It sets no
//    "connected" status, performs no OAuth call and writes nothing.
//  - It does not touch analytics.js state, live totals, platform
//    performance, recommendations, posting goals or exports.
//  - Share counts are intentionally not part of the sample data.
//  - Figures are the same on every refresh (seeded hash, no random source).
// ============================================================

(function (root) {
    "use strict";

    // ---- Demonstration assumptions (frozen, clearly separate) -------------
    // Each profile says how a sample compares with the SAME item's YouTube
    // views. Ranges overlap 1.0 on purpose so TikTok can beat YouTube on some
    // items and fall short on others, and Instagram is usually lower. These
    // are illustrative assumptions, not claims about real platform behaviour.
    const SAMPLE_PROFILES = Object.freeze({
        TikTok: Object.freeze({
            viewFactor: Object.freeze([0.5, 2.6]),
            likeRate: Object.freeze([0.05, 0.11]),
            commentRate: Object.freeze([0.0015, 0.005]),
        }),
        Instagram: Object.freeze({
            viewFactor: Object.freeze([0.25, 1.1]),
            likeRate: Object.freeze([0.03, 0.07]),
            commentRate: Object.freeze([0.0006, 0.003]),
        }),
    });
    const SAMPLE_VERSION = "v1"; // bump to change every sample figure at once

    // Scheduled statuses that count as "scheduled for publication".
    const ELIGIBLE_STATUSES = Object.freeze(["Scheduled", "Published"]);

    // ---- Deterministic pseudo-random helpers ------------------------------
    function hash32(text) { // FNV-1a
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    function seededRandom(seedText) { // mulberry32
        let a = hash32(seedText);
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function between(rand, range) {
        return range[0] + (range[1] - range[0]) * rand();
    }

    // Sample views/likes/comments for one content item on one platform,
    // anchored to that item's YouTube views. Pure function of its inputs.
    function makeSample(platformName, contentId, youtube) {
        const profile = SAMPLE_PROFILES[platformName];
        if (!profile || !youtube) return null;
        const baseViews = Math.max(1, Math.round(Number(youtube.views) || 0));
        const rand = seededRandom(`${SAMPLE_VERSION}|${contentId}|${platformName}`);

        const views = Math.max(1, Math.round(baseViews * between(rand, profile.viewFactor)));
        const likes = Math.min(views, Math.round(views * between(rand, profile.likeRate)));
        const comments = Math.min(likes, Math.round(views * between(rand, profile.commentRate)));
        return { views, likes, comments };
    }

    // ---- Comparison builder (pure; also used by the Node test) -------------
    // scheduledRows: GET /scheduled-content rows
    // metricRows:    GET /performance-metrics rows
    // youtubeConnected: true only when the YouTube integration reports connected
    function buildComparison(scheduledRows, metricRows, youtubeConnected) {
        const scheduled = Array.isArray(scheduledRows) ? scheduledRows : [];
        const metrics = Array.isArray(metricRows) ? metricRows : [];

        const byContent = new Map();
        scheduled.forEach((row) => {
            const status = row.computed_status || row.status;
            if (!ELIGIBLE_STATUSES.includes(status)) return;
            if (!byContent.has(row.content_id)) {
                byContent.set(row.content_id, {
                    contentId: row.content_id,
                    title: row.content_title || "Untitled",
                    platforms: new Set(),
                });
            }
            byContent.get(row.content_id).platforms.add(row.platform_name);
        });

        // Latest recorded YouTube figures per content item.
        const latestYoutube = new Map();
        metrics.forEach((m) => {
            if (m.platform_name !== "YouTube") return;
            const prev = latestYoutube.get(m.content_id);
            if (!prev || new Date(m.recorded_at) > new Date(prev.recorded_at)) {
                latestYoutube.set(m.content_id, m);
            }
        });

        const items = [];
        const unavailable = [];

        byContent.forEach((entry) => {
            const hasTikTok = entry.platforms.has("TikTok");
            const hasInstagram = entry.platforms.has("Instagram");
            const hasYoutube = entry.platforms.has("YouTube");
            if (!hasTikTok && !hasInstagram && !hasYoutube) return;

            const metric = latestYoutube.get(entry.contentId);

            if (hasYoutube && metric) {
                const youtube = {
                    views: Number(metric.views) || 0,
                    likes: Number(metric.likes) || 0,
                    comments: Number(metric.comments) || 0,
                    label: youtubeConnected ? "YouTube — Live Data" : "YouTube — Recorded Data",
                };
                items.push({
                    contentId: entry.contentId,
                    title: entry.title,
                    youtube,
                    // null = the creator did not schedule this item for that
                    // platform, so no sample is created for it.
                    tiktok: hasTikTok ? makeSample("TikTok", entry.contentId, youtube) : null,
                    instagram: hasInstagram ? makeSample("Instagram", entry.contentId, youtube) : null,
                });
            } else if (hasTikTok || hasInstagram) {
                unavailable.push({
                    contentId: entry.contentId,
                    title: entry.title,
                    reason: !hasYoutube
                        ? "Not scheduled for YouTube, so there are no YouTube figures to compare against."
                        : "No YouTube figures recorded for this item yet.",
                });
            }
        });

        items.sort((a, b) => a.title.localeCompare(b.title));
        unavailable.sort((a, b) => a.title.localeCompare(b.title));
        return { items, unavailable };
    }

    const api = { buildComparison, makeSample, SAMPLE_PROFILES, ELIGIBLE_STATUSES };

    // Node (tests) gets the pure functions; the browser gets the UI below.
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof document === "undefined") return;

    // ---- Browser UI ---------------------------------------------------------
    const section = document.getElementById("crossPlatformSection");
    if (!section) return;

    const statusEl = document.getElementById("crossPlatformStatus");
    const tableBody = document.getElementById("crossPlatformTableBody");
    const tableWrap = document.getElementById("crossPlatformTableWrap");
    const barsEl = document.getElementById("crossPlatformBars");
    const unavailableEl = document.getElementById("crossPlatformUnavailable");

    const format = (value) => Number(value).toLocaleString("en-US");

    function setStatus(text) {
        statusEl.textContent = text || "";
        statusEl.hidden = !text;
    }

    function cell(row, text, className) {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = text;
        row.appendChild(td);
        return td;
    }

    // All DOM is built with textContent (never innerHTML), so titles are
    // never parsed as markup.
    function sourceBadge(text, isSample, platform) {
        const badge = document.createElement("span");
        badge.className = "xp-badge" + (isSample ? " xp-badge--sample" : " xp-badge--live") +
            (platform ? ` xp-badge--${String(platform).toLowerCase()}` : "");
        badge.textContent = text;
        return badge;
    }

    function addMetricRow(item, platform, label, figures, isSample) {
        const row = document.createElement("tr");
        if (isSample) row.className = "xp-row--sample";
        cell(row, platform === "YouTube" ? item.title : "");
        const sourceCell = document.createElement("td");
        sourceCell.appendChild(sourceBadge(label, isSample, platform));
        row.appendChild(sourceCell);
        cell(row, format(figures.views), "xp-num");
        cell(row, format(figures.likes), "xp-num");
        cell(row, format(figures.comments), "xp-num");
        tableBody.appendChild(row);
    }

    function addUnavailableRow(platform) {
        const row = document.createElement("tr");
        row.className = "xp-row--none";
        cell(row, "");
        const td = cell(row, `${platform} — no cross-platform sample available: this item was not scheduled for ${platform}.`);
        td.colSpan = 4;
        tableBody.appendChild(row);
    }

    function addBar(label, value, max, isSample) {
        const row = document.createElement("div");
        row.className = "xp-bar-row";
        const name = document.createElement("div");
        name.className = "xp-bar-label";
        name.textContent = label;
        const track = document.createElement("div");
        track.className = "xp-bar-track";
        const fill = document.createElement("div");
        fill.className = "xp-bar-fill" + (isSample ? " xp-bar-fill--sample" : "") +
            ` xp-bar-fill--${String(label).toLowerCase()}`;
        fill.style.width = `${Math.max(2, Math.round((value / max) * 100))}%`;
        track.appendChild(fill);
        const val = document.createElement("span");
        val.className = "xp-bar-value";
        val.textContent = `${format(value)}${isSample ? " (sample)" : ""}`;
        row.appendChild(name);
        row.appendChild(track);
        row.appendChild(val);
        barsEl.appendChild(row);
    }

    function render(result) {
        tableBody.textContent = "";
        barsEl.textContent = "";
        unavailableEl.textContent = "";

        if (!result.items.length) {
            tableWrap.hidden = true;
            barsEl.hidden = true;
            setStatus(
                "No comparison to show yet. A sample appears only for a content item that is scheduled for YouTube " +
                "and also for TikTok or Instagram, and that already has recorded YouTube figures."
            );
        } else {
            setStatus("");
            tableWrap.hidden = false;
            barsEl.hidden = false;

            result.items.forEach((item) => {
                addMetricRow(item, "YouTube", item.youtube.label, item.youtube, false);
                if (item.tiktok) addMetricRow(item, "TikTok", "TikTok — Sample Data", item.tiktok, true);
                else addUnavailableRow("TikTok");
                if (item.instagram) addMetricRow(item, "Instagram", "Instagram — Sample Data", item.instagram, true);
                else addUnavailableRow("Instagram");

                const max = Math.max(item.youtube.views, item.tiktok ? item.tiktok.views : 0,
                    item.instagram ? item.instagram.views : 0, 1);
                const group = document.createElement("div");
                group.className = "xp-bar-group";
                const heading = document.createElement("div");
                heading.className = "xp-bar-heading";
                heading.textContent = item.title;
                group.appendChild(heading);
                barsEl.appendChild(group);
                addBar("YouTube", item.youtube.views, max, false);
                if (item.tiktok) addBar("TikTok", item.tiktok.views, max, true);
                if (item.instagram) addBar("Instagram", item.instagram.views, max, true);
            });
        }

        if (result.unavailable.length) {
            const heading = document.createElement("p");
            heading.className = "xp-unavailable-title";
            heading.textContent = "Scheduled for TikTok or Instagram, but no sample available:";
            unavailableEl.appendChild(heading);
            const list = document.createElement("ul");
            result.unavailable.forEach((u) => {
                const li = document.createElement("li");
                li.textContent = `${u.title} — ${u.reason}`;
                list.appendChild(li);
            });
            unavailableEl.appendChild(list);
        }
    }

    async function getJson(path) {
        const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
        if (!res.ok) throw new Error(`${path} returned ${res.status}`);
        return res.json();
    }

    async function load() {
        setStatus("Loading comparison…");
        try {
            const [scheduled, metrics] = await Promise.all([
                getJson("/scheduled-content"),
                getJson("/performance-metrics"),
            ]);
            // Only used to choose the "Live Data" wording; never to enable anything.
            let connected = false;
            try {
                const connection = await getJson("/api/youtube/connection");
                connected = !!(connection && connection.connected);
            } catch (ignored) { /* falls back to the "Recorded Data" wording */ }

            const legend = document.getElementById("crossPlatformYoutubeLegend");
            if (legend) legend.textContent = connected ? "YouTube — Live Data" : "YouTube — Recorded Data";
            render(buildComparison(scheduled, metrics, connected));
        } catch (error) {
            console.error("Cross-platform comparison failed to load:", error);
            tableWrap.hidden = true;
            barsEl.hidden = true;
            setStatus("The comparison could not be loaded. Your real analytics are not affected.");
        }
    }

    (async function init() {
        const ok = window.authReady ? await window.authReady : true;
        if (!ok) return;
        load();
        const refresh = document.getElementById("refreshBtn");
        if (refresh) refresh.addEventListener("click", load);
    })();
})(typeof window !== "undefined" ? window : globalThis);