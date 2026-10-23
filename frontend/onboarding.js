// Onboarding / profile editing. The server is the only source of truth:
// nothing is stored in localStorage and completion is set by the backend
// (POST /profile/complete) only after it verifies the saved data.
// API_BASE is defined by auth-guard.js, which onboarding.html loads first.

const params = new URLSearchParams(window.location.search);
const editMode = params.get("edit") === "1";

const els = {
    loadError: document.getElementById("loadError"),
    loadErrorText: document.getElementById("loadErrorText"),
    retryBtn: document.getElementById("retryBtn"),
    formArea: document.getElementById("formArea"),
    displayName: document.getElementById("displayName"),
    primaryNiche: document.getElementById("primaryNiche"),
    bio: document.getElementById("bio"),
    topicInput: document.getElementById("topicInput"),
    addTopicBtn: document.getElementById("addTopicBtn"),
    topicList: document.getElementById("topicList"),
    message: document.getElementById("message"),
    finishBtn: document.getElementById("finishBtn"),
};

let topics = [];

function setMessage(text, kind) {
    els.message.textContent = text || "";
    els.message.className = "onboard-msg" + (kind ? " " + kind : "");
}

function renderTopics() {
    els.topicList.textContent = "";
    topics.forEach((t) => {
        const li = document.createElement("li");
        li.appendChild(document.createTextNode(t.topic_name));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Remove topic ${t.topic_name}`);
        btn.textContent = "×";
        btn.addEventListener("click", () => removeTopic(t.topic_id));
        li.appendChild(btn);
        els.topicList.appendChild(li);
    });
}

async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        window.location.replace("login.html");
        throw new Error("unauthenticated");
    }
    return { ok: res.ok, status: res.status, data };
}

async function loadState() {
    els.loadError.classList.add("is-hidden");
    try {
        const { ok, data } = await api("/profile");
        if (!ok) {
            // A failed request is NOT treated as "no profile" and never redirects.
            els.loadErrorText.textContent =
                data.message || "We couldn't load your profile. Please try again.";
            els.loadError.classList.remove("is-hidden");
            els.formArea.classList.add("is-hidden");
            return;
        }
        if (data.onboarding_completed && !editMode) {
            window.location.replace("dashboard.html");
            return;
        }
        if (data.profile) {
            els.displayName.value = data.profile.display_name || "";
            els.primaryNiche.value = data.profile.primary_niche || "";
            els.bio.value = data.profile.bio || "";
        }
        topics = data.topics || [];
        renderTopics();
        if (editMode) {
            document.getElementById("pageTitle").textContent = "Edit your creator profile";
            els.finishBtn.textContent = "Save changes";
        }
        els.formArea.classList.remove("is-hidden");
    } catch (err) {
        if (err.message === "unauthenticated") return;
        els.loadErrorText.textContent = "The server could not be reached. Please try again.";
        els.loadError.classList.remove("is-hidden");
    }
}

async function addTopic() {
    const name = els.topicInput.value.trim();
    if (!name) { setMessage("Type a topic first.", "error"); return; }
    els.addTopicBtn.disabled = true;
    try {
        const { ok, data } = await api("/profile/topics", {
            method: "POST",
            body: JSON.stringify({ topic_name: name }),
        });
        if (!ok) { setMessage(data.message || "Could not add the topic.", "error"); return; }
        topics.push({ topic_id: data.topic_id, topic_name: data.topic_name });
        topics.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
        renderTopics();
        els.topicInput.value = "";
        setMessage("", "");
    } catch (err) {
        if (err.message !== "unauthenticated") setMessage("Could not reach the server.", "error");
    } finally {
        els.addTopicBtn.disabled = false;
    }
}

async function removeTopic(topicId) {
    try {
        const { ok, data } = await api(`/profile/topics/${topicId}`, { method: "DELETE" });
        if (!ok && data.message !== "Topic not found.") {
            setMessage(data.message || "Could not remove the topic.", "error");
            return;
        }
        topics = topics.filter((t) => t.topic_id !== topicId);
        renderTopics();
        setMessage("", "");
    } catch (err) {
        if (err.message !== "unauthenticated") setMessage("Could not reach the server.", "error");
    }
}

async function finish() {
    const displayName = els.displayName.value.trim();
    if (!displayName) { setMessage("Display name is required.", "error"); return; }
    if (!topics.length) { setMessage("Add at least one topic.", "error"); return; }

    els.finishBtn.disabled = true;
    setMessage("Saving…", "");
    try {
        const saved = await api("/profile", {
            method: "PUT",
            body: JSON.stringify({
                display_name: displayName,
                primary_niche: els.primaryNiche.value,
                bio: els.bio.value,
            }),
        });
        if (!saved.ok) { setMessage(saved.data.message || "Could not save your profile.", "error"); return; }

        const done = await api("/profile/complete", { method: "POST", body: "{}" });
        if (!done.ok) { setMessage(done.data.message || "Could not finish setup.", "error"); return; }

        setMessage("Saved! Taking you to your dashboard…", "ok");
        window.location.replace("dashboard.html");
    } catch (err) {
        if (err.message !== "unauthenticated") setMessage("Could not reach the server. Nothing was marked complete.", "error");
    } finally {
        els.finishBtn.disabled = false;
    }
}

els.addTopicBtn.addEventListener("click", addTopic);
els.topicInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } });
els.finishBtn.addEventListener("click", finish);
els.retryBtn.addEventListener("click", loadState);

(async function init() {
    const ok = await window.authReady;
    if (!ok) return; // auth-guard already redirected or showed its own message
    loadState();
})();