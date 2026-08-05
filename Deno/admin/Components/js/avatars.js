(function () {
    const palettes = [
        ["#006A4E", "#e6f2ee"],
        ["#2563eb", "#dbeafe"],
        ["#7c3aed", "#ede9fe"],
        ["#d4a017", "#fef3c7"],
        ["#e11d48", "#ffe4e6"],
        ["#b45309", "#ffedd5"]
    ];

    function getInitials(fullName) {
        if (!fullName) return "?";
        const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return "?";
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase() || "?";
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function hashPalette(value) {
        let hash = 0;
        const source = String(value || "");
        for (let i = 0; i < source.length; i += 1) {
            hash = (hash * 31 + source.charCodeAt(i)) | 0;
        }
        return Math.abs(hash) % palettes.length;
    }

    function applyInitialsAvatar(element, name) {
        if (!element) return;
        const palette = palettes[hashPalette(name)];
        element.textContent = getInitials(name);
        element.style.backgroundColor = palette[1];
        element.style.color = palette[0];
        element.setAttribute("aria-label", name || "Unknown author");
    }

    window.peasAvatars = {
        applyInitialsAvatar,
        getInitials,
        hashPalette,
        palettes
    };
}());
