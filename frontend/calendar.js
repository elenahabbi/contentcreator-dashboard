const openEventBtn = document.getElementById("openEvent");
const closeBtn = document.getElementById("closeEvent");
const sidebar = document.querySelector(".event-sidebar");

openEventBtn.addEventListener("click", () => {
    sidebar.classList.add("active");
});

closeBtn.addEventListener("click", () => {
    sidebar.classList.remove("active");
});

const grid = document.querySelector(".calendar-grid");

const monthSelect = document.getElementById("month");
const yearSelect = document.getElementById("year");

// platform_name (lowercased) -> platform_id, populated once from GET /platforms.
// Platform IDs are auto-incremented, so we never hardcode them (see checklist item 9).
let platformsByName = {};
let platformsById = {};

function loadPlatforms() {
    return fetch("http://localhost:3000/platforms")
        .then(res => res.json())
        .then(platforms => {
            platformsByName = {};
            platformsById = {};
            platforms.forEach(p => {
                platformsByName[p.platform_name.toLowerCase()] = p.platform_id;
                platformsById[p.platform_id] = p.platform_name;
            });
        })
        .catch(err => console.error("Error loading platforms:", err));
}

function setTodayInDropdowns() {
    const today = new Date();
    monthSelect.selectedIndex = today.getMonth();
    yearSelect.value = today.getFullYear();
}

function generateCalendar() {
    grid.innerHTML = "";

    const month = monthSelect.selectedIndex;
    const year = yearSelect.value;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement("div");
        grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = document.createElement("div");

        const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const today = getLocalDateString();

        if (fullDate === today) {
            dayCell.style.border = "2px solid white";
            dayCell.classList.add("today");
        }

        dayCell.dataset.date = fullDate;
        dayCell.style.cursor = "pointer";

        dayCell.addEventListener("click", (e) => {
            if (e.target.closest(".event-item")) return;
            sidebar.classList.add("active");
            document.getElementById("eventDate").value = fullDate;
        });

        const dateNumber = document.createElement("span");
        dateNumber.textContent = day;
        dayCell.appendChild(dateNumber);

        grid.appendChild(dayCell);
    }
}

monthSelect.addEventListener("change", () => {
    generateCalendar();
    loadScheduledContent();
});

yearSelect.addEventListener("change", () => {
    generateCalendar();
    loadScheduledContent();
});

setTodayInDropdowns();
generateCalendar();

document.getElementById("createScript").onclick = () => {
    const title = document.getElementById("eventTitle").value;
    const date = document.getElementById("eventDate").value;
    window.location.href =
        `write.html?from=calendar&date=${date}&title=${encodeURIComponent(title)}`;
};

function getSelectedPlatforms() {
    const checkboxes = document.querySelectorAll("#eventPlatform input:checked");
    return Array.from(checkboxes).map(cb => cb.value);
}

/* LOAD SCHEDULED CONTENT (replaces the old events-based calendar) */
function loadScheduledContent() {
    document.querySelectorAll("[data-date]").forEach(cell => {
        cell.style.backgroundColor = "";
        if (!cell.classList.contains("today")) {
            cell.style.border = "";
        }
    });

    document.querySelectorAll(".event-item").forEach(e => e.remove());

    fetch("http://localhost:3000/scheduled-content")
        .then(res => {
            if (!res.ok) throw new Error("Server error: " + res.status);
            return res.json();
        })
        .then(items => {
            if (!Array.isArray(items)) {
                console.error("Not an array:", items);
                return;
            }

            // Group by content_id + scheduled_date so multi-platform items
            // (several scheduled_content rows, one per platform) render as
            // a single card with a striped border, like the old UI did.
            const grouped = {};
            items.forEach(item => {
                if (activePlatform !== "All" &&
                    item.platform_name?.toLowerCase() !== activePlatform.toLowerCase()) {
                    return;
                }
                const key = `${item.content_id}_${item.scheduled_date}`;
                if (!grouped[key]) grouped[key] = { ...item, platform_names: [] };
                grouped[key].platform_names.push(item.platform_name);
                grouped[key].schedule_ids = [...(grouped[key].schedule_ids || []), item.schedule_id];
                // Parallel arrays (same index as platform_names/schedule_ids) —
                // each scheduled_content row has its own external video link,
                // so the group's top-level spread above isn't enough on its own.
                grouped[key].external_content_ids = [...(grouped[key].external_content_ids || []), item.external_content_id || null];
                grouped[key].external_content_urls = [...(grouped[key].external_content_urls || []), item.external_content_url || null];
                grouped[key].computed_statuses = [...(grouped[key].computed_statuses || []), item.computed_status];
            });

            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);

            Object.values(grouped).forEach(item => {
                const dateStr = item.scheduled_date.split(" ")[0].split("T")[0];
                const cell = document.querySelector(`[data-date="${dateStr}"]`);
                if (!cell) return;

                cell.classList.add("has-event");
                cell.style.backgroundColor = "#f0e1d4";

                if (item.computed_status === "Missed" && !cell.classList.contains("today")) {
                    cell.style.border = "2px solid red";
                }

                const eventItem = document.createElement("div");
                eventItem.textContent = item.content_title;
                eventItem.className = "event-item";
                eventItem.style.fontSize = "12px";

                const colours = [];
                if (item.platform_names.some(p => p?.toLowerCase() === "tiktok")) colours.push("#69C9D0");
                if (item.platform_names.some(p => p?.toLowerCase() === "youtube")) colours.push("#CD201F");
                if (item.platform_names.some(p => p?.toLowerCase() === "instagram")) colours.push("#6228D7");

                if (colours.length === 1) {
                    eventItem.style.borderLeft = `4px solid ${colours[0]}`;
                } else if (colours.length === 2) {
                    eventItem.style.borderLeft = "4px solid";
                    eventItem.style.borderImage = `linear-gradient(to bottom, ${colours[0]} 0%, ${colours[0]} 50%, ${colours[1]} 50%, ${colours[1]} 100%) 1`;
                } else if (colours.length === 3) {
                    eventItem.style.borderLeft = "4px solid";
                    eventItem.style.borderImage = `linear-gradient(to bottom, ${colours[0]} 0%, ${colours[0]} 33.33%, ${colours[1]} 33.33%, ${colours[1]} 66.66%, ${colours[2]} 66.66%, ${colours[2]} 100%) 1`;
                }

                eventItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openScheduledModal(item);
                });

                cell.appendChild(eventItem);
            });
        })
        .catch(err => console.error("Error loading scheduled content:", err));
}

let activePlatform = "All";

document.querySelectorAll(".platformToggle button").forEach(btn => {
    btn.addEventListener("click", () => {
        activePlatform = btn.textContent;
        loadScheduledContent();
    });
});

/* LOAD SCRIPTS FOR DROPDOWN */
function loadScriptsForDropdown() {
    const select = document.getElementById("scriptSelect");
    if (!select) return;

    fetch("http://localhost:3000/scripts")
        .then(res => res.json())
        .then(scripts => {
            select.innerHTML = '<option value="">No Script</option>';

            scripts.forEach(script => {
                const option = document.createElement("option");

                let typeLabel = "";
                if (script.content_type === "short-form") typeLabel = "SF";
                else if (script.content_type === "long-form") typeLabel = "LF";
                else if (script.content_type === "carousel") typeLabel = "C";

                option.value = script.script_id;
                option.dataset.contentId = script.content_id;
                option.textContent = `${script.title} · ${typeLabel}`;
                option.title = `${script.title}\nType: ${script.content_type}`;

                select.appendChild(option);
            });
        })
        .catch(err => console.error("Error loading scripts:", err));
}

const params = new URLSearchParams(window.location.search);
const selectedDate = params.get("date");
const selectedScriptId = params.get("scriptId");
const restoredTitle = params.get("title");

if (restoredTitle) {
    document.getElementById("eventTitle").value = decodeURIComponent(restoredTitle);
}

if (selectedDate) {
    const [year, month] = selectedDate.split("-");
    yearSelect.value = year;
    monthSelect.selectedIndex = Number(month) - 1;
    generateCalendar();

    setTimeout(() => {
        document.getElementById("eventDate").value = selectedDate;
        if (selectedScriptId) {
            setTimeout(() => {
                const dropdown = document.getElementById("scriptSelect");
                if (dropdown) dropdown.value = selectedScriptId;
            }, 200);
        }
    }, 100);
}

document.addEventListener("DOMContentLoaded", () => {
    loadPlatforms().then(loadScheduledContent);
    loadScriptsForDropdown();
});

/* SCHEDULING/SAVING */

document.body.addEventListener("click", (e) => {
    if (e.target.id === "saveEvent") {
        saveScheduledContent();
    }
});

function getToday() {
    return new Date().toISOString().split("T")[0];
}

async function saveScheduledContent() {
    const title = document.getElementById("eventTitle").value;
    const date = document.getElementById("eventDate").value;
    const today = getToday();
    const platformNames = getSelectedPlatforms();

    if (!title || !date) {
        alert("Please enter title and date");
        return;
    }

    if (platformNames.length === 0) {
        alert("Please select at least one platform");
        return;
    }

    if (new Date(date) < new Date(today)) {
        alert("You cannot create events in the past.");
        return;
    }

    const scriptSelect = document.getElementById("scriptSelect");
    const scriptId = scriptSelect.value;

    const platformIds = platformNames
        .map(name => platformsByName[name.toLowerCase()])
        .filter(Boolean);

    if (platformIds.length !== platformNames.length) {
        alert("Could not match all selected platforms — try reloading the page.");
        return;
    }

    try {
        let contentId;

        if (scriptId) {
            // Reuse the content already linked to the chosen script.
            const selectedOption = scriptSelect.selectedOptions[0];
            contentId = selectedOption.dataset.contentId;
        } else {
            // No script chosen yet — create a bare content item to schedule.
            const contentRes = await fetch("http://localhost:3000/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, content_type: "general" })
            });
            if (!contentRes.ok) throw new Error("Failed to create content for this event");
            const content = await contentRes.json();
            contentId = content.content_id;
        }

        const scheduleRes = await fetch("http://localhost:3000/scheduled-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content_id: contentId,
                platform_ids: platformIds,
                scheduled_date: date,
                status: "Scheduled"
            })
        });

        if (!scheduleRes.ok) {
            let message = "Failed to save scheduled content";
            try {
                const err = await scheduleRes.json();
                if (err && err.message) message = err.message;
            } catch (_) {
                message = `Failed to save scheduled content (HTTP ${scheduleRes.status})`;
            }
            throw new Error(message);
        }

        alert("Event saved!");
        sidebar.classList.remove("active");
        document.getElementById("eventTitle").value = "";
        document.getElementById("eventDate").value = "";
        loadScheduledContent();
    } catch (err) {
        console.error(err);
        alert(err.message);
    }
}

function getLocalDateString() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISO = new Date(now - tzOffset).toISOString().slice(0, 10);
    return localISO;
}

/* FETCH AND SHOW SCRIPT IN MODAL */
let currentModalItem = null;

function openScheduledModal(item) {
    currentModalItem = item;
    document.getElementById("modalEditForm").style.display = "none";

    const modal = document.getElementById("eventModal");

    const eventTitleEl = document.getElementById("modalEventTitle");
    const scriptTitleEl = document.getElementById("modalScriptTitle");
    const scriptContentEl = document.getElementById("modalScript");
    const platformsEl = document.getElementById("modalPlatforms");
    const dateEl = document.getElementById("modalDate");

    eventTitleEl.textContent = `Event: ${item.content_title}`;
    dateEl.textContent = `${item.scheduled_date}  (${item.computed_status})`;

    platformsEl.innerHTML = item.platform_names.map(p => {
        return `<span style="padding:2px 6px; margin-right:4px; border-radius:4px; font-size:11px;">${p}</span>`;
    }).join("");

    showPublishStatus("");
    updatePublishButtons(item);

    fetch(`http://localhost:3000/scripts?content_id=${item.content_id}`)
        .then(res => res.json())
        .then(scripts => {
            if (scripts.length === 0) {
                scriptTitleEl.textContent = "No script attached";
                scriptContentEl.textContent = "";
            } else {
                scriptTitleEl.textContent = scripts[0].title;
                scriptContentEl.textContent = scripts[0].script_content;
            }
            modal.style.display = "block";
        })
        .catch(() => {
            scriptTitleEl.textContent = "Could not load script";
            scriptContentEl.textContent = "";
            modal.style.display = "block";
        });

    setupYoutubeLinkSection(item);
}

/* =======================================================================
   YOUTUBE VIDEO LINK / SYNC (scheduled-item modal)
   Views/likes/comments shown here always come from the YouTube API —
   there is no field in this panel for typing analytics in by hand.
   ======================================================================= */

// Finds this group's YouTube-specific schedule_id + link, if it has one.
function getYoutubeLinkForItem(item) {
    const idx = item.platform_names.findIndex(p => p?.toLowerCase() === "youtube");
    if (idx === -1) return null;
    return {
        scheduleId: item.schedule_ids[idx],
        externalContentId: item.external_content_ids ? item.external_content_ids[idx] : null,
        externalContentUrl: item.external_content_urls ? item.external_content_urls[idx] : null,
        computedStatus: item.computed_statuses ? item.computed_statuses[idx] : item.computed_status,
    };
}

// Shared feedback line for the Publish/Unpublish actions in the event
// modal — reuses the same message styling already used for the YouTube
// subscriber sync feedback on the Analytics page (.subscriber-sync-message
// / .success / .error), so this never invents new UI styling.
function showPublishStatus(text, variant) {
    const statusMsg = document.getElementById("publishStatusMessage");
    if (!statusMsg) return;
    statusMsg.textContent = text;
    statusMsg.className = `subscriber-sync-message${variant ? ` ${variant}` : ""}`;
    statusMsg.style.display = text ? "block" : "none";
}

// Shows exactly one of "Mark Published" / "Unpublish" depending on the
// group's current status, so the modal never keeps offering "Mark
// Published" as though nothing happened after it already succeeded.
function updatePublishButtons(item) {
    const publishBtn = document.getElementById("publishEvent");
    const unpublishBtn = document.getElementById("unpublishEvent");
    if (!publishBtn || !unpublishBtn) return;
    const isPublished = item && item.computed_status === "Published";
    publishBtn.style.display = isPublished ? "none" : "inline-block";
    unpublishBtn.style.display = isPublished ? "inline-block" : "none";
}

// Safely parses a fetch Response as JSON. Used for every response coming
// back from the scheduled-content/YouTube-link routes so that an
// unexpected non-JSON body (an HTML 404/500 error page from a route
// mismatch, a proxy error, etc.) never surfaces to the user as a raw
// "Unexpected token '<' ... is not valid JSON" — this checks res.ok
// first and only tries to parse JSON where a body is actually expected.
async function expectJson(res, fallbackMessage) {
    if (!res.ok) {
        let message = fallbackMessage;
        try {
            const body = await res.json();
            if (body && body.message) message = body.message;
        } catch (_) {
            // Non-JSON error body (e.g. an HTML error page) — keep the
            // fallback message instead of throwing a raw parse error.
            message = `${fallbackMessage} (HTTP ${res.status})`;
        }
        throw new Error(message);
    }

    try {
        return await res.json();
    } catch (_) {
        throw new Error(`${fallbackMessage} — the server did not return a valid response.`);
    }
}

function escapeYoutubeText(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setupYoutubeLinkSection(item) {
    const section = document.getElementById("youtubeLinkSection");
    const notPublishedNote = document.getElementById("youtubeNotPublishedNote");
    const findForm = document.getElementById("youtubeFindForm");
    const candidatesBox = document.getElementById("youtubeCandidates");
    const candidatesList = document.getElementById("youtubeCandidatesList");
    const noMatchBox = document.getElementById("youtubeNoMatch");
    const linkedInfo = document.getElementById("youtubeLinkedInfo");
    const errorEl = document.getElementById("youtubeLinkError");
    const statsDisplay = document.getElementById("youtubeStatsDisplay");
    if (!section) return;

    errorEl.textContent = "";
    statsDisplay.innerHTML = "";
    candidatesList.innerHTML = "";

    const link = getYoutubeLinkForItem(item);

    if (!link) {
        // No YouTube platform on this scheduled item at all — nothing to show.
        section.style.display = "none";
        return;
    }

    section.style.display = "block";

    // Reset every sub-state, then show exactly one.
    notPublishedNote.style.display = "none";
    findForm.style.display = "none";
    candidatesBox.style.display = "none";
    noMatchBox.style.display = "none";
    linkedInfo.style.display = "none";

    if (link.externalContentId) {
        linkedInfo.style.display = "block";
        document.getElementById("youtubeVideoIdText").textContent = link.externalContentId;
        return;
    }

    if (link.computedStatus !== "Published") {
        notPublishedNote.style.display = "block";
        return;
    }

    findForm.style.display = "block";
}

function renderYoutubeStats(stats) {
    const statsDisplay = document.getElementById("youtubeStatsDisplay");
    if (!statsDisplay) return;
    statsDisplay.innerHTML = `
        <span><strong>${Number(stats.views).toLocaleString()}</strong> views</span>
        <span><strong>${Number(stats.likes).toLocaleString()}</strong> likes</span>
        <span><strong>${Number(stats.comments).toLocaleString()}</strong> comments</span>
        <span><strong>${stats.shares_available === false ? "—" : Number(stats.shares).toLocaleString()}</strong> shares</span>
    `;
}

function renderYoutubeCandidates(candidates) {
    document.getElementById("youtubeFindForm").style.display = "none";
    document.getElementById("youtubeNoMatch").style.display = "none";
    document.getElementById("youtubeCandidates").style.display = "block";

    const list = document.getElementById("youtubeCandidatesList");
    list.innerHTML = candidates.map((c, idx) => `
        <div class="youtube-candidate-card" data-index="${idx}">
            ${c.thumbnailUrl ? `<img class="youtube-candidate-thumb" src="${c.thumbnailUrl}" alt="">` : `<div class="youtube-candidate-thumb youtube-candidate-thumb--placeholder"></div>`}
            <div class="youtube-candidate-info">
                <div class="youtube-candidate-title">${escapeYoutubeText(c.title)}</div>
                <div class="youtube-candidate-date">${c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : "Publish date unknown"}</div>
            </div>
            <button type="button" class="youtube-candidate-select-btn" data-index="${idx}">Select</button>
        </div>
    `).join("");

    list.querySelectorAll(".youtube-candidate-select-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const candidate = candidates[Number(btn.dataset.index)];
            if (candidate) selectYoutubeVideo(candidate.videoId);
        });
    });
}

async function runYoutubeVideoSearch() {
    if (!currentModalItem) return;
    const link = getYoutubeLinkForItem(currentModalItem);
    const errorEl = document.getElementById("youtubeLinkError");
    errorEl.textContent = "";
    if (!link) return;

    const findBtn = document.getElementById("findYoutubeVideoBtn");
    const retryBtn = document.getElementById("retryYoutubeSearchBtn");
    const againBtn = document.getElementById("findYoutubeVideoAgainBtn");
    [findBtn, retryBtn, againBtn].forEach(b => { if (b) b.disabled = true; });

    document.getElementById("youtubeFindForm").style.display = "none";
    document.getElementById("youtubeCandidates").style.display = "none";
    document.getElementById("youtubeNoMatch").style.display = "none";

    try {
        const res = await fetch(`http://localhost:3000/scheduled-content/${link.scheduleId}/find-youtube-video`, {
            method: "POST",
        });
        const body = await expectJson(res, "Could not search YouTube for a matching video.");

        if (body.matchType === "exact" || body.matchType === "normalized") {
            loadScheduledContent();
            currentModalItem.external_content_ids[
                currentModalItem.platform_names.findIndex(p => p?.toLowerCase() === "youtube")
            ] = body.scheduled.external_content_id;
            setupYoutubeLinkSection(currentModalItem);
        } else if (body.matchType === "multiple") {
            renderYoutubeCandidates(body.candidates);
        } else {
            document.getElementById("youtubeNoMatch").style.display = "block";
        }
    } catch (err) {
        errorEl.textContent = err.message;
        document.getElementById("youtubeFindForm").style.display = "block";
    } finally {
        [findBtn, retryBtn, againBtn].forEach(b => { if (b) b.disabled = false; });
    }
}

async function selectYoutubeVideo(videoId) {
    if (!currentModalItem) return;
    const link = getYoutubeLinkForItem(currentModalItem);
    const errorEl = document.getElementById("youtubeLinkError");
    errorEl.textContent = "";
    if (!link) return;

    try {
        const res = await fetch(`http://localhost:3000/scheduled-content/${link.scheduleId}/select-youtube-video`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId }),
        });
        const body = await expectJson(res, "Could not link that video.");

        loadScheduledContent();
        currentModalItem.external_content_ids[
            currentModalItem.platform_names.findIndex(p => p?.toLowerCase() === "youtube")
        ] = body.scheduled.external_content_id;
        setupYoutubeLinkSection(currentModalItem);
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

document.getElementById("findYoutubeVideoBtn").onclick = runYoutubeVideoSearch;
document.getElementById("retryYoutubeSearchBtn").onclick = runYoutubeVideoSearch;
document.getElementById("findYoutubeVideoAgainBtn").onclick = runYoutubeVideoSearch;

document.getElementById("syncYoutubeBtn").onclick = async () => {
    if (!currentModalItem) return;
    const link = getYoutubeLinkForItem(currentModalItem);
    const errorEl = document.getElementById("youtubeLinkError");
    const syncBtn = document.getElementById("syncYoutubeBtn");
    errorEl.textContent = "";
    if (!link) return;

    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing…";
    try {
        const res = await fetch(`http://localhost:3000/performance-metrics/sync/${link.scheduleId}`, {
            method: "POST",
        });
        const body = await expectJson(res, "Could not sync analytics for this video.");
        renderYoutubeStats(body);
    } catch (err) {
        errorEl.textContent = err.message;
    } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync Analytics";
    }
};

document.getElementById("unlinkYoutubeBtn").onclick = async () => {
    if (!currentModalItem) return;
    const link = getYoutubeLinkForItem(currentModalItem);
    const errorEl = document.getElementById("youtubeLinkError");
    errorEl.textContent = "";
    if (!link) return;

    if (!confirm("Unlink this YouTube video? Past synced analytics records are kept.")) return;

    try {
        const res = await fetch(`http://localhost:3000/scheduled-content/${link.scheduleId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ external_content_url: null }),
        });
        const body = await expectJson(res, "Could not unlink this video.");

        loadScheduledContent();
        currentModalItem.external_content_ids[
            currentModalItem.platform_names.findIndex(p => p?.toLowerCase() === "youtube")
        ] = null;
        setupYoutubeLinkSection(currentModalItem);
    } catch (err) {
        errorEl.textContent = err.message;
    }
};

document.getElementById("closeModal").onclick = () => {
    document.getElementById("eventModal").style.display = "none";
};

/* EDIT */
document.getElementById("editEvent").onclick = () => {
    if (!currentModalItem) return;

    const dateInput = document.getElementById("modalEditDate");
    dateInput.value = currentModalItem.scheduled_date.split(" ")[0].split("T")[0];

    document.querySelectorAll("#modalEditPlatform input").forEach(cb => {
        cb.checked = currentModalItem.platform_names.some(
            p => p?.toLowerCase() === cb.value
        );
    });

    document.getElementById("modalEditStatus").value =
        currentModalItem.computed_status === "Missed" ? "Scheduled" : currentModalItem.computed_status;

    document.getElementById("modalEditForm").style.display = "block";
};

document.getElementById("saveEditEvent").onclick = async () => {
    if (!currentModalItem) return;

    const newDate = document.getElementById("modalEditDate").value;
    const newStatus = document.getElementById("modalEditStatus").value;
    const newPlatformNames = Array.from(
        document.querySelectorAll("#modalEditPlatform input:checked")
    ).map(cb => cb.value);

    if (!newDate || newPlatformNames.length === 0) {
        alert("Please choose a date and at least one platform");
        return;
    }

    const newPlatformIds = newPlatformNames
        .map(name => platformsByName[name.toLowerCase()])
        .filter(Boolean);

    if (newPlatformIds.length !== newPlatformNames.length) {
        alert("Could not match all selected platforms — try reloading the page.");
        return;
    }

    try {
        // Simplest reliable way to reconcile "which platforms changed":
        // replace the whole group (delete every schedule_id in it, recreate).
        // content and script are untouched — only scheduled_content rows change.
        for (const id of currentModalItem.schedule_ids) {
            await fetch(`http://localhost:3000/scheduled-content/${id}`, { method: "DELETE" });
        }

        const res = await fetch("http://localhost:3000/scheduled-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content_id: currentModalItem.content_id,
                platform_ids: newPlatformIds,
                scheduled_date: newDate,
                status: newStatus
            })
        });

        if (!res.ok) {
            let message = "Failed to update scheduled content";
            try {
                const err = await res.json();
                if (err && err.message) message = err.message;
            } catch (_) {
                message = `Failed to update scheduled content (HTTP ${res.status})`;
            }
            throw new Error(message);
        }

        document.getElementById("eventModal").style.display = "none";
        loadScheduledContent();
    } catch (err) {
        console.error(err);
        alert(err.message);
    }
};

/* PUBLISH */
// Marking something Published always succeeds on its own — the YouTube
// title-matching attempt below is a best-effort follow-up, never a
// precondition. A creator can mark an item Published before the actual
// upload exists, or the YouTube API can be briefly unavailable, without
// losing the Published state.
document.getElementById("publishEvent").onclick = async () => {
    if (!currentModalItem) return;

    const publishBtn = document.getElementById("publishEvent");
    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing…";
    showPublishStatus("Marking as Published…");

    try {
        for (const id of currentModalItem.schedule_ids) {
            const res = await fetch(`http://localhost:3000/scheduled-content/${id}/publish`, {
                method: "PATCH"
            });
            if (!res.ok) throw new Error("Failed to mark as published");
        }

        // Reflect the new status locally right away — the youtube-link
        // section and the Publish/Unpublish buttons both gate on this —
        // rather than waiting on a full recalendar reload to catch up.
        currentModalItem.computed_status = "Published";
        if (currentModalItem.computed_statuses) {
            currentModalItem.computed_statuses = currentModalItem.computed_statuses.map(() => "Published");
        }
        updatePublishButtons(currentModalItem);
        loadScheduledContent();

        const link = getYoutubeLinkForItem(currentModalItem);
        if (!link || link.externalContentId) {
            // Not a YouTube item, or a video is already linked — publishing
            // itself is the whole story here.
            setupYoutubeLinkSection(currentModalItem);
            showPublishStatus("Published.", "success");
            return;
        }

        setupYoutubeLinkSection(currentModalItem);
        showPublishStatus("Published. Searching your connected YouTube channel for a matching video…");

        try {
            const matchRes = await fetch(
                `http://localhost:3000/scheduled-content/${link.scheduleId}/find-youtube-video`,
                { method: "POST" }
            );
            const matchBody = await expectJson(matchRes, "Could not search YouTube for a matching video.");

            if (matchBody.matchType === "exact" || matchBody.matchType === "normalized") {
                currentModalItem.external_content_ids[
                    currentModalItem.platform_names.findIndex(p => p?.toLowerCase() === "youtube")
                ] = matchBody.scheduled.external_content_id;
                loadScheduledContent();
                setupYoutubeLinkSection(currentModalItem);
                showPublishStatus("Published. YouTube video: Linked.", "success");
            } else if (matchBody.matchType === "multiple") {
                setupYoutubeLinkSection(currentModalItem);
                renderYoutubeCandidates(matchBody.candidates);
                showPublishStatus("Published. Multiple possible YouTube matches were found — select the correct video below.");
            } else {
                showPublishStatus("Published, but no matching YouTube video was found.");
            }
        } catch (matchErr) {
            console.error(matchErr);
            showPublishStatus(`Published. YouTube video: Not linked (${matchErr.message}).`);
        }
    } catch (err) {
        console.error(err);
        showPublishStatus(err.message || "Failed to mark as published.", "error");
    } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = "Mark Published";
    }
};

/* UNPUBLISH */
// Reverts the scheduling/published state back to Scheduled. This never
// touches the actual YouTube video — a linked video (external_content_id/
// external_content_url) is intentionally left in place.
document.getElementById("unpublishEvent").onclick = async () => {
    if (!currentModalItem) return;

    const unpublishBtn = document.getElementById("unpublishEvent");
    unpublishBtn.disabled = true;
    unpublishBtn.textContent = "Unpublishing…";
    showPublishStatus("Reverting to Scheduled…");

    try {
        for (const id of currentModalItem.schedule_ids) {
            const res = await fetch(`http://localhost:3000/scheduled-content/${id}/unpublish`, {
                method: "PATCH"
            });
            if (!res.ok) throw new Error("Failed to unpublish");
        }

        currentModalItem.computed_status = "Scheduled";
        if (currentModalItem.computed_statuses) {
            currentModalItem.computed_statuses = currentModalItem.computed_statuses.map(() => "Scheduled");
        }
        updatePublishButtons(currentModalItem);
        setupYoutubeLinkSection(currentModalItem);
        loadScheduledContent();
        showPublishStatus("Reverted to Scheduled. Any linked YouTube video was kept.", "success");
    } catch (err) {
        console.error(err);
        showPublishStatus(err.message || "Failed to unpublish.", "error");
    } finally {
        unpublishBtn.disabled = false;
        unpublishBtn.textContent = "Unpublish";
    }
};

/* DELETE */
document.getElementById("deleteEvent").onclick = async () => {
    if (!currentModalItem) return;
    if (!confirm("Delete this scheduled item? This only removes the schedule, not the content or script.")) return;

    try {
        for (const id of currentModalItem.schedule_ids) {
            const res = await fetch(`http://localhost:3000/scheduled-content/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete scheduled content");
        }
        document.getElementById("eventModal").style.display = "none";
        loadScheduledContent();
    } catch (err) {
        console.error(err);
        alert(err.message);
    }
};