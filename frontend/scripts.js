console.log("Scripts JS loaded 🔥");
let currentFilter = "all";

// --- LOAD SCRIPTS ---
function loadScripts() {
    const longFormDiv = document.querySelector(".longForm .preview");
    const shortFormDiv = document.querySelector(".shortForm .preview");
    const carouselDiv = document.querySelector(".carousel .preview");
    const loadingIndicator = document.querySelector(".loading-indicator");

    if (longFormDiv) longFormDiv.innerHTML = "";
    if (shortFormDiv) shortFormDiv.innerHTML = "";
    if (carouselDiv) carouselDiv.innerHTML = "";
    if (loadingIndicator) loadingIndicator.classList.remove("hidden");

    fetch("http://localhost:3000/scripts")
        .then(res => {
            if (!res.ok) throw new Error("Failed to fetch scripts");
            return res.json();
        })
        .then(scripts => {
            console.log("Fetched scripts:", scripts);
            scripts.forEach(script => {

                // currentFilter and script.status both use the actual stored
                // values (draft / filmed / posted) — see write.html's status select.
                if (currentFilter !== "all" && script.status !== currentFilter) return;

                const row = document.createElement("div");
                row.classList.add("script-item", "script-item-row");
                row.addEventListener("click", () => openScript(script));

                const title = document.createElement("span");
                title.textContent = script.title;

                const badge = document.createElement("span");
                badge.textContent = script.status || "draft";
                badge.classList.add("script-status-badge", `script-status-${script.status || "draft"}`);

                row.appendChild(title);
                row.appendChild(badge);

                // content_type now lives on the joined `content` row
                // ("folder" was the old scripts.folder column)
                if (script.content_type?.trim() === "long-form" && longFormDiv) {
                    longFormDiv.appendChild(row);
                } else if (script.content_type?.trim() === "short-form" && shortFormDiv) {
                    shortFormDiv.appendChild(row);
                } else if (script.content_type?.trim() === "carousel" && carouselDiv) {
                    carouselDiv.appendChild(row);
                } else {
                    console.warn("Unknown content_type:", script.content_type);
                }
            });
        })
        .catch(err => console.error("Error loading scripts:", err))
        .finally(() => {
            if (loadingIndicator) loadingIndicator.classList.add("hidden");
        });
}

// --- CATEGORIES ---
// Categories come from the shared `categories` table, narrowed to the ones
// the creator chose in their profile (GET /categories/mine). Only present on
// write.html; a no-op elsewhere.
//
// `selectedCategories` is the item's current [{category_id, category_name}]
// list (edit mode). A saved category that is no longer in the creator's
// profile stays visible and checked, marked as such, so it is never silently
// dropped or swapped for a different one; the user can untick it.
let categoriesLoaded = false;

function loadCategoryOptions(selectedCategories = []) {
    const container = document.getElementById("categoryChecklist");
    if (!container) return Promise.resolve();
    const note = document.getElementById("categoryNote");
    if (note) note.textContent = "";

    return fetch("http://localhost:3000/categories/mine", { credentials: "include" })
        .then(res => {
            if (!res.ok) throw new Error("Failed to fetch categories");
            return res.json();
        })
        .then(data => {
            const offered = Array.isArray(data) ? data : (data.categories || []);
            const selectedIds = selectedCategories.map(c => c.category_id);
            container.innerHTML = "";

            const addChip = (cat, suffix) => {
                const label = document.createElement("label");
                label.classList.add("category-chip");

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = cat.category_id;
                checkbox.checked = selectedIds.includes(cat.category_id);

                label.appendChild(checkbox);
                label.append(" " + cat.category_name + (suffix || ""));
                container.appendChild(label);
            };

            offered.forEach(cat => addChip(cat));

            // Saved on this item but no longer offered by the profile.
            selectedCategories
                .filter(c => !offered.some(o => o.category_id === c.category_id))
                .forEach(c => addChip(c, " (no longer in your profile)"));

            if (note && !Array.isArray(data) && data.configured === false) {
                note.textContent =
                    "Showing all categories because no niche or topics are set in your profile yet.";
            }
            categoriesLoaded = true;
        })
        .catch(err => {
            console.error("Error loading categories:", err);
            categoriesLoaded = false;
            container.textContent = "Categories could not be loaded. Existing categories will be left unchanged.";
        });
}

// Reads the checked category_id values from #categoryChecklist as numbers.
// Returns undefined (leave categories untouched) when the list never loaded,
// so a failed load can't wipe an item's existing categories.
function getSelectedCategoryIds() {
    const container = document.getElementById("categoryChecklist");
    if (!container || !categoriesLoaded) return undefined;
    return Array.from(container.querySelectorAll("input[type=checkbox]:checked"))
        .map(el => Number(el.value));
}

// --- ADD SCRIPT ---
window.addScript = function () {
    const titleEl = document.getElementById("title");
    const contentEl = document.getElementById("content");
    const folderEl = document.getElementById("folder");
    const statusEl = document.getElementById("status");

    const status = statusEl.value;
    const title = titleEl.value.trim();
    const script_content = contentEl.value.trim();
    const content_type = folderEl.value; // "short-form" | "long-form" | "carousel"
    const category_ids = getSelectedCategoryIds();

    if (!title || !script_content) {
        alert("Please fill in both title and content");
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const date = params.get("date");
    const editingScriptId = params.get("id");

    const endpoint = editingScriptId
        ? `http://localhost:3000/scripts/${editingScriptId}`
        : "http://localhost:3000/scripts";
    const method = editingScriptId ? "PUT" : "POST";

    fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, script_content, content_type, status, category_ids })
    })
        .then(res => {
            if (!res.ok) return res.json().then(e => { throw new Error(e.message || "Failed to save script"); });
            return res.json();
        })
        .then((savedScript) => {
            alert("✓ Script saved successfully!");

            if (from === "calendar" && date) {
                window.location.href =
                    `calendar.html?date=${date}&scriptId=${savedScript.script_id}&title=${encodeURIComponent(title)}`;
            } else {
                window.location.href = "scripts.html";
            }
        })
        .catch(err => {
            console.error(err);
            alert("Error saving script: " + err.message);
        });
};

// --- DELETE SCRIPT ---
function deleteScript(id) {
    if (!confirm("Delete this script?")) return;

    fetch(`http://localhost:3000/scripts/${id}`, {
        method: "DELETE"
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to delete script");
            alert("Script deleted!");
            loadScripts();
        })
        .catch(err => {
            console.error(err);
            alert("Error deleting script: " + err.message);
        });
}

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("Page ready");

    document.querySelectorAll(".longForm, .shortForm, .carousel")
        .forEach(folder => {
            const preview = folder.querySelector(".preview");
            preview.style.display = "none";

            folder.addEventListener("click", (e) => {
                if (e.target.closest(".script-item")) return;
                preview.style.display =
                    preview.style.display === "none" ? "block" : "none";
            });
        });

    // Status filter bar (All / Draft / Filmed / Posted) — filters against
    // the actual stored script.status values from write.html's status select.
    document.querySelectorAll("#scriptFilterBar .script-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentFilter = btn.dataset.status;
            document.querySelectorAll("#scriptFilterBar .script-filter-btn")
                .forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            loadScripts();
        });
    });

    const closeBtn = document.getElementById("closeScriptBtn");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            window.location.href = "scripts.html";
        });
    }

    const addScriptBtn = document.getElementById("addScriptBtn");
    if (addScriptBtn) {
        addScriptBtn.addEventListener("click", () => {
            window.location.href = "write.html";
        });
    }

    const form = document.getElementById("scriptForm");
    if (form) form.classList.add("hidden");

    // Edit mode: write.html?id=<script_id> pre-fills the form and
    // addScript() above switches to PUT automatically.
    const params = new URLSearchParams(window.location.search);
    const editingScriptId = params.get("id");
    const titleEl = document.getElementById("title");
    if (editingScriptId && titleEl) {
        fetch(`http://localhost:3000/scripts/${editingScriptId}`)
            .then(res => res.json())
            .then(script => {
                document.getElementById("title").value = script.title || "";
                document.getElementById("content").value = script.script_content || "";
                const folderEl = document.getElementById("folder");
                const statusEl = document.getElementById("status");
                if (folderEl) folderEl.value = script.content_type || "short-form";
                if (statusEl) statusEl.value = script.status || "draft";
                const saveBtn = document.getElementById("saveScript");
                if (saveBtn) saveBtn.textContent = "Update Script";

                loadCategoryOptions(script.categories || []);
            })
            .catch(err => console.error("Error loading script for edit:", err));
    } else if (document.querySelector(".longForm .preview")) {
        // Only scripts.html has these folder containers.
        loadScripts();
    } else {
        // write.html in "create new" mode — no script to prefill from.
        loadCategoryOptions();
    }
});

function openScript(script) {
    window.location.href = `viewscripts.html?id=${script.script_id}`;
}