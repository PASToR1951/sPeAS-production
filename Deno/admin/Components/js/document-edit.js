/**
 * Document edit functionality
 * Handles editing of existing documents
 * 
 * FIXES: 
 * - Fixed author duplication issue by checking for existing authors before creating new ones
 * - Fixed research agenda item duplication by checking for existing items before creation
 * - Improved error handling and logging for debugging
 * - Fixed ID handling to ensure proper use of UUIDs without converting to integers
 * - Added temporary IDs for authors/topics that couldn't be created via API
 */


// Add toast notification styles
(function() {
    const style = document.createElement('style');
    style.textContent = `
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            max-width: 250px;
            font-size: 14px;
            padding: 10px 15px;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            z-index: 9999;
            opacity: 0;
            transform: translateY(10px);
            animation: slide-in-toast 0.3s forwards;
        }
        
        /* File Upload Styles */
        .file-upload {
            border: 2px dashed #ddd;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            background: #f8f9fa;
            transition: all 0.3s ease;
        }
        
        .file-upload.highlight {
            border-color: #2196F3;
            background: #E3F2FD;
        }
        
        .current-file {
            display: flex;
            align-items: center;
            padding: 10px;
            background: #f8f9fa;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            position: relative;
            z-index: 5;
        }
        
        .current-file i {
            font-size: 24px;
            color: #dc3545;
            margin-right: 10px;
        }
        
        .current-file span {
            flex-grow: 1;
            margin-right: 10px;
        }
        
        .btn-sm {
            padding: 4px 8px;
            font-size: 12px;
        }
        
        .replace-btn {
            position: relative;
            z-index: 10;
            pointer-events: auto;
        }
        
        .upload-area {
            cursor: pointer;
            padding: 20px;
            text-align: center;
        }
        
        .upload-area i {
            font-size: 48px;
            color: #6c757d;
            margin-bottom: 10px;
        }
        
        .upload-area p {
            margin: 5px 0;
            color: #6c757d;
        }
        
        .upload-area .file-types {
            font-size: 12px;
            color: #999;
        }
        
        @keyframes slide-in-toast {
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slide-in-toast {
            to { opacity: 1; transform: translateY(0); }
        }
        
        .toast-success {
            background-color: #e8f5e9;
            color: #2e7d32;
            border-left: 3px solid #2e7d32;
        }
        
        .toast-error {
            background-color: #ffebee;
            color: #c62828;
            border-left: 3px solid #c62828;
        }
        
        /* Success Popup Styles */
        .success-popup-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.3);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        }
        
        .success-popup {
            background-color: #E6E6E6;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
            padding: 25px 30px;
            text-align: center;
            max-width: 300px;
            animation: popup-appear 0.3s ease-out;
        }
        
        @keyframes popup-appear {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
        }
        
        .success-popup-icon {
            color: #2e7d32;
            font-size: 48px;
            margin-bottom: 15px;
        }
        
        .success-popup-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 10px;
            color: #333;
        }
        
        .success-popup-message {
            font-size: 16px;
            color: #666;
            margin-bottom: 20px;
        }
        
        .success-popup-button {
            background-color: #2e7d32;
            color: #E6E6E6;
            border: none;
            padding: 8px 20px;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .success-popup-button:hover {
            background-color: #1b5e20;
        }
        
        /* Dropdown Styles */
        .dropdown-list {
            position: absolute;
            background-color: #E6E6E6;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            width: 100%;
            max-height: 250px;
            overflow-y: auto;
            z-index: 1000;
            margin-top: 2px;
        }
        
        .dropdown-item {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid #f0f0f0;
            transition: background-color 0.2s;
        }
        
        .dropdown-item:hover {
            background-color: #f5f5f5;
        }
        
        .dropdown-item .item-name {
            font-weight: 500;
            margin-bottom: 2px;
        }
        
        .dropdown-item .item-detail {
            font-size: 12px;
            color: #666;
        }
        
        .dropdown-item .item-detail-small {
            font-size: 11px;
            color: #888;
        }
        
        .dropdown-item.no-results,
        .dropdown-item.error,
        .dropdown-item.loading {
            color: #888;
            font-style: italic;
        }
        
        .dropdown-item.create-new {
            color: #2e7d32;
            font-weight: 500;
        }
        
        .dropdown-item.create-new i {
            margin-right: 5px;
        }
        
        /* Selected items styles */
        .selected-author,
        .selected-topic {
            display: inline-block;
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 4px 8px;
            border-radius: 4px;
            margin: 4px;
            font-size: 14px;
        }
        
        .selected-topic {
            background-color: #e8f5e9;
            color: #2e7d32;
        }
        
        .remove-author,
        .remove-topic {
            margin-left: 5px;
            cursor: pointer;
            font-weight: bold;
        }
        
        .remove-author:hover,
        .remove-topic:hover {
            color: #f44336;
        }
    `;
    document.head.appendChild(style);
})();

// Function to show a toast notification
function showToast(message, type = 'info') {
    if (window.peasToast) {
        window.peasToast.show(message, type);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3000);
}

// Document edit module
window.documentEdit = {
    // Function to show the edit modal for a single document
    showEditModal: function(documentId) {
                
        // First, load the modals HTML if not already loaded
        this.loadModalHTML().then(() => {
            // Get the modal elements
            const modal = document.getElementById('edit-single-document-modal');
            if (!modal) {
                showToast('Error loading edit modal. Please refresh the page and try again.', 'error');
                return;
            }
            
            // Show a loading indicator
            showToast('Loading document data...', 'info');
            
            // Set the document ID in the form
            document.getElementById('edit-single-document-id').value = documentId;
            
            // Display the modal first with a loading state
            modal.style.display = 'flex';
            
            // Add a loading indicator to the form
            const form = modal.querySelector('.left-panel');
            if (form) {
                const loadingOverlay = document.createElement('div');
                loadingOverlay.className = 'loading-overlay';
                loadingOverlay.innerHTML = '<div class="spinner"><i class="fas fa-spinner fa-spin"></i></div><div class="loading-text">Loading document data...</div>';
                form.appendChild(loadingOverlay);
            }
            
            // Fetch document data and populate the form
            this.fetchDocumentData(documentId, false)
                .then(data => {
                    // Remove loading overlay
                    const loadingOverlay = modal.querySelector('.loading-overlay');
                    if (loadingOverlay) {
                        loadingOverlay.remove();
                    }
                    
                    this.populateEditForm(data);
                })
                .catch(error => {
                    showToast('Error loading document data. Please try again.', 'error');
                    
                    // Remove loading overlay
                    const loadingOverlay = modal.querySelector('.loading-overlay');
                    if (loadingOverlay) {
                        loadingOverlay.remove();
                    }
                    
                    // Show error in the form
                    const formContent = modal.querySelector('.left-panel');
                    if (formContent) {
                        formContent.innerHTML = `
                            <div class="error-container">
                                <i class="fas fa-exclamation-triangle"></i>
                                <h3>Error Loading Document</h3>
                                <p>${error.message}</p>
                                <button class="btn-secondary cancel-edit-btn">Close</button>
                            </div>
                        `;
                        
                        const closeBtn = formContent.querySelector('.cancel-edit-btn');
                        if (closeBtn) {
                            closeBtn.addEventListener('click', () => {
                                modal.style.display = 'none';
                            });
                        }
                    }
                });
        }).catch(error => {
            showToast('Error loading edit modal. Please refresh the page and try again.', 'error');
        });
    },
    
    // Function to show the edit modal for a compiled document
    showCompiledEditModal: function(documentId) {
                
        // First, load the modals HTML if not already loaded
        this.loadModalHTML().then(() => {
        // Find the modal and ensure it exists
        const modal = document.getElementById('edit-compiled-document-modal');
        if (!modal) {
                showToast('Error loading edit modal. Please refresh the page and try again.', 'error');
            return;
        }
            
            // Show a loading indicator
            showToast('Loading compiled document data...', 'info');
            
            // Set the document ID in the form
            document.getElementById('edit-compiled-document-id').value = documentId;
            
            // Display the modal first with a loading state
            modal.style.display = 'flex';
            
            // Add a loading indicator to the form
            const form = modal.querySelector('.left-panel');
            if (form) {
                const loadingOverlay = document.createElement('div');
                loadingOverlay.className = 'loading-overlay';
                loadingOverlay.innerHTML = '<div class="spinner"></div><div class="loading-text">Loading compiled document data...</div>';
                form.appendChild(loadingOverlay);
        }
        
        // Set up the modal event listeners
        this.setupModalEventListeners();
        
            // Fetch document data - use a proper compiled endpoint
                        this.fetchCompiledDocumentData(documentId)
            .then(data => {
                // Log data for debugging
                                        
                    // Remove loading overlay
                    const loadingOverlay = modal.querySelector('.loading-overlay');
                    if (loadingOverlay) {
                        loadingOverlay.remove();
                }
                
                // Populate form with data
                this.populateCompiledEditForm(data);
                
                // EMERGENCY DIRECT FORM POPULATION
                                setTimeout(() => {
                    // Force direct population of fields
                    try {
                        const titleField = document.getElementById('edit-compiled-document-title');
                        const startYearField = document.getElementById('edit-compiled-pub-year-start');
                        const endYearField = document.getElementById('edit-compiled-pub-year-end');
                        const volumeField = document.getElementById('edit-compiled-volume');
                        const categoryField = document.getElementById('edit-compiled-category');
                        const issuedNoField = document.getElementById('edit-compiled-issued-no');
                        const departmentalField = document.getElementById('edit-compiled-departmental');
                        
                        console.log('Emergency population - Fields exist:', {
                            title: !!titleField,
                            startYear: !!startYearField,
                            endYear: !!endYearField,
                            volume: !!volumeField,
                            category: !!categoryField,
                            issuedNo: !!issuedNoField,
                            departmental: !!departmentalField
                        });
                        
                        // Set values directly
                        if (titleField) titleField.value = data.title || '';
                        if (startYearField) startYearField.value = data.start_year || '';
                        if (endYearField) endYearField.value = data.end_year || '';
                        if (volumeField) volumeField.value = data.volume || '';
                        
                        // Set category with change trigger
                        if (categoryField && data.category) {
                                                        // Find matching option, case insensitive
                            const options = Array.from(categoryField.options);
                            const matchingOption = options.find(opt => 
                                opt.value.toLowerCase() === data.category.toLowerCase() ||
                                opt.text.toLowerCase() === data.category.toLowerCase()
                            );
                            
                            if (matchingOption) {
                                categoryField.value = matchingOption.value;
                                // Trigger change event
                                                                const event = new Event('change', { bubbles: true });
                                categoryField.dispatchEvent(event);
                            } else {
                                                            }
                            
                            // Add category change handler to toggle fields
                            categoryField.addEventListener('change', (e) => {
                                const selectedCategory = e.target.value;
                                this.handleCategoryChange(selectedCategory);
                            });
                        } else {
                        }
                        
                        // Set issue or department after a delay for the category change to take effect
                        setTimeout(() => {
                            // Set issue number or department based on category
                            if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                                if (departmentalField) {
                                                                        departmentalField.value = data.department || '';
                                    
                                    // Ensure departmental field is a dropdown and populated
                                    this.ensureDepartmentalDropdown(departmentalField);
                            } else {
                                }
                            } else {
                                if (issuedNoField) {
                                                                        issuedNoField.value = data.issue_number || '';
                                } else {
                                }
                            }
                            
                            // Update preview fields
                            if (typeof this.updatePreviewFields === 'function') {
                                                                this.updatePreviewFields();
                            } else {
                            }
                            
                                                    }, 200);
                    } catch (error) {
                    }
                }, 500);
            })
            .catch(error => {
                    // Remove loading overlay
                    const loadingOverlay = modal.querySelector('.loading-overlay');
                    if (loadingOverlay) {
                        loadingOverlay.remove();
                    }
                    
                    // Show error in the form
                    const formContent = modal.querySelector('.left-panel');
                    if (formContent) {
                        formContent.innerHTML = `
                            <div class="error-container">
                                <i class="fas fa-exclamation-triangle"></i>
                                <h3>Error Loading Compiled Document</h3>
                                <p>${error.message}</p>
                                <button class="btn-secondary cancel-edit-btn">Close</button>
                            </div>
                        `;
                        
                        const closeBtn = formContent.querySelector('.cancel-edit-btn');
                        if (closeBtn) {
                            closeBtn.addEventListener('click', () => {
                                modal.style.display = 'none';
                            });
                        }
                    }
                    
                    showToast('Error loading compiled document data. Please try again.', 'error');
                });
        }).catch(error => {
            showToast('Error loading edit modal. Please refresh the page and try again.', 'error');
            });
    },
    
    // Specialized function to fetch compiled document data
    fetchCompiledDocumentData: function(documentId) {
        return new Promise(async (resolve, reject) => {
                        
            // Define compiled-specific endpoints to try in sequence
            const compiledEndpoints = [
                `/api/compiled-documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                `/api/compiled-documents/${documentId}`,
                `/api/documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                `/api/documents/${documentId}`
            ];
            
            let documentData = null;
            let lastError = null;
            
            // Try each endpoint in sequence until we get data
            for (const endpoint of compiledEndpoints) {
                try {
                                        const response = await fetch(endpoint);
                    
                    if (response.ok) {
                        const data = await response.json();
                                                
                        // Detailed logging of the received data
                                                if (data.children)                         if (data.authors)                         if (data.research_agenda)                         if (data.topics)                         
                        // Process and normalize the data
                        documentData = this.normalizeCompiledDocumentData(data, documentId);
                        break; // We have data, break out of the loop
                    } else {
                        lastError = new Error(`Failed to fetch compiled document: ${response.status}`);
                    }
                } catch (error) {
                    lastError = error;
                }
            }
            
            // If we have data, only fetch missing pieces if necessary
            if (documentData) {
                                
                try {
                    const promises = [];
                    
                    // Only fetch children if not already included and they should be included
                    if ((!documentData.children || documentData.children.length === 0) && 
                        !compiledEndpoints[0].includes('failed_already')) {
                        // Only add this promise if we need it
                        promises.push(this.fetchChildrenIfNeeded(documentId, documentData));
                    } else {
                                            }
                    
                    // Only fetch authors if not already included
                    if (!documentData.authors || documentData.authors.length === 0) {
                        promises.push(this.fetchAuthorsIfNeeded(documentId, documentData));
                    } else {
                                            }
                    
                    // Only fetch research agenda if not already included
                    if ((!documentData.research_agenda || documentData.research_agenda.length === 0) &&
                        (!documentData.topics || documentData.topics.length === 0)) {
                        promises.push(this.fetchResearchAgendaIfNeeded(documentId, documentData));
                    } else {
                        console.log('Using existing research agenda data:', 
                            documentData.research_agenda ? documentData.research_agenda.length : 0, 'items');
                    }
                    
                    // Wait for any needed fetches to complete
                    if (promises.length > 0) {
                                                await Promise.all(promises);
                    } else {
                                            }
                    
                                        // Resolve with the complete data
                    resolve(documentData);
                } catch (error) {
                    // Still resolve with partial data
                    resolve(documentData);
                }
            } else {
                // No data found, reject with error
                reject(lastError || new Error('Failed to fetch compiled document data'));
            }
        });
    },
    
    // Helper function to fetch children only if needed
    fetchChildrenIfNeeded: async function(documentId, documentData) {
        if (!documentData.children || documentData.children.length === 0) {
            const childrenEndpoints = [
                `/api/compiled-documents/${documentId}/children`,
                `/compiled-documents/${documentId}/children`
            ];
            
            for (const childEndpoint of childrenEndpoints) {
                try {
                                        const childResponse = await fetch(childEndpoint);
                    if (childResponse.ok) {
                        const childData = await childResponse.json();
                                                if (childData.children && Array.isArray(childData.children)) {
                            documentData.children = childData.children;
                                                        return;
                        } else if (Array.isArray(childData)) {
                            documentData.children = childData;
                                                        return;
                        }
                    } else {
                    }
                } catch (childError) {
                }
            }
                        documentData.children = [];
        }
    },
    
    // Helper function to fetch authors only if needed
    fetchAuthorsIfNeeded: async function(documentId, documentData) {
        try {
                        const authors = await this.fetchAuthorsForDocument(documentId);
            if (authors && authors.length > 0) {
                documentData.authors = authors;
                            } else {
                                documentData.authors = [];
            }
        } catch (authorError) {
            documentData.authors = [];
        }
    },
    
    // Helper function to fetch research agenda only if needed
    fetchResearchAgendaIfNeeded: async function(documentId, documentData) {
        try {
                        const topics = await this.fetchResearchAgendaForDocument(documentId);
            if (topics && topics.length > 0) {
                documentData.research_agenda = topics;
                            } else {
                                documentData.research_agenda = [];
            }
        } catch (topicError) {
            documentData.research_agenda = [];
        }
    },
    
    // Helper function to normalize compiled document data
    normalizeCompiledDocumentData: function(data, documentId) {
        // Ensure we have the basic structure
        const normalizedData = {
            id: data.id || documentId,
            title: data.title || 'Untitled Compiled Document',
            document_type: data.document_type || data.category || data.type || 'CONFLUENCE',
            is_compiled: true
        };
        
        // Copy all other fields
        Object.keys(data).forEach(key => {
            normalizedData[key] = data[key];
        });
        
        // Normalize date fields - if publication_date exists but date_published doesn't
        if (data.publication_date && !normalizedData.date_published) {
            normalizedData.date_published = data.publication_date;
                    }
        
        // Handle the case where topics is populated but research_agenda isn't
        if (data.topics && Array.isArray(data.topics) && (!normalizedData.research_agenda || normalizedData.research_agenda.length === 0)) {
            normalizedData.research_agenda = data.topics;
                    }
        
        // Make sure children is an array
        if (!normalizedData.children) {
            normalizedData.children = [];
        } else if (!Array.isArray(normalizedData.children)) {
            normalizedData.children = [];
        }
        
        // Make sure authors is an array
        if (!normalizedData.authors) {
            normalizedData.authors = [];
        } else if (!Array.isArray(normalizedData.authors)) {
            normalizedData.authors = [];
        }
        
        // Make sure research_agenda is an array
        if (!normalizedData.research_agenda) {
            normalizedData.research_agenda = [];
        } else if (!Array.isArray(normalizedData.research_agenda)) {
            normalizedData.research_agenda = [];
        }
        
                return normalizedData;
    },
    
    // Load the modal HTML if not already present
    loadModalHTML: function() {
        return new Promise((resolve, reject) => {
            // Check if modals are already loaded
            if (document.getElementById('edit-single-document-modal') && 
                document.getElementById('edit-compiled-document-modal') &&
                document.getElementById('pdf-viewer-modal')) {
                                this.setupModalEventListeners();
                resolve();
                return;
            }
            
                        
            // Load the modal HTML
            fetch('/admin/Components/modals/edit-document-modals.html')
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to load modals: ${response.status}`);
                    }
                    return response.text();
                })
                .then(html => {
                                        
                    // Create a temporary div to hold the HTML
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = html;
                    
                    // Extract the modals from the HTML
                    const modals = [
                        tempDiv.querySelector('#edit-single-document-modal'),
                        tempDiv.querySelector('#edit-compiled-document-modal'),
                        tempDiv.querySelector('#select-child-document-modal'),
                        tempDiv.querySelector('#pdf-viewer-modal')
                    ];
                    
                    // Log what we found to help with debugging
                    console.log('Found modals:', 
                        modals[0] ? 'single-edit ✓' : 'single-edit ✗',
                        modals[1] ? 'compiled-edit ✓' : 'compiled-edit ✗',
                        modals[2] ? 'select-child ✓' : 'select-child ✗',
                        modals[3] ? 'pdf-viewer ✓' : 'pdf-viewer ✗'
                    );
                    
                    // Check if we found all the required modals
                    if (!modals[0] || !modals[1] || !modals[3]) {
                        // Try to extract the entire body contents as a fallback
                        const bodyContent = tempDiv.querySelector('body');
                        if (bodyContent) {
                                                        document.body.insertAdjacentHTML('beforeend', bodyContent.innerHTML);
                        } else {
                            throw new Error('Required modals not found in HTML');
                        }
                    } else {
                        // Append the modals to the document body
                        modals.forEach(modal => {
                            if (modal) {
                                // Check if a modal with this ID already exists
                                const existingModal = document.getElementById(modal.id);
                                if (existingModal) {
                                                                        existingModal.parentNode.replaceChild(modal, existingModal);
                                } else {
                                    document.body.appendChild(modal);
                                }
                            }
                        });
                    }
                    
                    // Set up event listeners for the modals
                    this.setupModalEventListeners();
                    
                    // Do a final check that everything loaded correctly
                    setTimeout(() => {
                        // Double-check that all required modals are in the DOM
                        const singleModal = document.getElementById('edit-single-document-modal');
                        const compiledModal = document.getElementById('edit-compiled-document-modal');
                        const pdfModal = document.getElementById('pdf-viewer-modal');
                        
                        if (!singleModal || !compiledModal || !pdfModal) {
                            console.error('Modals still missing after load:', 
                                !singleModal ? 'single-edit' : '',
                                !compiledModal ? 'compiled-edit' : '',
                                !pdfModal ? 'pdf-viewer' : ''
                            );
                            
                            // Try one more time with direct HTML insertion if needed
                            if (!singleModal || !compiledModal || !pdfModal) {
                                                                this.insertEmergencyModals();
                            }
                        }
                    }, 100);
                    
                    resolve();
                })
                .catch(error => {
                    reject(error);
                });
        });
    },
    
    // Emergency function to directly insert the most essential modal HTML
    insertEmergencyModals: function() {
        // Check which modals are missing
        const singleModal = document.getElementById('edit-single-document-modal');
        const compiledModal = document.getElementById('edit-compiled-document-modal');
        const pdfModal = document.getElementById('pdf-viewer-modal');
        
        // If PDF viewer modal is missing, insert a basic version
        if (!pdfModal) {
            const pdfModalHtml = `
                <div id="pdf-viewer-modal" style="display: none;">
                    <div class="pdf-modal-content">
                        <div class="pdf-modal-header">
                            <h3 id="pdf-viewer-title">Document Preview</h3>
                            <button id="close-pdf-btn" class="close-button">×</button>
                        </div>
                        <div class="pdf-container">
                            <iframe id="pdf-iframe" src=""></iframe>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', pdfModalHtml);
                    }
        
        // Re-setup event listeners
        this.setupModalEventListeners();
    },
    
    // Set up event listeners for modals
    setupModalEventListeners: function() {
                
        // Single document modal
        const singleModal = document.getElementById('edit-single-document-modal');
        if (singleModal) {
                        
            // Add document type change listener
            const typeSelect = document.getElementById('edit-single-document-type');
            if (typeSelect) {
                // Remove any existing listeners to prevent duplicates
                const oldListener = typeSelect._typeChangeListener;
                if (oldListener) {
                    typeSelect.removeEventListener('change', oldListener);
                }
                
                // Create new listener
                const typeChangeListener = (e) => {
                    const selectedType = e.target.value;
                    const typeIcon = document.getElementById('edit-single-document-type-icon');
                    if (typeIcon) {
                        typeIcon.dataset.category = selectedType || '';
                                            }
                };
                
                // Store reference to listener for future removal
                typeSelect._typeChangeListener = typeChangeListener;
                
                // Add the event listener
                typeSelect.addEventListener('change', typeChangeListener);
                            }
            
            // Cancel button - try multiple selector approaches to ensure we find all buttons
            const cancelButtons = singleModal.querySelectorAll('.cancel-edit-btn, button.btn-secondary');
                        
            cancelButtons.forEach(button => {
                // Remove any existing event listeners to prevent duplicates
                button.removeEventListener('click', () => singleModal.style.display = 'none');
                
                // Add the event listener
                button.addEventListener('click', () => {
                                        singleModal.style.display = 'none';
                });
                
                            });
            
            // Form submission
            const form = document.getElementById('edit-single-document-form');
            if (form) {
                // Remove any existing listeners to prevent duplicates
                const oldListener = form._editSubmitListener;
                if (oldListener) {
                    form.removeEventListener('submit', oldListener);
                }
                
                // Create new listener
                const submitListener = (e) => {
                    e.preventDefault();
                    this.saveDocument(new FormData(form));
                };
                
                // Store reference to listener for future removal
                form._editSubmitListener = submitListener;
                
                // Add the event listener
                form.addEventListener('submit', submitListener);
            }
            
            // Initialize author search input
            const authorSearchInput = document.getElementById('edit-single-document-author-search');
            if (authorSearchInput && typeof window.initAuthorSearchInput === 'function') {
                this.initializeAuthorSearch(authorSearchInput, 'edit-single-document-selected-authors');
            } else {
            }
            
            // Initialize research agenda search
            const topicSearchInput = document.getElementById('edit-single-document-topic-search');
            if (topicSearchInput) {
                this.initializeResearchAgendaSearch(topicSearchInput, 'edit-single-document-selected-topics');
            }
            
            // Read document button
            const readBtn = document.getElementById('edit-single-document-read-btn');
            if (readBtn) {
                                
                // Remove any existing event listeners to prevent duplicates
                readBtn.removeEventListener('click', readBtn._readBtnListener);
                
                // Create new listener with proper "this" context
                const self = this;
                const readBtnListener = function() {
                                        const docId = document.getElementById('edit-single-document-id').value;
                                        
                    // Directly fetch the document file path and open it
                    fetch(`/api/documents/${docId}`)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Error fetching document: ${response.status}`);
                            }
                            return response.json();
                        })
                        .then(document => {
                            if (document && document.file_path) {
                                const pdfPath = `${window.location.origin}/api/documents/${encodeURIComponent(document.id || docId)}/download?disposition=inline`;
                                window.open(pdfPath, '_blank');
                            } else {
                                alert('Document file not found.');
                            }
                        })
                        .catch(error => {
                            alert(`Error opening document: ${error.message}`);
                        });
                };
                
                // Store reference to listener for future removal
                readBtn._readBtnListener = readBtnListener;
                
                // Add the event listener
                readBtn.addEventListener('click', readBtnListener);
                            } else {
            }
        } else {
        }
        
        // Compiled document modal
        const compiledModal = document.getElementById('edit-compiled-document-modal');
        if (compiledModal) {
                        
            // Cancel button
            const cancelButtons = compiledModal.querySelectorAll('.cancel-edit-btn, button.btn-secondary');
                        
            cancelButtons.forEach(button => {
                // Remove any existing event listeners to prevent duplicates
                button.removeEventListener('click', () => compiledModal.style.display = 'none');
                
                // Add the event listener
                button.addEventListener('click', () => {
                                        compiledModal.style.display = 'none';
                });
                
                            });
            
            // Form submission
            const form = document.getElementById('edit-compiled-document-form');
            if (form) {
                // Remove any existing listeners to prevent duplicates
                const oldListener = form._editSubmitListener;
                if (oldListener) {
                    form.removeEventListener('submit', oldListener);
                }
                
                // Create new listener
                const submitListener = (e) => {
                    e.preventDefault();
                    this.saveCompiledDocument(new FormData(form));
                };
                
                // Store reference to listener for future removal
                form._editSubmitListener = submitListener;
                
                // Add the event listener
                form.addEventListener('submit', submitListener);
            }
            
            // Initialize author search input
            const authorSearchInput = document.getElementById('edit-compiled-document-author-search');
            if (authorSearchInput && typeof window.initAuthorSearchInput === 'function') {
                this.initializeAuthorSearch(authorSearchInput, 'edit-compiled-document-selected-authors');
            } else {
            }
            
            // Initialize research agenda search
            const topicSearchInput = document.getElementById('edit-compiled-document-topic-search');
            if (topicSearchInput) {
                this.initializeResearchAgendaSearch(topicSearchInput, 'edit-compiled-document-selected-topics');
            }
            
            // File upload handling
            const fileInput = document.getElementById('edit-compiled-document-file');
            const fileIndicator = document.getElementById('edit-compiled-document-file-indicator');
            if (fileInput && fileIndicator) {
                // Remove any existing listeners to prevent duplicates
                const oldListener = fileInput._editChangeListener;
                if (oldListener) {
                    fileInput.removeEventListener('change', oldListener);
                }
                
                // Create new listener
                const changeListener = (e) => {
                    if (fileInput.files.length > 0) {
                        fileIndicator.textContent = fileInput.files[0].name;
                    } else {
                        fileIndicator.textContent = '';
                    }
                };
                
                // Store reference to listener for future removal
                fileInput._editChangeListener = changeListener;
                
                // Add the event listener
                fileInput.addEventListener('change', changeListener);
            }
            
            // Read document button
            const readBtn = document.getElementById('edit-compiled-document-read-btn');
            if (readBtn) {
                                
                // Remove any existing event listeners to prevent duplicates
                readBtn.removeEventListener('click', readBtn._readBtnListener);
                
                // Create new listener with proper "this" context
                const self = this;
                const readBtnListener = function() {
                                        const docId = document.getElementById('edit-compiled-document-id').value;
                    
                    // Try multiple endpoints for compiled documents
                    const endpoints = [
                        `/api/compiled-documents/${docId}`,
                        `/api/documents/${docId}?type=compiled`,
                        `/api/documents/${docId}`
                    ];
                    
                    // Try each endpoint in order until one works
                    const tryNextEndpoint = (index = 0) => {
                        if (index >= endpoints.length) {
                            alert('Could not find the document file. Please try again later.');
                            return;
                        }
                        
                        const endpoint = endpoints[index];
                                                
                        fetch(endpoint)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Error fetching document: ${response.status}`);
                            }
                            return response.json();
                        })
                        .then(document => {
                            let fileUrl = null;
                            
                            // Check for foreword first (compiled document case)
                            if (document && document.foreword) {
                                fileUrl = `/api/compiled-documents/${encodeURIComponent(document.id || docId)}/foreword`;
                            } 
                            // Otherwise check for regular file path
                            else if (document && document.file_path) {
                                fileUrl = `/api/documents/${encodeURIComponent(document.id || docId)}/download?disposition=inline`;
                            }
                            
                            if (fileUrl) {
                                window.open(fileUrl, '_blank');
                            } else {
                                alert('Document file not found. Please ensure the document has a file attached.');
                            }
                        })
                        .catch(error => {
                            // Try the next endpoint
                            tryNextEndpoint(index + 1);
                        });
                    };
                    
                    // Start with the first endpoint
                    tryNextEndpoint();
                };
                
                // Store reference to listener for future removal
                readBtn._readBtnListener = readBtnListener;
                
                // Add the event listener
                readBtn.addEventListener('click', readBtnListener);
                            } else {
            }
            
            // Add child document button
            const addChildBtn = document.getElementById('add-child-document-btn');
            if (addChildBtn) {
                // Remove any existing event listeners to prevent duplicates
                addChildBtn.removeEventListener('click', addChildBtn._addChildListener);
                
                // Create new listener with proper "this" context 
                const self = this;
                const addChildListener = function() {
                    self.showChildDocumentSelector();
                };
                
                // Store reference to listener for future removal
                addChildBtn._addChildListener = addChildListener;
                
                // Add the event listener
                addChildBtn.addEventListener('click', addChildListener);
            }
        } else {
        }
        
        // Child document selection modal
        const selectModal = document.getElementById('select-child-document-modal');
        if (selectModal) {
            // Cancel button
            const cancelBtn = document.getElementById('close-select-document-btn');
            if (cancelBtn) {
                // Remove any existing event listeners to prevent duplicates
                cancelBtn.removeEventListener('click', () => selectModal.style.display = 'none');
                
                // Add the event listener
                cancelBtn.addEventListener('click', () => {
                    selectModal.style.display = 'none';
                });
            }
            
            // Search input
            const searchInput = document.getElementById('child-document-search');
            if (searchInput) {
                // Remove any existing listeners to prevent duplicates
                const oldListener = searchInput._searchListener;
                if (oldListener) {
                    searchInput.removeEventListener('input', oldListener);
                }
                
                // Create new listener with proper "this" context
                const self = this;
                const searchListener = function(e) {
                    self.searchAvailableDocuments(e.target.value);
                };
                
                // Store reference to listener for future removal
                searchInput._searchListener = searchListener;
                
                // Add the event listener
                searchInput.addEventListener('input', searchListener);
            }
        }
        
        // PDF viewer modal
        const pdfModal = document.getElementById('pdf-viewer-modal');
        if (pdfModal) {
            // Close button
            const closeBtn = document.getElementById('close-pdf-btn');
            if (closeBtn) {
                // Remove any existing event listeners to prevent duplicates
                closeBtn.removeEventListener('click', () => pdfModal.style.display = 'none');
                
                // Add the event listener
                closeBtn.addEventListener('click', () => {
                    pdfModal.style.display = 'none';
                });
            }
        }
        
            },
    
    // Fetch document data for editing
    fetchDocumentData: function(documentId, isCompiled) {
        return new Promise((resolve, reject) => {
                        
            // Try different potential endpoints for the document
            let endpoints = [];
            
            if (isCompiled) {
                // For compiled documents, try compiled-specific endpoints first
                endpoints = [
                    `/api/compiled-documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                    `/api/compiled-documents/${documentId}`,
                    `/api/documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                    `/api/documents/${documentId}`
                ];
            } else {
                // For regular documents, try standard endpoints
                endpoints = [
                    `/api/documents/${documentId}`,
                    `/api/document/${documentId}`
                ];
            }
            
            // Try each endpoint in sequence
            this.tryEndpoints(endpoints)
                .then(data => resolve(data))
                .catch(error => {
                    reject(error);
                });
        });
    },
    
    // Helper function for compatibility - uses loadChildDocuments
    populateChildDocumentsList: function(children) {
                this.loadChildDocuments(null, children);
    },
    
    // Helper function to fetch minimal document data when main endpoints fail
    fetchMinimalDocumentData: function(documentId, isCompiled) {
        return new Promise(async (resolve, reject) => {
            try {
                const minimalData = { id: documentId };
                
                // Try to at least get the title
                try {
                    const titleResponse = await fetch(`/api/documents/${documentId}/title`);
                    if (titleResponse.ok) {
                        const titleData = await titleResponse.json();
                        minimalData.title = titleData.title || 'Unknown Title';
                    }
                } catch (titleError) {
                }
                
                // Try to get authors
                try {
                    const authors = await this.fetchAuthorsForDocument(documentId);
                    minimalData.authors = authors;
                } catch (authorsError) {
                }
                
                // Try to get research agenda
                try {
                    const researchAgenda = await this.fetchResearchAgendaForDocument(documentId);
                    minimalData.research_agenda = researchAgenda;
                } catch (agendaError) {
                }
                
                // For compiled documents, also try to get child documents
                if (isCompiled) {
                    try {
                        const childResponse = await fetch(`/api/compiled-documents/${documentId}/children`);
                        if (childResponse.ok) {
                            const childData = await childResponse.json();
                            minimalData.children = childData.children || [];
                        }
                    } catch (childError) {
                        minimalData.children = [];
                    }
                }
                
                resolve(minimalData);
            } catch (error) {
                reject(error);
            }
        });
    },
    
    // Helper function to try multiple endpoints in sequence
    tryEndpoints: function(endpoints) {
        return new Promise(async (resolve, reject) => {
            let lastError = null;
            let partialData = null;
            
            // Extract ID from the first endpoint URL to use as fallback
            const idMatch = endpoints[0].match(/\/(\d+)(?:\?|$)/);
            const docId = idMatch ? idMatch[1] : 'unknown';
            
            // Check if this might be a compiled document based on endpoints
            const isLikelyCompiled = endpoints.some(ep => ep.includes('compiled'));
            
            // If compiled document, make sure we include compiled-specific endpoints
            if (isLikelyCompiled) {
                // Make sure we have compiled document endpoints
                const compiledEndpoints = [
                    `/api/compiled-documents/${docId}?include_children=true&include_authors=true&include_topics=true`,
                    `/api/compiled-documents/${docId}`
                ];
                
                // Add compiledEndpoints to the beginning of the endpoints array if they're not already there
                compiledEndpoints.forEach(ep => {
                    if (!endpoints.includes(ep)) {
                        endpoints.unshift(ep);
                    }
                });
                
                console.log('Document appears to be compiled, prioritizing compiled endpoints:', 
                            endpoints.slice(0, 2));
            }
            
            for (const endpoint of endpoints) {
                try {
                                        const response = await fetch(endpoint);
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        // If we get some data, save it even if incomplete
                        if (data && Object.keys(data).length > 0) {
                                                        
                            // Normalize date fields - if publication_date exists but date_published doesn't
                            if (data.publication_date && !data.date_published) {
                                data.date_published = data.publication_date;
                                                            }
                            
                            // Mark as compiled if it came from a compiled endpoint
                            if (endpoint.includes('compiled') && !data.is_compiled) {
                                data.is_compiled = true;
                            }
                            
                            // Save any data we get, even if it's partial
                            if (partialData) {
                                // Merge with previous partial data, preferring newer values
                                partialData = { ...partialData, ...data };
                            } else {
                                partialData = data;
                            }
                            
                            // If this looks like complete data, break out of the loop
                            if (data.title && (data.document_type || data.category)) {
                                break;
                            }
                        }
                    } else {
                                                lastError = new Error(`Failed to fetch document: ${response.status}`);
                    }
                } catch (error) {
                                        lastError = error;
                }
            }
            
            // If we didn't get any data at all, create fallback data
            if (!partialData || Object.keys(partialData).length === 0) {
                partialData = {
                                id: docId,
                                title: 'Untitled Document',
                                document_type: '',
                                date_published: new Date().toISOString(),
                                abstract: '',
                                authors: [],
                    research_agenda: [],
                    children: [],
                    is_compiled: isLikelyCompiled
                };
                        }
                        
                        // Ensure document ID is available
            if (!partialData.id) {
                partialData.id = docId;
            }
            
            // Ensure critical fields exist with defaults if missing
            if (!partialData.title) partialData.title = 'Untitled Document';
            if (!partialData.document_type && !partialData.category) partialData.document_type = '';
            if (!partialData.authors) partialData.authors = [];
            if (!partialData.research_agenda) partialData.research_agenda = [];
            if (!partialData.children) partialData.children = [];
            
            // Also ensure the date field exists
            if (!partialData.date_published && partialData.publication_date) {
                partialData.date_published = partialData.publication_date;
            } else if (!partialData.date_published) {
                partialData.date_published = new Date().toISOString();
            }
            
            // If we know it's compiled, mark it accordingly
            if (isLikelyCompiled && !partialData.is_compiled) {
                partialData.is_compiled = true;
            }
            
            try {
                // Only fetch additional author/topic data if endpoints didn't already include them
                // and avoid making extra API calls if we're dealing with a compiled document
                // which often has specific endpoints for these
                const shouldFetchAdditional = !endpoints.some(ep => 
                    ep.includes('include_authors') || ep.includes('include_topics'));
                
                if (shouldFetchAdditional) {
                    // Try to fetch additional data separately
                    const [authors, researchAgenda] = await Promise.all([
                        // Only fetch authors if we don't already have them
                        (!partialData.authors || partialData.authors.length === 0) 
                            ? this.fetchAuthorsForDocument(partialData.id).catch(() => [])
                            : Promise.resolve(partialData.authors),
                        
                        // Only fetch research agenda if we don't already have it
                        (!partialData.research_agenda || partialData.research_agenda.length === 0) 
                            ? this.fetchResearchAgendaForDocument(partialData.id).catch(() => [])
                            : Promise.resolve(partialData.research_agenda)
                    ]);
                    
                    // Merge the data - don't override if we already have values
                    if (authors && authors.length > 0) {
                        partialData.authors = authors;
                    }
                    
                    if (researchAgenda && researchAgenda.length > 0) {
                        partialData.research_agenda = researchAgenda;
                    }
                }
                
                // Always resolve with whatever data we have - never reject
                resolve(partialData);
            } catch (error) {
                // Still resolve with partial data even if additional fetches fail
                resolve(partialData);
            }
        });
    },
    
    // Fetch authors for a document separately
    fetchAuthorsForDocument: function(documentId) {
                
        // Try multiple potential endpoints, adding compiled-specific endpoints
        const endpoints = [
            `/api/document-authors/${documentId}`,
            `/api/documents/${documentId}/authors`,
            `/document-authors/${documentId}`,
            `/api/compiled-documents/${documentId}/authors`,
            `/compiled-documents/${documentId}/authors`
        ];
        
        return new Promise(async (resolve, reject) => {
            try {
                let authors = [];
                let succeeded = false;
                
                // Try each endpoint sequentially
                for (const endpoint of endpoints) {
                    try {
                                                const response = await fetch(endpoint);
                        
                        if (response.ok) {
                            const data = await response.json();
                                                        
                            // Handle different API response formats
                            let fetchedAuthors = [];
                            if (data.authors && Array.isArray(data.authors)) {
                                fetchedAuthors = data.authors;
                                                            } else if (Array.isArray(data)) {
                                fetchedAuthors = data;
                                                            } else if (data.document_authors && Array.isArray(data.document_authors)) {
                                fetchedAuthors = data.document_authors;
                                                            } else {
                                continue;
                            }
                            
                            // Process author objects to ensure they have proper name fields
                            authors = fetchedAuthors.map(author => {
                                // If author is just a string, create basic object
                                if (typeof author === 'string') {
                                    return { id: author, full_name: author, name: author };
                                }
                                
                                // If author is just an ID without name fields
                                if (author.id && !author.full_name && !author.name && !author.first_name && !author.last_name) {
                                    // This is the problematic case - we have an ID but no name
                                    return { 
                                        ...author, 
                                        full_name: `Author ${author.id.slice(0, 8)}`,
                                        name: `Author ${author.id.slice(0, 8)}`
                                    };
                                }
                                
                                // Return full author object - ensure it has a name field
                                return {
                                    ...author,
                                    full_name: author.full_name || author.name || 
                                               [author.first_name, author.last_name].filter(Boolean).join(' ') || 
                                               `Author ${author.id.slice(0, 8)}`,
                                    name: author.name || author.full_name || 
                                          [author.first_name, author.last_name].filter(Boolean).join(' ') || 
                                          `Author ${author.id.slice(0, 8)}`
                                };
                            });
                            
                                                        succeeded = true;
                            break;
                        } else {
                        }
                    } catch (endpointError) {
                    }
                }
                
                // Skip the document extraction fallback for compiled documents
                // since this often fails with 404 errors
                const isCompiled = documentId && String(documentId).startsWith('C');
                
                // If no authors found and not a compiled doc, try one more strategy - get document and extract authors
                if (!succeeded && authors.length === 0 && !isCompiled) {
                    try {
                                                // Try both regular and compiled document endpoints
                        let docData = null;
                        
                        try {
                            const regDocResponse = await fetch(`/api/documents/${documentId}`);
                            if (regDocResponse.ok) {
                                docData = await regDocResponse.json();
                            } else {
                            }
                        } catch (regError) {
                        }
                        
                        // If regular endpoint failed, try compiled endpoint
                        if (!docData) {
                            try {
                                const compDocResponse = await fetch(`/api/compiled-documents/${documentId}`);
                                if (compDocResponse.ok) {
                                    docData = await compDocResponse.json();
                                } else {
                                }
                            } catch (compError) {
                            }
                        }
                        
                        // If we have data, extract authors
                        if (docData && docData.authors && Array.isArray(docData.authors)) {
                            // Process author objects to ensure they have proper name fields
                            authors = docData.authors.map(author => {
                                // If author is just a string, create basic object
                                if (typeof author === 'string') {
                                    return { id: author, full_name: author, name: author };
                                }
                                
                                // If author is just an ID without name fields
                                if (author.id && !author.full_name && !author.name && !author.first_name && !author.last_name) {
                                    return { 
                                        ...author, 
                                        full_name: `Author ${author.id.slice(0, 8)}`,
                                        name: `Author ${author.id.slice(0, 8)}`
                                    };
                                }
                                
                                // Return full author object
                                return {
                                    ...author,
                                    full_name: author.full_name || author.name || 
                                               [author.first_name, author.last_name].filter(Boolean).join(' ') || 
                                               `Author ${author.id.slice(0, 8)}`,
                                    name: author.name || author.full_name || 
                                          [author.first_name, author.last_name].filter(Boolean).join(' ') || 
                                          `Author ${author.id.slice(0, 8)}`
                                };
                            });
                            
                                                    }
                    } catch (docError) {
                    }
                }
                
                // If we still have no authors, create a placeholder
                if (authors.length === 0) {
                                    }
                
                resolve(authors);
            } catch (error) {
                resolve([]); // Resolve with empty array in case of error
            }
        });
    },
    
    // Fetch research agenda for a document separately
    fetchResearchAgendaForDocument: function(documentId) {
                
        // Try multiple potential endpoints
        const endpoints = [
            `/api/document-research-agenda/${documentId}`,
            `/api/documents/${documentId}/topics`,
            `/document-research-agenda/${documentId}`,
            `/api/compiled-documents/${documentId}/topics`,
            `/api/documents/${documentId}/research-agenda`
        ];
        
        return new Promise(async (resolve, reject) => {
            try {
                let topics = [];
                let succeeded = false;
                
                // Try each endpoint sequentially
                for (const endpoint of endpoints) {
                    try {
                                                const response = await fetch(endpoint);
                        
                        if (response.ok) {
                            const data = await response.json();
                                                        
                            // Handle different API response formats
                            let fetchedTopics = [];
                            if (data.topics && Array.isArray(data.topics)) {
                                fetchedTopics = data.topics;
                                                            } else if (data.research_agenda && Array.isArray(data.research_agenda)) {
                                fetchedTopics = data.research_agenda;
                                                            } else if (Array.isArray(data)) {
                                fetchedTopics = data;
                                                            } else {
                                continue;
                            }
                            
                            // Process topic objects to ensure they have proper name fields
                            topics = fetchedTopics.map(topic => {
                                // If topic is just a string, create basic object
                                if (typeof topic === 'string') {
                                    return { id: topic, name: topic, title: topic };
                                }
                                
                                // If topic is just an ID without name fields
                                if (topic.id && !topic.name && !topic.title) {
                                    return { 
                                        ...topic, 
                                        name: `Topic ${topic.id.slice(0, 8)}`,
                                        title: `Topic ${topic.id.slice(0, 8)}`
                                    };
                                }
                                
                                // Return full topic object - ensure it has a name field
                                return {
                                    ...topic,
                                    name: topic.name || topic.title || `Topic ${topic.id.slice(0, 8)}`,
                                    title: topic.title || topic.name || `Topic ${topic.id.slice(0, 8)}`
                                };
                            });
                            
                                                        succeeded = true;
                            break;
                        } else {
                        }
                    } catch (endpointError) {
                    }
                }
                
                // If no topics found, try one more strategy - get document and extract topics
                if (!succeeded && topics.length === 0) {
                    try {
                                                const docResponse = await fetch(`/api/documents/${documentId}`);
                        if (docResponse.ok) {
                            const docData = await docResponse.json();
                            
                            let fetchedTopics = [];
                            if (docData.research_agenda && Array.isArray(docData.research_agenda)) {
                                fetchedTopics = docData.research_agenda;
                                                            } else if (docData.topics && Array.isArray(docData.topics)) {
                                fetchedTopics = docData.topics;
                                                            }
                            
                            // Process topic objects to ensure they have proper name fields
                            topics = fetchedTopics.map(topic => {
                                // If topic is just a string, create basic object
                                if (typeof topic === 'string') {
                                    return { id: topic, name: topic, title: topic };
                                }
                                
                                // If topic is just an ID without name fields
                                if (topic.id && !topic.name && !topic.title) {
                                    return { 
                                        ...topic, 
                                        name: `Topic ${topic.id.slice(0, 8)}`,
                                        title: `Topic ${topic.id.slice(0, 8)}`
                                    };
                                }
                                
                                // Return full topic object
                                return {
                                    ...topic,
                                    name: topic.name || topic.title || `Topic ${topic.id.slice(0, 8)}`,
                                    title: topic.title || topic.name || `Topic ${topic.id.slice(0, 8)}`
                                };
                            });
                        }
                    } catch (docError) {
                    }
                }
                
                // If we still have no topics, return empty array
                if (topics.length === 0) {
                                    }
                
                resolve(topics);
            } catch (error) {
                resolve([]); // Resolve with empty array in case of error
            }
        });
    },
    
    // Populate the edit form with document data
    populateEditForm: function(data) {
                
        // Set ID field
        document.getElementById('edit-single-document-id').value = data.id;
        
        // Set basic fields
        document.getElementById('edit-single-document-title').value = data.title || '';
        
        // Set document type dropdown
        const typeSelect = document.getElementById('edit-single-document-type');
        if (typeSelect) {
            // Try to find matching option
            const documentType = data.document_type || data.type || data.category || '';
            
            for (let i = 0; i < typeSelect.options.length; i++) {
                if (typeSelect.options[i].value.toUpperCase() === documentType.toUpperCase()) {
                    typeSelect.selectedIndex = i;
                    break;
                }
            }
        }
        
        // Set date field - handle both date_published and publication_date formats
        const dateField = document.getElementById('edit-single-document-date');
        if (dateField) {
            const dateValue = data.date_published || data.publication_date;
            if (dateValue) {
                try {
                    // Format date as YYYY-MM-DD for input[type=date]
                    const date = new Date(dateValue);
                    const formattedDate = date.toISOString().split('T')[0];
                    dateField.value = formattedDate;
                } catch (error) {
                }
            }
        }
        
        // Add styles for file handling
        const style = document.createElement('style');
        style.textContent += `
            .no-modal-close {
                pointer-events: auto !important;
                position: relative !important;
                z-index: 10000 !important;
            }
            
            .current-file {
                position: relative;
                z-index: 1;
            }
            
            #edit-single-document-file-current {
                pointer-events: auto !important;
            }
            
            .modal-content {
                pointer-events: auto !important;
            }
        `;
        document.head.appendChild(style);
        
        // Populate authors
        this.populateAuthorsContainer(data.authors || []);
        
        // Populate research agenda/topics
        this.populateResearchAgendaContainer(data.research_agenda || data.topics || []);
        
        // Update the preview section
        this.updateDocumentPreview(data);
    },
    
    // Populate authors container
    populateAuthorsContainer: function(authors) {
        const selectedAuthorsContainer = document.getElementById('edit-single-document-selected-authors');
        if (!selectedAuthorsContainer) {
            return;
        }
        
        // Clear existing content
        selectedAuthorsContainer.innerHTML = '';
        
        // Populate with author items
        if (authors && Array.isArray(authors) && authors.length > 0) {
                        
            authors.forEach(author => {
                // Skip if author is null or undefined
                if (!author) return;
                
                // Handle different formats of author items
                let authorId = 'unknown';
                let authorName = '';
                
                if (typeof author === 'string') {
                    authorName = author;
                } else if (author.id) {
                    authorId = author.id;
                    
                    if (author.full_name) {
                        authorName = author.full_name;
                    } else if (author.name) {
                        authorName = author.name;
                    } else if (author.first_name || author.last_name) {
                        authorName = [author.first_name, author.last_name].filter(Boolean).join(' ');
                    }
                }
                
                if (!authorName) {
                    return;
                }
                
                const authorElement = document.createElement('div');
                authorElement.className = 'selected-author';
                authorElement.dataset.id = authorId;
                    
                    // Only display the name, not the ID
                authorElement.innerHTML = `
                    ${authorName}
                        <span class="remove-author">&times;</span>
                `;
                
                // Add to container
                selectedAuthorsContainer.appendChild(authorElement);
                
                // Add click handler to remove button
                const removeBtn = authorElement.querySelector('.remove-author');
                if (removeBtn) {
                    removeBtn.addEventListener('click', () => {
                        authorElement.remove();
                    });
                }
            });
        } else {
        }
    },
    
    // Update document preview
    updateDocumentPreview: function(data) {
                
        // Update title
        const titleElement = document.getElementById('edit-single-document-preview-title');
        if (titleElement) {
            titleElement.textContent = data.title || 'Untitled Document';
        }
        
        // Update type
        const typeElement = document.getElementById('edit-single-document-preview-type');
        if (typeElement) {
            typeElement.textContent = data.document_type || data.type || data.category || 'Unknown Type';
        }
        
        // Update date
        const dateElement = document.getElementById('edit-single-document-preview-date');
        if (dateElement) {
            const dateValue = data.date_published || data.publication_date;
            const formattedDate = dateValue ? new Date(dateValue).toLocaleDateString() : '-';
            dateElement.textContent = formattedDate;
        }
        
        // Update authors
        const authorsElement = document.getElementById('edit-single-document-preview-authors');
        if (authorsElement) {
            const authors = data.authors || [];
            
            if (authors.length > 0) {
                const authorNames = authors.map(author => {
                    if (typeof author === 'string') return author;
                    return author.full_name || author.name || [author.first_name, author.last_name].filter(Boolean).join(' ') || 'Unknown Author';
                });
                
                authorsElement.textContent = authorNames.join(', ');
            } else {
                authorsElement.textContent = 'No authors';
            }
        }
        
        // Update abstract
        const abstractElement = document.getElementById('edit-single-document-preview-abstract');
        if (abstractElement) {
            abstractElement.textContent = data.abstract || 'No abstract available';
        }
        
        // Update keywords/topics
        const topicsElement = document.getElementById('edit-single-document-preview-topics');
        if (topicsElement) {
            let topicsText = '-';
            if (data.topics && Array.isArray(data.topics) && data.topics.length > 0) {
                topicsText = data.topics
                    .map(topic => typeof topic === 'string' ? topic : (topic.name || topic.title || ''))
                    .filter(name => name)
                    .join(', ');
            } else if (data.keywords && Array.isArray(data.keywords) && data.keywords.length > 0) {
                topicsText = data.keywords
                    .map(keyword => typeof keyword === 'string' ? keyword : (keyword.name || keyword.title || ''))
                    .filter(name => name)
                    .join(', ');
            }
            topicsElement.textContent = topicsText;
        }
        
        // Set document type icon if available
        const typeIcon = document.getElementById('edit-single-document-type-icon');
        if (typeIcon) {
            typeIcon.dataset.category = data.document_type || data.category || '';
            
            // Add background color to the icon container
            const iconContainer = document.getElementById('edit-single-document-preview-icon');
            if (iconContainer) {
                iconContainer.style.backgroundColor = '#006A4E';
            }
        }
    },
    
    // Helper function to populate keywords container
    populateResearchAgendaContainer: function(researchAgenda) {
        const selectedTopicsContainer = document.getElementById('edit-single-document-selected-topics');
        if (!selectedTopicsContainer) {
            return;
        }
        
        // Clear existing content
        selectedTopicsContainer.innerHTML = '';
        
        // Populate with research agenda items
        if (researchAgenda && Array.isArray(researchAgenda) && researchAgenda.length > 0) {
                        researchAgenda.forEach(item => {
                // Skip if item is null or undefined
                if (!item) return;
                
                // Handle different formats of research agenda items
                let itemId = 'unknown';
                let itemName = '';
                
                if (typeof item === 'string') {
                    itemName = item;
                } else if (item.id && item.name) {
                    itemId = item.id;
                    itemName = item.name;
                } else if (item.id && item.title) {
                    itemId = item.id;
                    itemName = item.title;
                } else if (item.name) {
                    itemId = 'unknown';
                    itemName = item.name;
                } else if (item.title) {
                    itemId = 'unknown';
                    itemName = item.title;
                }
                
                if (!itemName) {
                    return;
                }
                
                const topicElement = document.createElement('div');
                topicElement.className = 'selected-topic';
                topicElement.dataset.id = itemId;
                
                // Only display the name, not the ID
                topicElement.innerHTML = `
                    ${itemName}
                    <span class="remove-topic">&times;</span>
                `;
                
                // Add to container
                selectedTopicsContainer.appendChild(topicElement);
                
                // Add click handler to remove button
                const removeBtn = topicElement.querySelector('.remove-topic');
                if (removeBtn) {
                    removeBtn.addEventListener('click', () => {
                        topicElement.remove();
                    });
                }
            });
        } else {
        }
    },
    
    // Populate the compiled document edit form
    populateCompiledEditForm: function(data) {
                
        try {
            // Find the form fields
            const titleField = document.getElementById('edit-compiled-document-title');
            const startYearField = document.getElementById('edit-compiled-pub-year-start');
            const endYearField = document.getElementById('edit-compiled-pub-year-end');
            const volumeField = document.getElementById('edit-compiled-volume');
            const categoryField = document.getElementById('edit-compiled-category');
            const issuedNoField = document.getElementById('edit-compiled-issued-no');
            const departmentalField = document.getElementById('edit-compiled-departmental');
            
            // Log field existence for debugging
            console.log('Form field status:', {
                titleField: !!titleField,
                startYearField: !!startYearField,
                endYearField: !!endYearField,
                volumeField: !!volumeField,
                categoryField: !!categoryField,
                issuedNoField: !!issuedNoField,
                departmentalField: !!departmentalField
            });
            
            // Set field values directly with null checks
            if (titleField) {
                                titleField.value = data.title || '';
            } else {
            }
            
            if (startYearField) {
                                startYearField.value = data.start_year || '';
            } else {
            }
            
            if (endYearField) {
                                endYearField.value = data.end_year || '';
            } else {
            }
            
            if (volumeField) {
                                volumeField.value = data.volume || '';
            } else {
            }
            
            // For category, need to find the matching option
            if (categoryField && data.category) {
                                // Find matching option, case insensitive
                const options = Array.from(categoryField.options);
                const matchingOption = options.find(opt => 
                    opt.value.toLowerCase() === data.category.toLowerCase() ||
                    opt.text.toLowerCase() === data.category.toLowerCase()
                );
                
                if (matchingOption) {
                    categoryField.value = matchingOption.value;
                    // Trigger change event
                                        const event = new Event('change', { bubbles: true });
                    categoryField.dispatchEvent(event);
                } else {
                                    }
                
                // Add category change handler to toggle fields
                categoryField.addEventListener('change', (e) => {
                    const selectedCategory = e.target.value;
                    this.handleCategoryChange(selectedCategory);
                });
            } else {
            }
            
            // Set issue or department after a delay for the category change to take effect
            setTimeout(() => {
                // Set issue number or department based on category
                if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                    if (departmentalField) {
                                                departmentalField.value = data.department || '';
                        
                        // Ensure departmental field is a dropdown and populated
                        this.ensureDepartmentalDropdown(departmentalField);
                    } else {
                    }
                } else {
                    if (issuedNoField) {
                                                issuedNoField.value = data.issue_number || '';
                    } else {
                    }
                }
                
                // Update preview fields
                if (typeof this.updatePreviewFields === 'function') {
                                        this.updatePreviewFields();
                } else {
                }
                
                            }, 200);
            
            // Update preview area with document data
            this.updateCompiledDocumentPreview(data);
            
            // Store data in cache
            if (!this.documentCache) {
                this.documentCache = {};
            }
            this.documentCache[data.id] = data;
            
            // Listen for DOM mutations to detect if fields are cleared
            this.monitorFormFields(data);
        } catch (error) {
        }
    },
    
    // Monitor form fields for changes that might clear them
    monitorFormFields: function(data) {
        // Get form fields
        const titleField = document.getElementById('edit-compiled-document-title');
        if (!titleField) return;
        
        // Set up a monitoring interval
        const intervalId = setInterval(() => {
            // Check if title field is empty but should have a value
            if (titleField && !titleField.value && data.title) {
                                this.populateCompiledEditForm(data);
            }
            
            // Check if modal is still visible
            const modal = document.getElementById('edit-compiled-document-modal');
            if (!modal || modal.style.display === 'none') {
                // Modal closed, stop monitoring
                clearInterval(intervalId);
            }
        }, 1000);
        
        // Clear interval after 30 seconds to prevent memory leaks
        setTimeout(() => clearInterval(intervalId), 30000);
    },
    
    // Load and display child documents in the compiled document edit form
    loadChildDocuments: function(parentId, children = [], container = null) {
        // ... existing code ...
    },
    
    // Update the child documents preview in the right panel
    updateChildDocumentsPreview: function(children = [], container = null) {
        // ... existing code ...
    },
    
    // Update the compiled document edit preview section
    updateCompiledEditPreview: function(data) {
        // ... existing code ...
    },
    
    // Remove a child document from the compilation
    removeChildDocument: function(childId) {
        // ... existing code ...
    },
    
    // Show the child document selection modal
    showChildDocumentSelector: function() {
        // ... existing code ...
    },
    
    // Load available documents for selection
    loadAvailableDocuments: function() {
        // ... existing code ...
    },
    
    // Render available documents for selection
    renderAvailableDocuments: function(documents) {
        // ... existing code ...
    },
    
    // Search available documents
    searchAvailableDocuments: function(query) {
        // ... existing code ...
    },
    
    // Add a child document to the compilation
    addChildDocument: function(childId) {
        // ... existing code ...
    },
    
    // Get the currently selected child documents
    getSelectedChildDocuments: function() {
        // ... existing code ...
    },
    
    // Show PDF viewer
    showPdfViewer: function(documentId) {
        if (!documentId) {
            return;
        }
        
                
        // Fetch the document to get the file path
        fetch(`/api/documents/${documentId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error fetching document: ${response.status}`);
                }
                return response.json();
            })
            .then(document => {
                if (document && document.file_path) {
                    const pdfPath = `${window.location.origin}/api/documents/${encodeURIComponent(document.id || documentId)}/download?disposition=inline`;
                    window.open(pdfPath, '_blank');
                } else {
                    alert('Document file not found.');
                }
            })
            .catch(error => {
                alert(`Error opening document: ${error.message}`);
            });
    },
    
    // Show success message
    showSaveSuccess: function() {
        // Show success toast
        showToast('Document saved successfully!', 'success');
        
        // Get the modal element
        const modal = document.getElementById('edit-single-document-modal');
        
        // Ensure the modal exists before trying to close it
        if (modal) {
            // First set display to none
            modal.style.display = 'none';
            
            // Then clear any form data
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
            }
            
            // Clear any selected items
            const selectedAuthors = modal.querySelector('.selected-authors');
            if (selectedAuthors) {
                selectedAuthors.innerHTML = '';
            }
            
            const selectedTopics = modal.querySelector('.selected-topics');
            if (selectedTopics) {
                selectedTopics.innerHTML = '';
            }
            
            // Clear file input if it exists
            const fileInput = modal.querySelector('input[type="file"]');
            if (fileInput) {
                fileInput.value = '';
            }
            
            // Clear file indicator if it exists
            const fileIndicator = modal.querySelector('.file-indicator');
            if (fileIndicator) {
                fileIndicator.textContent = '';
            }
        }
        
        // If we're on a page with a document list, refresh it
        if (typeof window.documentList !== 'undefined' && typeof window.documentList.refreshDocumentList === 'function') {
            window.documentList.refreshDocumentList();
        }
    },
    
    // Show error message
    showSaveError: function(error) {
        // ... existing code ...
    },
    
    // Hide modal by ID
    hideModal: function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
                        modal.style.display = 'none';
            
            // Clear form data if it exists
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
            }
            
            // Clear any selected items
            const selectedAuthors = modal.querySelector('.selected-authors');
            if (selectedAuthors) {
                selectedAuthors.innerHTML = '';
            }
            
            const selectedTopics = modal.querySelector('.selected-topics');
            if (selectedTopics) {
                selectedTopics.innerHTML = '';
            }
            
            // Clear file input if it exists
            const fileInput = modal.querySelector('input[type="file"]');
            if (fileInput) {
                fileInput.value = '';
            }
            
            // Clear file indicator if it exists
            const fileIndicator = modal.querySelector('.file-indicator');
            if (fileIndicator) {
                fileIndicator.textContent = '';
            }
        } else {
        }
    },
    
    // Save changes to a document
    saveDocument: async function(formData) {
        try {
            const documentId = formData.get('document_id');
            if (!documentId) {
                throw new Error('Document ID is required');
            }

                        
            // Show loading state
            const submitButton = document.querySelector('#edit-single-document-form button[type="submit"]');
            if (submitButton) {
                const originalButtonText = submitButton.innerHTML;
                submitButton.disabled = true;
                submitButton.innerHTML = '<span class="inline-block animate-spin mr-2">↻</span> Saving...';
            }

            // Step 1: Prepare document data
            const documentData = {
                id: documentId,
                title: formData.get('title'),
                document_type: formData.get('document_type'),
                publication_date: formData.get('date_published'),
                category_id: formData.get('category_id') || null
            };

            // We don't need to handle file uploads since the feature was removed
            // We'll keep the existing file path from the document record
            
            // Step 2: Collect author IDs
            const selectedAuthors = document.getElementById('edit-single-document-selected-authors');
            const authorIds = [];
            if (selectedAuthors) {
                const authorElements = selectedAuthors.querySelectorAll('.selected-author');
                authorElements.forEach(authorElement => {
                    if (authorElement.dataset.id) {
                        authorIds.push(authorElement.dataset.id);
                    }
                });
            }
                    
            // Step 3: Collect topic IDs
            const selectedTopics = document.getElementById('edit-single-document-selected-topics');
            const topicIds = [];
            if (selectedTopics) {
                const topicElements = selectedTopics.querySelectorAll('.selected-topic');
                topicElements.forEach(topicElement => {
                    if (topicElement.dataset.id) {
                        topicIds.push(topicElement.dataset.id);
                    }
                });
            }
                    
            // Step 4: Save document with all data
                        const requestData = {
                document: documentData,
                authorIds: authorIds,
                topicIds: topicIds
            };

            // Try multiple save endpoints
            const saveEndpoints = [
                `/api/document-edit/${documentId}`,
                `/api/documents/${documentId}`,
                `/documents/${documentId}`
            ];

            let saveSuccess = false;
            let saveError = null;

            for (const endpoint of saveEndpoints) {
                try {
                                        const saveResponse = await fetch(endpoint, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestData)
                    });

                    if (saveResponse.ok) {
                        const saveResult = await saveResponse.json();
                                                saveSuccess = true;
                        break;
                    } else {
                        const errorData = await saveResponse.json().catch(() => ({ error: 'Unknown error' }));
                        saveError = new Error(errorData.error || `Failed to save document: ${saveResponse.status}`);
                    }
                } catch (endpointError) {
                    saveError = endpointError;
                }
            }

            if (!saveSuccess) {
                throw saveError || new Error('Failed to save document to any endpoint');
            }

            // Show success message and clean up
            this.showSaveSuccess();
            
            // Restore save button
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Save Changes';
            }
            
        } catch (error) {
            this.showSaveError(error);
            
            // Restore save button
            const submitButton = document.querySelector('#edit-single-document-form button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Save Changes';
            }
        }
    },
    
    // Save changes to a compiled document
    saveCompiledDocument: async function(formData) {
        try {
            const documentId = formData.get('document_id');
            if (!documentId) {
                throw new Error('Compiled document ID is required');
            }

                        
            // Show loading state
            const submitButton = document.querySelector('#edit-compiled-document-form button[type="submit"]');
            let originalButtonText = 'Save Changes'; // Default value
            
            if (submitButton) {
                originalButtonText = submitButton.innerHTML; // Save the original text
                submitButton.disabled = true;
                submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
            }

            // Extract data from form fields and map to correct API parameters
            const startYear = document.getElementById('edit-compiled-pub-year-start');
            const endYear = document.getElementById('edit-compiled-pub-year-end');
            const departmentalField = document.getElementById('edit-compiled-departmental');
            
            // Step 1: Convert FormData to a clean object for JSON endpoints
            const jsonData = {};
            
            // Copy all formData entries to the jsonData object
            for (const [key, value] of formData.entries()) {
                // Try parsing JSON strings for arrays/objects
                try {
                    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                        jsonData[key] = JSON.parse(value);
                    } else {
                        jsonData[key] = value;
                    }
                } catch (e) {
                    jsonData[key] = value;
                }
            }
            
            // Add explicit mappings for start_year, end_year, and department fields
            if (startYear && startYear.value) {
                jsonData.start_year = parseInt(startYear.value, 10) || null;
                formData.set('start_year', startYear.value);
            }
            
            if (endYear && endYear.value) {
                jsonData.end_year = parseInt(endYear.value, 10) || null;
                formData.set('end_year', endYear.value);
            }
            
            if (departmentalField && departmentalField.value) {
                jsonData.department = departmentalField.value;
                formData.set('department', departmentalField.value);
            }
            
            // Include the category field for proper document type handling
            const categoryField = document.getElementById('edit-compiled-category');
            if (categoryField && categoryField.value) {
                jsonData.category = categoryField.value;
                formData.set('category', categoryField.value);
            }
            
            // Add explicit mapping for issue_number field (from issued-no input)
            const issuedNoField = document.getElementById('edit-compiled-issued-no');
            if (issuedNoField && issuedNoField.value) {
                jsonData.issue_number = issuedNoField.value;
                formData.set('issue_number', issuedNoField.value);
            }
            
                        
            // Step 2: Send the update to the server
            const endpoints = [
                {
                    url: `/api/compiled-documents/${documentId}`,
                    contentType: 'multipart/form-data',
                    body: formData
                },
                {
                    url: `/api/documents/${documentId}?is_compiled=true`,
                    contentType: 'application/json',
                    body: JSON.stringify(jsonData)
                },
                {
                    url: `/api/documents/${documentId}`,
                    contentType: 'application/json',
                    body: JSON.stringify(jsonData)
                }
            ];
            
            let updateSuccess = false;
            let serverResponse = null;
            
            for (const endpoint of endpoints) {
                try {
                                        
                    const fetchOptions = {
                        method: 'PUT'
                    };
                    
                    // Set the proper body and headers based on content type
                    if (endpoint.contentType === 'application/json') {
                        fetchOptions.headers = {
                            'Content-Type': 'application/json'
                        };
                        fetchOptions.body = endpoint.body;
                    } else {
                        // For FormData, don't set Content-Type header (browser will set it with boundary)
                        fetchOptions.body = endpoint.body;
                    }
                    
                    const updateResponse = await fetch(endpoint.url, fetchOptions);
                    
                    if (updateResponse.ok) {
                        serverResponse = await updateResponse.json();
                                                updateSuccess = true;
                        break;
                    } else {
                    }
                } catch (updateError) {
                }
            }
            
            if (!updateSuccess) {
                throw new Error('Failed to update document on any endpoint');
            }
            
            // Step 3: Show success message and clean up
            showToast('Compiled document saved successfully!', 'success');
            
            // Hide the modal
            const modal = document.getElementById('edit-compiled-document-modal');
            if (modal) {
                modal.style.display = 'none';
            }
            
            // Reset form state
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
            }
            
            // If we have a document list on the page, refresh it
            if (window.documentList && typeof window.documentList.refreshDocumentList === 'function') {
                window.documentList.refreshDocumentList();
            }
            
            // Also try to refresh the compiled document list if it exists
            if (window.compiledDocumentList && typeof window.compiledDocumentList.refreshDocumentList === 'function') {
                window.compiledDocumentList.refreshDocumentList();
            }
            
            return serverResponse;
        } catch (error) {
            // Show error message
            showToast(`Error saving document: ${error.message}`, 'error');
            
            // Reset form state
            const submitButton = document.querySelector('#edit-compiled-document-form button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = 'Save Changes';
            }
            
            throw error;
        }
    },
    
    // Helper function to try creating a new author via API
    createNewAuthor: async function(name) {
                
        // First check if author already exists to prevent duplicates
        try {
                        const searchEndpoints = [
                `/api/authors/search?q=${encodeURIComponent(name)}`,
                `/api/authors?search=${encodeURIComponent(name)}`,
                `/api/authors?q=${encodeURIComponent(name)}`,
                `/authors/search?q=${encodeURIComponent(name)}`
            ];
            
            for (const endpoint of searchEndpoints) {
            try {
                    const response = await fetch(endpoint);
                    if (response.ok) {
                        const data = await response.json();
                                                
                        // Extract authors depending on response format
                        let authors = [];
                        if (data.authors && Array.isArray(data.authors)) {
                            authors = data.authors;
                        } else if (Array.isArray(data)) {
                            authors = data;
                        } else if (data.results && Array.isArray(data.results)) {
                            authors = data.results;
                        }
                        
                        // Check for exact name match
                        const exactMatch = authors.find(author => 
                            author.full_name?.toLowerCase() === name.toLowerCase() ||
                            author.name?.toLowerCase() === name.toLowerCase()
                        );
                        
                        if (exactMatch) {
                                                        return exactMatch;
                        }
                    }
                } catch (err) {
                }
            }
            } catch (error) {
        }
        
        // If we get here, the author doesn't exist yet or couldn't be found
        // Try different endpoints for creating authors
        const endpoints = [
            '/api/authors',
            '/authors'
        ];
        
        // Parse name into components (simple logic)
        let firstName = '';
        let lastName = '';
        
        const nameParts = name.trim().split(' ');
        if (nameParts.length > 1) {
            lastName = nameParts.pop();
            firstName = nameParts.join(' ');
        } else {
            // If only one word, assume it's the last name
            lastName = name.trim();
        }
        
        // Ensure we send ALL possible name fields to avoid API confusion
        const authorData = {
            name: name.trim(),
            full_name: name.trim(),
            first_name: firstName,
            last_name: lastName,
            // Don't send ID to avoid creating with an ID that's not from database
            spud_id: null
        };
        
                
        // Try each endpoint
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(authorData)
                });
                
                if (response.ok) {
                    const result = await response.json();
                                        
                    // Handle different API response formats
                    if (result.id || result.author_id) {
                        return {
                            id: result.id || result.author_id,
                            full_name: name,
                            name: name
                        };
                    } else if (result.author && result.author.id) {
                        return result.author;
                    }
                    
                    return result;
                } else {
                    try {
                        const errorText = await response.text();
                    } catch(e) {
                        // Ignore error text read failures
                    }
                }
            } catch (error) {
            }
        }
        
        // If we didn't create via API, return a basic object with a flag for frontend handling
        return {
            id: 'temp_' + Date.now(),
            name: name,
            full_name: name,
            is_temporary: true
        };
    },
    
    // A dummy function for the fallback implementation
    dummyAuthorSearchInit: function(inputElement) {
            },
    
    // Select an author and add to the selected list
    selectAuthor: function(authorId, authorName, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
                
        // Check if author already selected
        const existingAuthor = container.querySelector(`.selected-author[data-id="${authorId}"]`);
        if (existingAuthor) {
                        return;
        }
        
        // Create author element - without showing the ID
        const authorElement = document.createElement('div');
        authorElement.className = 'selected-author';
        authorElement.dataset.id = authorId;
        
        // Only display the name, not the ID
        authorElement.innerHTML = `
            ${authorName}
            <span class="remove-author">&times;</span>
        `;
        
        // Add to container
        container.appendChild(authorElement);
                
        // Add click handler to remove button
        const removeBtn = authorElement.querySelector('.remove-author');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                authorElement.remove();
            });
        }
    },
    
    // Initialize Author Search
    initializeAuthorSearch: function(inputElement, selectedContainerId) {
        if (!inputElement) return;
        
                
        // Create author dropdown container
        const dropdownId = `${inputElement.id}-dropdown`;
        
        // First remove any existing dropdown to avoid duplicates
        const existingDropdown = document.getElementById(dropdownId);
        if (existingDropdown) {
            existingDropdown.remove();
        }
        
        // Create new dropdown element with absolute positioning
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.position = 'relative';
        dropdownContainer.style.width = '100%';
        
        const dropdown = document.createElement('div');
        dropdown.id = dropdownId;
        dropdown.className = 'dropdown-list';
        dropdown.style.display = 'none';
        dropdownContainer.appendChild(dropdown);
        
        // Insert the dropdown container after the input element
        const parent = inputElement.parentNode;
        if (parent.nextSibling) {
            parent.parentNode.insertBefore(dropdownContainer, parent.nextSibling);
        } else {
            parent.parentNode.appendChild(dropdownContainer);
        }
        
                
        // Debounce function for search delay
        const debounce = (func, delay) => {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), delay);
            };
        };
        
        // Search authors as user types
        const searchAuthors = debounce(async (query) => {
            if (query.length < 2) {
                dropdown.innerHTML = '';
                dropdown.style.display = 'none';
                return;
            }
            
            // Show loading indicator
            dropdown.innerHTML = '<div class="dropdown-item loading"><i class="fas fa-spinner fa-spin"></i> Searching authors...</div>';
            dropdown.style.display = 'block';
            
            try {
                                
                // Try multiple potential author search endpoints
                const endpoints = [
                    `/api/authors/search?q=${encodeURIComponent(query)}`,
                    `/api/authors?search=${encodeURIComponent(query)}`,
                    `/api/authors?q=${encodeURIComponent(query)}`,
                    `/authors/search?q=${encodeURIComponent(query)}`,
                    `/authors?search=${encodeURIComponent(query)}`
                ];
                
                let authors = [];
                let lastError = null;
                
                // Try each endpoint until we get results
                for (const endpoint of endpoints) {
                    try {
                                                const response = await fetch(endpoint);
                        
                        if (response.ok) {
                            const data = await response.json();
                                                        
                            // Handle different response formats
                            if (data.authors && Array.isArray(data.authors)) {
                                authors = data.authors;
                                                                break;
                            } else if (Array.isArray(data)) {
                                authors = data;
                                                                break;
                            } else if (data.results && Array.isArray(data.results)) {
                                authors = data.results;
                                                                break;
                            } else {
                            }
                        } else {
                            lastError = new Error(`Failed to fetch authors: ${response.status}`);
                        }
                    } catch (error) {
                        lastError = error;
                    }
                }
                
                // If no authors found, try getting all authors and filtering
                if (authors.length === 0) {
                                        try {
                        const allAuthorsResponse = await fetch('/api/authors');
                        if (allAuthorsResponse.ok) {
                            const allAuthorsData = await allAuthorsResponse.json();
                                                        
                            // Handle different response formats for all authors
                            let allAuthors = [];
                            if (allAuthorsData.authors && Array.isArray(allAuthorsData.authors)) {
                                allAuthors = allAuthorsData.authors;
                            } else if (Array.isArray(allAuthorsData)) {
                                allAuthors = allAuthorsData;
                            }
                            
                            // Filter authors by the search query
                                const lowerQuery = query.toLowerCase();
                            authors = allAuthors.filter(author => {
                                    const fullName = (author.full_name || '').toLowerCase();
                                    const firstName = (author.first_name || '').toLowerCase();
                                    const lastName = (author.last_name || '').toLowerCase();
                                const name = (author.name || '').toLowerCase();
                                    
                                    return fullName.includes(lowerQuery) || 
                                           firstName.includes(lowerQuery) ||
                                           lastName.includes(lowerQuery) ||
                                       name.includes(lowerQuery);
                                });
                            
                                                    }
                    } catch (error) {
                    }
                }
                
                // Update dropdown with results
                dropdown.innerHTML = '';
                
                if (authors.length === 0) {
                    dropdown.innerHTML = '<div class="dropdown-item no-results">No authors found</div>';
                    
                    // Add option to create new author if query is long enough
                    if (query.length >= 3) {
                        const createItem = document.createElement('div');
                        createItem.className = 'dropdown-item create-new';
                        createItem.innerHTML = `<div class="item-name"><i class="fas fa-plus"></i> Create "${query}"</div>`;
                        
                        createItem.addEventListener('click', async () => {
                            try {
                                const newAuthor = await this.createNewAuthor(query);
                                if (newAuthor && newAuthor.id) {
                                    this.selectAuthor(newAuthor.id, newAuthor.full_name || newAuthor.name || query, selectedContainerId);
                                } else {
                            this.selectAuthor('new', query, selectedContainerId);
                                }
                            } catch (error) {
                                this.selectAuthor('new', query, selectedContainerId);
                            }
                            
                            dropdown.style.display = 'none';
                            inputElement.value = '';
                        });
                        
                        dropdown.appendChild(createItem);
                    }
                } else {
                    // Add authors to dropdown
                    authors.forEach(author => {
                        const item = document.createElement('div');
                        item.className = 'dropdown-item';
                        item.dataset.id = author.id;
                        item.dataset.name = author.full_name || author.name;
                        
                        // Format with name and affiliation if available
                        let authorDisplay = `<div class="item-name">${author.full_name || author.name}</div>`;
                        if (author.affiliation) {
                            authorDisplay += `<div class="item-detail">${author.affiliation}</div>`;
                        }
                        if (author.spud_id) {
                            authorDisplay += `<div class="item-detail-small">ID: ${author.spud_id}</div>`;
                        }
                        
                        item.innerHTML = authorDisplay;
                        
                        // Add click handler to select the author
                        item.addEventListener('click', () => {
                            this.selectAuthor(author.id, author.full_name || author.name, selectedContainerId);
                            dropdown.style.display = 'none';
                            inputElement.value = '';
                        });
                        
                        dropdown.appendChild(item);
                    });
                }
                
                // Position dropdown directly under the input field
                dropdown.style.display = 'block';
            } catch (error) {
                dropdown.innerHTML = '<div class="dropdown-item error">Error searching authors</div>';
            }
        }, 300);
        
        // Add input event listener
        inputElement.addEventListener('input', (e) => {
            searchAuthors(e.target.value);
        });
        
        // Handle focus to reshow dropdown if there's a value
        inputElement.addEventListener('focus', () => {
            if (inputElement.value.length >= 2) {
                searchAuthors(inputElement.value);
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    },
    
    // Initialize Research Agenda Search
    initializeResearchAgendaSearch: function(inputElement, selectedContainerId) {
        if (!inputElement) return;
        
                
        // Create dropdown container
        const dropdownId = `${inputElement.id}-dropdown`;
        
        // First remove any existing dropdown to avoid duplicates
        const existingDropdown = document.getElementById(dropdownId);
        if (existingDropdown) {
            existingDropdown.remove();
        }
        
        // Create new dropdown element with absolute positioning
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.position = 'relative';
        dropdownContainer.style.width = '100%';
        
        const dropdown = document.createElement('div');
        dropdown.id = dropdownId;
        dropdown.className = 'dropdown-list';
        dropdown.style.display = 'none';
        dropdownContainer.appendChild(dropdown);
        
        // Insert the dropdown container after the input element
        const parent = inputElement.parentNode;
        if (parent.nextSibling) {
            parent.parentNode.insertBefore(dropdownContainer, parent.nextSibling);
        } else {
            parent.parentNode.appendChild(dropdownContainer);
        }
        
                
        // Debounce function for search delay
        const debounce = (func, delay) => {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), delay);
            };
        };
        
        // Search research agenda items as user types
        const searchAgendaItems = debounce(async (query) => {
            if (query.length < 2) {
                dropdown.innerHTML = '';
                dropdown.style.display = 'none';
                return;
            }
            
            // Show loading indicator
            dropdown.innerHTML = '<div class="dropdown-item loading"><i class="fas fa-spinner fa-spin"></i> Searching research agenda items...</div>';
            dropdown.style.display = 'block';
            
            try {
                // Try multiple potential research agenda endpoints
                let items = [];
                let response;
                
                // Define all potential endpoints to try
                let endpoints = [
                    `/research-agenda-items/search?q=${encodeURIComponent(query)}`,
                    `/api/research-agenda-items/search?q=${encodeURIComponent(query)}`,
                    `/document-research-agenda/search?q=${encodeURIComponent(query)}`,
                    `/api/topics/search?q=${encodeURIComponent(query)}`
                ];
                
                // Try each endpoint until one works
                for (const endpoint of endpoints) {
                    try {
                                                response = await fetch(endpoint);
                        
                        if (response.ok) {
                            const data = await response.json();
                                                        
                            // Format the data based on response structure
                            if (data.items) {
                                items = data.items;
                            } else if (Array.isArray(data)) {
                                items = data;
                            } else if (data.agendaItems) {
                                items = data.agendaItems;
                            } else if (data.topics) {
                                items = data.topics;
                            }
                            
                            if (items.length > 0) {
                                break; // We found results, stop trying endpoints
                            } else {
                                                            }
                        } else {
                        }
                    } catch (err) {
                    }
                }
                
                // If no search endpoints worked or returned results, try getting all research agenda items
                if (items.length === 0) {
                                        try {
                        // Try the all research agenda items endpoint with multiple paths
                        const allEndpoints = [
                            '/research-agenda-items/all',
                            '/research-agenda-items',
                            '/api/research-agenda-items',
                            '/api/topics'
                        ];
                        
                        for (const allEndpoint of allEndpoints) {
                            try {
                                const allItemsResponse = await fetch(allEndpoint);
                        
                        if (allItemsResponse.ok) {
                            const allItemsData = await allItemsResponse.json();
                                                                
                                    // Handle different response structures
                                    let allItems = [];
                            if (allItemsData.items && Array.isArray(allItemsData.items)) {
                                        allItems = allItemsData.items;
                            } else if (Array.isArray(allItemsData)) {
                                        allItems = allItemsData;
                                    } else if (allItemsData.topics && Array.isArray(allItemsData.topics)) {
                                        allItems = allItemsData.topics;
                                    }
                                    
                                    if (allItems.length > 0) {
                                        // Filter items by the search query manually
                                const lowerQuery = query.toLowerCase();
                                        items = allItems.filter(item => {
                                    const name = (item.name || '').toLowerCase();
                                            const title = (item.title || '').toLowerCase();
                                    const description = (item.description || '').toLowerCase();
                                    
                                            return name.includes(lowerQuery) || 
                                                   title.includes(lowerQuery) || 
                                                   description.includes(lowerQuery);
                                });
                            
                                                                    if (items.length > 0) break;
                                    }
                                }
                            } catch (err) {
                            }
                        }
                    } catch (err) {
                    }
                }
                
                // Update dropdown with results
                dropdown.innerHTML = '';
                
                // Always add option to create a new item
                const exactMatchFound = items.some(item => 
                    (item.name || item.title || '').toLowerCase() === query.toLowerCase()
                );
                
                if (items.length > 0) {
                    items.forEach(item => {
                        const dropdownItem = document.createElement('div');
                        dropdownItem.className = 'dropdown-item';
                        
                        // Handle different item structures
                        const itemId = item.id || 'unknown';
                        const itemName = item.name || item.title || '';
                        
                        dropdownItem.dataset.id = itemId;
                        dropdownItem.dataset.name = itemName;
                        
                        // Add item details including description if available
                        let itemDisplay = `<div class="item-name">${itemName}</div>`;
                        if (item.description) {
                            itemDisplay += `<div class="item-detail">${item.description}</div>`;
                        }
                        
                        dropdownItem.innerHTML = itemDisplay;
                        
                        // Add click handler to select the item
                        dropdownItem.addEventListener('click', () => {
                            this.selectResearchAgendaItem(itemId, itemName, selectedContainerId);
                            dropdown.style.display = 'none';
                            inputElement.value = '';
                        });
                        
                        dropdown.appendChild(dropdownItem);
                    });
                } else {
                    dropdown.innerHTML = '<div class="dropdown-item no-results">No research agenda items found</div>';
                }
                
                // If no exact match found, add option to create new item 
                if (!exactMatchFound && query.length >= 3) {
                    const createItem = document.createElement('div');
                    createItem.className = 'dropdown-item create-new';
                    createItem.innerHTML = `<div class="item-name"><i class="fas fa-plus"></i> Create "${query}"</div>`;
                    
                    // Add click handler to create and select new item
                    createItem.addEventListener('click', async () => {
                        try {
                            // Attempt to create the new item via API
                            const newItem = await this.createNewResearchAgendaItem(query);
                            if (newItem && newItem.id) {
                                this.selectResearchAgendaItem(newItem.id, newItem.name || newItem.title || query, selectedContainerId);
                            } else {
                        this.selectResearchAgendaItem('new', query, selectedContainerId);
                            }
                        } catch (error) {
                            this.selectResearchAgendaItem('new', query, selectedContainerId);
                        }
                        
                        dropdown.style.display = 'none';
                        inputElement.value = '';
                    });
                    
                    dropdown.appendChild(createItem);
                }
                
                // Position dropdown directly under the input field
                dropdown.style.display = 'block';
            } catch (error) {
                dropdown.innerHTML = '<div class="dropdown-item error">Error searching</div>';
            }
        }, 300);
        
        // Add input event listener
        inputElement.addEventListener('input', (e) => {
            searchAgendaItems(e.target.value);
        });
        
        // Handle focus to reshow dropdown if there's a value
        inputElement.addEventListener('focus', () => {
            if (inputElement.value.length >= 2) {
                searchAgendaItems(inputElement.value);
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    },
    
    // Helper function to create a new research agenda item
    createNewResearchAgendaItem: async function(name) {
                
        // First check if item already exists to prevent duplicates
        try {
                        const searchEndpoints = [
                `/research-agenda-items/search?q=${encodeURIComponent(name)}`,
                `/api/research-agenda-items/search?q=${encodeURIComponent(name)}`,
                `/api/topics/search?q=${encodeURIComponent(name)}`
            ];
            
            for (const endpoint of searchEndpoints) {
                try {
                    const response = await fetch(endpoint);
                    if (response.ok) {
                        const data = await response.json();
                                                
                        // Extract items depending on response format
                        let items = [];
                        if (data.items) {
                            items = data.items;
                        } else if (Array.isArray(data)) {
                            items = data;
                        } else if (data.agendaItems) {
                            items = data.agendaItems;
                        } else if (data.topics) {
                            items = data.topics;
                        } else if (data.results) {
                            items = data.results;
                        }
                        
                        // Check for exact name match
                        const exactMatch = items.find(item => 
                            item.name?.toLowerCase() === name.toLowerCase() ||
                            item.title?.toLowerCase() === name.toLowerCase()
                        );
                        
                        if (exactMatch) {
                                                        return exactMatch;
                        }
                    }
                } catch (err) {
                }
            }
            
            // Try to get all items as fallback
            const allEndpoints = [
                '/research-agenda-items/all',
                '/research-agenda-items',
                '/api/research-agenda-items',
                '/api/topics'
            ];
            
            for (const endpoint of allEndpoints) {
                try {
                    const response = await fetch(endpoint);
                    if (response.ok) {
                        const data = await response.json();
                        
                        // Extract items depending on response format
                        let allItems = [];
                        if (data.items) {
                            allItems = data.items;
                        } else if (Array.isArray(data)) {
                            allItems = data;
                        } else if (data.agendaItems) {
                            allItems = data.agendaItems;
                        } else if (data.topics) {
                            allItems = data.topics;
                        } else if (data.results) {
                            allItems = data.results;
                        }
                        
                        // Filter for exact match
                        const exactMatch = allItems.find(item => 
                            item.name?.toLowerCase() === name.toLowerCase() ||
                            item.title?.toLowerCase() === name.toLowerCase()
                        );
                        
                        if (exactMatch) {
                                                        return exactMatch;
                        }
                    }
                } catch(err) {
                }
            }
        } catch (error) {
        }
        
        // If we get here, the item doesn't exist yet or couldn't be found
        // Try different endpoints for creating items
        const endpoints = [
            '/api/research-agenda-items',
            '/research-agenda-items',
            '/api/topics'
        ];
        
        // Ensure we send all possible name fields
        const itemData = {
            name: name.trim(),
            title: name.trim(),
            description: ''
        };
        
                
        // Try each endpoint
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                    body: JSON.stringify(itemData)
            });
            
                if (response.ok) {
            const result = await response.json();
                                        
                    // Handle different API response formats
                    if (result.id) {
                        return {
                            id: result.id,
                            name: name
                        };
                    } else if (result.item && result.item.id) {
                        return result.item;
                    } else if (result.topic && result.topic.id) {
                        return {
                            id: result.topic.id,
                            name: result.topic.name || name
                        };
                    }
                    
                    return result;
                } else {
                    try {
                        const errorText = await response.text();
                    } catch(e) {
                        // Ignore error text read failures
                    }
                }
            } catch (error) {
            }
        }
        
        // If we didn't create via API, return a basic object with a temporary ID
        return {
            id: 'temp_' + Date.now(),
            name: name,
            is_temporary: true
        };
    },
    
    // Select a research agenda item and add to the selected list
    selectResearchAgendaItem: function(itemId, itemName, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
                
        // Check if item already selected
        const existingItem = container.querySelector(`.selected-topic[data-id="${itemId}"]`);
        if (existingItem) {
                        return;
        }
        
        // Create item element - without showing the ID
        const itemElement = document.createElement('div');
        itemElement.className = 'selected-topic';
        itemElement.dataset.id = itemId;
        
        // Only display the name, not the ID
        itemElement.innerHTML = `
            ${itemName}
            <span class="remove-topic">&times;</span>
        `;
        
        // Add to container
        container.appendChild(itemElement);
                
        // Add click handler to remove button
        const removeBtn = itemElement.querySelector('.remove-topic');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                itemElement.remove();
            });
        }
    },
    
    // Helper function to fetch child documents by IDs
    fetchChildDocuments: function(childIds) {
        // ... existing code ...
    },
    
    // Update compiled document preview - for references in other parts of the code
    updateCompiledDocumentPreview: function(data) {
        try {
                        
            // Find preview elements
            const previewTitleEl = document.getElementById('edit-compiled-document-preview-title');
            const previewYearsEl = document.getElementById('edit-compiled-preview-years');
            const previewVolumeEl = document.getElementById('edit-compiled-preview-volume');
            const previewIssuedEl = document.getElementById('edit-compiled-preview-issued-no');
            const previewIssuedLabel = document.getElementById('edit-preview-issued-no-label');
            const categoryIcon = document.getElementById('edit-compiled-category-icon');
            
            // Log preview element existence
            console.log('Preview elements found:', {
                title: !!previewTitleEl,
                years: !!previewYearsEl,
                volume: !!previewVolumeEl,
                issued: !!previewIssuedEl,
                issuedLabel: !!previewIssuedLabel,
                categoryIcon: !!categoryIcon
            });
            
            // Update preview elements
            if (previewTitleEl) {
                previewTitleEl.textContent = data.title || 'Compilation Title';
            }
            
            if (previewYearsEl) {
                const startYear = data.start_year || '-';
                const endYear = data.end_year || '-';
                previewYearsEl.textContent = `${startYear}-${endYear}`;
            }
            
            if (previewVolumeEl) {
                previewVolumeEl.textContent = data.volume || '-';
            }
            
            // Update issued/department field based on category
            if (previewIssuedEl) {
                if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                    previewIssuedEl.textContent = data.department || '-';
                    if (previewIssuedLabel) {
                        previewIssuedLabel.textContent = 'Departmental:';
                    }
                } else {
                    previewIssuedEl.textContent = data.issue_number || '-';
                    if (previewIssuedLabel) {
                        previewIssuedLabel.textContent = 'Issued No:';
                    }
                }
            }
            
            // Update category icon
            if (categoryIcon) {
                if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                    categoryIcon.dataset.category = 'synergy';
                } else {
                    categoryIcon.dataset.category = 'confluence';
                }
            }
            
                    } catch (error) {
        }
    },
    
    // Function to upload a file with multiple endpoint attempts
    uploadFileWithFallback: function(documentId, fileInput) {
        // ... existing code ...
    },
    
    // Helper function to try multiple file upload endpoints
    tryFileUploadEndpoints: function(endpoints, formData) {
        // ... existing code ...
    },
    
    // Handle category change
    handleCategoryChange: function(category) {
                
        // Get all needed elements
        const issuedNoLabel = document.getElementById('edit-compiled-issued-no-label');
        const previewIssuedLabel = document.getElementById('edit-preview-issued-no-label');
        const issuedNoInput = document.getElementById('edit-compiled-issued-no');
        const departmentalSelect = document.getElementById('edit-compiled-departmental');
        
        if (category === 'SYNERGY' || category === 'Synergy') {
                        
            // Update labels
            if (issuedNoLabel) issuedNoLabel.textContent = 'Departmental';
            if (previewIssuedLabel) previewIssuedLabel.textContent = 'Departmental:';
            
            // Show department field, hide issued field
            if (issuedNoInput) issuedNoInput.style.cssText = 'display: none !important';
            if (departmentalSelect) departmentalSelect.style.cssText = 'display: block !important';
            
            // Ensure departmental is a dropdown and populated
            this.ensureDepartmentalDropdown(departmentalSelect);
        } else {
                        
            // Update labels
            if (issuedNoLabel) issuedNoLabel.textContent = 'Issued No';
            if (previewIssuedLabel) previewIssuedLabel.textContent = 'Issued No:';
            
            // Show issued field, hide department field
            if (issuedNoInput) issuedNoInput.style.cssText = 'display: block !important';
            if (departmentalSelect) departmentalSelect.style.cssText = 'display: none !important';
        }
        
        // Update preview if possible
        if (typeof this.updatePreviewFields === 'function') {
            this.updatePreviewFields();
        }
    },
    
    // Ensure departmental field is a dropdown and populated with departments
    ensureDepartmentalDropdown: function(selectElement) {
        if (!selectElement) return;
        
        // Check if it's not already a select element
        if (selectElement.tagName !== 'SELECT') {
                        
            // Create a new select element
            const departmentalSelect = document.createElement('select');
            departmentalSelect.id = selectElement.id;
            departmentalSelect.name = selectElement.name;
            departmentalSelect.className = selectElement.className;
            
            // Replace the original element with the select
            selectElement.parentNode.replaceChild(departmentalSelect, selectElement);
            selectElement = departmentalSelect;
        }
        
        // Only fetch departments if the dropdown is empty
        if (selectElement.options.length <= 1) {
                        this.fetchAndPopulateDepartments(selectElement);
        }
    },
    
    // Fetch departments from the database and populate the dropdown
    fetchAndPopulateDepartments: async function(selectElement) {
                
        try {
            // Save the current value to restore it after populating
            const currentValue = selectElement.value;
            
            // Add loading option
            selectElement.innerHTML = '<option value="">Loading departments...</option>';
            
            const endpoints = [
                '/api/departments',
                '/api/synergy-departments',
                '/departments'
            ];
            
            let departments = [];
            let fetchSucceeded = false;
            
            // Try each endpoint until one works
            for (const endpoint of endpoints) {
                try {
                                        const response = await fetch(endpoint);
                    
                    if (response.ok) {
                        const data = await response.json();
                                                
                        // Extract departments based on response structure
                        if (Array.isArray(data)) {
                            departments = data;
                        } else if (data.departments && Array.isArray(data.departments)) {
                            departments = data.departments;
                        } else if (data.data && Array.isArray(data.data)) {
                            departments = data.data;
                        }
                        
                        fetchSucceeded = true;
                        break;
                    }
                } catch (error) {
                }
            }
            
            // If no endpoints returned data, use a fallback list of common departments
            if (!fetchSucceeded || departments.length === 0) {
                                departments = [
                    { name: 'Finance', id: 'finance' },
                    { name: 'Human Resources', id: 'hr' },
                    { name: 'Information Technology', id: 'it' },
                    { name: 'Marketing', id: 'marketing' },
                    { name: 'Operations', id: 'operations' },
                    { name: 'Research & Development', id: 'rd' },
                    { name: 'Sales', id: 'sales' },
                    { name: 'Customer Support', id: 'support' }
                ];
            }
            
            // Clear and populate dropdown
            selectElement.innerHTML = '<option value="">Select Department</option>';
            
            // Add each department as an option
            departments.forEach(dept => {
                const option = document.createElement('option');
                
                // Handle different data structures
                if (typeof dept === 'string') {
                    option.value = dept;
                    option.textContent = dept;
                } else if (dept.id && dept.name) {
                    option.value = dept.id;
                    option.textContent = dept.name;
                } else if (dept.name) {
                    option.value = dept.name;
                    option.textContent = dept.name;
                } else if (dept.value && dept.label) {
                    option.value = dept.value;
                    option.textContent = dept.label;
                }
                
                selectElement.appendChild(option);
            });
            
            // Restore previously selected value if it exists
            if (currentValue) {
                                
                // Find a matching option by value or text content
                let found = false;
                Array.from(selectElement.options).forEach(option => {
                    if (option.value === currentValue || option.textContent === currentValue) {
                        selectElement.value = option.value;
                        found = true;
                    }
                });
                
                // If no match found and we have a value, create a new option
                if (!found && currentValue) {
                                        const newOption = document.createElement('option');
                    newOption.value = currentValue;
                    newOption.textContent = currentValue;
                    selectElement.appendChild(newOption);
                    selectElement.value = currentValue;
                }
            }
            
                    } catch (error) {
        }
    }
};

// Initialize document edit components when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
        
    // Set up global functions for use in other scripts
    window.showEditModal = window.documentEdit.showEditModal.bind(window.documentEdit);
    window.showCompiledEditModal = window.documentEdit.showCompiledEditModal.bind(window.documentEdit);
    
    // Create a fallback author search function if the main one isn't available
    if (typeof window.initAuthorSearchInput !== 'function') {
                window.initAuthorSearchInput = function(inputElement) {
            // This is a simplified fallback implementation
                        // The document edit module will use its own implementation
        };
    }
});
