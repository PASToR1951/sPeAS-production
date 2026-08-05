/**
 * Document archive functionality
 */

// Add styles for the confirmation dialog
const dialogStyles = document.createElement('style');
dialogStyles.textContent = `
    .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    }

    .confirmation-dialog {
        background-color: #E6E6E6;
        border-radius: 8px;
        padding: 20px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .confirmation-dialog h3 {
        margin: 0 0 15px 0;
        color: #333;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .confirmation-dialog h3 i {
        color: #007bff;
    }

    .confirmation-dialog p {
        margin: 0 0 20px 0;
        color: #666;
    }

    .confirmation-dialog .warning {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
        padding: 10px;
        margin: 10px 0;
        color: #856404;
    }

    .dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }

    .dialog-buttons button {
        padding: 8px 16px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
    }

    .dialog-buttons .btn-secondary {
        background-color: #6c757d;
        color: #E6E6E6;
    }

    .dialog-buttons .btn-primary {
        background-color: #007bff;
        color: #E6E6E6;
    }

    .dialog-buttons button:hover {
        opacity: 0.9;
    }
`;

// Add styles to document head
document.head.appendChild(dialogStyles);

// Add styles for toasts and dialogs
const styles = document.createElement('style');
styles.textContent = `
    #toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
    }

    .toast {
        background: #E6E6E6;
        border-radius: 4px;
        padding: 12px 20px;
        margin-bottom: 10px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        min-width: 200px;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    }

    .toast.success {
        border-left: 4px solid #28a745;
    }

    .toast.error {
        border-left: 4px solid #dc3545;
    }

    .toast.info {
        border-left: 4px solid #17a2b8;
    }

    .toast.warning {
        border-left: 4px solid #ffc107;
    }

    .toast i {
        margin-right: 10px;
    }

    .toast.success i {
        color: #28a745;
    }

    .toast.error i {
        color: #dc3545;
    }

    .toast.info i {
        color: #17a2b8;
    }

    .toast.warning i {
        color: #ffc107;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    ${dialogStyles.textContent}

    .dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
    }

    .dialog-buttons button {
        padding: 10px 20px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
        font-size: 14px;
    }

    .dialog-buttons .btn-secondary {
        background-color: #6c757d;
        color: #E6E6E6;
    }

    .dialog-buttons .btn-danger {
        background-color: #dc3545;
        color: #E6E6E6;
        position: relative;
        overflow: hidden;
    }

    .dialog-buttons .btn-danger:hover {
        background-color: #c82333;
        transform: scale(1.05);
    }

    .dialog-buttons .btn-danger:disabled {
        background-color: #dc354580;
        cursor: not-allowed;
        transform: none;
    }

    .confirmation-dialog .warning {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
        padding: 15px;
        margin: 15px 0;
        color: #856404;
        border-radius: 4px;
    }

    .confirmation-dialog h3 {
        color: #dc3545;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 1.5em;
        margin-bottom: 20px;
    }

    .confirmation-dialog h3 i {
        color: #dc3545;
    }

    .confirmation-dialog #delete-confirmation-input {
        border: 2px solid #dc3545;
        border-radius: 4px;
        padding: 10px;
        margin: 15px 0;
        width: 100%;
        font-size: 16px;
    }

    .confirmation-dialog #delete-confirmation-input:focus {
        outline: none;
        box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.25);
    }

    .document-actions .hard-delete-btn {
        background-color: #dc3545;
        color: #E6E6E6;
        padding: 8px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
    }

    .document-actions .hard-delete-btn:hover {
        background-color: #c82333;
        transform: scale(1.1);
    }

    .document-actions .hard-delete-btn:hover i {
        animation: shake 0.5s ease-in-out;
    }

    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        75% { transform: translateX(2px); }
    }

    .document-actions .hard-delete-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
        );
        transition: 0.5s;
    }

    .document-actions .hard-delete-btn:hover::before {
        left: 100%;
    }

    .document-actions .hard-delete-btn i {
        font-size: 1.2em;
    }

    .confirmation-dialog .delete-warning {
        color: #dc3545;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin: 15px 0;
        text-align: center;
        border: 2px solid #dc3545;
        padding: 10px;
        border-radius: 4px;
        background-color: rgba(220, 53, 69, 0.1);
    }
`;

// Add styles to document head
document.head.appendChild(styles);

// Remove the old styles element if it exists
if (dialogStyles.parentNode) {
    dialogStyles.parentNode.removeChild(dialogStyles);
}

// Initialize core functions immediately to prevent reference errors
(function(global) {
    // Create namespace if it doesn't exist
    if (!global.documentArchive) {
        global.documentArchive = {
            _initialized: false,
            _isArchiveMode: false
        };
    }

    // Define core functions first
    const archiveDocument = async function(documentId) {
        if (!documentId) {
            showToast('Failed to archive: Missing document ID', 'error');
            return Promise.reject(new Error('No document ID provided'));
        }
        
        try {
            // Show loading indication
            showToast(`Archiving document...`, 'info');
            
            // Try the new unified API endpoint first
            const response = await fetch(`/api/archives`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                    document_id: documentId,
                    archive_children: true
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to archive document: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Add a timestamp to force cache refresh
            window.forceRefreshTimestamp = Date.now();
            
            // Show success message
            showToast('Document archived successfully', 'success');
            
            // Refresh the current view
            if (global.documentArchive.isArchiveMode()) {
                if (typeof loadArchivedDocuments === 'function') {
                    setTimeout(() => loadArchivedDocuments(1, true), 500);
                }
            } else {
                if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                    setTimeout(() => window.documentList.refreshDocumentList(true), 300);
                }
            }
            
            return result;
        } catch (error) {
            showToast(`Archive failed: ${error.message}`, 'error');
            return Promise.reject(error);
        }
    };

    const archiveCompiledDocument = async function(documentId) {
        if (!documentId) {
            showToast('Failed to archive: Missing document ID', 'error');
            return Promise.reject(new Error('No document ID provided'));
        }
        
        try {
            // Show loading indication
            showToast(`Archiving compilation...`, 'info');
            
            // Try the unified API endpoint first
            const response = await fetch(`/api/archives/compiled/${documentId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to archive compilation: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Add a timestamp to force cache refresh
            window.forceRefreshTimestamp = Date.now();
            
            // Show success message
            showToast('Compilation archived successfully', 'success');
            
            // Refresh the current view
            if (global.documentArchive.isArchiveMode()) {
                if (typeof loadArchivedDocuments === 'function') {
                    setTimeout(() => loadArchivedDocuments(1, true), 500);
                }
            } else {
                if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                    setTimeout(() => window.documentList.refreshDocumentList(true), 300);
                }
            }
            
            return result;
        } catch (error) {
            showToast(`Archive failed: ${error.message}`, 'error');
            return Promise.reject(error);
        }
    };

    const restoreDocument = async function(documentId) {
        if (!documentId) {
            throw new Error('No document ID provided');
        }

        try {
            // Show loading toast
            showToast('Restoring document...', 'info');

            // Try the unified API endpoint first
            const response = await fetch(`/api/archives/${documentId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to restore document: ${response.statusText}`);
            }

            const result = await response.json();

            // Show success message
            showToast('Document restored successfully', 'success');

            // Refresh the document lists
            if (typeof loadArchivedDocuments === 'function') {
                setTimeout(() => loadArchivedDocuments(1, true), 500);
            }
            if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                setTimeout(() => window.documentList.refreshDocumentList(true), 500);
            }

            return result;
        } catch (error) {
            console.error('Error restoring document:', error);
            showToast(`Failed to restore document: ${error.message}`, 'error');
            throw error;
        }
    };

    // Assign core functions to the global namespace
    global.documentArchive.archiveDocument = archiveDocument;
    global.documentArchive.archiveCompiledDocument = archiveCompiledDocument;
    global.documentArchive.restoreDocument = restoreDocument;
    
    // Add isArchiveMode function
    global.documentArchive.isArchiveMode = function() {
        return global.documentArchive._isArchiveMode;
    };
    
    // Add setArchiveMode function
    global.documentArchive.setArchiveMode = function(mode) {
        global.documentArchive._isArchiveMode = mode;
        // Trigger UI updates when mode changes
        if (typeof updateArchiveButtonUI === 'function') {
            updateArchiveButtonUI();
        }
        if (typeof updatePageTitle === 'function') {
            updatePageTitle();
        }
    };

    // Define and assign the showRestoreConfirmation function
    global.documentArchive.showRestoreConfirmation = async function(documentId, isCompiled, docTitle) {
        if (!documentId) {
            return Promise.reject(new Error('No document ID provided'));
        }

        // Create and show the confirmation dialog
        return new Promise((resolve, reject) => {
            const dialogHtml = `
                <div class="confirmation-dialog">
                    <div class="dialog-content">
                        <h3><i class="fas fa-question-circle"></i> Restore Document?</h3>
                        <p>Are you sure you want to restore "${docTitle || 'this document'}"?</p>
                        ${isCompiled ? '<p class="warning"><i class="fas fa-info-circle"></i> This will also restore all child documents.</p>' : ''}
                        <div class="dialog-buttons">
                            <button class="btn btn-secondary cancel-btn">Cancel</button>
                            <button class="btn btn-primary confirm-btn">Restore</button>
                        </div>
                    </div>
                </div>
            `;

            // Create dialog element
            const dialog = document.createElement('div');
            dialog.className = 'dialog-overlay';
            dialog.innerHTML = dialogHtml;
            document.body.appendChild(dialog);

            // Add event listeners
            const confirmBtn = dialog.querySelector('.confirm-btn');
            const cancelBtn = dialog.querySelector('.cancel-btn');

            const cleanup = () => {
                dialog.remove();
            };

            confirmBtn.addEventListener('click', async () => {
                cleanup();
                try {
                    await restoreDocument(documentId);
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            });

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
        });
    };

    // Make sure the initialization is completed
    document.addEventListener('DOMContentLoaded', function() {
        // Mark as initialized immediately since we have all functions ready
        global.documentArchive._initialized = true;
        console.log('Document archive system initialization completed');
    });

    // Add the showHardDeleteConfirmation function to the global namespace
    global.documentArchive.showHardDeleteConfirmation = async function(documentId, isCompiled, docTitle) {
        if (!documentId) {
            return Promise.reject(new Error('No document ID provided'));
        }

        // Create and show the confirmation dialog
        return new Promise((resolve, reject) => {
            const dialogHtml = `
                <div class="confirmation-dialog">
                    <div class="dialog-content">
                        <h3><i class="fas fa-exclamation-triangle"></i> Permanent Delete</h3>
                        <p>You are about to permanently delete "${docTitle || 'this document'}". This action cannot be undone.</p>
                        ${isCompiled ? '<p class="warning"><i class="fas fa-info-circle"></i> This will also permanently delete all child documents.</p>' : ''}
                        <div class="delete-warning">
                            <i class="fas fa-exclamation-circle"></i> Warning: This action is permanent and irreversible
                        </div>
                        <p class="mt-3">To confirm, type "Delete" in the field below:</p>
                        <input type="text" id="delete-confirmation-input" class="form-control" placeholder="Type 'Delete' to confirm" style="margin: 10px 0;">
                        <div class="dialog-buttons">
                            <button class="btn btn-secondary cancel-btn">Cancel</button>
                            <button class="btn btn-danger confirm-btn" disabled>
                                <i class="fas fa-trash-alt"></i> Delete Permanently
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Create dialog element
            const dialog = document.createElement('div');
            dialog.className = 'dialog-overlay';
            dialog.innerHTML = dialogHtml;
            document.body.appendChild(dialog);

            // Get elements
            const confirmBtn = dialog.querySelector('.confirm-btn');
            const cancelBtn = dialog.querySelector('.cancel-btn');
            const input = dialog.querySelector('#delete-confirmation-input');

            // Add input listener to enable/disable confirm button
            input.addEventListener('input', function() {
                confirmBtn.disabled = this.value !== 'Delete';
            });

            const cleanup = () => {
                dialog.remove();
            };

            // Add event listeners
            confirmBtn.addEventListener('click', async () => {
                if (input.value !== 'Delete') {
                    return;
                }
                cleanup();
                try {
                    const response = await fetch(`/api/archives/${documentId}/hard-delete`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to permanently delete document');
                    }

                    showToast('Document permanently deleted', 'success');
                    
                    // Refresh the archive list
                    if (typeof loadArchivedDocuments === 'function') {
                        setTimeout(() => loadArchivedDocuments(1, true), 500);
                    }
                    
                    resolve(true);
                } catch (error) {
                    showToast(`Failed to delete document: ${error.message}`, 'error');
                    reject(error);
                }
            });

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });

            // Add keyboard event listener for Enter and Escape
            dialog.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !confirmBtn.disabled) {
                    confirmBtn.click();
                } else if (e.key === 'Escape') {
                    cancelBtn.click();
                }
            });

            // Focus the input field
            input.focus();
        });
    };

})(typeof window !== 'undefined' ? window : global);

// Create a namespace for archive functionality
window.documentArchive = (function() {
    // State management object
    const archiveState = {
        isArchiveMode: false,
        documents: [],
        currentPage: 1,
        totalPages: 1,
        category: 'All',
        isLoading: false,
        transitionInProgress: false,
        cacheLifetimeMs: 5 * 60 * 1000, // 5 minutes cache lifetime
        
        // Methods to update state
        setArchiveMode(mode) {
            this.isArchiveMode = mode;
            // Trigger UI updates when mode changes
            updateArchiveButtonUI();
            updatePageTitle();
        },
        
        reset() {
            this.documents = [];
            this.currentPage = 1;
            this.totalPages = 1;
        }
    };
    
    // Document cache to improve performance
    const documentCache = {
        regular: {
            documents: [],
            timestamp: 0,
            page: 1,
            category: 'All',
            totalPages: 0
        },
        archived: {
            documents: [],
            timestamp: 0,
            page: 1,
            category: 'All',
            totalPages: 0
        },
        
        // Cache expiration time (5 minutes)
        expiryTime: 5 * 60 * 1000,
        
        // Store documents in cache
        storeDocuments(mode, docs, page, category) {
            const cache = mode === 'archived' ? this.archived : this.regular;
            cache.documents = docs;
            cache.timestamp = Date.now();
            cache.page = page;
            cache.category = category;
        },
        
        // Get documents from cache if valid
        getDocuments(mode, page, category) {
            const cache = mode === 'archived' ? this.archived : this.regular;
            
            // Check if cache is valid and matches current request
            if (
                cache.documents.length > 0 && 
                cache.page === page &&
                cache.category === category &&
                (Date.now() - cache.timestamp) < this.expiryTime
            ) {
                                return cache.documents;
            }
            
            return null;
        },
        
        // Get the appropriate cache based on current mode
        getCurrentCache() {
            return archiveState.isArchiveMode ? this.archived : this.regular;
        },
        
        // Check if the current cache is still valid
        isCacheValid() {
            const cache = this.getCurrentCache();
            return cache.timestamp > 0 && 
                   (Date.now() - cache.timestamp) < archiveState.cacheLifetimeMs;
        },
        
        // Clear both caches
        clearAll() {
            this.regular = { documents: [], timestamp: 0, totalPages: 0 };
            this.archived = { documents: [], timestamp: 0, totalPages: 0 };
                    }
    };

    // Legacy variables for backward compatibility
    let archivedDocuments = [];
    let currentPage = 1;
    let totalPages = 1;
    let filterCategory = "All";
    let isLoadingDocuments = false;

    /**
     * Initialize archive functionality
     */
    function initializeArchive() {
                
        // Make sure the archive state is reset
        archiveState.isArchiveMode = false;
        
        // Find the archive button
        const archiveBtn = document.getElementById('archive-btn');
        
        if (archiveBtn) {
                        
            // Make sure button doesn't have navigation attributes
            if (archiveBtn.hasAttribute('href')) {
                archiveBtn.removeAttribute('href');
            }
            
            // Make sure it's not inside a form
            const parentForm = archiveBtn.closest('form');
            if (parentForm) {
                // Make sure it doesn't submit the form
                archiveBtn.setAttribute('type', 'button');
            }
            
            // Remove any existing event listeners and recreate the button
            const newArchiveBtn = archiveBtn.cloneNode(true);
            if (archiveBtn.parentNode) {
                archiveBtn.parentNode.replaceChild(newArchiveBtn, archiveBtn);
            }
            
            // Set correct initial state
            newArchiveBtn.classList.remove('active');
            newArchiveBtn.innerHTML = '<i class="fas fa-archive"></i>';
            newArchiveBtn.title = 'View Archived Documents';
            
            // Add event listener for the new button
            newArchiveBtn.addEventListener('click', function handleArchiveClick(e) {
                                // Check if we have a dedicated archive page
                if (typeof window.USE_DEDICATED_ARCHIVE_PAGE !== 'undefined' && window.USE_DEDICATED_ARCHIVE_PAGE) {
                    // Navigate to dedicated archive page instead of toggling mode
                    window.location.href = 'archive-list.html';
                } else {
                    // Use the traditional toggle behavior
                    e.preventDefault();
                    e.stopPropagation();
                    toggleArchiveMode(e);
                    return false;
                }
            });
        } else {
        }
        
        // Check if we need to restore from archive mode based on URL parameter
        checkUrlParameters();
        
        // Add custom styles for archive mode
        addArchiveStyles();
        
        // Set a flag to prevent multiple initializations
        window.archiveInitialized = true;
        
            }
    
    /**
     * Check URL parameters to see if we should start in archive mode
     */
    function checkUrlParameters() {
        // Check if URL has archive=true parameter
        const url = new URL(window.location.href);
        const archiveParam = url.searchParams.get('archive');
        
        if (archiveParam === 'true' && !archiveState.isArchiveMode) {
            // Switch to archive mode if URL parameter is set
            archiveState.setArchiveMode(true);
            loadArchivedDocuments(1);
        }
    }
    
    /**
     * Update URL when toggling archive mode
     */
    function updateUrl() {
        // Create URL object from current location
        const url = new URL(window.location.href);
        
        if (archiveState.isArchiveMode) {
            url.searchParams.set('archive', 'true');
        } else {
            url.searchParams.delete('archive');
        }
        
        // Update URL without reloading page
        try {
            // Use history.pushState to avoid page reloads
            window.history.pushState({ archive: archiveState.isArchiveMode }, '', url.toString());
                    } catch (err) {
            // If pushState fails, don't update the URL to avoid reload
        }
    }
    
    /**
     * Setup keyboard shortcuts for power users
     */
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Alt+A to toggle archive mode
            if (e.altKey && e.key === 'a') {
                e.preventDefault();
                toggleArchiveMode();
            }
            
            // Escape key to exit archive mode if active
            if (e.key === 'Escape' && archiveState.isArchiveMode) {
                e.preventDefault();
                archiveState.setArchiveMode(false);
                if (window.documentFilters) {
                    window.documentFilters.resetFilters();
                }
                loadDocuments(1, true);
            }
        });
    }
    
    /**
     * Add custom styles for archive mode
     */
    function addArchiveStyles() {
        // Check if styles already exist
        if (document.getElementById('archive-styles')) {
            return;
        }
        
        // Create style element
        const style = document.createElement('style');
        style.id = 'archive-styles';
        style.textContent = `
            /* Archive view container */
            .archive-mode {
                background-color: #f9f9fa;
                border-radius: 8px;
                margin-bottom: 20px;
                padding: 15px;
            }
            
            .archive-banner {
                background-color: #f8f9fa;
                border-radius: 4px;
                padding: 15px;
                margin-bottom: 20px;
                border-left: 4px solid #6c757d;
            }
            
            .archive-header {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-bottom: 10px;
                text-align: center;
            }
            
            .archive-header h3 {
                margin: 0;
                color: #495057;
            }
            
            .archive-section {
                margin-bottom: 20px;
            }
            
            .archive-section-header {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 10px;
                color: #495057;
                padding-bottom: 5px;
                border-bottom: 1px solid #dee2e6;
            }
            
            /* Document cards - match main document view */
            .archive-mode .document-wrapper {
                margin-bottom: 10px;
                position: relative;
            }
            
            .archive-mode .document-card {
                display: flex;
                align-items: center;
                padding: 10px 15px;
                background-color: #E6E6E6;
                border-radius: 4px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                transition: all 0.2s ease;
                border-left: 3px solid #dc3545; /* Red border to indicate archived status */
            }
            
            /* Style for expanded documents */
            .archive-mode .document-card.expanded {
                background-color: #f0f7ff;
                box-shadow: 0 2px 5px rgba(0,0,0,0.15);
            }
            
            .archive-mode .document-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                margin-right: 15px;
                flex-shrink: 0;
            }
            
            .archive-mode .document-icon img {
                max-width: 30px;
                max-height: 30px;
            }
            
            .archive-mode .document-info {
                flex: 1;
                min-width: 0;
                padding-right: 10px;
            }
            
            .archive-mode .document-title {
                font-size: 16px;
                font-weight: 500;
                margin: 0 0 5px 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .archive-mode .document-meta {
                font-size: 12px;
                color: #6c757d;
            }
            
            .archive-mode .toggle-indicator {
                display: inline-block;
                margin-right: 5px;
                color: #6c757d;
                transition: transform 0.2s ease;
            }
            
            .archive-mode .document-card.expanded .toggle-indicator {
                color: #0056b3;
            }
            
            .archive-mode .category-badge {
                display: inline-block;
                font-size: 11px;
                padding: 2px 5px;
                border-radius: 3px;
                background-color: #f0f0f0;
                color: #555;
                margin-top: 5px;
            }
            
            .archive-mode .category-badge.thesis {
                background-color: #e3f2fd;
                color: #0d47a1;
            }
            
            .archive-mode .category-badge.dissertation {
                background-color: #e8f5e9;
                color: #1b5e20;
            }
            
            .archive-mode .category-badge.confluence {
                background-color: #fff3e0;
                color: #e65100;
            }
            
            .archive-mode .category-badge.synergy {
                background-color: #f3e5f5;
                color: #4a148c;
            }
            
            .archive-mode .document-actions {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .archive-mode .action-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border-radius: 4px;
                background-color: #28a745;
                color: #E6E6E6;
                border: none;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .archive-mode .action-btn:hover {
                background-color: #218838;
            }
            
            /* Child documents styling */
            .archive-mode .children-container {
                margin-left: 30px;
                margin-bottom: 10px;
                padding: 0;
                transition: all 0.3s ease;
                max-height: 800px;
                overflow: auto;
            }
            
            .archive-mode .children-list {
                border-left: 2px solid #dee2e6;
                padding-left: 10px;
                margin-top: 5px;
            }
            
            .archive-mode .child-document-card {
                margin-bottom: 8px;
                background-color: #E6E6E6;
                border-radius: 4px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                transition: all 0.2s ease;
                border-left: 3px solid #dc3545; /* Red border to indicate archived status */
            }
            
            .archive-mode .child-document-card:hover {
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                background-color: #f8f9fa;
            }
            
            .archive-mode .child-document-inner {
                display: flex;
                align-items: center;
                padding: 8px 12px;
            }
            
            .archive-mode .child-document-card .document-icon {
                width: 28px;
                height: 28px;
                margin-right: 10px;
            }
            
            .archive-mode .child-document-card .document-icon img {
                max-width: 20px;
                max-height: 20px;
            }
            
            .archive-mode .child-document-card .document-title {
                font-size: 14px;
                font-weight: 500;
                margin-bottom: 3px;
            }
            
            .archive-mode .child-document-card .document-meta {
                font-size: 11px;
                color: #6c757d;
            }
            
            .archive-mode .meta-row {
                margin-bottom: 2px;
            }
            
            .archive-mode .meta-label {
                font-weight: 500;
                margin-right: 5px;
            }
            
            /* Parent information styling */
            .archive-mode .parent-info {
                margin-top: 5px;
                padding-top: 5px;
                border-top: 1px dotted #dee2e6;
            }
            
            .archive-mode .parent-label {
                color: #495057;
                font-weight: 500;
                margin-right: 5px;
            }
            
            .archive-mode .parent-title {
                color: #0056b3;
                font-weight: 500;
            }
            
            /* Loading indicator styling */
            .archive-mode .loading-indicator {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 0;
                background-color: #f8f9fa;
                border-radius: 8px;
                text-align: center;
            }
            
            .archive-mode .loading-animation {
                font-size: 24px;
                color: #6c757d;
                margin-bottom: 15px;
            }
            
            .archive-mode .loading-children {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 15px;
                color: #6c757d;
                font-size: 14px;
            }
            
            .archive-mode .loading-children i {
                margin-right: 10px;
            }
            
            .archive-mode .error-message {
                padding: 15px;
                background-color: #fff5f5;
                color: #e53e3e;
                border-radius: 4px;
                margin: 10px 0;
            }
            
            .archive-mode .retry-btn {
                background-color: #e53e3e;
                color: #E6E6E6;
                border: none;
                border-radius: 4px;
                padding: 5px 10px;
                margin-top: 10px;
                cursor: pointer;
            }
            
            .archive-mode .no-children {
                padding: 15px;
                color: #6c757d;
                font-style: italic;
                text-align: center;
            }
            
            /* Collection hierarchical display styling */
            .archive-mode .collection-item {
                position: relative;
            }
            
            .archive-mode .collection-children {
                margin-left: 25px;
                padding-left: 15px;
                border-left: 2px solid #dee2e6;
            }
        `;
        
        // Add to document head
        document.head.appendChild(style);
    }

    /**
     * Toggle archive mode and update UI
     */
    function toggleArchiveMode(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
                
        // Show a loading overlay
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = '<div class="spinner"></div><p>Loading...</p>';
        document.body.appendChild(loadingOverlay);
        
        try {
            // Toggle the archive mode state BEFORE updating UI
            const wasInArchiveMode = archiveState.isArchiveMode;
            archiveState.isArchiveMode = !archiveState.isArchiveMode;
            
            // Log the state change for debugging
                        
            // Check if the button state is correct before making any changes
            const archiveBtn = document.getElementById('archive-btn') || 
                             document.querySelector('.archive-btn');
            if (archiveBtn) {
                            }
            
            // IMPORTANT: First update the button UI *before* replacing the category label
            // This way updateArchiveButtonUI can find the current button
            updateArchiveButtonUI();
            
            // Update page title 
            const pageTitleElement = document.querySelector('.page-title');
            if (pageTitleElement) {
                pageTitleElement.textContent = archiveState.isArchiveMode ? 'Archived Documents' : 'Documents List';
            }
            
            // Then update category label depending on mode
            const categoryLabel = document.querySelector('.category-container .label');
            if (categoryLabel) {
                if (archiveState.isArchiveMode) {
                    // Save original text if not already saved
                    if (!categoryLabel.dataset.originalText) {
                        categoryLabel.dataset.originalText = categoryLabel.textContent.trim();
                    }
                    
                    // Completely replace the label contents
                    categoryLabel.innerHTML = `
                        <span>Archived Documents</span>
                        <button id="exit-archive-btn" class="btn btn-sm btn-primary exit-archive-btn" type="button" title="Exit Archive Mode">
                            <i class="fas fa-times"></i>
                        </button>
                    `;
                    
                    // Add event listener to exit button
                    setTimeout(() => {
                        const exitBtn = categoryLabel.querySelector('#exit-archive-btn');
                        if (exitBtn) {
                            exitBtn.addEventListener('click', function(e) {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleArchiveMode(e);
                            });
                        }
                    }, 0);
                } else {
                    // Change back to original text with archive button
                    const originalText = categoryLabel.dataset.originalText || 'Categories';
                    
                    // Completely replace the label contents
                    categoryLabel.innerHTML = `
                        <span>${originalText}</span>
                        <button id="archive-btn" class="archive-btn" type="button" title="View Archived Documents">
                            <i class="fas fa-archive"></i>
                        </button>
                    `;
                    
                    // Reattach event listener to the archive button
                    setTimeout(() => {
                        const newArchiveBtn = categoryLabel.querySelector('#archive-btn');
                        if (newArchiveBtn) {
                            newArchiveBtn.addEventListener('click', function(e) {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleArchiveMode(e);
                            });
                        }
                    }, 0);
                }
            }
            
            // Reset search input
            const searchInput = document.getElementById('search-input') || document.getElementById('search-documents');
            if (searchInput) {
                searchInput.value = '';
            }
            
            // Clear existing content
            const contentArea = document.getElementById('documents-container');
            if (contentArea) {
                contentArea.innerHTML = '';
                // Remove archive-mode class when exiting
                if (!archiveState.isArchiveMode) {
                    contentArea.classList.remove('archive-mode');
                }
            }
            
            // Clear filter selections if available
            if (window.documentFilters && typeof window.documentFilters.resetFilters === 'function' && !archiveState.isArchiveMode) {
                window.documentFilters.resetFilters();
            }
            
            // Always load the appropriate documents based on the NEW state
            if (archiveState.isArchiveMode) {
                                loadArchivedDocuments(1);
            } else {
                                if (typeof loadDocuments === 'function') {
                    loadDocuments(1, true);
                } else {
                    showError('Could not load documents. Please refresh the page and try again.');
                }
            }
        } catch (error) {
            showError('An error occurred while toggling archive mode. Please try again.');
        } finally {
            // Remove loading overlay after a minimum time (for UX)
            setTimeout(() => {
                if (document.body.contains(loadingOverlay)) {
                    document.body.removeChild(loadingOverlay);
                }
            }, 500);
        }
        
        return false;
    }
    
    /**
     * Update the archive button UI based on current state
     */
    function updateArchiveButtonUI() {
                
        // Find the archive button - could be in different places
        let archiveBtn = document.getElementById('archive-btn') || 
                           document.querySelector('.archive-btn');
        
        // If button not found, check if it's in the category header
        if (!archiveBtn) {
            const categoryHeader = document.querySelector('.category-header');
            if (categoryHeader) {
                archiveBtn = categoryHeader.querySelector('#archive-btn') || categoryHeader.querySelector('.archive-btn');
            }
        }
        
        // If still not found, check if it might be inside the label
        if (!archiveBtn) {
            const categoryLabel = document.querySelector('.category-container .label');
            if (categoryLabel) {
                archiveBtn = categoryLabel.querySelector('#archive-btn') || categoryLabel.querySelector('.archive-btn');
            }
        }
        
        // If still not found, create a new button as a fallback
        if (!archiveBtn) {
            const categoryLabel = document.querySelector('.category-container .label');
            
            if (categoryLabel) {
                archiveBtn = document.createElement('button');
                archiveBtn.id = 'archive-btn';
                archiveBtn.className = 'archive-btn';
                archiveBtn.type = 'button';
                archiveBtn.title = archiveState.isArchiveMode ? 'Exit Archive View' : 'View Archived Documents';
                archiveBtn.innerHTML = archiveState.isArchiveMode ? '<i class="fas fa-times"></i>' : '<i class="fas fa-archive"></i>';
                
                // Add event listener
                archiveBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleArchiveMode(e);
                });
                
                // Append to category label
                categoryLabel.appendChild(archiveBtn);
            }
        }
        
        if (archiveBtn) {
            // Check the current button state before updating
            const hasActiveClass = archiveBtn.classList.contains('active');
                        
            // Check for mismatch between button state and archive mode
            if (hasActiveClass !== archiveState.isArchiveMode) {
                            }
            
                        
            if (archiveState.isArchiveMode) {
                // We are in archive mode
                archiveBtn.classList.add('active');
                archiveBtn.innerHTML = '<i class="fas fa-times"></i>';
                archiveBtn.title = 'Exit Archive View';
                
                // Add global visual indicator that we're in archive mode
                document.body.classList.add('archive-mode');
                
                // Update header
                const header = document.querySelector('.category-header');
                if (header) {
                    header.classList.add('archive-header');
                }
                
                // Remove banner creation from here - only create it in renderArchivedDocuments
            } else {
                // We are in normal mode
                archiveBtn.classList.remove('active');
                archiveBtn.innerHTML = '<i class="fas fa-archive"></i>';
                archiveBtn.title = 'View Archived Documents';
                
                // Remove archive mode indicators
                document.body.classList.remove('archive-mode');
                
                // Update header
                const header = document.querySelector('.category-header');
                if (header) {
                    header.classList.remove('archive-header');
                }
                
                // Remove banner if it exists
                const banner = document.querySelector('.archive-banner');
                if (banner) {
                    banner.remove();
                }
            }
            
            // Verify that the button state matches the archive mode after update
            const hasActiveClassAfter = archiveBtn.classList.contains('active');
                        
            // If there's still a mismatch, force the correct state
            if (hasActiveClassAfter !== archiveState.isArchiveMode) {
                if (archiveState.isArchiveMode) {
                    archiveBtn.classList.add('active');
                } else {
                    archiveBtn.classList.remove('active');
                }
            }
        } else {
        }
    }

    /**
     * Update the page title to reflect current mode
     */
    function updatePageTitle() {
        const originalTitle = document.title.replace(' - Archive', '');
        document.title = archiveState.isArchiveMode ? `${originalTitle} - Archive` : originalTitle;
    }

    /**
     * Load and render archived documents
     * @param {number} page - Page number to load
     * @param {string} category - Category filter
     */
    async function loadArchivedDocuments(page = 1, category = null, search = '') {
                
        // Save current state in cache
        archiveState.currentPage = page;
        archiveState.categoryFilter = category;
        archiveState.searchTerm = search;
            
            // Build URL with query parameters
        let url = `/api/archives?page=${page}&size=10`;
        
        // Add optional filters if they exist
        if (category) {
            url += `&type=${encodeURIComponent(category)}`;
        }
        
        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
        }
        
        // Add cache busting if needed
        if (window.forceRefreshTimestamp) {
            url += `&_t=${window.forceRefreshTimestamp}`;
        }
        
        // Get archive container element
        const archiveContainer = document.querySelector('#archived-documents');
        
        if (!archiveContainer) {
            return;
        }
        
        // Show loading state
        archiveContainer.innerHTML = '<div class="loading-container"><div class="spinner"></div><p>Loading archived documents...</p></div>';
        
        try {
            // Use the new unified API endpoint first
                        const response = await fetch(url);
            
            // Check for errors
            if (!response.ok) {
                // Fall back to the old endpoint approach
                return legacyLoadArchivedDocuments(page, category, search);
            }
            
            // Parse the response
            const data = await response.json();
                        
            // Update pagination state
            archiveState.documents = data.documents || [];
            archiveState.totalPages = data.total_pages || 1;
            archiveState.totalDocuments = data.total_documents || 0;
            
            // Update category counts if provided
            if (data.category_counts) {
                updateCategoryFilters(data.category_counts);
            }
            
            // Render the archived documents
            renderArchivedDocuments(archiveState.documents);
            
            // Update pagination controls
            updatePagination(page, data.total_pages);
            
            // Check if we have any archived documents
            checkRemainingArchived();
            
            return data;
        } catch (error) {
            // Show error in container
            archiveContainer.innerHTML = `
                <div class="archive-error">
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>Error loading archived documents:</strong> ${error.message}
                    </div>
                    <button class="btn btn-primary btn-retry" onclick="documentArchive.loadArchivedDocuments(${page})">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                        </div>
                    `;
            
            return null;
        }
    }
    
    /**
     * Legacy method for loading archived documents (fallback if unified API fails)
     * @param {number} page - Page number to load
     * @param {string} category - Category filter
     * @param {string} search - Search term
     * @returns {Promise} - Promise that resolves when documents are loaded
     */
    async function legacyLoadArchivedDocuments(page, category, search) {
        try {
                        
            // Build URL with query parameters for the old endpoint
            let url = `/api/archived-documents?page=${page}&size=10`;
            
            // Add optional filters if they exist
            if (category) {
                url += `&type=${encodeURIComponent(category)}`;
            }
            
            if (search) {
                url += `&search=${encodeURIComponent(search)}`;
            }
            
            // Add cache busting if needed
            if (window.forceRefreshTimestamp) {
                url += `&_t=${window.forceRefreshTimestamp}`;
            }
            
            // Try different endpoints for loading archived documents
            let response = null;
            let data = null;
            let loadSuccess = false;
            
            // Try potential endpoints
            const loadEndpoints = [
                url,
                url.replace('/api/archived-documents', '/archives')
            ];
            
            for (const endpoint of loadEndpoints) {
                try {
                                        response = await fetch(endpoint);
                    
                    if (response.ok) {
                        data = await response.json();
                                                loadSuccess = true;
                        break;
                } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!loadSuccess) {
                throw new Error('Server endpoints not available for archived documents');
            }
            
                        
            // Update pagination state (handle different response formats)
            if (data.documents) {
                // New format
                archiveState.documents = data.documents || [];
                archiveState.totalPages = data.total_pages || 1;
                archiveState.totalDocuments = data.total_documents || 0;
            } else if (Array.isArray(data)) {
                // Old format (just an array of documents)
                archiveState.documents = data;
                archiveState.totalPages = 1;
                archiveState.totalDocuments = data.length;
                    } else {
                // Unknown format
                archiveState.documents = [];
                archiveState.totalPages = 1;
                archiveState.totalDocuments = 0;
            }
            
            // Update category counts if provided
            if (data.category_counts) {
                updateCategoryFilters(data.category_counts);
            }
            
            // Render the archived documents
            renderArchivedDocuments(archiveState.documents);
            
            // Update pagination controls
            updatePagination(page, archiveState.totalPages);
            
            // Check if we have any archived documents
            checkRemainingArchived();
            
            return data;
        } catch (error) {
            // Show error in container
            const archiveContainer = document.querySelector('#archived-documents');
            if (archiveContainer) {
                archiveContainer.innerHTML = `
                    <div class="archive-error">
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Error loading archived documents:</strong> ${error.message}
                        </div>
                        <button class="btn btn-primary btn-retry" onclick="documentArchive.loadArchivedDocuments(${page})">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                    </div>
                `;
            }
            
            return null;
        }
    }

    /**
     * Render archived documents in the container
     * @param {Array} documents - Array of archived documents
     * @param {number} currentPage - Current page number
     * @param {number} totalPages - Total number of pages
     */
    function renderArchivedDocuments(documents, currentPage, totalPages) {
        const container = document.getElementById('documents-container');
        
        // Clear container
        container.innerHTML = '';
        
        // Remove any existing archive banners to avoid duplicates
        const existingBanners = document.querySelectorAll('.archive-banner');
        existingBanners.forEach(banner => banner.remove());
        
        // Create archive mode container
        const archiveModeContainer = document.createElement('div');
        archiveModeContainer.className = 'archive-mode'; // Updated class name to match new CSS
        
        // Add archive banner
        const archiveBanner = document.createElement('div');
        archiveBanner.className = 'archive-banner';
        archiveBanner.innerHTML = `
            <div class="archive-header">
                <h3><i class="fas fa-archive"></i> Archive Mode</h3>
            </div>
            <p>You are viewing archived documents. These documents are not visible in the main document list.</p>
            `;
        archiveModeContainer.appendChild(archiveBanner);
        
        // Remove the exit button code since we already have one in the header
        
        // Create documents list container
        const documentsListContainer = document.createElement('div');
        documentsListContainer.className = 'documents-list-container';
        
        // Process documents
        if (documents.length === 0) {
            // Show empty state if no documents
            documentsListContainer.innerHTML = `
                <div class="no-archived-documents">
                    <div class="empty-state">
                        <i class="fas fa-archive"></i>
                        <h3>No Archived Documents</h3>
                        <p>There are no archived documents to display. When you archive a document, it will appear here.</p>
                    </div>
                    </div>
                `;
        } else {
            // Debug - log document data to help understand the structure
                        
            // Organize documents into a hierarchy
            // 1. First identify parent/compiled documents - check both is_compiled AND is_package flags
            const parentDocuments = documents.filter(doc => doc.is_compiled === true || doc.is_package === true);
                        
            // 2. Group child documents by parent
            const childrenMap = new Map(); // Map to store child documents by parent ID
            
            // Group child documents by parent
            documents.forEach(doc => {
                if (doc.is_child && doc.parent_compiled_id) {
                    if (!childrenMap.has(doc.parent_compiled_id)) {
                        childrenMap.set(doc.parent_compiled_id, []);
                    }
                    childrenMap.get(doc.parent_compiled_id).push(doc);
                }
            });
            
            // 3. Find standalone documents (not children and not parents)
            const standaloneDocuments = documents.filter(doc => 
                !doc.is_compiled && 
                !doc.is_package && 
                !doc.is_child && 
                !doc.parent_compiled_id
            );
            
            // Create sections
            
            // Create parent-child hierarchies section if there are parent documents
            if (parentDocuments.length > 0) {
                const hierarchySection = document.createElement('div');
                hierarchySection.className = 'archive-section';
                
                // Add section header
                const sectionHeader = document.createElement('h4');
                sectionHeader.className = 'archive-section-header';
                sectionHeader.innerHTML = `<i class="fas fa-folder"></i> Archived Document Collections (${parentDocuments.length})`;
                hierarchySection.appendChild(sectionHeader);
                
                // Create a document card for each parent document
                parentDocuments.forEach(parentDoc => {
                    try {
                                                // Create wrapper
                        const parentWrapper = document.createElement('div');
                        parentWrapper.className = 'document-wrapper';
                        hierarchySection.appendChild(parentWrapper);
                        
                        // Create card for parent document
                        const parentCard = createDocumentCard(parentDoc);
                        parentWrapper.appendChild(parentCard);
                        
                        // Create the children container
                        const childrenContainer = document.createElement('div');
                        childrenContainer.className = 'children-container';
                        childrenContainer.dataset.parent = parentDoc.id;
                        
                        // Initially collapsed
                        childrenContainer.style.display = 'none';
                        
                        // Get children for this parent
                        const children = childrenMap.get(parentDoc.id) || [];
                        
                        if (children.length > 0) {
                            // Pre-populate with children we already have
                            const childrenList = document.createElement('div');
                            childrenList.className = 'children-list';
                            
                            // Add each child document
                            children.forEach(childDoc => {
                                const childCard = createChildDocumentCard(childDoc);
                                childrenList.appendChild(childCard);
                            });
                            
                            childrenContainer.appendChild(childrenList);
                        } else {
                            // If no children found, show message
                            childrenContainer.innerHTML = `
                                <div class="no-children">
                                    <p>No child documents available in this collection.</p>
                                </div>
                            `;
                        }
                        
                        // Add children container to parent wrapper
                        parentWrapper.appendChild(childrenContainer);
                        
                    } catch (error) {
                    }
                });
                
                documentsListContainer.appendChild(hierarchySection);
            }
            
            // Create standalone documents section if there are any
            if (standaloneDocuments.length > 0) {
                const standaloneSection = document.createElement('div');
                standaloneSection.className = 'archive-section';
                
                // Add section header
                const sectionHeader = document.createElement('h4');
                sectionHeader.className = 'archive-section-header';
                sectionHeader.innerHTML = `<i class="fas fa-file-alt"></i> Archived Individual Documents (${standaloneDocuments.length})`;
                standaloneSection.appendChild(sectionHeader);
                
                // Add each standalone document
                standaloneDocuments.forEach(doc => {
                    try {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'document-wrapper';
                        standaloneSection.appendChild(wrapper);
                        
                        const card = createDocumentCard(doc);
                        wrapper.appendChild(card);
                    } catch (error) {
                    }
                });
                
                documentsListContainer.appendChild(standaloneSection);
            }
            
            // Create orphaned children section (children whose parents aren't in the archive)
            const orphanedChildren = documents.filter(doc => 
                doc.is_child && 
                doc.parent_compiled_id && 
                !parentDocuments.some(parent => parent.id === doc.parent_compiled_id)
            );
            
            if (orphanedChildren.length > 0) {
                const orphanedSection = document.createElement('div');
                orphanedSection.className = 'archive-section';
                
                // Add section header
                const sectionHeader = document.createElement('h4');
                sectionHeader.className = 'archive-section-header';
                sectionHeader.innerHTML = `<i class="fas fa-unlink"></i> Archived Child Documents (Parent Not Archived) (${orphanedChildren.length})`;
                orphanedSection.appendChild(sectionHeader);
                
                // Add each orphaned child document
                orphanedChildren.forEach(doc => {
                    try {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'document-wrapper';
                        orphanedSection.appendChild(wrapper);
                        
                        const card = createDocumentCard(doc);
                        wrapper.appendChild(card);
                    } catch (error) {
                    }
                });
                
                documentsListContainer.appendChild(orphanedSection);
            }
            }
            
            // Add the documents list to the archive container
            archiveModeContainer.appendChild(documentsListContainer);
            
        // Add pagination if needed
        if (totalPages > 1) {
            const paginationContainer = document.createElement('div');
            paginationContainer.className = 'archive-pagination';
            paginationContainer.style.marginTop = '20px';
            
                renderPagination(currentPage, totalPages, paginationContainer, 'loadArchivedDocuments');
            
            archiveModeContainer.appendChild(paginationContainer);
        }
        
        // Add the archive container to the main container
        container.appendChild(archiveModeContainer);
    }

    /**
     * Create a document card element for an archived document
     * @param {Object} doc - Document object
     * @returns {HTMLElement} - Card element
     */
    function createDocumentCard(doc) {
                
        // Create card container
        const card = document.createElement('div');
        card.className = 'document-card';
        card.setAttribute('data-document-id', doc.id);
        
        // Add classes based on document properties
        if (doc.is_compiled || doc.is_package) {
            card.classList.add('compiled-document');
                    }
        
        card.classList.add('archived');
        
        // Category slug for the central icon classes (category-icons.css)
        const iconCategory = doc.document_type || '';

        // Format the date when it was archived
        const archivedDate = formatDate(doc.deleted_at);
        
        // Format document authors
        let authors = 'Unknown';
        if (doc.authors) {
            if (Array.isArray(doc.authors) && doc.authors.length > 0) {
                authors = doc.authors.map(a => {
                    if (typeof a === 'string') return a;
                    return `${a.first_name || ''} ${a.last_name || ''}`.trim();
                }).join(', ');
            } else if (typeof doc.authors === 'string') {
                authors = doc.authors;
            }
        }
        
        // Check if this is a child document with a parent
        let parentInfo = '';
        if (doc.parent_compiled_id || doc.is_child) {
            const parentId = doc.parent_compiled_id;
            const parentTitle = doc.parent_title || 'Parent Document';
            
            parentInfo = `
                <div class="parent-info">
                    <span class="parent-label"><i class="fas fa-folder"></i> Part of:</span>
                    <span class="parent-title">${parentTitle}</span>
                </div>
            `;
        }
        
        // The toggle indicator for compiled documents
        const toggleIcon = (doc.is_compiled || doc.is_package) ? 
            '<span class="toggle-indicator">▶</span>' : '';
        
        // Create card inner HTML
        card.innerHTML = `
                <div class="document-icon">
                <span class="category-icon" data-category="${iconCategory}" aria-hidden="true"></span>
                </div>
                <div class="document-info">
                    <div class="document-header">
                    <h3 class="document-title">${toggleIcon}${doc.title || 'Untitled Document'}</h3>
                    <div class="document-meta">
                        <div class="meta-row"><span class="meta-label"><i class="fas fa-user"></i></span> ${authors}</div>
                        <div class="meta-row"><span class="meta-label">Archived:</span> ${archivedDate}</div>
                        ${parentInfo}
                    </div>
                </div>
                ${doc.document_type ? `<div class="category-badge ${(doc.document_type || '').toLowerCase()}">${formatCategoryName(doc.document_type || '')}</div>` : ''}
                </div>
                <div class="document-actions">
                <button class="action-btn restore-btn" title="Restore Document" data-document-id="${doc.id}">
                        <i class="fas fa-trash-restore"></i>
                    </button>
                    <button class="action-btn hard-delete-btn" title="Permanently Delete" data-document-id="${doc.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>`;
        
        // Add event listeners for compiled documents
        if (doc.is_compiled || doc.is_package) {
            // Make the title clickable to toggle
            const titleEl = card.querySelector('.document-title');
            if (titleEl) {
                titleEl.style.cursor = 'pointer';
                titleEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const wrapper = card.closest('.document-wrapper');
                    if (wrapper) {
                    toggleChildDocuments(doc.id, wrapper);
                    } else {
                    }
                });
            }
        }
        
        // Add restore button event listener
        const restoreBtn = card.querySelector('.restore-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const docId = doc.id;
                
                // Use our custom confirmation dialog instead of browser's confirm
                const docTitle = doc.title || 'this document';
                const isCompiled = doc.is_compiled || doc.is_package;
                showRestoreConfirmation(docId, isCompiled, docTitle);
            });
        }
        
        return card;
    }
    
    /**
     * Toggle the visibility of child documents
     * @param {string} parentId - ID of the parent document
     * @param {HTMLElement} wrapper - Parent card wrapper element
     */
    function toggleChildDocuments(parentId, wrapper) {
        if (!parentId || !wrapper) {
            return;
        }
        
        const card = wrapper.querySelector('.document-card');
        if (!card) {
            return;
        }
        
                
        // Find existing children container or create one
        let childrenContainer = wrapper.querySelector('.children-container');
        
        if (!childrenContainer) {
            return;
        }
        
        // Toggle visibility
        const isVisible = childrenContainer.style.display !== 'none';
        const indicator = card.querySelector('.toggle-indicator');
        
        if (isVisible) {
            // Hide it
            childrenContainer.style.display = 'none';
            if (indicator) {
                indicator.textContent = '▶'; // Change to right arrow
            }
            card.classList.remove('expanded');
        } else {
            // Show it
            childrenContainer.style.display = 'block';
            if (indicator) {
                indicator.textContent = '▼'; // Change to down arrow
            }
            card.classList.add('expanded');
            
            // Check if we need to (re)load the child documents
            const isEmpty = !childrenContainer.querySelector('.children-list') && 
                            !childrenContainer.querySelector('.loading-children');
            
            if (isEmpty) {
                // Show loading indicator
                childrenContainer.innerHTML = '<div class="loading-children"><i class="fas fa-spinner fa-spin"></i> Loading contents...</div>';
                
                // Load the child documents
                fetchArchivedChildDocuments(parentId, childrenContainer);
            }
        }
    }

    /**
     * Get the icon class for a compiled document based on its category
     * @param {string} category - Document category
     * @returns {string} - Icon class
     */
    function getCompiledDocumentIcon(category) {
        if (!category) return 'fas fa-file-alt';
        
        const normalizedCategory = category.toLowerCase();
        
        switch(normalizedCategory) {
            case 'confluence':
                return 'fas fa-book text-warning';
            case 'thesis':
                return 'fas fa-graduation-cap text-primary';
            case 'dissertation':
                return 'fas fa-scroll text-success';
            case 'synergy':
                return 'fas fa-handshake text-info';
            default:
                return 'fas fa-file-alt';
        }
    }

    /**
     * Format category name for display
     * @param {string} category - Raw category/document type
     * @returns {string} - Formatted category name
     */
    function formatCategoryName(category = '') {
        if (!category) return 'Uncategorized';
        
        // Convert to title case (first letter uppercase, rest lowercase)
        let formatted = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
        
        // Handle synergy (rename to Departmental)
        if (formatted === 'Synergy') {
            formatted = 'Departmental';
        }
        
        return formatted;
    }

    /**
     * Format a date string in a user-friendly way
     * @param {string|Date|null} dateString - Date to format
     * @returns {string} - Formatted date string
     */
    function formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            const date = new Date(dateString);
            
            // Check if the date is valid
            if (isNaN(date.getTime())) {
                return '';
            }
            
            // Get date components
            const day = date.getDate();
            const month = date.toLocaleString('default', { month: 'short' });
            const year = date.getFullYear();
            
            // Format as "15 Jun 2023"
            return `${day} ${month} ${year}`;
        } catch (e) {
            return '';
        }
    }

    /**
     * Archives a document by marking it with deleted_at
     * Returns a Promise that resolves when the operation completes
     * @param {number} documentId - ID of the document to archive
     * @returns {Promise<boolean>} - Promise resolving to true if successful
     */
    async function archiveDocument(documentId) {
        if (!documentId) {
            showToast('Failed to archive: Missing document ID', 'error');
            return Promise.reject(new Error('No document ID provided'));
        }
        
                
        try {
            // Show loading indication
            showToast(`Archiving document...`, 'info');
            
            // Try the new unified API endpoint first
                        const response = await fetch(`/api/archives`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                    document_id: documentId,
                    archive_children: true // Archive all child documents as well
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                // Fall back to the old multi-endpoint approach
                return legacyArchiveDocument(documentId);
            }
            
            // Parse the response
            const result = await response.json();
                        
            // Add a timestamp to force cache refresh when loading documents
            window.forceRefreshTimestamp = Date.now();
            
            // Show success message
            showToast('Document archived successfully', 'success');
            
            // If we're in archive mode, refresh the archive list
            if (window.documentArchive.isArchiveMode()) {
                loadArchivedDocuments(window.documentArchive.getCurrentCache().page || 1);
            } else {
                // Otherwise, force refresh the regular document list (in document-list.js)
                if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                                        setTimeout(() => {
                        window.documentList.refreshDocumentList(true);
                    }, 300);
                }
            }
            
            return true;
        } catch (error) {
            showToast(`Archive failed: ${error.message}`, 'error');
            return Promise.reject(error);
        }
    }

    // Make archiveDocument available globally immediately
    window.archiveDocument = archiveDocument;

    /**
     * Archive a compiled document
     * @param {number} documentId - Document ID to archive
     * @returns {Promise} - Promise resolving when the archive operation is complete
     */
    async function archiveCompiledDocument(documentId) {
        try {
            // Show loading indication
            showToast(`Archiving compilation...`, 'info');
            
            // First try to use the unified archive API endpoint specifically for compiled documents
                        
            // Try the most reliable endpoint first - the specific compiled route
            const response = await fetch(`/api/archives/compiled/${documentId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            
            // Check if this endpoint worked
            if (response.ok) {
                const result = await response.json();
                                
                // Add a timestamp to force cache refresh
                window.forceRefreshTimestamp = Date.now();
                
                // Show success message
                showToast('Document archived successfully', 'success');
                
                // Refresh the current view
                refreshCurrentView();
                
                return result;
            }
            
                        
            // If specific endpoint failed, try the more generic unified endpoint
            const genericResponse = await fetch(`/api/archives`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({
                    document_id: documentId,
                    archive_children: true,
                    is_compiled: true
                })
            });
            
            // Check if this endpoint worked
            if (genericResponse.ok) {
                const result = await genericResponse.json();
                                
                // Add a timestamp to force cache refresh
                window.forceRefreshTimestamp = Date.now();
                
                // Show success message
                showToast('Document archived successfully', 'success');
                
                // Refresh the current view
                refreshCurrentView();
                
                return result;
            }
            
                        
            // If all optimized endpoints failed, try legacy multi-endpoint approach
            return await legacyArchiveDocument(documentId, true);
            
        } catch (error) {
            showToast(`Failed to archive document: ${error.message}`, 'error');
            return Promise.reject(error);
        }
    }

    /**
     * Helper function to refresh the appropriate view after an operation
     */
    function refreshCurrentView() {
        // If we're in archive mode, refresh the archive list
        if (window.documentArchive.isArchiveMode()) {
            loadArchivedDocuments(window.documentArchive.getCurrentCache().page || 1);
        } else {
            // Otherwise, force refresh the regular document list
            if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                                setTimeout(() => {
                    window.documentList.refreshDocumentList(true);
                }, 300);
            }
        }
    }
    
    /**
     * Legacy method for archiving documents (fallback if unified API fails)
     * @param {number} documentId - Document ID to archive
     * @returns {Promise<boolean>} - Promise that resolves to true if successful
     */
    async function legacyArchiveDocument(documentId) {
        try {
            // Try to verify the document from multiple possible endpoints
            let verifyResponse;
            let documentData;
            let endpointFound = false;
            
            // Try potential endpoint paths (ordered by most likely to work)
            const potentialEndpoints = [
                `/documents/${documentId}`,           // Regular path without /api prefix
                `/api/documents/${documentId}`,       // Standard API path
                `/api/compiled-documents/${documentId}` // Compiled document specific endpoint
            ];
            
            for (const endpoint of potentialEndpoints) {
                try {
                                        verifyResponse = await fetch(endpoint);
                    
                    if (verifyResponse.ok) {
                        documentData = await verifyResponse.json();
                                                endpointFound = true;
                        break;
                    } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!endpointFound) {
                // Continue with the operation anyway since the user confirmed
                                // Assume it's a regular document since we're in this function
                documentData = { id: documentId, is_compiled: false };
            } else if (documentData.deleted_at) {
                                showToast('Document is already archived', 'warning');
                // Return success since the document is already in the desired state
                return true;
            }
            
            // Check if this document is actually a compiled document
            // If so, we should use the specialized function instead
            if (documentData.is_compiled === true || documentData.document_type === 'COMPILED' || 
                (documentData.child_count && documentData.child_count > 0)) {
                                return legacyArchiveCompiledDocument(documentId);
            }
            
            // Try different archive endpoints
            let response = null;
            let archiveSuccess = false;
            
            // Try potential archive endpoints
            const archiveEndpoints = [
                {
                    url: `/documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/compiled-documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/archives`,
                    method: 'POST',
                    body: JSON.stringify({
                        document_id: documentId,
                        archive_children: false
                    })
                }
            ];
            
            for (const endpoint of archiveEndpoints) {
                try {
                                        response = await fetch(endpoint.url, {
                        method: endpoint.method,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        },
                        body: endpoint.body
                    });
                    
                    if (response.ok) {
                        archiveSuccess = true;
                                                break;
                    } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!archiveSuccess) {
                showToast('Cannot archive document. Please contact your system administrator.', 'error');
                return Promise.reject(new Error('Failed to archive document: No working endpoint found'));
            }
            
            // Parse the response
            const result = await response.json();
                        
            // If this is a compiled document with children, log details
            if (result.is_compiled && result.child_documents && result.child_documents.length) {
                            }
            
            // Add a timestamp to force cache refresh when loading documents
            window.forceRefreshTimestamp = Date.now();
            
            // Show success message
            showToast('Document archived successfully', 'success');
            
            // If we're in archive mode, refresh the archive list
            if (window.documentArchive.isArchiveMode()) {
                loadArchivedDocuments(window.documentArchive.getCurrentCache().page || 1);
                } else {
                // Otherwise, force refresh the regular document list (in document-list.js)
                if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                                        setTimeout(() => {
                        window.documentList.refreshDocumentList(true);
                    }, 300);
                }
            }
            
            return true;
        } catch (error) {
            showToast(`Archive failed: ${error.message || 'Server operation failed'}`, 'error');
            return Promise.reject(error);
        }
    }
    
    /**
     * Legacy method for archiving compiled documents (fallback if unified API fails)
     * @param {number} documentId - Document ID to archive
     * @returns {Promise<boolean>} - Promise that resolves to true if successful
     */
    async function legacyArchiveCompiledDocument(documentId) {
        try {
            // Try different endpoint paths that might be valid
            let verifyResponse;
            let documentData;
            let endpointFound = false;
            
            // Try potential endpoint paths (ordered by most likely to work)
            const potentialEndpoints = [
                `/documents/${documentId}`,           // Regular path without /api prefix
                `/api/documents/${documentId}`,       // Standard API path
                `/api/compiled-documents/${documentId}` // Compiled document specific endpoint
            ];
            
            for (const endpoint of potentialEndpoints) {
                try {
                                        verifyResponse = await fetch(endpoint);
                    
                    if (verifyResponse.ok) {
                        documentData = await verifyResponse.json();
                                                endpointFound = true;
                        break;
                    } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!endpointFound) {
                showToast('Could not verify document information', 'error');
                return Promise.reject(new Error('Document verification failed: No endpoint found'));
            }
            
            if (documentData.deleted_at) {
                                showToast('Document is already archived', 'warning');
                return true;
            }
            
            // Try different archive endpoints, with compiled document endpoints first
            let response = null;
            let archiveSuccess = false;
            
            // Try potential archive endpoints - ordered from most specific to more general
            const archiveEndpoints = [
                {
                    url: `/api/compiled-documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/documents/${documentId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/archives`,
                    method: 'POST',
                    body: JSON.stringify({
                        document_id: documentId,
                        archive_children: true
                    })
                }
            ];
            
            for (const endpoint of archiveEndpoints) {
                try {
                                        response = await fetch(endpoint.url, {
                        method: endpoint.method,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        },
                        body: endpoint.body
                    });
                    
                    if (response.ok) {
                        archiveSuccess = true;
                                                break;
                    } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!archiveSuccess) {
                showToast('Cannot archive document. Please contact your system administrator.', 'error');
                return Promise.reject(new Error('Failed to archive document: No working endpoint found'));
            }
            
            // Parse the response
            const result = await response.json();
                        
            // Show success message
            showToast('Document archived successfully', 'success');
            
            // Refresh the document list
            if (window.documentArchive.isArchiveMode()) {
                loadArchivedDocuments(window.documentArchive.getCurrentCache().page || 1);
            } else {
                if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                                        setTimeout(() => {
                        window.documentList.refreshDocumentList(true);
                    }, 300);
                }
            }
            
            return true;
        } catch (error) {
            showToast(`Archive failed: ${error.message || 'Server operation failed'}`, 'error');
            return Promise.reject(error);
        }
    }
    
    /**
     * Archive a child document with reference to its parent
     * @param {number} childId - ID of child document
     * @param {number} parentId - ID of parent document
     * @returns {Promise<boolean>} - Promise resolving to true if successful
     */
    async function archiveChildDocument(childId, parentId) {
        try {
                        
            // Try different archive endpoints
            let archiveSuccess = false;
            
            // Try potential archive endpoints
            const archiveEndpoints = [
                {
                    url: `/documents/${childId}/soft-delete`,
                    method: 'DELETE'
                },
                {
                    url: `/api/documents/${childId}/soft-delete`,
                    method: 'DELETE'
                }
            ];
            
            for (const endpoint of archiveEndpoints) {
                try {
                                        const response = await fetch(endpoint.url, {
                        method: endpoint.method,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        },
                        body: JSON.stringify({
                            parent_compiled_id: parentId,
                            is_child: true
                        })
                    });
                    
                    if (response.ok) {
                        archiveSuccess = true;
                                                break;
                    } else {
                                            }
                } catch (err) {
                                    }
            }
            
            if (!archiveSuccess) {
                return false;
            }
            
                        return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Fetch archived child documents for a compiled package
     * @param {string} parentId - ID of the parent compiled document
     * @param {HTMLElement} containerElement - Container to render children in
     */
    async function fetchArchivedChildDocuments(parentId, containerElement) {
        if (!parentId || !containerElement) {
            return;
        }
        
        try {
            // Show loading indicator
            containerElement.innerHTML = '<div class="loading-children"><i class="fas fa-spinner fa-spin"></i> Loading contents...</div>';
            
            // Fetch the parent document first to get its title
            let parentTitle = 'Parent Document';
            try {
                const parentResponse = await fetch(`/api/documents/${parentId}`);
                if (parentResponse.ok) {
                    const parentData = await parentResponse.json();
                    if (parentData && parentData.title) {
                        parentTitle = parentData.title;
                                            }
                }
            } catch (err) {
            }
            
            // Fetch the child documents
            const response = await fetch(`/api/documents/${parentId}/archived-children`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch child documents: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            const childDocuments = data.documents || [];
            
                        
            // Clear container
            containerElement.innerHTML = '';
            
            // Check if we have child documents
            if (!childDocuments || childDocuments.length === 0) {
                containerElement.innerHTML = `
                    <div class="no-children">
                        <p>No documents found in this package.</p>
                    </div>
                `;
                return;
            }
            
            // Create a wrapper for the child documents
            const childrenWrapper = document.createElement('div');
            childrenWrapper.className = 'children-wrapper';
            childrenWrapper.style.width = '100%';
            childrenWrapper.style.padding = '10px 0';
            containerElement.appendChild(childrenWrapper);
            
            // Loop through and add each child document, including parent info
            childDocuments.forEach(child => {
                // Add parent document information to each child document
                child.parent_id = parentId;
                child.parent_title = parentTitle;
                
                // Create and add the child card
                const childCard = createChildDocumentCard(child);
                childrenWrapper.appendChild(childCard);
            });
            
        } catch (error) {
            containerElement.innerHTML = `
                <div class="error-message">
                    <p>Failed to load package contents: ${error.message}</p>
                    <button class="retry-btn">
                        <i class="fas fa-sync"></i> Try Again
                    </button>
                </div>
            `;
            
            // Add retry button functionality
            const retryBtn = containerElement.querySelector('.retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', function() {
                    fetchArchivedChildDocuments(parentId, containerElement);
                });
            }
        }
    }
    
    /**
     * Create a card for a child document
     * @param {Object} child - Child document object
     * @returns {HTMLElement} - Child document card element
     */
    function createChildDocumentCard(child) {
        const childCard = document.createElement('div');
        childCard.className = 'child-document-card';
        childCard.dataset.documentId = child.id;
        
        // Format authors
        let authors = 'Unknown Author';
        if (child.authors) {
            if (Array.isArray(child.authors) && child.authors.length > 0) {
                authors = child.authors.map(a => {
                    if (typeof a === 'string') return a;
                    return `${a.first_name || ''} ${a.last_name || ''}`.trim();
                }).join(', ');
            } else if (typeof child.authors === 'string') {
                authors = child.authors;
            }
        }
        
        // Format date if available
        const archivedDate = formatDate(child.deleted_at) || 'Unknown date';
        
        // Category slug for the central icon classes (category-icons.css)
        const iconCategory = child.document_type || child.category || '';
        
        // Create a more simplified layout based on the image
        childCard.innerHTML = `
            <div class="child-document-inner">
                <div class="document-icon">
                    <span class="category-icon category-icon--sm" data-category="${iconCategory}" aria-hidden="true"></span>
                </div>
                <div class="document-info">
                    <h4 class="document-title">${child.title || 'Untitled Document'}</h4>
                    <div class="document-meta">
                    <span><i class="fas fa-user"></i> ${authors}</span>
                </div>
            </div>
                <div class="document-actions">
                    <button class="action-btn restore-btn" title="Restore Document" data-document-id="${child.id}">
                        <i class="fas fa-trash-restore"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Add restore button functionality
        const restoreBtn = childCard.querySelector('.restore-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                // Use our custom confirmation dialog instead of browser's confirm
                showRestoreConfirmation(child.id, false, child.title);
            });
        }
        
        return childCard;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type of toast (success, error, warning, info, document-archived, document-restored)
     */
    function showToast(message, type = 'success') {
        if (window.peasToast) {
            window.peasToast.show(message, type);
            return;
        }

        // Check if toastr is available (common toast library)
        if (typeof toastr !== 'undefined') {
            toastr[type](message);
            return;
        }
        
        // If toastr is not available, create our own implementation
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Create a unique ID for the toast
        const toastId = 'toast-' + Date.now();
        toast.id = toastId;
        
        // Determine icon based on toast type
        let icon;
        switch (type) {
            case 'success':
                icon = '<i class="fas fa-check-circle"></i>';
                break;
            case 'document-archived':
                icon = '<i class="fas fa-archive"></i>';
                break;
            case 'document-restored':
                icon = '<i class="fas fa-history"></i>';
                break;
            case 'error':
                icon = '<i class="fas fa-exclamation-circle"></i>';
                break;
            case 'warning':
                icon = '<i class="fas fa-exclamation-triangle"></i>';
                break;
            case 'info':
            default:
                icon = '<i class="fas fa-info-circle"></i>';
                break;
        }
        
        // Auto remove after 5 seconds for success/info, 8 seconds for errors/warnings
        const duration = (type === 'error' || type === 'warning') ? 8000 : 4000;
        
        toast.innerHTML = `
            <div class="toast-content">
                ${icon}
                <span>${message}</span>
            </div>
            <button class="close-btn"><i class="fas fa-times"></i></button>
            <div class="toast-progress"></div>
        `;
        
        // Check if a toast container exists
        let toastContainer = document.getElementById('toast-container');
        
        // If not, create one
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        
        // Add the toast to the container
        toastContainer.appendChild(toast);
        
        // Animate the progress bar
        const progressBar = toast.querySelector('.toast-progress');
        progressBar.style.animation = `toast-progress ${duration/1000}s linear forwards`;
        
        // Auto-hide after set duration
        setTimeout(() => {
            removeToast(toastId);
        }, duration);
        
        // Add click handler to close button
        const closeButton = toast.querySelector('.close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', function() {
                removeToast(toastId);
            });
        }
        
        // Function to remove toast with animation
        function removeToast(id) {
            const toastToRemove = document.getElementById(id);
            if (toastToRemove) {
                toastToRemove.style.opacity = '0';
                toastToRemove.style.transform = 'translateX(100px)';
                
                // Wait for animation to finish before removing from DOM
                setTimeout(() => {
                    if (toastToRemove.parentNode) {
                        toastToRemove.parentNode.removeChild(toastToRemove);
                    }
                }, 300);
            }
        }
    }
    
    /**
     * Render pagination controls
     * @param {number} currentPage - Current page number
     * @param {number} totalPages - Total number of pages
     * @param {HTMLElement} container - Container element for pagination
     * @param {string} callbackFunctionName - Name of the function to call when a page is clicked
     */
    function renderPagination(currentPage, totalPages, container, callbackFunctionName) {
        // Clear container
        container.innerHTML = '';
        
        // Create pagination element
        const pagination = document.createElement('nav');
        pagination.setAttribute('aria-label', 'Document pagination');
        
        const ul = document.createElement('ul');
        ul.className = 'pagination';
        
        // Previous button
        const prevLi = document.createElement('li');
        prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
        
        const prevLink = document.createElement('a');
        prevLink.className = 'page-link';
        prevLink.href = '#';
        prevLink.setAttribute('aria-label', 'Previous');
        prevLink.innerHTML = '<span aria-hidden="true">&laquo;</span>';
        
        if (currentPage > 1) {
            prevLink.addEventListener('click', function(e) {
                e.preventDefault();
                window[callbackFunctionName](currentPage - 1);
            });
        }
        
        prevLi.appendChild(prevLink);
        ul.appendChild(prevLi);
        
        // Determine which page numbers to show
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        
        // Adjust if we're near the end
        if (endPage - startPage < 4 && startPage > 1) {
            startPage = Math.max(1, endPage - 4);
        }
        
        // Page numbers
        for (let i = startPage; i <= endPage; i++) {
            const pageLi = document.createElement('li');
            pageLi.className = `page-item ${i === currentPage ? 'active' : ''}`;
            
            const pageLink = document.createElement('a');
            pageLink.className = 'page-link';
            pageLink.href = '#';
            pageLink.textContent = i;
            
            if (i !== currentPage) {
                pageLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    window[callbackFunctionName](i);
                });
            }
            
            pageLi.appendChild(pageLink);
            ul.appendChild(pageLi);
        }
        
        // Next button
        const nextLi = document.createElement('li');
        nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
        
        const nextLink = document.createElement('a');
        nextLink.className = 'page-link';
        nextLink.href = '#';
        nextLink.setAttribute('aria-label', 'Next');
        nextLink.innerHTML = '<span aria-hidden="true">&raquo;</span>';
        
        if (currentPage < totalPages) {
            nextLink.addEventListener('click', function(e) {
                e.preventDefault();
                window[callbackFunctionName](currentPage + 1);
            });
        }
        
        nextLi.appendChild(nextLink);
        ul.appendChild(nextLi);
        
        // Add pagination to container
        pagination.appendChild(ul);
        container.appendChild(pagination);
    }

    /**
     * Fetch parent document details for a child document
     * @param {number} childId - Child document ID
     * @returns {Promise<Object|null>} - Parent document details or null
     */
    async function fetchParentDocumentDetails(childId) {
        if (!childId) {
            return null;
        }
        
        try {
            // Check if we have the parent ID in the cache (from previous API responses)
            if (archiveState.childParentMap && archiveState.childParentMap[childId]) {
                                return archiveState.childParentMap[childId];
            }
            
                        const response = await fetch(`/api/documents/${childId}/parent-info`);
            
            if (!response.ok) {
                return null;
            }
            
            const data = await response.json();
                        
            // Cache the parent details
            if (!archiveState.childParentMap) {
                archiveState.childParentMap = {};
            }
            
            if (data && data.parent_id) {
                archiveState.childParentMap[childId] = data;
            }
            
            return data;
        } catch (error) {
            return null;
        }
    }

    /**
     * Update the loading state in the UI
     * @param {boolean} isLoading - Whether the system is in a loading state
     */
    function updateLoadingState(isLoading) {
        const container = document.getElementById('documents-container');
        if (!container) return;
        
        // Show/hide loading indicator
        if (isLoading) {
            // Show loading indicator
            const loadingEl = document.createElement('div');
            loadingEl.className = 'loading-indicator';
            loadingEl.innerHTML = `
                <div class="loading-animation">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <p>Loading archived documents...</p>
            `;
            
            // Clear container and add loading indicator
            container.innerHTML = '';
            container.appendChild(loadingEl);
        } else {
            // Remove loading indicator if it exists
            const loadingEl = container.querySelector('.loading-indicator');
            if (loadingEl) {
                loadingEl.remove();
            }
        }
    }

    /**
     * Update the category filters with the provided counts
     * @param {Object} categoryCounts - Object mapping category names to counts
     */
    function updateCategoryFilters(categoryCounts) {
                
        if (!categoryCounts) {
            return;
        }
        
        // Calculate total count across all categories
        let totalCount = 0;
        for (const category in categoryCounts) {
            if (Object.prototype.hasOwnProperty.call(categoryCounts, category)) {
                totalCount += Number(categoryCounts[category]);
            }
        }
        
        // Find all category filter elements
        const categoryElements = document.querySelectorAll('.category-filter, .filter-item, .category-card');
        
        // Update the "All" category count
        categoryElements.forEach(element => {
            const category = element.getAttribute('data-category') || element.getAttribute('data-filter');
            if (category === 'All' || category === 'all' || !category) {
                const countElement = element.querySelector('.count, .filter-count, .category-count');
                if (countElement) {
                    countElement.textContent = `${totalCount} ${totalCount === 1 ? 'file' : 'files'}`;
                }
            }
        });
        
        // Update individual category counts
        categoryElements.forEach(element => {
            const category = element.getAttribute('data-category') || element.getAttribute('data-filter');
            if (category && category !== 'All' && category !== 'all') {
                const count = categoryCounts[category] || 0;
                const countElement = element.querySelector('.count, .filter-count, .category-count');
                if (countElement) {
                    countElement.textContent = `${count} ${count === 1 ? 'file' : 'files'}`;
                }
            }
        });
        
        // Log completion
            }

    // Public API
    return {
        // Archive mode state
        isArchiveMode: function() {
            return archiveState.isArchiveMode;
        },
        setArchiveMode: archiveState.setArchiveMode,
        toggleArchiveMode,
        
        // Core document operations
        archiveDocument,
        archiveCompiledDocument,
        archiveChildDocument,
        restoreDocument,
        showRestoreConfirmation,
        
        // UI functions
        updateArchiveButtonUI,
        updatePageTitle,
        
        // Document loading
        loadArchivedDocuments,
        
        // Cache management
        getCurrentCache: function() {
            return {
                isArchiveMode: archiveState.isArchiveMode,
                documents: archiveState.documents,
                page: archiveState.currentPage,
                totalPages: archiveState.totalPages,
                category: archiveState.categoryFilter,
                search: archiveState.searchTerm
            };
        },
        
        // Initialization
        initializeArchive,
        _initialized: false  // Flag to track initialization state
    };
})();

// Immediately make core functions available globally to prevent race conditions
(function(global) {
    // Pre-initialize core functions to prevent "not defined" errors
    global.archiveDocument = async function(documentId) {
        if (!documentId) {
            console.warn('archiveDocument called before full initialization');
            return Promise.reject(new Error('Archive system not fully initialized'));
        }
        await waitForFullInit();
        return global.documentArchive.archiveDocument(documentId);
    };

    global.archiveCompiledDocument = async function(documentId) {
        if (!documentId) {
            console.warn('archiveCompiledDocument called before full initialization');
            return Promise.reject(new Error('Archive system not fully initialized'));
        }
        await waitForFullInit();
        return global.documentArchive.archiveCompiledDocument(documentId);
    };

    global.showRestoreConfirmation = async function(documentId, isCompiled, docTitle) {
    if (!documentId) {
            console.warn('showRestoreConfirmation called before full initialization');
            return Promise.reject(new Error('Archive system not fully initialized'));
        }
        await waitForFullInit();
        return global.documentArchive.showRestoreConfirmation(documentId, isCompiled, docTitle);
    };

    // Helper function to wait for full initialization
    const waitForFullInit = () => {
        return new Promise((resolve) => {
            const checkInit = () => {
                if (global.documentArchive && global.documentArchive._initialized) {
                    resolve();
            } else {
                    setTimeout(checkInit, 50);
                }
            };
            checkInit();
        });
    };
})(typeof window !== 'undefined' ? window : global);

// Properly initialize archive functionality when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Check if initialization has already happened to prevent duplicates
    if (window.archiveInitialized) {
        return;
    }
    
    if (typeof initializeArchive === 'function') {
        initializeArchive();
    } else if (window.documentArchive && typeof window.documentArchive.initializeArchive === 'function') {
        window.documentArchive.initializeArchive();
    }
    
    // Mark as fully initialized
    window.documentArchive._initialized = true;
});
