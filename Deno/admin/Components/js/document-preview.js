/**
 * Document preview module
 * This file handles document preview functionality
 */

// Document preview object to be exported
window.documentPreview = {
    showPreviewModal,
    closePreviewModal,
    openPdfViewer,
    closePdfModal
};

/**
 * Show the preview modal for a document
 * @param {string|number} documentId - The ID of the document to preview
 */
async function showPreviewModal(documentId) {
        
    try {
        // Fetch document details from API
        const response = await fetch(`/api/documents/${documentId}`);
        if (!response.ok) {
            throw new Error(`Error fetching document: ${response.status}`);
        }
        
        const docData = await response.json();
                
        // Fetch authors separately to ensure we get them
        let authors = [];
        try {
            const authorsResponse = await fetch(`/api/document-authors/${documentId}`);
            if (authorsResponse.ok) {
                const authorsData = await authorsResponse.json();
                authors = authorsData.authors || [];
                            }
        } catch (authorError) {
            // Continue with empty authors array
        }
        
        // Populate the preview modal with document data
        const previewModal = document.getElementById('preview-modal');
        
        // Title
        const previewTitle = document.getElementById('previewTitle');
        if (previewTitle) {
            previewTitle.textContent = docData.title || 'Untitled Document';
        }
        
        // Author(s)
        const previewAuthor = document.getElementById('previewAuthor');
        if (previewAuthor) {
            let authorText = 'Unknown Author';
            
            // First try with fetched authors
            if (authors && Array.isArray(authors) && authors.length > 0) {
                authorText = authors
                    .map(author => {
                        return author.full_name || `${author.first_name || ''} ${author.last_name || ''}`.trim();
                    })
                    .filter(name => name) // Remove empty names
                    .join(', ');
            } 
            // Fallback to document authors if available
            else if (docData.authors && Array.isArray(docData.authors) && docData.authors.length > 0) {
                authorText = docData.authors
                    .map(author => {
                        if (typeof author === 'string') return author;
                        return author.full_name || `${author.first_name || ''} ${author.last_name || ''}`.trim();
                    })
                    .filter(name => name) // Remove empty names
                    .join(', ');
            }
            
            previewAuthor.textContent = `by ${authorText}`;
        }
        
        // Publishing date
        const previewPublishDate = document.getElementById('previewPublishDate');
        if (previewPublishDate) {
            const date = docData.publish_date || docData.publication_date;
            previewPublishDate.textContent = date ? new Date(date).toLocaleDateString() : 'Unknown';
        }
        
        // Topics
        const previewTopics = document.getElementById('previewTopics');
        if (previewTopics) {
            let topicsText = 'None';
            
            if (docData.topics && Array.isArray(docData.topics) && docData.topics.length > 0) {
                topicsText = docData.topics
                    .map(topic => typeof topic === 'string' ? topic : (topic.name || ''))
                    .filter(name => name)
                    .join(', ');
            }
            
            previewTopics.textContent = topicsText;
        }
        
        // Pages (if available)
        const previewPages = document.getElementById('previewPages');
        if (previewPages) {
            previewPages.textContent = docData.pages || docData.page_count || 'Unknown';
        }
        
        // Added date
        const previewAddedDate = document.getElementById('previewAddedDate');
        if (previewAddedDate) {
            const date = docData.created_at || docData.added_date;
            previewAddedDate.textContent = date ? new Date(date).toLocaleDateString() : 'Unknown';
        }
        
        // Abstract
        const previewAbstract = document.getElementById('previewAbstract');
        if (previewAbstract) {
            previewAbstract.textContent = docData.abstract || docData.description || 'No abstract available.';
        }
        
        // Set read document button action
        const readDocumentBtn = document.getElementById('readDocumentBtn');
        if (readDocumentBtn) {
            readDocumentBtn.onclick = function() {
                // Use docData if it has file_path, otherwise fetch document details again
                if (docData && docData.file_path) {
                    const pdfPath = `${window.location.origin}/api/documents/${encodeURIComponent(documentId)}/download?disposition=inline`;
                    window.open(pdfPath, '_blank');
                } else {
                    // Fetch document details if file_path is not available
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
                                alert('PDF path not found for this document');
                            }
                        })
                        .catch(error => {
                            alert(`Error opening document: ${error.message}`);
                        });
                }
            };
        }
        
        // Display the modal
        previewModal.style.display = 'flex';
        
    } catch (error) {
        alert(`Error loading document preview: ${error.message}`);
    }
}

/**
 * Close the preview modal
 */
function closePreviewModal() {
    const previewModal = document.getElementById('preview-modal');
    if (previewModal) {
        previewModal.style.display = 'none';
    }
}

/**
 * Open the PDF viewer for a document
 * @param {string|number} documentId - The ID of the document to view
 */
function openPdfViewer(documentId) {
        
    try {
        // First try to fetch the document to verify it exists and get its file path
        fetch(`/api/documents/${documentId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error fetching document: ${response.status}`);
                }
                return response.json();
            })
            .then(doc => {
                if (!doc) {
                    throw new Error('Document not found');
                }
                
                // If we have a document file, use the authenticated inline route.
                if (doc.file_path) {
                    const pdfPath = `${window.location.origin}/api/documents/${encodeURIComponent(doc.id || documentId)}/download?disposition=inline`;
                    window.open(pdfPath, '_blank');
                    return;
                }
                
                // If no direct file path, use the PDF endpoint in the viewer
                const pdfViewer = document.getElementById('pdf-viewer');
                if (pdfViewer) {
                    const pdfUrl = `/api/documents/${encodeURIComponent(documentId)}/download?disposition=inline`;
                                        pdfViewer.src = pdfUrl;
                    
                    // Set modal title
                    const modalTitle = document.getElementById('pdf-modal-title');
                    if (modalTitle && doc.title) {
                        modalTitle.textContent = doc.title;
                    }
                    
                    // Show the modal
                    const pdfModal = document.getElementById('pdf-modal');
                    if (pdfModal) {
                        pdfModal.style.display = 'flex';
                        pdfModal.classList.add('active');
                    } else {
                        // Fallback: open in new tab
                        window.open(pdfUrl, '_blank');
                    }
                } else {
                    window.open(`/api/documents/${encodeURIComponent(documentId)}/download?disposition=inline`, '_blank');
                }
            })
            .catch(error => {
                // Fallback: Try to open the document directly
                const fallbackUrl = `/api/documents/${encodeURIComponent(documentId)}/download?disposition=inline`;
                                window.open(fallbackUrl, '_blank');
            });
    } catch (error) {
        alert(`Error opening document: ${error.message}. Please try the Read Document button instead.`);
    }
}

/**
 * Close the PDF viewer modal
 */
function closePdfModal() {
    const pdfModal = document.getElementById('pdf-modal');
    if (pdfModal) {
        pdfModal.style.display = 'none';
        pdfModal.classList.remove('active');
        
        // Clear the iframe source to stop loading the PDF
        const pdfViewer = document.getElementById('pdf-viewer');
        if (pdfViewer) {
            pdfViewer.src = '';
        }
    }
}

// Set up global functions for use in other scripts
window.showPreviewModal = showPreviewModal;
window.closePreviewModal = closePreviewModal;
window.openPdfViewer = openPdfViewer;
window.closePdfModal = closePdfModal;

// Initialize event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
        
    // Close preview modal when clicking the close button
    const previewCloseButton = document.querySelector('.preview-close');
    if (previewCloseButton) {
        previewCloseButton.addEventListener('click', closePreviewModal);
    }
    
    // Close PDF modal when clicking the close button
    const pdfCloseButton = document.querySelector('#pdf-modal .close-button');
    if (pdfCloseButton) {
        pdfCloseButton.addEventListener('click', closePdfModal);
    }
});
