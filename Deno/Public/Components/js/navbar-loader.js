/**
 * navbar-loader.js
 *
 * A comprehensive, reusable module for loading and initializing the navbar
 * across all pages in the application.
 */

// Create a global NavbarModule object
window.NavbarModule = (function() {
    'use strict';

    // Configuration
    const USER_NAVBAR_URL = '/Components/NavBar/user-Navbar.html';
    const GUEST_NAVBAR_URL = '/Components/NavBar/default-NavBar.html';
    const USER_PROFILE_URL = '/api/user/profile';
    const LIBRARY_COUNT_URL = '/api/user/library/count';
    const JQUERY_CDN_URL = 'https://code.jquery.com/jquery-3.6.4.min.js';
    
    // Global initialization flag to prevent double initialization
    let isInitialized = false;

    // Check if jQuery is available, load it if not
    function ensureJQuery(callback) {
        if (window.jQuery) {
                        if (callback) callback();
            return;
        }
        
                const script = document.createElement('script');
        script.src = JQUERY_CDN_URL;
        script.integrity = 'sha256-oP6HI9z1XaZNBrJURtCoUT5SUnxFr8s3BzRl+cbzUq8=';
        script.crossOrigin = 'anonymous';
        
        script.onload = function() {
                        if (callback) callback();
        };
        
        script.onerror = function() {
            if (callback) callback(new Error('Failed to load jQuery'));
        };
        
        document.head.appendChild(script);
    }

    function initFlowbiteComponents() {
        try {
            if (window.SystemUI && typeof window.SystemUI.init === 'function') {
                window.SystemUI.init();
                return;
            }

            if (typeof window.initFlowbite === 'function') {
                window.initFlowbite();
            }
        } catch (error) {
        }
    }

    // Main initialization function - call this from each page
    function initNavbar() {
                        
        // Prevent double initialization
        if (isInitialized) {
                        return;
        }
        
        // Check if navbar container exists
        const navbarContainer = document.getElementById('navbarContainer');
        if (!navbarContainer) {
            return;
        } else {
                    }
        
        // Check if we're on a page that should not display the navbar
        const currentPath = window.location.pathname;
        const excludedPages = ['/pages/doc-single.html', '/pages/doc-compiled.html', '/pages/doc-compiled-single.html'];
        
        if (excludedPages.some(page => currentPath.includes(page))) {
                        return; // Skip navbar initialization for excluded pages
        }
        
        // Add global logout function that can be called from anywhere
        window.logout = logout;
        
        // First, clean up any stale user data
        cleanupUserData();
        
        // Add global function for login button
        window.handleLogin = function(event) {
                        // Navigate to login page
            window.location.href = '/log-in.html';
        };
        
        // Ensure jQuery is available before proceeding
        ensureJQuery(function(error) {
            if (error) {
            }
        
        // Make sure DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupNavbar);
                        } else {
                            setupNavbar();
        }
        });
        
        // Implementation of recordPageVisit function
        if (typeof window.recordPageVisit !== 'function') {
            window.recordPageVisit = function() {
                try {
                    // The active React public application records its page view
                    // after mount. Keep this legacy compatibility tracker
                    // dormant there so a home load is counted once.
                    if (document.getElementById('react-public-root')) return;
                    // Check if user is logged in
                    let userInfo = null;
                    try {
                        userInfo = JSON.parse(sessionStorage.getItem('userInfo') || localStorage.getItem('userInfo'));
                    } catch (e) {
                                            }
                    
                    // Get current page URL
                    const pageUrl = window.location.pathname + window.location.search;
                    
                    // Prepare visit data
                    const visitData = {
                        pageUrl: pageUrl,
                        visitorType: userInfo?.isLoggedIn ? 'user' : 'guest',
                        userId: userInfo?.isLoggedIn ? userInfo.id : undefined,
                        metadata: {}
                    };
                    
                                        
                    // Send the visit data to the API
                    fetch('/api/page-visits', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include', // auth rides the HttpOnly session cookie
                        body: JSON.stringify(visitData)
                    }).then(response => {
                        if (!response.ok) {
                            return;
                        }
                                            }).catch(error => {
                    });
                } catch (error) {
                    // Non-critical error, don't disrupt the user experience
                }
            };
        }
        
        // Set initialization flag to true
        isInitialized = true;
    }

    // Function to clean up stale user data
    function cleanupUserData() {
        try {
            // Check sessionStorage
            const sessionUserInfo = sessionStorage.getItem('userInfo');
            if (sessionUserInfo) {
                try {
                    const userInfo = JSON.parse(sessionUserInfo);
                    
                    // If login time is more than 24 hours ago, clear it
                    if (userInfo.loginTime) {
                        const loginTime = new Date(userInfo.loginTime);
                        const currentTime = new Date();
                        const hoursSinceLogin = (currentTime - loginTime) / (1000 * 60 * 60);
                        
                        if (hoursSinceLogin > 24) {
                                                        sessionStorage.removeItem('userInfo');
                        }
                    }
                    
                    // If login status is false, clear it
                    if (userInfo.isLoggedIn !== true) {
                                                sessionStorage.removeItem('userInfo');
                    }
                } catch (e) {
                    sessionStorage.removeItem('userInfo');
                }
            }
            
            // Remove any existing localStorage items for backward compatibility
            if (localStorage.getItem('userInfo')) {
                                            localStorage.removeItem('userInfo');
                        }
            if (localStorage.getItem('session_token')) {
                localStorage.removeItem('session_token');
            }
        } catch (e) {
        }
    }

    // Main setup logic
    function setupNavbar() {
        // Check for navbar container
        const navbarContainer = document.getElementById('navbarContainer');
        if (!navbarContainer) {
            return;
        }
        
        // Check if navbar is already initialized or initializing
        if (navbarContainer.dataset.initialized === 'true' || navbarContainer.dataset.initializing === 'true') {
                        return;
        }

        // Check user authentication and load appropriate navbar
        const userInfo = getUserInfo();
        const isLoggedIn = isUserLoggedIn(userInfo);

        // The server session (HttpOnly cookie) is the source of truth. If it is
        // gone but client storage still says logged-in, drop the stale state and
        // re-render as guest. Covers logout paths that miss cleanup and
        // server-side session expiry.
        if (isLoggedIn) {
            fetch('/api/auth/get-session', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Accept': 'application/json' }
            })
            .then(response => (response.ok ? response.json() : null))
            .then(data => {
                if (!data || !data.user) {
                    sessionStorage.removeItem('userInfo');
                    localStorage.removeItem('userInfo');
                    window.location.reload();
                }
            })
            .catch(() => {});
        }

        // Add initialized flag to the container
        navbarContainer.dataset.initializing = 'true';
        
        // Load the appropriate navbar
        loadNavbar(navbarContainer, isLoggedIn, userInfo);
        
        // Set up an observer to watch for when the navbar content is loaded
        const observer = new MutationObserver(function(mutations) {
            // Look for newly added nav elements
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    // Check if there's a navbar in the added content
                    const hasNavElement = Array.from(mutation.addedNodes).some(node => 
                        node.nodeType === 1 && // Element node
                        (node.tagName === 'NAV' || node.querySelector('nav'))
                    );
                    
                    if (hasNavElement && navbarContainer.dataset.initializing === 'true') {
                                                observer.disconnect();
                        
                        // Mark as initialized to prevent double initialization
                        navbarContainer.dataset.initializing = 'false';
                        navbarContainer.dataset.initialized = 'true';
                        
                        // Initialize navbar functionality
                        initializeNavbarFunctionality(userInfo);
                        
                        // Setup event listeners
                        setupDropdown();
                        setupMobileMenu();
                        setupSearch();
                        initFlowbiteComponents();
                        
                        break;
                    }
                }
            }
        });
        
        // Start observing
        observer.observe(navbarContainer, { 
            childList: true,
            subtree: true
        });
        
        // Failsafe: Try initializing after a delay if observer didn't catch it
        setTimeout(() => {
            const navElement = navbarContainer.querySelector('nav');
            if (navElement && navbarContainer.dataset.initialized !== 'true') {
                                
                // Mark as initialized
                navbarContainer.dataset.initializing = 'false';
                navbarContainer.dataset.initialized = 'true';
                
                initializeNavbarFunctionality(userInfo);
                setupDropdown();
                setupMobileMenu();
                setupSearch();
                initFlowbiteComponents();
            }
        }, 800); // Slightly longer timeout to ensure content is loaded
    }

    // Get user information from storage
    function getUserInfo() {
        try {
            // Check sessionStorage only
            const sessionUserInfo = sessionStorage.getItem('userInfo');
            
                                    
            // Parse the stored JSON data
            if (sessionUserInfo) {
                try {
                    const userInfo = JSON.parse(sessionUserInfo);

                    // Fetch additional user info from database if logged in
                    // (auth rides the HttpOnly session cookie)
                    if (userInfo.isLoggedIn === true) {
                        fetchUserProfileFromDatabase(userInfo)
                            .then(dbUserInfo => {
                                if (dbUserInfo) {
                                    // Merge the existing userInfo with database info
                                                                    }
                            })
                            .catch(error => {
                            });
                    }
                    
                    return userInfo;
                } catch (parseError) {
                    // Clear invalid data
                    sessionStorage.removeItem('userInfo');
                    return null;
                }
            }
            
                        return null;
        } catch (error) {
            return null;
        }
    }

    // Fetch user profile information from the database
    async function fetchUserProfileFromDatabase(userInfo) {
        if (!userInfo || userInfo.isLoggedIn !== true) {
            return null;
        }

        try {

            // Make API call to fetch user data from database
            // Add userId to the URL as a query parameter
            const userId = userInfo.id || userInfo.user_id || '';

            const response = await fetch(`/api/user/profile?userId=${userId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include' // auth rides the HttpOnly session cookie
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch user profile: ${response.status} ${response.statusText}`);
            }
            
            const dbUserData = await response.json();
                        
            if (dbUserData) {
                // Update session storage with the enriched user data
                // Especially ensure we're using first_name from the database
                const updatedUserInfo = {
                    ...userInfo,
                    first_name: dbUserData.first_name || userInfo.first_name || userInfo.id,
                    last_name: dbUserData.last_name || userInfo.last_name || '',
                    email: dbUserData.email || userInfo.email || '',
                    display_name: dbUserData.first_name || userInfo.first_name || userInfo.id,
                    // Add profile picture URL from database
                    profile_picture: dbUserData.profile_picture || null,
                    profilePictureUrl: dbUserData.profilePictureUrl || dbUserData.profile_picture || null
                };
                
                                                
                // Update the session storage
                sessionStorage.setItem('userInfo', JSON.stringify(updatedUserInfo));
                
                // If already in a loaded state, update the UI
                const navbarContainer = document.getElementById('navbarContainer');
                if (navbarContainer && navbarContainer.dataset.initialized === 'true') {
                    updateProfileInfo(updatedUserInfo);
                }
                
                return updatedUserInfo;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    // Check if user is logged in
    function isUserLoggedIn(userInfo) {
        if (!userInfo) {
                        return false;
        }
        
                
        // Check for login timestamp and validate it's not too old (24 hours)
        if (userInfo.loginTime) {
            const loginTime = new Date(userInfo.loginTime);
            const currentTime = new Date();
            const hoursSinceLogin = (currentTime - loginTime) / (1000 * 60 * 60);

            if (hoursSinceLogin > 24) {
                                // Clear stale data
                sessionStorage.removeItem('userInfo');
                return false;
            }
        }

        // The session token lives in an HttpOnly cookie (not readable here);
        // isLoggedIn is the display-side signal, verified server-side per request.
        return userInfo.isLoggedIn === true;
    }

    // Fetch and load the navbar HTML
    function loadNavbar(container, isLoggedIn, userInfo) {
        // Get the appropriate navbar URL
        const navbarUrl = isLoggedIn ? USER_NAVBAR_URL : GUEST_NAVBAR_URL;
        
                
        // Try both capitalizations of path
        const urls = [
            navbarUrl,
            navbarUrl.replace('/Components/', '/components/')
        ];
        
        // Check if jQuery is available
        if (typeof jQuery !== 'undefined') {
                        
            // Use jQuery's load method which handles insertion and script execution
            $(container).load(urls[0], function(response, status, xhr) {
                if (status === "error") {
                                        
                    // Try the alternative capitalization
                    $(container).load(urls[1], function(response2, status2, xhr2) {
                        if (status2 === "error") {
                            createFallbackNavbar(container);
                        } else {
                                                    }
                    });
                } else {
                                    }
            });
        } else {
                        
            // Fallback to fetch API for browsers without jQuery
            fetch(urls[0])
                .then(response => {
                    if (!response.ok) {
                                                return fetch(urls[1]).then(altResponse => {
                            if (!altResponse.ok) {
                                throw new Error(`Failed to load navbar from both paths`);
                            }
                                                        return altResponse.text();
                        });
                    }
                                        return response.text();
                })
                .then(htmlContent => {
                    // Simple insertion of content
                    container.innerHTML = htmlContent;
                                    })
                .catch(error => {
            createFallbackNavbar(container);
                });
        }
    }

    // Initialize navbar functionality after loading
    function initializeNavbarFunctionality(userInfo) {
                
        // Add debug code to check for profile picture availability
        debugProfilePictureAvailability(userInfo);
        
        try {
            // Specifically initialize the profile badge for logged in users
            if (userInfo && isUserLoggedIn(userInfo)) {
                                
                // Fetch fresh user data from database if not already done
                if (!userInfo.first_name) {
                    fetchUserProfileFromDatabase(userInfo)
                        .then(dbUserInfo => {
                            if (dbUserInfo) {
                                // Re-initialize with the fresh data
                                userInfo = dbUserInfo;
                                // Debug profile picture after fetching
                                debugProfilePictureAvailability(dbUserInfo);
                            }
                            // Continue with UI initialization
                            initializeUserInterface(userInfo);
                        })
                        .catch(error => {
                            // Continue with what we have
                            initializeUserInterface(userInfo);
                        });
                } else {
                    // Continue with current userInfo
                    initializeUserInterface(userInfo);
                }
            } else {
                                // Setup login buttons for non-logged in users
                setupLoginButtons();
            }
        
            // Set up dropdown toggle
            setupDropdown();
            
            // Set up mobile menu toggle
            setupMobileMenu();
            
            // Set up search button
            setupSearch();

            initFlowbiteComponents();
        } catch (error) {
        }
    }

    // Debug helper function to check profile picture
    function debugProfilePictureAvailability(userInfo) {
        if (!userInfo) return;
        
                const profilePictureUrl = userInfo.profile_picture || userInfo.profilePictureUrl || null;
                
        if (profilePictureUrl) {
                        
            // Test image loading
            const testImg = new Image();
            testImg.onload = function() {
                                            };
            testImg.onerror = function() {
                                            };
            
            // Set the source to test loading
            testImg.src = profilePictureUrl.startsWith('/') ? profilePictureUrl : `/${profilePictureUrl}`;
        }
        
        // Check if profile badge already exists
        const profileBadgeButton = document.getElementById('profile-badge-button');
                
            }

    // Helper function to initialize the UI after getting user data
    function initializeUserInterface(userInfo) {
        // Find user-auth-container elements
        const userAuthContainer = document.getElementById('user-auth-container');
        const mobileUserAuthContainer = document.getElementById('mobile-user-auth-container');
        
        if (userAuthContainer) {
                        
            // Initialize user data display in the navbar
            updateProfileInfo(userInfo);
            
            // Add fallback implementations in case they're not defined in the navbar
            if (typeof window.createProfileBadge !== 'function') {
                                
                window.createProfileBadge = function(user) {
                    // Generate initials
                    let initials = '';
                    if (user.first_name && user.last_name) {
                        initials = user.first_name.charAt(0) + user.last_name.charAt(0);
                    } else if (user.first_name) {
                        initials = user.first_name.charAt(0) + (user.middle_name ? user.middle_name.charAt(0) : '');
                    } else if (user.username) {
                        const parts = user.username.split(' ');
                        if (parts.length > 1) {
                            initials = parts[0].charAt(0) + parts[parts.length-1].charAt(0);
                        } else {
                            initials = user.username.substring(0, 2);
                        }
                    } else {
                        initials = 'U';
                    }
                    
                    // Full name for display - prioritize first_name from database
                    const displayName = user.display_name || user.first_name || user.name || user.username || 'User';
                    const isAdminUser = String(user.role || '').toLowerCase() === 'admin';
                    const adminDashboardLink = isAdminUser ? `
                            <a href="/admin/dashboard.html" class="group text-green-800 flex items-center px-4 py-2 text-sm hover:bg-amber-100 hover:text-green-900 rounded-md mx-1 font-semibold" role="menuitem" tabindex="-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-5 h-5 mr-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75h6.75v6.75H3.75V3.75zm9.75 0h6.75v6.75H13.5V3.75zM3.75 13.5h6.75v6.75H3.75V13.5zm9.75 0h6.75v6.75H13.5V13.5z" />
                                </svg>
                                Dashboard
                            </a>
                            <div class="dropdown-divider mx-1" role="separator"></div>
                    ` : '';
                    
                    // Create profile badge container
                    const profileBadgeContainer = document.createElement('div');
                    profileBadgeContainer.id = 'profile-badge-container-dynamic';
                    profileBadgeContainer.className = 'relative inline-block text-left';
                    
                    // Create button
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.id = 'profile-badge-button';
                    button.className = 'flex items-center justify-center w-10 h-10 bg-green-600 rounded-full hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#E6E6E6] focus:ring-green-600 profile-initials text-lg select-none';
                    button.setAttribute('aria-expanded', 'false');
                    button.setAttribute('aria-haspopup', 'true');
                    button.innerHTML = `<span class="text-[#E6E6E6] font-medium">${initials.toUpperCase()}</span>`;
                    
                    // Add click listener directly to button
                    button.addEventListener('click', function(event) {
                        event.stopPropagation();
                        
                        // Toggle dropdown visibility
                        const dropdownMenu = this.nextElementSibling;
                        if (!dropdownMenu) return;
                        
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
                        
                        this.setAttribute('aria-expanded', (!isOpen).toString());
                    });
                    
                    // Create dropdown menu
                    const dropdownMenu = document.createElement('div');
                    dropdownMenu.id = 'dropdown-menu';
                    dropdownMenu.className = 'dropdown-menu origin-top-right absolute right-0 mt-2 w-60 rounded-md shadow-lg bg-[#E6E6E6] ring-1 ring-black ring-opacity-5 focus:outline-none opacity-0 transform scale-95 pointer-events-none z-50 select-none';
                    dropdownMenu.setAttribute('role', 'menu');
                    dropdownMenu.setAttribute('aria-orientation', 'vertical');
                    dropdownMenu.setAttribute('aria-labelledby', 'profile-badge-button');
                    dropdownMenu.tabIndex = -1;
                    
                    // Get greeting based on time of day
                    const currentHour = new Date().getHours();
                    let greeting = "Hello";
                    let emoji = "👋";
                    if (currentHour < 12) {
                        greeting = "Good morning";
                        emoji = "☀️";
                    } else if (currentHour < 18) {
                        greeting = "Good afternoon";
                        emoji = "👋";
                    } else {
                        greeting = "Good evening";
                        emoji = "🌙";
                    }
                    
                    // Populate dropdown menu
                    dropdownMenu.innerHTML = `
                        <div class="dropdown-greeting-container" role="none">
                            <span id="greeting-part" class="greeting-text">${greeting}! ${emoji}</span>
                            <span id="user-name-part" class="greeting-name">${displayName}</span>
                        </div>
                        <div class="py-1" role="none">
                            ${adminDashboardLink}
                            <a href="#" class="group text-gray-700 flex items-center px-4 py-2 text-sm hover:bg-amber-100 hover:text-green-800 rounded-md mx-1" role="menuitem" tabindex="-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-5 h-5 mr-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                </svg>
                                Profile
                            </a>
                            <a href="#" class="group text-gray-700 flex items-center px-4 py-2 text-sm hover:bg-amber-100 hover:text-green-800 rounded-md mx-1" role="menuitem" tabindex="-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-5 h-5 mr-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                History
                            </a>
                            <a href="#" class="group text-gray-700 flex items-center px-4 py-2 text-sm hover:bg-amber-100 hover:text-green-800 rounded-md mx-1" role="menuitem" tabindex="-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-5 h-5 mr-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                                </svg>
                                Library 
                                ${user.libraryCount > 0 ? `<span class="count-badge">${user.libraryCount}</span>` : ''}
                            </a>
                            <div class="dropdown-divider mx-1" role="separator"></div>
                            <button type="button" id="logout-button-desktop" class="group text-red-600 flex items-center px-4 py-2 text-sm hover:bg-red-200 hover:text-red-800 rounded-md mx-1 w-full text-left" role="menuitem" tabindex="-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-5 h-5 mr-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                                </svg>
                                Log Out
                            </button>
                        </div>`;
                    
                    // Add elements to container
                    profileBadgeContainer.appendChild(button);
                    profileBadgeContainer.appendChild(dropdownMenu);
                    
                    // Add document click listener to close dropdown when clicking outside
                    document.addEventListener('click', function(event) {
                        if (profileBadgeContainer && !profileBadgeContainer.contains(event.target)) {
                            if (dropdownMenu.classList.contains('opacity-100')) {
                                dropdownMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                                dropdownMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                                button.setAttribute('aria-expanded', 'false');
                            }
                        }
                    });
                    
                    return profileBadgeContainer;
                };
            }
            
            if (typeof window.createMobileProfileSection !== 'function') {
                                
                window.createMobileProfileSection = function(user) {
                    // Generate initials
                    let initials = '';
                    if (user.first_name && user.last_name) {
                        initials = user.first_name.charAt(0) + user.last_name.charAt(0);
                    } else if (user.first_name) {
                        initials = user.first_name.charAt(0) + (user.middle_name ? user.middle_name.charAt(0) : '');
                    } else if (user.username) {
                        const parts = user.username.split(' ');
                        if (parts.length > 1) {
                            initials = parts[0].charAt(0) + parts[parts.length-1].charAt(0);
                        } else {
                            initials = user.username.substring(0, 2);
                        }
                    } else {
                        initials = 'U';
                    }
                    
                    // Full name for display
                    const displayName = user.display_name || user.first_name || user.name || user.username || 'User';
                    const isAdminUser = String(user.role || '').toLowerCase() === 'admin';
                    const adminMobileLink = isAdminUser
                        ? '<a href="/admin/dashboard.html" class="block px-3 py-2 rounded-md text-base font-semibold text-green-800 hover:bg-amber-100 hover:text-green-900">Dashboard</a>'
                        : '';
                    
                    // Create mobile profile section
                    const section = document.createElement('div');
                    section.innerHTML = `
                        <div class="flex items-center px-5">
                            <div class="flex-shrink-0">
                                <div class="flex items-center justify-center w-10 h-10 bg-green-600 rounded-full profile-initials text-lg select-none">
                                    <span class="text-[#E6E6E6] font-medium">${initials.toUpperCase()}</span>
                                </div>
                            </div>
                            <div class="ml-3">
                                <div class="text-base font-medium leading-none text-gray-800">${displayName}</div>
                                <div class="text-sm font-medium leading-none text-gray-500">${user.email || ''}</div>
                            </div>
                        </div>
                        <div class="mt-3 px-2 space-y-1">
                            ${adminMobileLink}
                            <a href="#" class="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-amber-100 hover:text-green-800">Profile</a>
                            <a href="#" class="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-amber-100 hover:text-green-800">History</a>
                            <a href="#" class="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-amber-100 hover:text-green-800">
                                Library 
                                ${user.libraryCount > 0 ? `<span class="ml-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-green-800">${user.libraryCount}</span>` : ''}
                            </a>
                            <button type="button" id="logout-button-mobile" class="w-full text-left block px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-red-200 hover:text-red-800">Log Out</button>
                        </div>`;
                    
                    return section;
                };
            }
            
            if (typeof window.handleUserNameClick !== 'function') {
                                
                window.handleUserNameClick = function(event) {
                    const userNamePartElement = document.getElementById('user-name-part');
                    if (!userNamePartElement) return;
                    
                    // Rainbow effect
                    const rainbowGradient = 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #6366f1, #8b5cf6)';
                    userNamePartElement.style.backgroundImage = rainbowGradient;
                    userNamePartElement.style.webkitBackgroundClip = 'text';
                    userNamePartElement.style.backgroundClip = 'text';
                    userNamePartElement.style.color = 'transparent';
                    userNamePartElement.style.webkitTextFillColor = 'transparent';
                    
                    // Reset after animation
                    setTimeout(() => {
                        userNamePartElement.style.backgroundImage = '';
                        userNamePartElement.style.webkitBackgroundClip = '';
                        userNamePartElement.style.backgroundClip = '';
                        userNamePartElement.style.color = '';
                        userNamePartElement.style.webkitTextFillColor = '';
                    }, 1000);
                    
                    // Confetti effect if available
                    if (typeof confetti === 'function') {
                        const y = (event.clientY / window.innerHeight);
                        const baseConfettiOptions = {
                            particleCount: 60,
                            spread: 70,
                            origin: {y},
                            colors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#8b5cf6']
                        };
                        
                        confetti({...baseConfettiOptions, angle: 60, origin: {...baseConfettiOptions.origin, x: 0}});
                        confetti({...baseConfettiOptions, angle: 120, origin: {...baseConfettiOptions.origin, x: 1}});
                    } else {
                    }
                };
            }
            
            // Check if createProfileBadge function exists in the loaded navbar
            if (typeof window.createProfileBadge === 'function') {
                // Use the createProfileBadge function from the navbar
                                const profileBadge = window.createProfileBadge(userInfo);
                userAuthContainer.innerHTML = '';
                userAuthContainer.appendChild(profileBadge);
                
                // Add event listener to logout button
                const logoutButtonDesktop = profileBadge.querySelector('#logout-button-desktop');
                if (logoutButtonDesktop) {
                    logoutButtonDesktop.addEventListener('click', logout);
                                    }
                
                // Fix navigation links to ensure they work across page navigations
                const navLinks = profileBadge.querySelectorAll('.dropdown-menu a[href]');
                navLinks.forEach(link => {
                    link.addEventListener('click', function(e) {
                        // Use normal navigation for links rather than direct manipulation
                        // This ensures proper page loading and event reattachment
                        const href = this.getAttribute('href');
                        
                        // Only prevent default for # links or javascript links
                        if (href === '#' || href.startsWith('javascript:')) {
                            e.preventDefault();
                        }
                        
                        // For library and history links, ensure they point to the right pages
                        if (this.textContent.trim() === 'Library') {
                            this.href = '/pages/savedDocument.html';
                        } else if (this.textContent.trim() === 'History') {
                            this.href = '/pages/userHistory.html';
                        }
                        
                                            });
                });
                
                // Add event listener to user name
                const userNamePart = profileBadge.querySelector('#user-name-part');
                if (userNamePart && typeof window.handleUserNameClick === 'function') {
                    userNamePart.addEventListener('click', window.handleUserNameClick);
                                    }
                
                // Also update mobile view if available
                if (mobileUserAuthContainer && typeof window.createMobileProfileSection === 'function') {
                    const mobileProfileSection = window.createMobileProfileSection(userInfo);
                    mobileUserAuthContainer.innerHTML = '';
                    mobileUserAuthContainer.appendChild(mobileProfileSection);
                    
                    // Add event listener to mobile logout button
                    const logoutButtonMobile = mobileProfileSection.querySelector('#logout-button-mobile');
                    if (logoutButtonMobile) {
                        logoutButtonMobile.addEventListener('click', logout);
                                            }
                    
                    // Fix navigation links in mobile menu
                    const mobileNavLinks = mobileProfileSection.querySelectorAll('a[href]');
                    mobileNavLinks.forEach(link => {
                        link.addEventListener('click', function(e) {
                            // Use normal navigation for links
                            const href = this.getAttribute('href');
                            
                            // Only prevent default for # links or javascript links
                            if (href === '#' || href.startsWith('javascript:')) {
                                e.preventDefault();
                            }
                            
                            // For library and history links, ensure they point to the right pages
                            if (this.textContent.trim().includes('Library')) {
                                this.href = '/pages/savedDocument.html';
                            } else if (this.textContent.trim().includes('History')) {
                                this.href = '/pages/userHistory.html';
                            }
                            
                                                    });
                    });
                }
            } else {
            }
        } else {
        }
    }

    // Update profile information in the navbar
    function updateProfileInfo(userInfo) {
        if (!userInfo) return;
        
                
        // Check if we have a profile picture URL
        const profilePictureUrl = userInfo.profile_picture || userInfo.profilePictureUrl || null;
                
        // Update profile badge with profile picture if available
        if (profilePictureUrl) {
            const updateProfilePicture = () => {
                const profileBadgeButton = document.getElementById('profile-badge-button');
                if (profileBadgeButton) {
                                        
                    // Preserve classes before clearing content
                    const buttonClasses = profileBadgeButton.className;
                    
                    // Clear any existing content
                    profileBadgeButton.innerHTML = '';
                    
                    // Make sure we preserve all styling classes
                    profileBadgeButton.className = buttonClasses;
                    
                    // Ensure the button is circular
                    profileBadgeButton.style.borderRadius = '50%';
                    
                    // Create and add an image element
                    const imgElement = document.createElement('img');
                    imgElement.src = profilePictureUrl.startsWith('/') ? profilePictureUrl : `/${profilePictureUrl}`;
                    imgElement.className = 'w-full h-full object-cover';
                    imgElement.alt = 'Profile';
                    
                    // Ensure the image is circular
                    imgElement.style.borderRadius = '50%';
                    
                    // Add error handler to fall back to initials if image fails to load
                    imgElement.onerror = function() {
                        this.style.display = 'none';
                        
                        // Generate initials
                        let initials = generateInitials(userInfo);
                        
                        // Create initials element
                        const initialsSpan = document.createElement('span');
                        initialsSpan.className = 'text-[#E6E6E6] font-medium';
                        initialsSpan.textContent = initials;
                        profileBadgeButton.appendChild(initialsSpan);
                        
                        // Ensure button retains its styling
                        profileBadgeButton.className = buttonClasses;
                        profileBadgeButton.style.borderRadius = '50%';
                    };
                    
                    // Add the image to the button
                    profileBadgeButton.appendChild(imgElement);
                                        return true;
                }
                return false;
            };
            
            // Try immediately first
            if (!updateProfilePicture()) {
                                // Set up an observer to wait for the button to be created
                const observer = new MutationObserver((mutations, obs) => {
                    const profileBadgeButton = document.getElementById('profile-badge-button');
                    if (profileBadgeButton) {
                                                updateProfilePicture();
                        obs.disconnect(); // Stop observing once we've found it
                    }
                });
                
                // Start observing the document with the configured parameters
                observer.observe(document.body, { childList: true, subtree: true });
                
                // Set a timeout to stop the observer after 5 seconds to prevent memory leaks
                setTimeout(() => {
                    observer.disconnect();
                                    }, 5000);
            }
            
            // Also update mobile profile section if it exists
            const updateMobileProfilePic = () => {
                const mobileProfileImg = document.querySelector('#mobile-menu .rounded-full img');
                if (mobileProfileImg) {
                    mobileProfileImg.src = profilePictureUrl.startsWith('/') ? profilePictureUrl : `/${profilePictureUrl}`;
                                        return true;
                }
                return false;
            };
            
            // Try to update mobile profile picture
            if (!updateMobileProfilePic()) {
                // Set up an observer for mobile profile
                const mobileObserver = new MutationObserver((mutations, obs) => {
                    if (updateMobileProfilePic()) {
                        obs.disconnect();
                    }
                });
                
                mobileObserver.observe(document.body, { childList: true, subtree: true });
                
                // Set a timeout to stop the observer
                setTimeout(() => {
                    mobileObserver.disconnect();
                }, 5000);
            }
        }
        
        // Helper function to generate initials
        function generateInitials(user) {
            if (user.first_name && user.last_name) {
                return (user.first_name.charAt(0) + user.last_name.charAt(0)).toUpperCase();
            } else if (user.first_name) {
                return (user.first_name.charAt(0) + (user.middle_name ? user.middle_name.charAt(0) : '')).toUpperCase();
            } else if (user.username) {
                const parts = user.username.split(' ');
                if (parts.length > 1) {
                    return (parts[0].charAt(0) + parts[parts.length-1].charAt(0)).toUpperCase();
                } else {
                    return user.username.substring(0, 2).toUpperCase();
                }
            } else {
                return 'U';
            }
        }
        
        // Update profile initials if no profile picture or as fallback
        const profileInitialsElements = document.querySelectorAll('.profile-initials-text');
        if (profileInitialsElements.length > 0) {
            const initials = generateInitials(userInfo);
            
            profileInitialsElements.forEach(element => {
                element.textContent = initials;
            });
        }
        
        // Continue with other profile updates
        // Update user name
        const userNameElement = document.getElementById('user-name-part');
        const greetingElement = document.getElementById('greeting-part');
        
        if (userNameElement) {
            // Try different user info properties with clear priority order
            if (userInfo.display_name) {
                userNameElement.textContent = userInfo.display_name;
            } else if (userInfo.first_name) {
                userNameElement.textContent = userInfo.first_name;
            } else if (userInfo.username) {
                userNameElement.textContent = userInfo.username;
            } else if (userInfo.name) {
                userNameElement.textContent = userInfo.name;
            } else {
                userNameElement.textContent = 'User';
            }
                    } else {
            // Set up observer for user name element
            const nameObserver = new MutationObserver((mutations, obs) => {
                const userNameElement = document.getElementById('user-name-part');
                if (userNameElement) {
                    if (userInfo.display_name) {
                        userNameElement.textContent = userInfo.display_name;
                    } else if (userInfo.first_name) {
                        userNameElement.textContent = userInfo.first_name;
                    } else if (userInfo.username) {
                        userNameElement.textContent = userInfo.username;
                    } else if (userInfo.name) {
                        userNameElement.textContent = userInfo.name;
                    } else {
                        userNameElement.textContent = 'User';
                    }
                                        obs.disconnect();
                }
            });
            
            nameObserver.observe(document.body, { childList: true, subtree: true });
            
            // Set a timeout to stop the observer
            setTimeout(() => {
                nameObserver.disconnect();
            }, 5000);
        }
        
        if (greetingElement) {
            // Set greeting based on time of day
            const currentHour = new Date().getHours();
            let greeting = "Hello";
            if (currentHour < 12) greeting = "Good morning";
            else if (currentHour < 18) greeting = "Good afternoon";
            else greeting = "Good evening";
            
            greetingElement.textContent = `${greeting}!`;
        }
        
        // Update user info in mobile menu
        const userFullNameElement = document.getElementById('user-full-name');
        const userEmailElement = document.getElementById('user-email');
        
        if (userFullNameElement) {
            if (userInfo.first_name || userInfo.middle_name || userInfo.last_name) {
                const fullName = [
                    userInfo.first_name,
                    userInfo.middle_name,
                    userInfo.last_name
                ].filter(Boolean).join(' ');
                
                userFullNameElement.textContent = fullName;
            } else if (userInfo.display_name) {
                userFullNameElement.textContent = userInfo.display_name;
            } else if (userInfo.username) {
                userFullNameElement.textContent = userInfo.username;
            } else if (userInfo.name) {
                userFullNameElement.textContent = userInfo.name;
            } else {
                userFullNameElement.textContent = 'User';
            }
        }
        
        if (userEmailElement && userInfo.email) {
            userEmailElement.textContent = userInfo.email;
        }
    }

    // Set up dropdown menu toggle
    function setupDropdown() {
                const profileButton = document.getElementById('profile-badge-button');
        const dropdownMenu = document.getElementById('dropdown-menu');
        
        if (profileButton && dropdownMenu) {
                        
            // Add click event to toggle dropdown visibility
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
                
                profileButton.setAttribute('aria-expanded', (!isOpen).toString());
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                const profileBadgeContainer = document.getElementById('profile-badge-container-dynamic');
                if (dropdownMenu.classList.contains('opacity-100') && profileBadgeContainer && !profileBadgeContainer.contains(event.target)) {
                                        dropdownMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                    dropdownMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                    profileButton.setAttribute('aria-expanded', 'false');
                }
            });
        } else {
                                }
    }

    // Set up mobile menu toggle
    function setupMobileMenu() {
        const mobileMenuButton = document.querySelector('.mobile-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');
        
        if (mobileMenuButton && mobileMenu) {
            const mobileMenuOpenIcon = mobileMenuButton.querySelector('svg:not(.hidden)');
            const mobileMenuCloseIcon = mobileMenuButton.querySelector('svg.hidden');
            
            mobileMenuButton.addEventListener('click', () => {
                const isCurrentlyExpanded = mobileMenuButton.getAttribute('aria-expanded') === 'true';
                const openMenu = !isCurrentlyExpanded;
                
                mobileMenuButton.setAttribute('aria-expanded', openMenu.toString());
                mobileMenu.classList.toggle('hidden', !openMenu);
                if (mobileMenuOpenIcon && mobileMenuCloseIcon) {
                    mobileMenuOpenIcon.classList.toggle('hidden', openMenu);
                    mobileMenuCloseIcon.classList.toggle('hidden', !openMenu);
                }
            });
        }
    }

    // Function to load filters data when search is opened
    function setupSearch() {
        const searchOpenButton = document.getElementById('search-open-button');
        const searchOpenButtonMobile = document.getElementById('search-open-button-mobile');
        const searchCloseButton = document.getElementById('search-close-button');
        const searchOverlay = document.getElementById('search-overlay');
        
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
        
        if (searchCloseButton && searchOverlay) {
            searchCloseButton.addEventListener('click', () => {
                closeSearch();
            });
            
            searchOverlay.addEventListener('click', (event) => {
                if (event.target === searchOverlay) {
                    closeSearch();
                }
            });
        }
        
        // Handle keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (!searchOverlay) return;
            
            // Close with Escape key
            if (event.key === 'Escape' && searchOverlay.classList.contains('visible')) {
                closeSearch();
                event.preventDefault();
                return;
            }
            
            // Open with / key when not in an input field
            const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                                 document.activeElement?.tagName === 'TEXTAREA' ||
                                 document.activeElement?.isContentEditable;
            
            if (event.key === '/' && !isInputFocused && !searchOverlay.classList.contains('visible')) {
                event.preventDefault();
                openSearch();
            }
            
            // Open with Ctrl+K or Cmd+K
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (searchOverlay.classList.contains('visible')) {
                    const searchInputOverlay = document.getElementById('searchInputOverlay');
                    if (document.activeElement !== searchInputOverlay && searchInputOverlay) {
                        searchInputOverlay.focus();
                    }
                } else {
                    openSearch();
                }
            }
        });
        
        // Set up window.openSearch and window.closeSearch functions if they don't exist
        // These are called by the navbar implementation
        if (typeof window.openSearch !== 'function') {
            window.openSearch = openSearch;
        }
        if (typeof window.closeSearch !== 'function') {
            window.closeSearch = closeSearch;
        }
        
        // Initialize search data for direct navbar access
        if (!window.NavbarModule) {
            window.NavbarModule = {};
        }
        
        // Initialize search filtering
        const searchInputOverlay = document.getElementById('searchInputOverlay');
        const clearSearchInputButton = document.getElementById('clearSearchInputButton');
        
        if (searchInputOverlay && typeof searchInputOverlay.addEventListener === 'function') {
            // Set up search input event listener if the navbar hasn't done so
            if (!searchInputOverlay._hasInputListener) {
                searchInputOverlay.addEventListener('input', () => {
                    if (typeof window.performSearchOverlay === 'function') {
                        window.performSearchOverlay();
                    }
                    if (clearSearchInputButton) {
                        clearSearchInputButton.classList.toggle('visible', searchInputOverlay.value.length > 0);
                    }
                });
                searchInputOverlay._hasInputListener = true;
            }
        }
    }

    // Open search overlay
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
        
        // If the navbar has defined loadFiltersData function, call it
        if (typeof window.loadFiltersData === 'function' && !openSearch.filtersLoaded) {
            window.loadFiltersData();
            openSearch.filtersLoaded = true;
        }
    }

    // Close search overlay
    function closeSearch() {
        const searchOverlay = document.getElementById('search-overlay');
        const bodyElement = document.body;
        
        if (!searchOverlay || !bodyElement) return;
        
        bodyElement.style.overflow = '';
        searchOverlay.classList.remove('visible');
        
        setTimeout(() => {
            searchOverlay.classList.add('hidden');
        }, 300); // Match transition duration
    }

    // Create a simple fallback navbar if everything else fails
    function createFallbackNavbar(container) {
                        
        if (!container) {
            return;
        }
        
        try {
            // Simple HTML fallback with minimal styling that works everywhere
            container.innerHTML = `
                <nav class="emergency-navbar" style="background-color: #f8f9fa; padding: 1rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: center;">
                        <a href="/" style="text-decoration: none; color: #006A4E; font-weight: bold; font-size: 1.25rem; display: flex; align-items: center;">
                            <img src="/Components/img/logo1.png" alt="Logo" style="height: 2.5rem; margin-right: 0.5rem;" onerror="this.onerror=null; this.src='https://placehold.co/80x40/f8f9fa/006A4E?text=LOGO';">
                            <span>Paulinian Electronic Archiving System</span>
                            </a>
                        </div>
                    <div>
                        <a href="/" style="margin-right: 1rem; text-decoration: none; color: #006A4E;">Home</a>
                        <a href="/pages/doc-search.html" style="margin-right: 1rem; text-decoration: none; color: #006A4E;">Search</a>
                        <a href="/log-in.html" style="padding: 0.5rem 1rem; background-color: #FDB813; color: #E6E6E6; text-decoration: none; border-radius: 0.25rem; font-weight: 500;">Log In</a>
                    </div>
                </nav>
            `;
            
            // Add event listener to the login button
            const loginButton = container.querySelector('a[href="/log-in.html"]');
            if (loginButton) {
                loginButton.addEventListener('click', function(event) {
                                        window.location.href = '/log-in.html';
                });
            }

            initFlowbiteComponents();
            
                    } catch (error) {
            // Ultimate fallback - just a simple login link
            container.innerHTML = '<div style="text-align: center; padding: 1rem;"><a href="/log-in.html" style="color: #006A4E;">Log In</a></div>';
        }
    }

    // Function to handle user logout
    function logout() {
                        
        // Create visible log message
                
        // 1. Clear the display-only cache from client storage
        try {
            sessionStorage.removeItem('userInfo');
            sessionStorage.removeItem('session_token');
            // Clear localStorage for backward compatibility
            localStorage.removeItem('userInfo');
            localStorage.removeItem('session_token');
                    } catch (e) {
        }

        // 2. Revoke the session through Better Auth (the HttpOnly cookie can
        // only be cleared by the server)
        fetch('/api/auth/sign-out', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        }).catch(e => console.warn('Sign-out failed:', e)).then(() => {

            // 3. Redirect to home page - use timeout to ensure other operations complete
            setTimeout(() => {
                // Add timestamp for cache busting
                window.location.href = `/index.html?logout=true&t=${Date.now()}`;
            }, 200);
        });
    }

    // Setup login buttons functionality
    function setupLoginButtons() {
        const loginButtonDesktop = document.getElementById('login-button');
        const loginButtonMobile = document.getElementById('mobile-login-button');
        
        if (loginButtonDesktop) {
            loginButtonDesktop.addEventListener('click', window.handleLogin);
        }
        
        if (loginButtonMobile) {
            loginButtonMobile.addEventListener('click', window.handleLogin);
        }
    }

    // Public API
    return {
        init: initNavbar,
        updateProfileInfo: updateProfileInfo,
        logout: logout
    };
})();

// The function initNavbar is defined inside the module closure above,
// so we need to use the version returned by the module
document.addEventListener('DOMContentLoaded', function() {
    if (window.NavbarModule && typeof window.NavbarModule.init === 'function') {
        window.NavbarModule.init();
    } else {
    }
});
