/**
 * Most Visited Documents Component
 * 
 * This script fetches and displays the most visited documents 
 * in the admin dashboard.
 */

// Function to update the most visited documents section
async function updateMostVisitedDocuments(limit = 5, days = 30) {
    try {
                const response = await fetch(`/api/page-visits/most-visited-documents?limit=${limit}&days=${days}`);
        
        if (!response.ok) {
                        displayErrorMessage();
            return;
        }
        
        const data = await response.json();
                
        if (!data.documents || data.documents.length === 0) {
            displayNoDataMessage();
            return;
        }
        
        updateMostVisitedDocumentsUI(data.documents);
    } catch (error) {
        displayErrorMessage();
    }
}

// Function to update the UI with the most visited documents data
function updateMostVisitedDocumentsUI(documents) {
    // Get the documents list container
    const documentsListContainer = document.querySelector('.most-visited-documents-list');
    if (!documentsListContainer) {
        return;
    }
    
    // Clear existing content
    documentsListContainer.innerHTML = '';
    
    // Add each document to the list
    documents.forEach((doc, index) => {
        const documentElement = document.createElement('div');
        documentElement.className = 'document-item flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors';
        
        // Format the document type for display
        const documentType = formatDocumentType(doc.document_type);
        
        // Create DOM elements
        const rankDiv = document.createElement('div');
        rankDiv.className = 'document-rank w-8 flex-shrink-0 font-bold text-gray-500';
        rankDiv.textContent = `#${index + 1}`;
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'document-info flex-grow px-3';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'document-title font-medium text-green-800 truncate';
        titleDiv.textContent = doc.title || `Document ID: ${doc.document_id}`;
        titleDiv.title = doc.title || `Document ID: ${doc.document_id}`; // Add title for tooltip
        
        const typeDiv = document.createElement('div');
        typeDiv.className = 'document-type text-xs text-gray-500';
        typeDiv.textContent = documentType;
        
        const statsDiv = document.createElement('div');
        statsDiv.className = 'document-stats flex-shrink-0 text-right';
        
        const visitsDiv = document.createElement('div');
        visitsDiv.className = 'document-visits font-semibold text-amber-600';
        visitsDiv.textContent = `${doc.visit_count} visits`;
        
        const dateDiv = document.createElement('div');
        dateDiv.className = 'document-last-visit text-xs text-gray-500';
        dateDiv.textContent = doc.last_visit_date ? formatDate(doc.last_visit_date) : 'N/A';
        
        // Link to view the document
        const documentLink = document.createElement('a');
        documentLink.href = `/document/${doc.document_id}`;
        documentLink.className = 'block w-full h-full cursor-pointer'; 
        
        // Assemble the document item
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(typeDiv);
        
        statsDiv.appendChild(visitsDiv);
        statsDiv.appendChild(dateDiv);
        
        documentElement.appendChild(rankDiv);
        documentElement.appendChild(infoDiv);
        documentElement.appendChild(statsDiv);
        
        documentLink.appendChild(documentElement);
        documentsListContainer.appendChild(documentLink);
    });
    
    // Show the container 
    const containerElement = document.querySelector('.most-visited-documents-container');
    if (containerElement) {
        containerElement.classList.remove('hidden');
    }
}

// Function to display an error message when data fetch fails
function displayErrorMessage() {
    const documentsListContainer = document.querySelector('.most-visited-documents-list');
    if (!documentsListContainer) return;
    
    documentsListContainer.innerHTML = `
        <div class="text-center py-4 text-gray-500">
            <p>Could not load document visit data.</p>
            <p class="text-sm mt-1">Please try again later.</p>
        </div>
    `;
    
    // Show the container
    const containerElement = document.querySelector('.most-visited-documents-container');
    if (containerElement) {
        containerElement.classList.remove('hidden');
    }
}

// Function to display a message when no data is available
function displayNoDataMessage() {
    const documentsListContainer = document.querySelector('.most-visited-documents-list');
    if (!documentsListContainer) return;
    
    documentsListContainer.innerHTML = `
        <div class="text-center py-4 text-gray-500">
            <p>No document visit data available yet.</p>
            <p class="text-sm mt-1">Data will appear here as documents are viewed.</p>
        </div>
    `;
    
    // Show the container
    const containerElement = document.querySelector('.most-visited-documents-container');
    if (containerElement) {
        containerElement.classList.remove('hidden');
    }
}

// Helper function to format document type for display
function formatDocumentType(type) {
    if (!type) return 'Unknown Type';
    
    type = type.toLowerCase();
    
    switch (type) {
        case 'single':
            return 'Single Document';
        case 'compiled':
            return 'Compiled Document';
        default:
            // Capitalize first letter of each word
            return type.replace(/\b\w/g, l => l.toUpperCase());
    }
}

// Helper function to format date
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric'
        });
    } catch (error) {
        return 'N/A';
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
        // Get the select element for time period if it exists
    const timeSelectElement = document.getElementById('most-visited-time-period');
    
    // Initial update
    updateMostVisitedDocuments();
    
    // Add event listener for time period changes
    if (timeSelectElement) {
        timeSelectElement.addEventListener('change', () => {
            const days = parseInt(timeSelectElement.value);
            updateMostVisitedDocuments(5, days);
        });
    }
}); 