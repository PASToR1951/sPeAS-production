document.addEventListener("DOMContentLoaded", () => {

    const authBtn = document.getElementById("auth-btn");

    let loggedIn = false;
    try {
        const userInfo = JSON.parse(
            sessionStorage.getItem("userInfo") || localStorage.getItem("userInfo") || "null",
        );
        loggedIn = Boolean(userInfo && userInfo.isLoggedIn);
    } catch (_error) {
        loggedIn = false;
    }

    if (authBtn && loggedIn) {
        authBtn.outerHTML = `<button id="logout-btn" class="nav-link loginbtn w-nav-link">Logout</button>`;

        // Add logout event listener
        document.getElementById("logout-btn").addEventListener("click", async () => {
            try {
                await fetch("/api/auth/sign-out", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
            } catch (_error) {
                // Redirect regardless
            }
            ["userInfo", "userRole"].forEach((key) => {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
            });
            globalThis.location.href = "/log-in.html"; // Redirect to login page
        });
    }
});
