const params = new URLSearchParams(window.location.search);
const scriptId = params.get("id");

document.addEventListener("DOMContentLoaded", () => {

    if (!scriptId) {
        console.error("No script ID in URL");
        return;
    }

    fetch(`http://localhost:3000/scripts/${scriptId}`)
        .then(res => {
            if (!res.ok) throw new Error("Script not found");
            return res.json();
        })
        .then(script => {
            document.getElementById("viewTitle").textContent = script.title;
            document.getElementById("viewContent").textContent = script.script_content;

            document.getElementById("viewMeta").textContent =
                `${script.content_type || "No type"} • ${script.status}`;

            document.getElementById("viewFolder").textContent =
                `Type: ${script.content_type}`;

            loadScheduleInfo(script.content_id);
        })
        .catch(err => console.error("Error loading script:", err));

    const backBtn = document.getElementById("closeScriptBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            window.location.href = "scripts.html";
        });
    }

    document.getElementById("editBtn").addEventListener("click", () => {
        window.location.href = `write.html?id=${scriptId}`;
    });
});

document.getElementById("deleteBtn").addEventListener("click", () => {
    if (!confirm("Delete this script?")) return;

    fetch(`http://localhost:3000/scripts/${scriptId}`, {
        method: "DELETE"
    })
        .then(res => {
            if (!res.ok) throw new Error("Delete failed");
            alert("Deleted!");
            window.location.href = "scripts.html";
        })
        .catch(err => console.error(err));
});

// Shows any scheduled_content entries for the content this script belongs to.
function loadScheduleInfo(contentId) {
    const eventEl = document.getElementById("viewEvents");
    if (!eventEl || !contentId) return;

    fetch("http://localhost:3000/scheduled-content")
        .then(res => res.json())
        .then(items => {
            const related = items.filter(i => i.content_id == contentId);

            if (related.length === 0) {
                eventEl.textContent = "Not scheduled yet";
                return;
            }

            eventEl.innerHTML = related.map(i => {
                return `<div>
                    ${i.platform_name}: ${i.scheduled_date} (${i.computed_status})
                </div>`;
            }).join("");
        })
        .catch(err => console.error("Error loading schedule info:", err));
}
