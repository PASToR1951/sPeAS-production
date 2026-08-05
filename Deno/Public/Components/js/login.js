// Login handling for the legacy pages, backed by Better Auth
// (/api/auth/sign-in/username). The session cookie is HttpOnly and managed
// by the server; only display info is cached in web storage.

function ensurePeasAuth() {
    return new Promise((resolve) => {
        if (window.PeasAuth) return resolve(window.PeasAuth);
        const script = document.createElement('script');
        script.src = '/Components/js/auth-client.js';
        script.onload = () => resolve(window.PeasAuth);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
    });
}

document.addEventListener("DOMContentLoaded", () => {

    setTimeout(() => {
        const loginForm = document.getElementById("login-form");
        if (!loginForm) {
            return;
        }

        let isSubmitting = false;

        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (isSubmitting) {
                return;
            }
            isSubmitting = true;

            const ID = document.getElementById("wf-log-in-id")?.value.trim();
            const Password = document.getElementById("wf-log-in-password")?.value.trim();

            if (!ID || !Password) {
                alert("Please fill in both fields.");
                isSubmitting = false;
                return;
            }

            try {
                const auth = await ensurePeasAuth();
                if (!auth) {
                    alert("Login is temporarily unavailable. Please reload the page.");
                    return;
                }

                const session = await auth.signInUsername(ID, Password);

                // Display-only cache; the HttpOnly cookie is the credential.
                const userInfo = auth.storeUserInfo(session);

                // Update header UI
                updateHeaderUI(userInfo);

                auth.redirectByRole(session.role);
            } catch (error) {
                alert(error && error.message ? error.message : "Login failed. Please check your credentials.");
            } finally {
                isSubmitting = false;
            }
        });
    }, 100);
});

// Function to update header UI after login
function updateHeaderUI(userInfo) {
    if (!userInfo) return;

    // Try to refresh using navbar module if available
    if (window.NavbarModule && typeof window.NavbarModule.refresh === 'function') {
                window.NavbarModule.refresh();
        return;
    }

    // Fallback to old method if NavbarModule not available

    // Try to get the header elements
    const loginContainer = document.getElementById('loginContainer');
    const userDropdownContainer = document.getElementById('userDropdownContainer');
    const userName = document.getElementById('userName');

    // If header elements exist on the current page
    if (loginContainer && userDropdownContainer && userName) {
        loginContainer.style.display = 'none';
        userDropdownContainer.style.display = 'block';

        // Set user name
        userName.textContent = userInfo.username || userInfo.id || 'User';

        // Add role if not a regular user
        if (userInfo.role && userInfo.role.toLowerCase() !== 'user') {
            userName.textContent += ` (${userInfo.role})`;
        }
    }
}

// Add a global logout function that can be called from anywhere
window.logout = async function() {
    try {
        const auth = await ensurePeasAuth();
        if (auth) {
            await auth.signOut();
        }

        // Update UI if on a page with the header
        const loginContainer = document.getElementById('loginContainer');
        const userDropdownContainer = document.getElementById('userDropdownContainer');

        if (loginContainer && userDropdownContainer) {
            loginContainer.style.display = 'block';
            userDropdownContainer.style.display = 'none';
        }

        // If on an admin page, redirect to login
        if (window.location.pathname.includes('/admin/')) {
            window.location.href = '/log-in.html';
        } else if (window.location.pathname.includes('/profile') ||
            window.location.pathname.includes('/settings')) {
            window.location.href = '/log-in.html';
        } else {
            // Optional: reload the current page
            window.location.reload();
        }
    } catch (error) {
    }
};
