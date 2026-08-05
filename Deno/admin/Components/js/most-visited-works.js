/**
 * Most Visited Works Component
 * 
 * This script fetches and displays document visit data
 * in the admin dashboard's Most Visited Works table.
 */

// Function to update the most visited works table
async function updateMostVisitedWorks() {
    // Always use 0 for days parameter to show all time data
    const days = 0;
    const limit = 5; // Always use exactly 5 documents
    try {
                
        // Use DocumentTracker's function to get most visited documents if available
        if (window.DocumentTracker && typeof window.DocumentTracker.getMostVisitedDocuments === 'function') {
                        const documents = await window.DocumentTracker.getMostVisitedDocuments(limit, days);
            if (documents && documents.length > 0) {
                updateWorksTable(documents);
                return;
            }
                    }
        
        // Fallback to direct API call - use the page-visits endpoint that we implemented
        const response = await fetch(`/api/page-visits/most-visited-documents?limit=${limit}&days=${days}`);
        
        if (!response.ok) {
                        // Try compatibility endpoint as second fallback
            try {
                const compatResponse = await fetch(`/api/most-visited-documents?limit=${limit}&period=${days}`);
                if (compatResponse.ok) {
                    const compatData = await compatResponse.json();
                    if (compatData.documents && compatData.documents.length > 0) {
                        // Transform the compatibility format to our expected format
                        const formattedDocs = await Promise.all(compatData.documents.map(async (doc) => {
                            // Fetch document details to get title and type
                            try {
                                const detailsResponse = await fetch(`/api/documents/${doc.id}`);
                                if (detailsResponse.ok) {
                                    const details = await detailsResponse.json();
                                    return {
                                        document_id: doc.id,
                                        title: details.title || 'Untitled Document',
                                        document_type: details.document_type || 'single',
                                        visit_count: doc.visits || 0,
                                        guest_count: Math.round(doc.visits * 0.8) || 0, // Estimate
                                        user_count: Math.round(doc.visits * 0.2) || 0,  // Estimate
                                        is_compiled: details.is_compiled || false
                                    };
                                }
                            } catch (err) {
                            }
                            
                            // Fallback with minimal data
                            return {
                                document_id: doc.id,
                                title: 'Document ' + doc.id,
                                visit_count: doc.visits || 0,
                                guest_count: 0,
                                user_count: 0
                            };
                        }));
                        
                        updateWorksTable(formattedDocs);
            return;
        }
                }
            } catch (compatError) {
            }
            
            // Use default documents endpoint as last resort
            await fetchRecentDocuments();
            return;
        }
        
        const data = await response.json();
                
        if (!data.documents) {
            // Check if response is already an array of documents
            if (Array.isArray(data) && data.length > 0) {
                // Ensure only 5 documents are displayed
                updateWorksTable(data.slice(0, limit));
            return;
        }
        
                        await fetchRecentDocuments();
            return;
        }
        
        // Ensure only 5 documents are displayed
        updateWorksTable(data.documents.slice(0, limit));
    } catch (error) {
        await fetchRecentDocuments();
    }
}

// Function to fetch recent documents when visit data is not available
async function fetchRecentDocuments() {
    try {
                
        const response = await fetch(`/api/documents?limit=5&sort=latest`);
        
        if (!response.ok) {
                        displayErrorMessage();
            return;
        }
        
        const data = await response.json();
                
        if (!data.documents || data.documents.length === 0) {
                        displayNoDataMessage();
            return;
        }
        
        // Transform to include required fields with zero visit counts
        const documentsWithVisits = data.documents.map(doc => ({
                document_id: doc.id,
            title: doc.title || 'Untitled Document',
                document_type: doc.document_type || 'single',
            visit_count: 0,
            guest_count: 0,
            user_count: 0,
            is_compiled: doc.is_compiled || false,
            children: doc.children || [],
            keywords: doc.keywords || [],
            last_visit_date: doc.updated_at || doc.publication_date || doc.created_at
        }));
        
        // Update the table
        updateWorksTable(documentsWithVisits);
    } catch (error) {
        displayErrorMessage();
    }
}

// Resolve a document type/category to a category slug for category-icons.css
function getDocumentTypeCategory(type, category) {
    // First check for explicit category if provided
    if (category) {
        // Normalize the category to lowercase for consistent comparison
        const normalizedCategory = category.toLowerCase();

        if (normalizedCategory.includes('thesis')) {
            return 'thesis';
        } else if (normalizedCategory.includes('dissertation')) {
            return 'dissertation';
        } else if (normalizedCategory.includes('confluence')) {
            return 'confluence';
        } else if (normalizedCategory.includes('synergy')) {
            return 'synergy';
        }
        // If category doesn't match any known type, fall through to type-based logic
    }

    if (!type) return '';

    // Normalize the type to lowercase for consistent comparison
    const normalizedType = (type || '').toLowerCase();

    // Check for compiled documents first using multiple indicators
    if (normalizedType === 'compiled' ||
        normalizedType === 'compilation' ||
        normalizedType.includes('compile') ||
        normalizedType.includes('confluence')) {
        return 'confluence';
    }

    // Then check for other specific types
    switch (normalizedType) {
        case 'thesis':
        case 'single':
            return 'thesis';
        case 'dissertation':
            return 'dissertation';
        case 'synergy':
            return 'synergy';
        default:
            return '';
    }
}

// Function to display data in the existing table
function updateWorksTable(documents) {
        
    // Get the table body
    const tableBody = document.getElementById('most-visited-works-tbody');
    if (!tableBody) {
        return;
    }
    
    // Clear existing content
    tableBody.innerHTML = '';
    
    // First, filter out child documents - we only want to show compiled documents and standalone singles
    // We'll create a set to track documents that are children of compiled documents
    let childDocumentIds = new Set();
        
    // Find and mark all child documents
    const compiledDocs = documents.filter(doc => 
        doc.is_compiled === true || 
        doc.document_type === 'compiled' || 
        (doc.children && doc.children.length > 0)
    );
    
    // Add all child document IDs to our set
    compiledDocs.forEach(compiledDoc => {
        if (compiledDoc.children && Array.isArray(compiledDoc.children)) {
            compiledDoc.children.forEach(child => {
                if (child.id) childDocumentIds.add(child.id);
                if (child.document_id) childDocumentIds.add(child.document_id);
            });
        }
    });
            
    // If some documents aren't showing child info yet, try to fetch it
    let needsChildDataFetch = false;
    for (const doc of compiledDocs) {
        if (!doc.children || doc.children.length === 0) {
            needsChildDataFetch = true;
            break;
        }
    }
    
    // If we need to fetch child data, do that asynchronously
    if (needsChildDataFetch) {
        fetchChildDocuments(compiledDocs).then(updatedDocs => {
            // After fetching, update our filter with the new child information
            updatedDocs.forEach(compiledDoc => {
                if (compiledDoc.children && Array.isArray(compiledDoc.children)) {
                    compiledDoc.children.forEach(child => {
                        if (child.id) childDocumentIds.add(child.id);
                        if (child.document_id) childDocumentIds.add(child.document_id);
                    });
                }
            });
            
            // Filter documents to only show compiled documents and standalone singles
            const filteredDocuments = documents.filter(doc => {
                const docId = doc.id || doc.document_id;
                // Include if it's a compiled document OR if it's a single document that isn't a child
                const isCompiled = doc.is_compiled === true || 
                                doc.document_type === 'compiled' || 
                                (doc.children && doc.children.length > 0);
                return isCompiled || !childDocumentIds.has(docId);
            });
            
            // Render the filtered documents
            renderDocumentsToTable(filteredDocuments, tableBody);
        });
                            } else {
        // Filter documents to only show compiled documents and standalone singles
        const filteredDocuments = documents.filter(doc => {
            const docId = doc.id || doc.document_id;
            // Include if it's a compiled document OR if it's a single document that isn't a child
            const isCompiled = doc.is_compiled === true || 
                            doc.document_type === 'compiled' || 
                            (doc.children && doc.children.length > 0);
            return isCompiled || !childDocumentIds.has(docId);
        });
        
        // Render the filtered documents
        renderDocumentsToTable(filteredDocuments, tableBody);
    }
}

// Helper function to fetch child document data for compiled documents
async function fetchChildDocuments(compiledDocs) {
    const updatedDocs = [...compiledDocs];
    
    for (let i = 0; i < updatedDocs.length; i++) {
        const doc = updatedDocs[i];
        if (!doc.children || doc.children.length === 0) {
            const docId = doc.id || doc.document_id;
            if (!docId) continue;
            
            try {
                // Try the compiled document details endpoint
                const response = await fetch(`/api/compiled-documents/${docId}/details`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.children && Array.isArray(data.children)) {
                        updatedDocs[i] = {
                            ...doc,
                            children: data.children
                        };
                        continue;
                    }
                }
                
                // Fallback to child documents endpoint
                const childResponse = await fetch(`/api/documents/${docId}/children`);
                if (childResponse.ok) {
                    const childData = await childResponse.json();
                    if (Array.isArray(childData)) {
                        updatedDocs[i] = {
                            ...doc,
                            children: childData
                        };
                    } else if (childData.documents && Array.isArray(childData.documents)) {
                        updatedDocs[i] = {
                            ...doc,
                            children: childData.documents
                        };
                    }
                }
            } catch (error) {
    }
        }
    }
    
    return updatedDocs;
}

// Separate function to render documents to the table
function renderDocumentsToTable(documents, tableBody) {
    // First, check for any documents that are explicitly marked as children
    const filteredDocuments = documents.filter(doc => {
        // Skip any documents that explicitly have a parent_id or compiled_document_id
        if (doc.parent_id || doc.compiled_document_id || doc.parent_document_id) {
                        return false;
        }

        // Filter out if the document has a relationship property indicating it's a child
        if (doc.is_child === true || doc.child_order !== undefined || doc.order_index !== undefined) {
                        return false;
        }

        return true;
    });

    if (filteredDocuments.length === 0) {
        displayNoDataMessage();
        return;
    }

    // Add each document to the table
    filteredDocuments.forEach((doc, idx) => {
        const rank = idx + 1;

        // Create a row
        const row = document.createElement('tr');
        row.className = 'most-visited-row';
        row.style.animationDelay = `${idx * 40}ms`;

        // Rank cell
        const rankCell = document.createElement('td');
        rankCell.className = 'most-visited-rank-cell';
        const rankBadge = document.createElement('span');
        rankBadge.className = `most-visited-rank rank-${rank}`;
        rankBadge.textContent = rank;
        rankCell.appendChild(rankBadge);
        row.appendChild(rankCell);
        
        // Determine if this is a compiled document - check multiple indicators
        const isCompiled = 
            doc.is_compiled === true || 
            (doc.document_type && doc.document_type.toLowerCase().includes('compil')) ||
            (doc.document_type && doc.document_type.toLowerCase().includes('confluence')) ||
            (doc.children && doc.children.length > 0) ||
            (doc.name && doc.name.toLowerCase().includes('compilation')) ||
            (doc.name && doc.name.toLowerCase().includes('compiled'));
        
        // Force document_type to 'compiled' if it is a compiled document
        if (isCompiled) {
            doc.document_type = 'compiled';
        }
        
        // Create cover cell
        const coverCell = document.createElement('td');
        coverCell.className = 'most-visited-cover-cell';
        const coverDiv = document.createElement('div');
        coverDiv.className = 'cover most-visited-cover';
        
        // Extract category from the title for compiled documents
        let category = null;
        if (doc.document_type === 'compiled' && doc.title) {
            // Try to extract category from the title format "Category: Title"
            const titleParts = doc.title.split(':');
            if (titleParts.length > 1) {
                category = titleParts[0].trim();
            }
        }

        // Central category icon (see category-icons.css)
        const coverIcon = document.createElement('span');
        coverIcon.className = 'category-icon category-icon--sm';
        coverIcon.dataset.category = getDocumentTypeCategory(doc.document_type, category);
        coverIcon.title = category || formatDocumentType(doc.document_type);
        coverIcon.setAttribute('aria-hidden', 'true');

        coverDiv.appendChild(coverIcon);
        coverCell.appendChild(coverDiv);
        
        // Create details cell
        const detailsCell = document.createElement('td');
        detailsCell.className = 'most-visited-details-cell';
        
        // Document title and basic info
        const titleElement = document.createElement('h5');
        titleElement.className = 'most-visited-title';
        
        // Check various title fields in order of preference
        let docTitle = 'Untitled Document';
        if (doc.title) {
            docTitle = doc.title;
            } else if (doc.name) {
            docTitle = doc.name;
        } else if (doc.document_title) {
            docTitle = doc.document_title;
        }
        
        // Use the title directly from the API response
        titleElement.textContent = docTitle;
        titleElement.title = docTitle; // For hover tooltip
        
        // If compiled document, add compiled badge
        if (isCompiled) {
            const compiledBadge = document.createElement('span');
            compiledBadge.className = 'compiled-badge';
            compiledBadge.textContent = 'Compiled';
            compiledBadge.style.backgroundColor = 'var(--theme-gold-light-bg)';
            compiledBadge.style.color = 'var(--text-on-gold)';
            compiledBadge.style.padding = '0.1rem 0.3rem';
            compiledBadge.style.fontSize = '0.7rem';
            compiledBadge.style.borderRadius = '0.25rem';
            compiledBadge.style.marginLeft = '0.5rem';
            titleElement.appendChild(compiledBadge);
        }
        
        // Format the document type for display (used for tags only)
        const docType = formatDocumentType(doc.document_type);
        
        // Create tags container
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'tags most-visited-tags';
        
        // Document type tag
        const docTypeSpan = document.createElement('span');
        docTypeSpan.className = 'doc-type most-visited-doc-type';
        docTypeSpan.textContent = isCompiled ? 'Compiled' : docType;
        // Make the document type tag non-clickable
        docTypeSpan.style.pointerEvents = 'none';
        tagsDiv.appendChild(docTypeSpan);
        
        // Add keywords as tags if available
        if (doc.keywords && Array.isArray(doc.keywords) && doc.keywords.length > 0) {
            // Limit to first 3 keywords to avoid overcrowding
            const keywordsToShow = doc.keywords.slice(0, 3);
            keywordsToShow.forEach(keyword => {
                if (keyword) {
                    const keywordTag = document.createElement('span');
                    keywordTag.className = 'tag most-visited-tag';
                    keywordTag.textContent = keyword;
                    // Make sure it's not clickable
                    keywordTag.style.pointerEvents = 'none';
                    tagsDiv.appendChild(keywordTag);
                }
            });
        } else if (doc.keywords && typeof doc.keywords === 'string' && doc.keywords.trim() !== '') {
            // Handle case where keywords might be a comma-separated string
            const keywordsArray = doc.keywords.split(',').map(k => k.trim()).filter(k => k);
            // Limit to first 3 keywords
            const keywordsToShow = keywordsArray.slice(0, 3);
            keywordsToShow.forEach(keyword => {
                const keywordTag = document.createElement('span');
                keywordTag.className = 'tag most-visited-tag';
                keywordTag.textContent = keyword;
                // Make sure it's not clickable
                keywordTag.style.pointerEvents = 'none';
                tagsDiv.appendChild(keywordTag);
            });
        }
        
        // Add elements to details cell
        detailsCell.appendChild(titleElement);
        detailsCell.appendChild(tagsDiv);
        
        // Create visits cell with detailed breakdown on hover
        const visitsCell = document.createElement('td');
        visitsCell.className = 'visits most-visited-visits';
        
        const visitsStrong = document.createElement('strong');
        visitsStrong.className = 'most-visited-count';
        visitsStrong.textContent = doc.visit_count || 0;
        
        visitsCell.appendChild(visitsStrong);
        visitsCell.appendChild(document.createTextNode(' Visits'));
        
        // Add hover tooltip with detailed visit counts
        const tooltip = document.createElement('div');
        tooltip.className = 'visits-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.display = 'none';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '0.75rem';
        tooltip.style.borderRadius = '0.375rem';
        tooltip.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        tooltip.style.fontSize = '0.875rem';
        tooltip.style.zIndex = '1000';
        tooltip.style.width = 'auto';
        tooltip.style.minWidth = '200px';
        
        // Create tooltip content
        const tooltipContent = document.createElement('div');
        
        // Add guest/user visit breakdown
        const guestCount = doc.guest_count || 0;
        const userCount = doc.user_count || 0;
        
        const breakdownHtml = `
            <div style="margin-bottom: 0.5rem"><strong>Visit Breakdown:</strong></div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem">
                <span>Guest Visits:</span>
                <strong>${guestCount}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem">
                <span>User Visits:</span>
                <strong>${userCount}</strong>
            </div>
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.2); padding-top: 0.5rem;">
                <div style="display: flex; justify-content: space-between">
                    <span>Total Visits:</span>
                    <strong>${doc.visit_count || 0}</strong>
                </div>
            </div>
        `;
        
        tooltipContent.innerHTML = breakdownHtml;
        tooltip.appendChild(tooltipContent);
        
        // Add child documents section if this is a compiled document with children
        if (isCompiled && doc.children && doc.children.length > 0) {
            const childrenSection = document.createElement('div');
            childrenSection.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
            childrenSection.style.marginTop = '0.75rem';
            childrenSection.style.paddingTop = '0.5rem';
            
            const childrenTitle = document.createElement('div');
            childrenTitle.style.marginBottom = '0.5rem';
            childrenTitle.innerHTML = `<strong>Child Documents (${doc.children.length}):</strong>`;
            childrenSection.appendChild(childrenTitle);
            
            // Show top 3 child documents
            const childrenToShow = doc.children.slice(0, 3);
            childrenToShow.forEach(child => {
                const childRow = document.createElement('div');
                childRow.style.display = 'flex';
                childRow.style.justifyContent = 'space-between';
                childRow.style.marginBottom = '0.25rem';
                
                const childTitle = document.createElement('span');
                childTitle.style.overflow = 'hidden';
                childTitle.style.textOverflow = 'ellipsis';
                childTitle.style.whiteSpace = 'nowrap';
                childTitle.style.maxWidth = '160px';
                childTitle.textContent = child.title || `Document ${child.id || ''}`;
                
                const childVisits = document.createElement('strong');
                childVisits.textContent = child.visit_count || 0;
                
                childRow.appendChild(childTitle);
                childRow.appendChild(childVisits);
                childrenSection.appendChild(childRow);
            });
            
            // Add "more" indicator if there are more children
            if (doc.children.length > 3) {
                const moreRow = document.createElement('div');
                moreRow.style.fontSize = '0.8rem';
                moreRow.style.opacity = '0.8';
                moreRow.style.textAlign = 'center';
                moreRow.style.marginTop = '0.25rem';
                moreRow.textContent = `+ ${doc.children.length - 3} more`;
                childrenSection.appendChild(moreRow);
            }
            
            tooltip.appendChild(childrenSection);
        }
        
        // Add tooltip to the page
        document.body.appendChild(tooltip);
        
        // Add mouseover/mouseout event listeners for tooltip
        visitsCell.addEventListener('mouseover', function(e) {
            const rect = this.getBoundingClientRect();
            tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
            tooltip.style.left = `${rect.left + window.scrollX}px`;
            tooltip.style.display = 'block';
            // Allow the tooltip to be displayed before adding the visible class
            setTimeout(() => {
                tooltip.classList.add('visible');
            }, 10);
        });
        
        visitsCell.addEventListener('mouseout', function() {
            tooltip.classList.remove('visible');
            // Wait for the transition to complete before hiding
            setTimeout(() => {
                tooltip.style.display = 'none';
            }, 200); // Match the transition duration
        });
        
        // Add all cells to the row
        row.appendChild(coverCell);
        row.appendChild(detailsCell);
        row.appendChild(visitsCell);
        
        // Add click handler only for compiled documents
        if (isCompiled) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                // Show popup with child document breakdown for compiled documents
                showCompiledDocumentBreakdown(doc);
            });
        } else {
            // For single documents, no click handler and different cursor
            row.style.cursor = 'default';
            
            // Add visual styling to indicate non-clickable state
            row.style.opacity = '0.85';
            
            // Add a "read-only" badge to make it clear
            const readOnlyBadge = document.createElement('span');
            readOnlyBadge.className = 'read-only-badge';
            readOnlyBadge.textContent = 'Read Only';
            readOnlyBadge.style.backgroundColor = '#f0f0f0';
            readOnlyBadge.style.color = '#666';
            readOnlyBadge.style.padding = '0.1rem 0.3rem';
            readOnlyBadge.style.fontSize = '0.7rem';
            readOnlyBadge.style.borderRadius = '0.25rem';
            readOnlyBadge.style.marginLeft = '0.5rem';
            titleElement.appendChild(readOnlyBadge);
        }
        
        // Add the row to the table
        tableBody.appendChild(row);
    });
}

/**
 * Shows a modal popup with breakdown of visits for child documents
 * @param {Object} compiledDoc - The compiled document with children
 */
async function showCompiledDocumentBreakdown(compiledDoc) {
    const docId = compiledDoc.document_id || compiledDoc.id;
    
    if (!docId) {
        return;
    }
    
    // Create modal backdrop immediately to show loading state
    const modalBackdrop = document.createElement('div');
    modalBackdrop.style.position = 'fixed';
    modalBackdrop.style.top = '0';
    modalBackdrop.style.left = '0';
    modalBackdrop.style.width = '100%';
    modalBackdrop.style.height = '100%';
    modalBackdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modalBackdrop.style.display = 'flex';
    modalBackdrop.style.justifyContent = 'center';
    modalBackdrop.style.alignItems = 'center';
    modalBackdrop.style.zIndex = '2000';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'compiled-doc-modal';
    modalContent.style.backgroundColor = '#E6E6E6';
    modalContent.style.borderRadius = '8px';
    modalContent.style.padding = '20px';
    modalContent.style.width = '600px';
    modalContent.style.maxWidth = '90%';
    modalContent.style.maxHeight = '80vh';
    modalContent.style.overflowY = 'auto';
    modalContent.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
    
    // Show loading state initially
    modalContent.innerHTML = `
        <h3>${compiledDoc.title || 'Compiled Document Details'}</h3>
        <div style="text-align: center; padding: 30px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f3f3; 
                 border-top: 3px solid var(--theme-green-dark, #006A4E); border-radius: 50%; 
                 animation: spin 1s linear infinite;"></div>
            <p style="margin-top: 15px;">Loading document details...</p>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    
    // Add modal to page immediately to show loading
    modalBackdrop.appendChild(modalContent);
    document.body.appendChild(modalBackdrop);
    
    // Add keyboard shortcut to close modal with Escape key
    const escapeKeyHandler = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modalBackdrop);
            document.removeEventListener('keydown', escapeKeyHandler);
        }
    };
    
    // Store the handler globally so it can be accessed by the close button
    document.activeModalEscapeHandler = escapeKeyHandler;
    document.addEventListener('keydown', escapeKeyHandler);
    
    // Close when clicking outside the modal
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) {
            document.body.removeChild(modalBackdrop);
            document.removeEventListener('keydown', escapeKeyHandler);
        }
    });
    
    try {
        // Fetch detailed compiled document information with children
        const response = await fetch(`/api/compiled-documents/${docId}/details`);
        
        if (!response.ok) {
            // Fallback to regular documents endpoint if compiled endpoint fails
            // Try fallback to regular document endpoint
            const fallbackResponse = await fetch(`/api/documents/${docId}`);
            if (!fallbackResponse.ok) {
                throw new Error(`Both API endpoints failed: ${fallbackResponse.status}`);
            }
            
            const docData = await fallbackResponse.json();
            await updateModalContent(modalContent, compiledDoc, docData);
            return;
        }
        
        const detailedData = await response.json();
        await updateModalContent(modalContent, compiledDoc, detailedData);
        
    } catch (error) {
        modalContent.innerHTML = `
            <h3>${compiledDoc.title || 'Compiled Document Details'}</h3>
            <div style="padding: 20px; text-align: center; color: #e53935;">
                <div style="font-size: 36px; margin-bottom: 10px;">⚠️</div>
                <p>Error loading document details.</p>
                <p style="font-size: 0.9rem; color: #666;">${error.message || 'Unknown error'}</p>
            </div>
            <div style="display: flex; justify-content: center; margin-top: 20px;">
                <button class="close-btn" style="background-color: #f0f0f0; color: #333; border: none; 
                    padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                    Close
                </button>
            </div>
        `;
        
        // Add click handler to close button
        const closeBtn = modalContent.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                document.body.removeChild(modalBackdrop);
                document.removeEventListener('keydown', escapeKeyHandler);
            });
        }
    }
}

// Function to update the modal content with document details
async function updateModalContent(modalContent, basicDocData, detailedData) {
    // Combine data from both sources, preferring detailed data
    const doc = {
        ...basicDocData,
        ...detailedData,
        // Keep visit counts from basic data if detailed data doesn't have them
        visit_count: detailedData.visit_count || basicDocData.visit_count || 0,
        guest_count: detailedData.guest_count || basicDocData.guest_count || 0,
        user_count: detailedData.user_count || basicDocData.user_count || 0
    };
    
    // Get child documents
    let childDocs = [];
    
    if (detailedData.children && Array.isArray(detailedData.children)) {
        childDocs = detailedData.children;
    } else if (detailedData.child_documents && Array.isArray(detailedData.child_documents)) {
        childDocs = detailedData.child_documents;
    } else if (basicDocData.children && Array.isArray(basicDocData.children)) {
        childDocs = basicDocData.children;
    }
    
    // If still no child documents, try to fetch them
    if (childDocs.length === 0) {
        try {
            const childResponse = await fetch(`/api/documents/${doc.id || doc.document_id}/children`);
            if (childResponse.ok) {
                const childData = await childResponse.json();
                if (Array.isArray(childData)) {
                    childDocs = childData;
                } else if (childData.documents && Array.isArray(childData.documents)) {
                    childDocs = childData.documents;
                }
            }
        } catch (err) {
        }
    }
    
    // Fetch visit counts for each child document if not already present
    for (let i = 0; i < childDocs.length; i++) {
        const child = childDocs[i];
        if (!child.visit_count) {
            try {
                const childId = child.id || child.document_id;
                if (childId && window.DocumentTracker?.getDocumentVisitStats) {
                    // Use DocumentTracker if available
                    const stats = await window.DocumentTracker.getDocumentVisitStats(childId);
                    child.visit_count = stats.total || 0;
                    child.guest_count = stats.guest || 0;
                    child.user_count = stats.user || 0;
                } else if (childId) {
                    // Direct API call
                    const visitResponse = await fetch(`/api/document-visits/counts?documentId=${childId}`);
                    if (visitResponse.ok) {
                        const visitData = await visitResponse.json();
                        child.visit_count = visitData.total || 0;
                        child.guest_count = visitData.guest || 0;
                        child.user_count = visitData.user || 0;
                    }
                }
            } catch (err) {
                // Set fallback values
                child.visit_count = child.visit_count || 0;
                child.guest_count = child.guest_count || 0;
                child.user_count = child.user_count || 0;
            }
        }
    }
    
    // Total values
    const totalVisits = doc.visit_count || 0;
    const guestVisits = doc.guest_count || 0;
    const userVisits = doc.user_count || 0;
    
    // Update the modal content with the data
    modalContent.innerHTML = `
        <h3>${doc.title || 'Compiled Document Details'}</h3>
        
        <div style="margin-bottom: 15px; padding: 10px; background-color: #f9f9f9; border-radius: 4px;">
            <div style="font-weight: bold; margin-bottom: 8px;">Total Visits: ${totalVisits}</div>
            
            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>Guest Visits:</span>
                    <span>${guestVisits} (${Math.round((guestVisits / totalVisits || 0) * 100)}%)</span>
                </div>
                <div class="percentage-bar">
                    <div class="percentage-bar-fill" style="width: ${Math.round((guestVisits / totalVisits || 0) * 100)}%; background-color: #FFB74D;"></div>
                </div>
            </div>
            
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>User Visits:</span>
                    <span>${userVisits} (${Math.round((userVisits / totalVisits || 0) * 100)}%)</span>
                </div>
                <div class="percentage-bar">
                    <div class="percentage-bar-fill" style="width: ${Math.round((userVisits / totalVisits || 0) * 100)}%;"></div>
                </div>
            </div>
        </div>
        
        <h4>Child Documents (${childDocs.length})</h4>
        
        ${childDocs.length === 0 ? '<p style="color: #666;">No child documents found.</p>' : ''}
    `;
    
    // If we have child documents, add the table
    if (childDocs.length > 0) {
        // Create table for child documents
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        
        // Add table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Document</th>
                <th style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd;">Visits</th>
                <th style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd;">%</th>
            </tr>
        `;
        table.appendChild(thead);
        
        // Add table body
        const tbody = document.createElement('tbody');
        
        // Sort children by visit count (descending)
        childDocs.sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0));
        
        // Add row for each child document
        childDocs.forEach(child => {
            const childVisits = child.visit_count || 0;
            const childPercent = totalVisits ? ((childVisits / totalVisits) * 100).toFixed(1) : 0;
            
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.style.transition = 'background-color 0.2s';
            row.style.borderBottom = '1px solid #eee';
            
            // Click to navigate to child document
            row.onclick = () => {
                window.location.href = `/pages/user-single.html?id=${child.id || child.document_id}`;
            };
            
            row.innerHTML = `
                <td style="padding: 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${child.title || 'Untitled Document'}
                </td>
                <td style="text-align: right; padding: 8px;">${childVisits}</td>
                <td style="text-align: right; padding: 8px;">
                    <div style="display: flex; align-items: center; justify-content: flex-end;">
                        <span style="margin-right: 8px;">${childPercent}%</span>
                        <div style="width: 40px; height: 8px; background-color: #eee; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${childPercent}%; background-color: var(--theme-gold, #FDB813);"></div>
                        </div>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        modalContent.appendChild(table);
    }
    
    // Add close button only (removing the View button)
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end'; // Align to the right
    buttonContainer.style.marginTop = '20px';
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.className = 'close-btn';
    closeButton.style.backgroundColor = '#f0f0f0';
    closeButton.style.color = '#333';
    closeButton.style.border = 'none';
    closeButton.style.padding = '8px 16px';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';
    
    // Store reference to the modal backdrop to properly remove it
    closeButton.onclick = () => {
        const modalBackdrop = modalContent.parentNode;
        if (modalBackdrop) {
            document.body.removeChild(modalBackdrop);
            // Remove the event listener for the Escape key
            document.removeEventListener('keydown', document.activeModalEscapeHandler);
        }
    };
    
    buttonContainer.appendChild(closeButton);
    modalContent.appendChild(buttonContainer);
}

// Function to display an error message when data fetch fails
function displayErrorMessage() {
    const tableBody = document.getElementById('most-visited-works-tbody');
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr><td colspan="4" style="padding:0;background:transparent;">
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M3.5 18.5l8.5 -15l8.5 15h-17z"/></svg>
                <p class="empty-title">Couldn&rsquo;t load document data</p>
                <p class="empty-sub">Please try again later.</p>
            </div>
        </td></tr>
    `;
}

// Function to display a message when no data is available
function displayNoDataMessage() {
    const tableBody = document.getElementById('most-visited-works-tbody');
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr><td colspan="4" style="padding:0;background:transparent;">
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/></svg>
                <p class="empty-title">No visits yet</p>
                <p class="empty-sub">Documents will appear here once they&rsquo;ve been viewed.</p>
            </div>
        </td></tr>
    `;
}

// Helper function to format document type for display
function formatDocumentType(type) {
    if (!type) return 'Document';
    
    type = type.toLowerCase();
    
    switch (type) {
        case 'single':
            return 'Document';
        case 'compiled':
            return 'Compiled';
        case 'thesis':
            return 'Thesis';
        case 'dissertation':
            return 'Dissertation';
        case 'confluence':
            return 'Confluence';
        case 'synergy':
            return 'Synergy';
        default:
            // Capitalize first letter of each word
            return type.replace(/\b\w/g, l => l.toUpperCase());
    }
}

// Helper function to format date
function formatDate(doc) {
    if (!doc) return 'N/A';
    
    try {
        // Handle different document types
        if (doc.document_type === 'compiled' && doc.start_year && doc.end_year) {
            // For compiled documents, use start_year-end_year format
            return `${doc.start_year}-${doc.end_year}`;
        } else if (doc.document_type === 'compiled' && doc.start_year) {
            // If only start_year is available
            return doc.start_year.toString();
        } else if (doc.last_visit_date) {
            // For single documents, use publication date (last_visit_date)
            const date = new Date(doc.last_visit_date);
            const year = date.getFullYear();
            
            if (isNaN(year)) return 'N/A';
            
            return year.toString();
        }
        
        return 'N/A';
    } catch (error) {
        return 'N/A';
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
        
    // Add CSS for tooltip to the page
    const style = document.createElement('style');
    style.textContent = `
        .most-visited-visits {
            position: relative;
        }
        .visits-tooltip {
            position: absolute;
            display: none;
            z-index: 1000;
        }
        .most-visited-row {
            animation: fadeUp 0.4s cubic-bezier(.16,1,.3,1) both;
        }
        @media (prefers-reduced-motion: reduce) {
            .most-visited-row { animation: none; }
        }
        
        /* Compiled Document Modal Styles */
        .compiled-doc-modal {
            font-family: Inter;
        }
        .compiled-doc-modal h3 {
            color: var(--theme-green-darker-text, #00523D);
            font-size: 1.25rem;
        }
        .compiled-doc-modal h4 {
            color: var(--theme-green-dark, #006A4E);
            font-size: 1.1rem;
        }
        .compiled-doc-modal table {
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .compiled-doc-modal tbody tr:hover {
            background-color: var(--theme-gold-lighter-bg, rgba(253, 184, 19, 0.1)) !important;
        }
        .compiled-doc-modal .view-btn {
            transition: background-color 0.2s;
        }
        .compiled-doc-modal .view-btn:hover {
            background-color: var(--theme-green-darker-text, #00523D);
        }
        .compiled-doc-modal .close-btn:hover {
            background-color: #e0e0e0;
        }
        .percentage-bar {
            height: 6px;
            background-color: #eee;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 2px;
        }
        .percentage-bar-fill {
            height: 100%;
            background-color: var(--theme-gold, #FDB813);
        }
    `;
    document.head.appendChild(style);
    
    // Initialize with all time data
    updateMostVisitedWorks();
}); 