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
                if (!grouped[key]) grouped[key] = { ...item, platform_names: [], rows: [] };
                grouped[key].platform_names.push(item.platform_name);
                grouped[key].schedule_ids = [...(grouped[key].schedule_ids || []), item.schedule_id];
                // keep the per-platform rows: linking a published video needs
                // the schedule_id of the YouTube row specifically
                grouped[key].rows.push(item);
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
            const err = await scheduleRes.json();
            throw new Error(err.message || "Failed to save scheduled content");
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

    renderYoutubeSection(item);

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
}

document.getElementById("closeModal").onclick = () => {
    document.getElementById("eventModal").style.display = "none";
};

/* ---------------------------------------------------------------------
   PUBLISHED YOUTUBE VIDEO — link + automatic analytics sync

   The creator only supplies a link to content they already published.
   Views/likes/comments are always retrieved by the backend from the
   YouTube Data API; they are never entered here.
--------------------------------------------------------------------- */

// The scheduled_content row for YouTube inside the currently open group.
let currentYoutubeRow = null;

function renderYoutubeSection(item) {
    const section = document.getElementById("youtubeLinkSection");
    const input = document.getElementById("youtubeUrlInput");
    if (!section) return;

    currentYoutubeRow = (item.rows || []).find(
        row => row.platform_name?.toLowerCase() === "youtube"
    ) || null;

    if (!currentYoutubeRow) {
        section.classList.remove("active");
        return;
    }

    section.classList.add("active");
    input.value = currentYoutubeRow.external_content_url || "";
    setYoutubeStatus(
        currentYoutubeRow.external_content_id
            ? `Linked to video ${currentYoutubeRow.external_content_id}.`
            : "No video linked yet.",
        ""
    );
}

function setYoutubeStatus(message, state) {
    const status = document.getElementById("youtubeLinkStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `youtube-link-status${state ? ` ${state}` : ""}`;
}

async function readError(response, fallback) {
    const body = await response.json().catch(() => ({}));
    return new Error(body.message || fallback);
}

document.getElementById("saveYoutubeLink").onclick = async () => {
    if (!currentYoutubeRow) return;

    const url = document.getElementById("youtubeUrlInput").value.trim();
    setYoutubeStatus("Saving link…", "");

    try {
        const res = await fetch(
            `http://localhost:3000/scheduled-content/${currentYoutubeRow.schedule_id}/link`,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url })
            }
        );
        if (!res.ok) throw await readError(res, "Could not save this link.");

        const updated = await res.json();
        currentYoutubeRow = { ...currentYoutubeRow, ...updated };
        document.getElementById("youtubeUrlInput").value = updated.external_content_url || "";

        setYoutubeStatus(
            updated.external_content_id
                ? `Linked to video ${updated.external_content_id}. Click "Sync Analytics" to retrieve its statistics.`
                : "Link removed.",
            "ok"
        );
        loadScheduledContent();
    } catch (err) {
        setYoutubeStatus(err.message, "error");
    }
};

document.getElementById("syncYoutubeMetrics").onclick = async () => {
    if (!currentYoutubeRow) return;

    const button = document.getElementById("syncYoutubeMetrics");
    button.disabled = true;
    setYoutubeStatus("Retrieving statistics from YouTube…", "");

    try {
        const res = await fetch(
            `http://localhost:3000/performance-metrics/sync/${currentYoutubeRow.schedule_id}`,
            { method: "POST" }
        );
        if (!res.ok) throw await readError(res, "Could not sync analytics.");

        const result = await res.json();
        const metric = result.metric || {};
        setYoutubeStatus(
            `${Number(metric.views || 0).toLocaleString("en-US")} views · ` +
            `${Number(metric.likes || 0).toLocaleString("en-US")} likes · ` +
            `${Number(metric.comments || 0).toLocaleString("en-US")} comments ` +
            `(recorded ${metric.recorded_at}). Shares are not provided by the YouTube API.`,
            "ok"
        );
    } catch (err) {
        setYoutubeStatus(err.message, "error");
    } finally {
        button.disabled = false;
    }
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
            const err = await res.json();
            throw new Error(err.message || "Failed to update scheduled content");
        }

        document.getElementById("eventModal").style.display = "none";
        loadScheduledContent();
    } catch (err) {
        console.error(err);
        alert(err.message);
    }
};

/* PUBLISH */
document.getElementById("publishEvent").onclick = async () => {
    if (!currentModalItem) return;

    try {
        for (const id of currentModalItem.schedule_ids) {
            const res = await fetch(`http://localhost:3000/scheduled-content/${id}/publish`, {
                method: "PATCH"
            });
            if (!res.ok) throw new Error("Failed to mark as published");
        }
        document.getElementById("eventModal").style.display = "none";
        loadScheduledContent();
    } catch (err) {
        console.error(err);
        alert(err.message);
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