/**
 * navbar-manager.js
 * 
 * This script handles the dynamic loading of the appropriate navbar
 * based on user authentication state and role.
 */

document.addEventListener("DOMContentLoaded", () => {
        
    // Get the navbar element
    const navbarElement = document.querySelector('nav.shadow-md');
    
    // Check user authentication status
    checkUserAuthentication()
        .then(userInfo => {
            if (userInfo && userInfo.isLoggedIn && userInfo.role) {
                // User is logged in, load the appropriate navbar based on role
                                
                if (userInfo.role.toLowerCase() === 'user') {
                    // Load the user navbar
                                        loadUserNavbar(navbarElement);
                } else if (userInfo.role.toLowerCase() === 'admin') {
                    // Redirect to admin dashboard if not already there
                    window.location.href = "/admin/dashboard.html";
                }
            } else {
                // User is not logged in, keep the default navbar
                            }
        })
        .catch(error => {
        });
});

/**
 * Check if the user is authenticated by looking for user info in session storage
 * @returns {Promise<Object|null>} User info object or null if not authenticated
 */
function checkUserAuthentication() {
    return new Promise((resolve) => {
        let userInfo = null;
        
        try {
            // Try to get user info from sessionStorage (preferred) or localStorage
            const sessionData = sessionStorage.getItem('userInfo');
            const localData = localStorage.getItem('userInfo');
            
            if (sessionData) {
                userInfo = JSON.parse(sessionData);
            } else if (localData) {
                userInfo = JSON.parse(localData);
            }
            
            // Validate that we have necessary user info
            if (userInfo && (userInfo.isLoggedIn || userInfo.token) && userInfo.role) {
                resolve(userInfo);
            } else {
                resolve(null);
            }
        } catch (error) {
            resolve(null);
        }
    });
}

/**
 * Load the user navbar by fetching the user-navBar.html content
 * @param {HTMLElement} navbarElement - The navbar element to replace
 */
function loadUserNavbar(navbarElement) {
    if (!navbarElement) {
        return;
    }
    
    // Create a temporary container to hold the user navbar
    const tempContainer = document.createElement('div');
    tempContainer.style.display = 'none';
    document.body.appendChild(tempContainer);
    
    // Fetch the user navbar HTML
    fetch('/Components/user-navBar.html')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch user-navBar.html: ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            // Parse the HTML to extract just the nav element
            tempContainer.innerHTML = html;
            
            // Find the nav element in the loaded content
            const userNav = tempContainer.querySelector('nav.sticky');
            
            if (userNav) {
                // Replace the existing navbar with the user navbar
                navbarElement.parentNode.replaceChild(userNav, navbarElement);
                
                // Initialize any scripts that the user navbar needs
                initializeUserNavbar();
            } else {
            }
        })
        .catch(error => {
        })
        .finally(() => {
            // Clean up the temporary container
            document.body.removeChild(tempContainer);
        });
}

/**
 * Initialize event handlers and other functionality for the user navbar
 */
function initializeUserNavbar() {
    // Get user info
    let userInfo = null;
    try {
        userInfo = JSON.parse(sessionStorage.getItem('userInfo')) || JSON.parse(localStorage.getItem('userInfo'));
    } catch (error) {
        return;
    }
    
    if (!userInfo) return;
    
    // Set up user profile button
    const profileInitialsElements = document.querySelectorAll('.profile-initials span');
    const userNameElements = document.querySelectorAll('#user-name-part, #greeting-part');
    
    // Set up initials
    if (profileInitialsElements.length > 0) {
        const username = userInfo.username || userInfo.id || '';
        const initials = username.split(' ')
            .map(name => name.charAt(0))
            .join('')
            .toUpperCase()
            .substring(0, 2);
        
        profileInitialsElements.forEach(element => {
            element.textContent = initials;
        });
    }
    
    // Set up user name
    if (userNameElements.length > 0 && userInfo.username) {
        userNameElements.forEach(element => {
            if (element.id === 'greeting-part') {
                // Set greeting based on time of day
                const currentHour = new Date().getHours();
                let greeting = "Hello";
                if (currentHour < 12) greeting = "Good morning";
                else if (currentHour < 18) greeting = "Good afternoon";
                else greeting = "Good evening";
                
                element.textContent = `${greeting}!`;
            } else {
                element.textContent = userInfo.username;
            }
        });
    }
    
    // Set up dropdown menu toggle
    const profileButton = document.getElementById('profile-badge-button');
    const dropdownMenu = document.getElementById('dropdown-menu');
    
    if (profileButton && dropdownMenu) {
        profileButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpen = dropdownMenu.classList.contains('opacity-100');
            
            if (isOpen) {
                // Close dropdown
                dropdownMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                dropdownMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
            } else {
                // Open dropdown
                dropdownMenu.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
                dropdownMenu.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
            }
            
            profileButton.setAttribute('aria-expanded', !isOpen);
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const profileBadgeContainer = document.getElementById('profile-badge-container');
            if (profileBadgeContainer && !profileBadgeContainer.contains(event.target)) {
                dropdownMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                dropdownMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                profileButton.setAttribute('aria-expanded', 'false');
            }
        });
    }
    
    // Set up logout button
    const logoutButton = document.getElementById('menu-item-3');
    if (logoutButton) {
        logoutButton.addEventListener('click', (event) => {
            event.preventDefault();
            
            // Use the global logout function instead of just clearing storage
            if (typeof window.logout === 'function') {
                window.logout();
            } else {
                // Fallback if global function isn't available
                // Revoke the session through Better Auth directly
                fetch('/api/auth/sign-out', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                }).then(() => {
                    // Clear the display-only cache
                    sessionStorage.removeItem('userInfo');
                    localStorage.removeItem('userInfo');
                    sessionStorage.removeItem('session_token');
                    localStorage.removeItem('session_token');

                    // Redirect to login page
                    window.location.href = '/log-in.html';
                }).catch(error => {
                    // Redirect anyway as fallback
                    window.location.href = '/log-in.html';
                });
            }
        });
    }
    
    // Set up mobile menu toggle
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuOpenIcon = mobileMenuButton?.querySelector('svg:not(.hidden)');
    const mobileMenuCloseIcon = mobileMenuButton?.querySelector('svg.hidden');
    
    if (mobileMenuButton && mobileMenu && mobileMenuOpenIcon && mobileMenuCloseIcon) {
        mobileMenuButton.addEventListener('click', () => {
            const isCurrentlyExpanded = mobileMenuButton.getAttribute('aria-expanded') === 'true';
            const openMenu = !isCurrentlyExpanded;
            
            mobileMenuButton.setAttribute('aria-expanded', openMenu.toString());
            mobileMenu.classList.toggle('hidden', !openMenu);
            mobileMenuOpenIcon.classList.toggle('hidden', openMenu);
            mobileMenuCloseIcon.classList.toggle('hidden', !openMenu);
        });
    }
    
    // Set up search functionality
    const searchOpenButton = document.getElementById('search-open-button');
    const searchOpenButtonMobile = document.getElementById('search-open-button-mobile');
    
    if (searchOpenButton) {
        searchOpenButton.addEventListener('click', (event) => {
            event.stopPropagation();
            openSearch();
        });
    }
    
    if (searchOpenButtonMobile) {
        searchOpenButtonMobile.addEventListener('click', (event) => {
            event.stopPropagation();
            openSearch();
        });
    }
}

/**
 * Open the search overlay - reused from the user-navBar.html script
 */
function openSearch() {
    const searchOverlay = document.getElementById('search-overlay');
    const searchInputOverlay = document.getElementById('searchInputOverlay');
    const clearSearchInputButton = document.getElementById('clearSearchInputButton');
    const bodyElement = document.body;
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (!searchOverlay || !searchInputOverlay || !bodyElement) return;
    
    const originalBodyOverflow = bodyElement.style.overflow;
    bodyElement.style.overflow = 'hidden';
    
    searchOverlay.classList.remove('hidden');
    searchOverlay.classList.add('visible');
    
    setTimeout(() => {
        searchInputOverlay.focus();
        if (clearSearchInputButton) {
            clearSearchInputButton.classList.toggle('visible', searchInputOverlay.value.length > 0);
        }
    }, 50);
    
    if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
        // Close mobile menu
        const mobileMenuButton = document.querySelector('.mobile-menu-button');
        if (mobileMenuButton) {
            mobileMenuButton.setAttribute('aria-expanded', 'false');
            mobileMenu.classList.add('hidden');
            const mobileMenuOpenIcon = mobileMenuButton.querySelector('svg:not(.hidden)');
            const mobileMenuCloseIcon = mobileMenuButton.querySelector('svg.hidden');
            if (mobileMenuOpenIcon) mobileMenuOpenIcon.classList.remove('hidden');
            if (mobileMenuCloseIcon) mobileMenuCloseIcon.classList.add('hidden');
        }
    }
} 