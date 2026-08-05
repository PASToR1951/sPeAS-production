/**
 * Document Visit Tracker (Enhanced)
 * 
 * This script tracks visits to document pages and records them using the document visits API.
 * Features:
 * - Tracks visits to both single and compiled documents
 * - Separates guest vs user visits
 * - Associates child document visits with parent compiled documents
 * - Uses counter-based tracking for better performance
 */

/**
 * Records a document visit using the counter-based API
 * @param {string} documentId - The ID of the document being viewed
 * @param {string} visitorType - Type of visitor ('guest' or 'user')
 * @param {Object} metadata - Additional metadata about the visit
 */
async function recordDocumentVisit(documentId, visitorType = 'guest', metadata = {}) {
    try {
        // React detail routes record successful server-side metadata/file
        // operations. The legacy script must not create a second visit.
        if (document.getElementById('react-public-root')) return;
        if (!documentId) {
            return;
        }
        
        // More detailed debug logging
                        
        // Only check and possibly correct visitor type if not forced
        if (!metadata.forceVisitorType) {
            // Check login status with extra logging
            const currentLoginState = isUserLoggedIn();
            let originalVisitorType = visitorType;
            
            // Only correct visitor type in specific cases to prevent errors
            if (visitorType === 'user' && !currentLoginState) {
                // If we're in a guest page and getting a user visit type, it's probably incorrect
                if (window.location.pathname.includes('/guest-') || 
                    window.location.pathname.includes('/public/') || 
                    window.location.pathname.includes('/Public/')) {
                                        visitorType = 'guest';
                }
            } else if (visitorType === 'guest' && currentLoginState && !metadata.isTest && !metadata.isRepair) {
                // If we're in a user page and getting a guest visit type, it's probably incorrect
                if (window.location.pathname.includes('/user-') || 
                    window.location.pathname.includes('/admin/')) {
                                        visitorType = 'user';
                }
            }
            
            if (originalVisitorType !== visitorType) {
                            }
        } else {
                    }
        
        // Prepare request data
        const visitData = {
                documentId: documentId,
            visitorType: visitorType,
            pageUrl: window.location.pathname,
            referrer: document.referrer || 'direct',
            ...metadata
        };
        
        // Remove internal flags that shouldn't be sent to the server
        delete visitData.forceVisitorType;
        
        // Log the exact data being sent to the server
                
        // Use the counter-based document visits endpoint
        const response = await fetch('/api/document-visits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(visitData)
        });
        
        if (!response.ok) {
            // Try legacy endpoint as fallback
            const legacyResponse = await fetch('/api/page-visits', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pageUrl: window.location.pathname,
                    visitorType: visitorType,
                    metadata: {
                        documentId: documentId,
                        ...metadata,
                        forceVisitorType: undefined // Don't send this flag
                    }
                })
            });
            
            if (!legacyResponse.ok) {
                return;
            }
            
                        return;
        }
        
            } catch (error) {
    }
}

/**
 * Helper function to extract document ID from URL
 * @returns {string|null} Document ID or null if not found
 */
function getDocumentIdFromUrl() {
    // Get the current URL
    const url = new URL(window.location.href);
    
    // Try to extract document ID from path (e.g., /document/123)
    const pathMatch = window.location.pathname.match(/\/document\/(\d+)/);
    if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
    }
    
    // Try to extract document ID from query parameter (e.g., ?id=123)
    return url.searchParams.get('id');
}

/**
 * Determines if the current user is logged in
 * @returns {boolean} True if user is logged in, false otherwise
 */
function isUserLoggedIn() {
    // Try multiple storage locations
    try {
                
        // First check sessionStorage (primary storage for login status).
        // The session token itself lives in an HttpOnly cookie and is not
        // readable from JS — userInfo.isLoggedIn is the display-side signal.
        let userInfo = sessionStorage.getItem('userInfo');
        if (userInfo) {
            try {
                userInfo = JSON.parse(userInfo);
                if (userInfo && userInfo.isLoggedIn === true) {
                                        return true;
                }
            } catch (e) {
                            }
        }

        // Then check localStorage (used for cross-tab communication)
        userInfo = localStorage.getItem('userInfo');
        if (userInfo) {
            try {
                userInfo = JSON.parse(userInfo);
                if (userInfo && userInfo.isLoggedIn === true) {
                                        return true;
                }
            } catch (e) {
                            }
        }
        
        // Finally check cookies directly
        const cookies = document.cookie.split(';');
                const sessionCookie = cookies.find(cookie => cookie.trim().startsWith('session_token='));
        if (sessionCookie) {
            const tokenValue = sessionCookie.trim().substring('session_token='.length);
            if (tokenValue && tokenValue !== 'undefined' && tokenValue !== 'null' && tokenValue.length > 10) {
                                return true;
            } else {
                            }
        }
        
        // Additional check for admin_session cookie which would indicate an admin is logged in
        const adminCookie = cookies.find(cookie => cookie.trim().startsWith('admin_session='));
        if (adminCookie) {
            const adminTokenValue = adminCookie.trim().substring('admin_session='.length);
            if (adminTokenValue && adminTokenValue !== 'undefined' && adminTokenValue !== 'null' && adminTokenValue.length > 10) {
                                return true;
            }
        }
        
        // No valid login found
                return false;
    } catch (e) {
        return false;
    }
}

/**
 * Gets the parent document ID for a child document (if available)
 * @param {string} documentId - The ID of the child document
 * @returns {Promise<string|null>} Parent document ID or null if not found
 */
async function getParentDocumentId(documentId) {
    try {
                const response = await fetch(`/api/documents/${documentId}/parent`);
        
        // If 404, it means there's no parent (this is not an error)
        if (response.status === 404) {
                        return null;
        }
        
        // For other non-200 responses, log but don't throw
        if (!response.ok) {
                        return null;
        }
        
            const data = await response.json();
            if (data && data.parentId) {
                            return data.parentId;
        }
        
                return null;
    } catch (error) {
        // Log error but continue without parent tracking
                return null;
    }
}

/**
 * Initializes document visit tracking for a single document page
 * @param {string} documentId - Optional document ID override (uses URL param if not provided)
 */
async function initSingleDocumentTracking(documentId) {
    // Use provided ID or extract from URL
    const docId = documentId || getDocumentIdFromUrl();
    
    if (!docId) {
        return;
    }
    
    // Check if we're on a guest page and force visitor type accordingly
    let visitorType = 'guest';
    const currentPath = window.location.pathname.toLowerCase();
    
    if (currentPath.includes('/guest-') || 
        currentPath.includes('/public/') || 
        currentPath.includes('/public/pages/')) {
        // Force guest type for guest pages
                visitorType = 'guest';
    } else if (currentPath.includes('/user-') || 
               currentPath.includes('/admin/')) {
        // Only check login status for user/admin pages
        visitorType = isUserLoggedIn() ? 'user' : 'guest';
            } else {
        // For any other page, check login status
        visitorType = isUserLoggedIn() ? 'user' : 'guest';
            }
    
                    
    // Track the visit to this document
    await recordDocumentVisit(docId, visitorType, {
        documentType: 'single',
        url: window.location.pathname + window.location.search,
        forceVisitorType: true // Signal that we've already determined the visitor type
    });
    
    // Check if this document is a child of a compiled document
    const parentId = await getParentDocumentId(docId);
    
    if (parentId) {
                // Also record a visit to the parent compiled document
        await recordDocumentVisit(parentId, visitorType, {
            documentType: 'compiled',
            childDocumentId: docId,
            fromChild: true,
            forceVisitorType: true // Signal that we've already determined the visitor type
        });
    }
}

/**
 * Initializes document visit tracking for a compiled document page
 * @param {string} documentId - Optional document ID override (uses URL param if not provided)
 */
async function initCompiledDocumentTracking(documentId) {
    // Use provided ID or extract from URL
    const docId = documentId || getDocumentIdFromUrl();
    
    if (!docId) {
        return;
    }
    
    // Check if we're on a guest page and force visitor type accordingly
    let visitorType = 'guest';
    const currentPath = window.location.pathname.toLowerCase();
    
    if (currentPath.includes('/guest-') || 
        currentPath.includes('/public/') || 
        currentPath.includes('/public/pages/')) {
        // Force guest type for guest pages
                visitorType = 'guest';
    } else if (currentPath.includes('/user-') || 
               currentPath.includes('/admin/')) {
        // Only check login status for user/admin pages
        visitorType = isUserLoggedIn() ? 'user' : 'guest';
            } else {
        // For any other page, check login status
        visitorType = isUserLoggedIn() ? 'user' : 'guest';
            }
    
                    
    // Record compiled document visit
    await recordDocumentVisit(docId, visitorType, {
        documentType: 'compiled',
        url: window.location.pathname + window.location.search,
        forceVisitorType: true // Signal that we've already determined the visitor type
    });
}

/**
 * Gets detailed visit statistics for a document with breakdown by visitor type
 * @param {string} documentId - The ID of the document
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Promise<Object>} Visit statistics with breakdown
 */
async function getDocumentVisitStats(documentId, days = 30) {
    try {
        if (!documentId) {
            return {
                total: 0,
                guest: 0,
                user: 0
            };
        }
        
        // Fetch document visit stats from counter endpoint
        const response = await fetch(`/api/document-visits/counts?documentId=${documentId}&days=${days}`);
        
        if (!response.ok) {
            return {
                total: 0,
                guest: 0,
                user: 0
            };
        }
        
        const data = await response.json();
        
        return {
            total: (data.guest || 0) + (data.user || 0),
            guest: data.guest || 0,
            user: data.user || 0,
            breakdown: data.breakdown || null
        };
    } catch (error) {
        return {
            total: 0,
            guest: 0,
            user: 0
        };
    }
        }
        
/**
 * Get most visited documents with breakdown by visitor type
 * @param {number} limit - Maximum number of documents to return
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Most visited documents with stats
 */
async function getMostVisitedDocuments(limit = 10, days = 30) {
    try {
        const response = await fetch(`/api/documents/most-visited?limit=${limit}&days=${days}`);
        
        if (!response.ok) {
            return [];
        }
        
        const data = await response.json();
        return data.documents || [];
    } catch (error) {
        return [];
    }
}

// Export functionality as a module
window.DocumentTracker = {
    // Main tracking functions
    initSingleDocumentTracking,
    initCompiledDocumentTracking,
    recordDocumentVisit,
    
    // Helper functions
    getDocumentIdFromUrl,
    isUserLoggedIn,
    getParentDocumentId,
    
    // Stats functions
    getDocumentVisitStats,
    getMostVisitedDocuments,
    
    // Test function to force a guest visit
    forceGuestVisit: async function(documentId) {
        if (!documentId) {
            documentId = getDocumentIdFromUrl();
            if (!documentId) {
                return false;
            }
        }
                
        try {
            // Force visitor type to guest regardless of login status
            const visitData = {
                documentId: documentId,
                visitorType: 'guest',
                documentType: 'test',
                url: window.location.pathname + window.location.search,
                isTest: true
            };
            
                        
            // Use the counter-based document visits endpoint directly
            const response = await fetch('/api/document-visits', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(visitData)
            });
            
            if (!response.ok) {
                return false;
            }
            
            const responseData = await response.json();
                        
            // Immediately verify the count was updated
            setTimeout(async () => {
                try {
                    const stats = await getDocumentVisitStats(documentId);
                                    } catch (err) {
                }
            }, 1000);
            
            return true;
        } catch (error) {
            return false;
        }
    },
    
    // Diagnostic function to check document visits
    checkDocumentVisits: async function(documentIds) {
        // If no IDs provided, use top documents
        if (!documentIds || !documentIds.length) {
            try {
                                const response = await fetch('/api/page-visits/most-visited-documents?limit=10');
                if (response.ok) {
                    const data = await response.json();
                    documentIds = data.documents.map(doc => doc.document_id);
                                    } else {
                    return { status: 'error', message: 'Failed to fetch top documents' };
                }
            } catch (error) {
                return { status: 'error', message: 'Error fetching documents' };
            }
        }
        
        const results = [];
        
        // Check each document
        for (const docId of documentIds) {
            try {
                                const stats = await getDocumentVisitStats(docId);
                
                // Report the results
                results.push({
                    document_id: docId,
                    total_visits: stats.total,
                    guest_visits: stats.guest,
                    user_visits: stats.user,
                    has_guest_visits: stats.guest > 0,
                    guest_percentage: stats.total > 0 ? Math.round((stats.guest / stats.total) * 100) : 0
                });
                
                // If no guest visits but has user visits, generate one
                if (stats.guest === 0 && stats.user > 0) {
                                        await this.forceGuestVisit(docId);
                }
            } catch (error) {
                results.push({
                    document_id: docId,
                    error: true,
                    message: error.message
                });
            }
        }
        
                return {
            status: 'success',
            results: results,
            message: 'Check complete. See browser console for details.'
        };
    }
};
