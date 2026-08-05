(function () {
    const iconMap = {
        success: "fas fa-check-circle",
        "document-archived": "fas fa-archive",
        "document-restored": "fas fa-trash-restore",
        error: "fas fa-exclamation-circle",
        warning: "fas fa-exclamation-triangle",
        info: "fas fa-info-circle"
    };

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getContainer() {
        let container = document.getElementById("toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            container.className = "toast-container";
            document.body.appendChild(container);
        }
        return container;
    }

    function normalizeType(type) {
        const safeType = String(type || "info").toLowerCase();
        if (safeType === "danger") return "error";
        if (safeType === "restored") return "document-restored";
        if (safeType === "archived") return "document-archived";
        return safeType;
    }

    function show(message, type = "info", options = {}) {
        const normalizedType = normalizeType(type);
        const duration = Number(options.duration || (normalizedType === "error" ? 8000 : normalizedType === "warning" ? 6000 : 5000));
        const container = getContainer();
        const toast = document.createElement("div");
        const id = "toast-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        const title = options.title || ({
            success: "Success",
            error: "Error",
            warning: "Heads up",
            info: "Notice",
            "document-archived": "Archived",
            "document-restored": "Restored"
        }[normalizedType] || "Notice");

        toast.id = id;
        toast.className = `toast ${normalizedType}`;
        toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");
        toast.innerHTML = `
            <div class="toast-content">
                <i class="${iconMap[normalizedType] || iconMap.info}" aria-hidden="true"></i>
                <div class="message-container">
                    <div class="toast-title">${escapeHtml(title)}</div>
                    <div class="toast-message">${escapeHtml(message)}</div>
                </div>
                <button class="close-btn" type="button" aria-label="Dismiss notification">&times;</button>
            </div>
            <div class="toast-progress"></div>
        `;

        container.appendChild(toast);

        const progress = toast.querySelector(".toast-progress");
        if (progress) {
            progress.style.animationDuration = `${duration / 1000}s`;
        }

        let timeoutId = window.setTimeout(remove, duration);

        function remove() {
            window.clearTimeout(timeoutId);
            toast.style.opacity = "0";
            toast.style.transform = "translateX(18px)";
            window.setTimeout(() => toast.remove(), 180);
        }

        toast.querySelector(".close-btn").addEventListener("click", remove);
        return { id, remove };
    }

    window.peasToast = { show };
    window.showPeasToast = show;
    if (typeof window.showToast !== "function") {
        window.showToast = show;
    }
}());
