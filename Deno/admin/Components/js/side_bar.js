// Restore the persisted collapse state before first paint to avoid a flash
try {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
        document.documentElement.classList.add('sidebar-collapsed');
    }
} catch (_) { /* ignore storage errors */ }

// Enable sidebar animations only after the first frame has painted, so a
// page loading in the collapsed state doesn't animate into place
requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.add('sidebar-anim');
}));

// Delegated listener so the toggle keeps working even when the sidebar
// markup is re-injected via innerHTML (dashboard.html loads it twice).
// Guarded so a double-included script doesn't toggle twice per click.
if (!globalThis.__sidebarToggleWired) {
    globalThis.__sidebarToggleWired = true;
document.addEventListener('click', (event) => {
    const toggle = event.target.closest('.sidebar-toggle');
    if (!toggle) return;
    const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    try {
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch (_) { /* ignore storage errors */ }

    // Replay the jelly wobble on every toggle
    const sideBar = toggle.closest('.side-bar');
    if (sideBar) {
        sideBar.classList.remove('jelly');
        void sideBar.offsetWidth; // force reflow so the animation restarts
        sideBar.classList.add('jelly');
        const onEnd = (e) => {
            // label animations also fire animationend; wait for the panel's own
            if (e.target !== sideBar) return;
            sideBar.classList.remove('jelly');
            sideBar.removeEventListener('animationend', onEnd);
        };
        sideBar.addEventListener('animationend', onEnd);
    }
});
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // Get the sidebar container
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer) {
        return;
    }
    
    // Use absolute path to fetch sidebar HTML
    fetch('/admin/Components/side_bar.html')
    .then(response => response.text())
    .then(data => {
        sidebarContainer.innerHTML = data;

        // Find the sidebar element inside the container
        const sideBar = sidebarContainer.querySelector('#side-bar') || sidebarContainer;

        // If the sidebar exists, highlight the active link
        if (sideBar) {
            highlightActiveSidebarLink(sideBar);
        }

        // Setup logout functionality AFTER sidebar is loaded
        setupLogout();

        // Populate the user profile block from the active session
        populateSidebarUser();
    })
    .catch(error => console.error('Error loading sidebar:', error));
});

let adminIdentityPromise = null;

/**
 * Resolve display information from the authoritative Better Auth session.
 * Browser storage is updated only as a compatibility cache for older pages;
 * it is never used to decide who is signed in.
 */
function getAdminIdentity() {
    if (adminIdentityPromise) return adminIdentityPromise;

    adminIdentityPromise = fetch('/api/auth/get-session', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
    })
    .then(response => response.ok ? response.json() : null)
    .then(async data => {
        const user = data && data.user;
        if (!user) {
            try {
                sessionStorage.removeItem('userInfo');
                localStorage.removeItem('userInfo');
            } catch (_) { /* storage may be unavailable */ }
            return null;
        }

        let profile = null;
        try {
            const response = await fetch('/api/user/profile', {
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) profile = await response.json();
        } catch (_) { /* session data is sufficient for the display */ }

        const profileName = profile
            ? [profile.first_name, profile.middle_name, profile.last_name]
                .filter(Boolean)
                .join(' ')
                .trim()
            : '';
        const identity = {
            id: user.id,
            name: profileName || user.name || user.displayUsername || user.username || String(user.id || 'User'),
            username: user.displayUsername || user.username || user.name || String(user.id || ''),
            role: String(user.role || 'user').toLowerCase(),
            avatar: (profile && profile.profile_picture) || user.image || ''
        };

        try {
            const cached = JSON.stringify({
                isLoggedIn: true,
                id: identity.id,
                username: identity.username,
                role: identity.role
            });
            sessionStorage.setItem('userInfo', cached);
            localStorage.setItem('userInfo', cached);
        } catch (_) { /* storage may be unavailable */ }

        return identity;
    })
    .catch(() => null);

    return adminIdentityPromise;
}

function setTextIfChanged(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
}

function identityInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function renderLegacyAvatar(elementId, identity) {
    const current = document.getElementById(elementId);
    if (!current) return;

    if (identity.avatar) {
        if (current.tagName === 'IMG') {
            const image = current;
            const normalizedAvatar = identity.avatar.startsWith('/') ? identity.avatar : `/${identity.avatar}`;
            if (image.src !== normalizedAvatar) image.src = normalizedAvatar;
            return;
        }

        const image = document.createElement('img');
        image.id = elementId;
        image.src = identity.avatar.startsWith('/') ? identity.avatar : `/${identity.avatar}`;
        image.alt = 'User Avatar';
        image.addEventListener('error', () => renderLegacyAvatar(elementId, { ...identity, avatar: '' }), { once: true });
        current.replaceWith(image);
        return;
    }

    if (current.tagName !== 'SPAN') {
        const initials = document.createElement('span');
        initials.id = elementId;
        initials.className = 'user-avatar-initials';
        initials.setAttribute('role', 'img');
        initials.setAttribute('aria-label', 'User Avatar');
        current.replaceWith(initials);
        renderLegacyAvatar(elementId, identity);
        return;
    }

    current.textContent = identityInitials(identity.name);
}

function renderAdminIdentity(identity) {
    if (!identity) return;

    setTextIfChanged(document.getElementById('sidebar-user-name'), identity.name);
    setTextIfChanged(document.getElementById('sidebar-user-role'),
        identity.role === 'admin' ? 'Administrator' : identity.role === 'publisher' ? 'Content Publisher' : 'User');
    setTextIfChanged(document.getElementById('header-user-name'), identity.name);
    setTextIfChanged(document.getElementById('header-user-role'),
        identity.role === 'admin' ? 'ADMIN' : identity.role === 'publisher' ? 'PUBLISHER' : identity.role.toUpperCase());
    setTextIfChanged(document.getElementById('welcome-username'), identity.name);

    renderLegacyAvatar('sidebar-user-avatar', identity);
    renderLegacyAvatar('header-user-avatar', identity);
}

/** Populate every legacy admin identity surface from one session result. */
function populateSidebarUser() {
    return getAdminIdentity().then(renderAdminIdentity);
}

// Header/sidebar fragments are injected asynchronously with innerHTML, which
// does not execute their embedded scripts. Re-apply the resolved identity when
// either fragment appears, without issuing another session request.
document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => {
        if (document.getElementById('sidebar-user-name') || document.getElementById('header-user-name')) {
            populateSidebarUser();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    populateSidebarUser();
});

globalThis.populateAdminIdentity = populateSidebarUser;

// Highlight active sidebar link
function highlightActiveSidebarLink(sideBar) {
    const currentPage = globalThis.location.pathname;
    // Find links either in the sidebar element or in the document if sidebar not provided
    const navLinks = sideBar ? 
        sideBar.querySelectorAll('a.icon-wrapper') : 
        document.querySelectorAll('#side-bar a.icon-wrapper');

    navLinks.forEach(link => {
        // Get the pathname from the link's href
        const href = new URL(link.href, globalThis.location.origin).pathname;

        // Skip highlighting for logout link
        if (href === '/logout') {
            link.classList.remove('active');
            return;
        }

        if (href === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

/**
 * Side bar functionality
 */

// Remove duplicate DOMContentLoaded listener to avoid conflicts
// document.addEventListener('DOMContentLoaded', () => {
//   //   
//   // Setup logout functionality
//   setupLogout();
//   
//   // Initialize prevention on page load
//   preventBackNavigation();
// });

// Initialize prevention on page load - moved outside of duplicate event listener
document.addEventListener('DOMContentLoaded', () => {
    preventBackNavigation();
});

// Function to prevent back navigation
function preventBackNavigation() {
    // Clear all history entries
    globalThis.history.pushState(null, '', globalThis.location.href);
    
    // Prevent back navigation
    globalThis.addEventListener('popstate', function() {
        globalThis.history.pushState(null, '', globalThis.location.href);
    });
    
    // Disable back button
    globalThis.history.pushState(null, '', globalThis.location.href);
    globalThis.onpopstate = function() {
        globalThis.history.pushState(null, '', globalThis.location.href);
    };
}

// Additional prevention for browser back button
globalThis.addEventListener('beforeunload', function() {
    preventBackNavigation();
});

/**
 * Setup logout functionality
 */
function setupLogout() {
    
  // Try multiple selectors to find the logout button - improved selector specificity
  const logoutButton = document.querySelector('.icon-wrapper.logout-btn') || 
                       document.querySelector('a.logout-btn') ||
                       document.querySelector('a[href="/logout"].icon-wrapper.logout-btn') ||
                       document.querySelector('a[onclick*="handleLogout"]');
  
  if (logoutButton) {
    // Check if the button already has an event handler
    if (logoutButton.getAttribute('data-has-logout-handler') !== 'true') {
      // Remove any existing event listeners to prevent duplicates
      logoutButton.removeEventListener('click', handleLogout);
      
      // Add fresh event listener
      logoutButton.addEventListener('click', handleLogout);
      
      // Mark this button as having a handler to prevent duplicates
      logoutButton.setAttribute('data-has-logout-handler', 'true');
      
      // Also ensure the onclick attribute is set correctly
      logoutButton.setAttribute('onclick', 'handleLogout(event); return false;');
      
          } else {
          }
  } else {
    // Add a fallback timeout to try again after sidebar is fully loaded
    setTimeout(() => {
      // Try a more comprehensive set of selectors
      const retryLogoutButton = document.querySelector('.icon-wrapper.logout-btn') || 
                                document.querySelector('a.logout-btn') ||
                                document.querySelector('a[href="/logout"].icon-wrapper.logout-btn') ||
                                document.querySelector('a[onclick*="handleLogout"]');
                                
      if (retryLogoutButton && retryLogoutButton.getAttribute('data-has-logout-handler') !== 'true') {
        retryLogoutButton.removeEventListener('click', handleLogout);
        retryLogoutButton.addEventListener('click', handleLogout);
        retryLogoutButton.setAttribute('data-has-logout-handler', 'true');
        retryLogoutButton.setAttribute('onclick', 'handleLogout(event); return false;');
              } else if (retryLogoutButton) {
              } else {
      }
    }, 1000);
  }
}

function handleLogout(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation(); // Stop event propagation to prevent multiple handlers
  }
    
  // Prevent multiple logout attempts
  if (window.logoutInProgress) {
        return;
  }
  
  window.logoutInProgress = true;
  
  // Add visual indicator that logout is happening
  const loadingPopup = document.createElement('div');
  loadingPopup.style.position = 'fixed';
  loadingPopup.style.top = '0';
  loadingPopup.style.left = '0';
  loadingPopup.style.width = '100%';
  loadingPopup.style.height = '100%';
  loadingPopup.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  loadingPopup.style.display = 'flex';
  loadingPopup.style.justifyContent = 'center';
  loadingPopup.style.alignItems = 'center';
  loadingPopup.style.zIndex = '9999';
  
  const loadingContent = document.createElement('div');
  loadingContent.style.backgroundColor = 'white';
  loadingContent.style.padding = '20px';
  loadingContent.style.borderRadius = '10px';
  loadingContent.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
  loadingContent.style.display = 'flex';
  loadingContent.style.flexDirection = 'column';
  loadingContent.style.alignItems = 'center';
  loadingContent.style.gap = '15px';
  
  const spinner = document.createElement('div');
  spinner.style.width = '40px';
  spinner.style.height = '40px';
  spinner.style.border = '4px solid #f3f3f3';
  spinner.style.borderTop = '4px solid #006A4E';
  spinner.style.borderRadius = '50%';
  spinner.style.animation = 'spin 1s linear infinite';
  
  // Add the animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  const loadingText = document.createElement('p');
  loadingText.textContent = 'Logging out...';
  loadingText.style.margin = '0';
  loadingText.style.fontFamily = 'Inter';
  loadingText.style.color = '#4b5563';
  
  loadingContent.appendChild(spinner);
  loadingContent.appendChild(loadingText);
  loadingPopup.appendChild(loadingContent);
  document.body.appendChild(loadingPopup);
  
  // Clear the display-only cache; the HttpOnly session cookie can only be
  // cleared by the server (Better Auth sign-out below).
  try {
    const storageKeys = ['userInfo', 'session_token', 'accessToken', 'user', 'userData', 'auth', 'role'];
    storageKeys.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
  }

  // Revoke the session through Better Auth
  fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  .then(() => {
    window.location.href = '/index.html?nocache=' + Date.now();
  })
  .catch(error => {
    // Fallback on error
    window.location.href = '/index.html?nocache=' + Date.now();
  })
  .finally(() => {
    // Small delay to show the loading animation
    setTimeout(() => {
      // Clean up loading popup
      if (document.body.contains(loadingPopup)) {
        document.body.removeChild(loadingPopup);
      }
      
      // Final safety check - if we're still on admin page after 2 seconds, force redirect
      if (window.location.pathname.includes('/admin/')) {
                window.location.href = '/index.html?forcedRedirect=true&t=' + Date.now();
      }
    }, 1000);
  });
}

// Export the function for use in other files and make it globally available
window.handleLogout = handleLogout;
window.sidebarHandleLogout = handleLogout; // Add this for dashboard.html to use
globalThis.handleLogout = handleLogout;
globalThis.sidebarHandleLogout = handleLogout;

// Make sure the function is available after the page loads too
document.addEventListener('DOMContentLoaded', () => {
  window.handleLogout = handleLogout;
  window.sidebarHandleLogout = handleLogout; // Add this for dashboard.html to use
  globalThis.handleLogout = handleLogout;
  globalThis.sidebarHandleLogout = handleLogout;
  });
