
const API_BASE = "http://localhost:3000";

function showSessionMessage(message) {
    let notice = document.getElementById("sessionCheckNotice");

    if (!notice) {
        notice = document.createElement("div");
        notice.id = "sessionCheckNotice";
        notice.setAttribute("role", "alert");

        Object.assign(notice.style, {
            position: "fixed",
            inset: "0",
            zIndex: "99999",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            background: "rgba(255,255,255,0.97)",
            color: "#4e1e17",
            textAlign: "center",
            fontSize: "16px"
        });

        document.body.appendChild(notice);
    }

    notice.textContent = message;
}

function hideSessionMessage() {
    document.getElementById("sessionCheckNotice")?.remove();
}

window.authReady = (async function checkApplicationSession() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            credentials: "include"
        });

        if (res.status === 401) {
            window.location.replace("login.html");
            return false;
        }

        if (!res.ok) {
            showSessionMessage(
                "We couldn't verify your session because the server returned an error. Please try again."
            );
            return false;
        }

        hideSessionMessage();
        return true;
    } catch (error) {
        showSessionMessage(
            "The server could not be reached. Check your connection and try again. You have not been signed out automatically."
        );
        return false;
    }
})();

window.wireLogoutButton = function wireLogoutButton() {
    const btn = document.getElementById("logoutBtn");
    if (!btn || btn.dataset.logoutWired === "true") return;

    btn.dataset.logoutWired = "true";

    btn.addEventListener("click", async (event) => {
        event.preventDefault();
        btn.setAttribute("aria-disabled", "true");

        try {
            const res = await fetch(`${API_BASE}/auth/logout`, {
                method: "POST",
                credentials: "include"
            });

            if (!res.ok) {
                showSessionMessage(
                    "Logout could not be confirmed by the server. Please try again."
                );
                btn.removeAttribute("aria-disabled");
                return;
            }

            window.location.replace("login.html");
        } catch (error) {
            showSessionMessage(
                "The server could not confirm logout. Reconnect and try again."
            );
            btn.removeAttribute("aria-disabled");
        }
    });
};
