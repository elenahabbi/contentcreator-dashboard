console.log("Scripts JS loaded 🔥");
let currentFilter = "all";

// --- LOAD SCRIPTS ---
function loadScripts() {
    const longFormDiv = document.querySelector(".longForm .preview");
    const shortFormDiv = document.querySelector(".shortForm .preview");
    const carouselDiv = document.querySelector(".carousel .preview");

    if (longFormDiv) longFormDiv.innerHTML = "";
    if (shortFormDiv) shortFormDiv.innerHTML = "";
    if (carouselDiv) carouselDiv.innerHTML = "";

    fetch("http://localhost:3000/scripts")
        .then(res => {
            if (!res.ok) throw new Error("Failed to fetch scripts");
            return res.json();
        })
        .then(scripts => {
            console.log("Fetched scripts:", scripts);
            scripts.forEach(script => {

                if (currentFilter !== "all") {
                    if (script.status !== currentFilter.slice(0, -1)) return;
                }

                const p = document.createElement("p");
                p.textContent = script.title;
                p.classList.add("script-item");
                p.style.cursor = "pointer";

                p.addEventListener("click", () => openScript(script));

                // content_type now lives on the joined `content` row
                // ("folder" was the old scripts.folder column)
                if (script.content_type?.trim() === "long-form" && longFormDiv) {
                    longFormDiv.appendChild(p);
                } else if (script.content_type?.trim() === "short-form" && shortFormDiv) {
                    shortFormDiv.appendChild(p);
                } else if (script.content_type?.trim() === "carousel" && carouselDiv) {
                    carouselDiv.appendChild(p);
                } else {
                    console.warn("Unknown content_type:", script.content_type);
                }
            });
        })
        .catch(err => console.error("Error loading scripts:", err));
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
        body: JSON.stringify({ title, script_content, content_type, status })
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
                if (e.target.classList.contains("script-item")) return;
                preview.style.display =
                    preview.style.display === "none" ? "block" : "none";
            });
        });

    document.querySelectorAll(".ulScripts li").forEach(li => {
        li.style.cursor = "pointer";
        li.addEventListener("click", () => {
            currentFilter = li.dataset.status;
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
            })
            .catch(err => console.error("Error loading script for edit:", err));
    } else if (document.querySelector(".longForm .preview")) {
        // Only scripts.html has these folder containers.
        loadScripts();
    }
});

function openScript(script) {
    window.location.href = `viewscripts.html?id=${script.script_id}`;
}
