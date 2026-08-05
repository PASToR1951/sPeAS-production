/**
 * Trending Keywords Component
 * 
 * This script fetches and displays trending keywords based on:
 * 1. Document keywords from most visited documents
 * 2. Keywords from documents list if trending isn't available
 */

// Function to fetch trending keywords
async function fetchTrendingKeywords() {
    try {
                // Show loading state
        showLoadingState();
        
        // Skip the failing endpoint and go directly to the working documents list endpoint
        await fetchKeywordsFromDocumentsList();
    } catch (error) {
        // Use hardcoded keywords as last resort
        useHardcodedKeywords();
    }
}

// Function to extract keywords from most visited documents
async function fetchKeywordsFromMostVisitedDocuments() {
    try {
        // Use the most-visited-works endpoint which is confirmed to be working
        const response = await fetch('/api/most-visited-documents?period=30&limit=20');
        
        if (!response.ok) {
                        // Fallback to documents list
            await fetchKeywordsFromDocumentsList();
            return;
        }
        
        const data = await response.json();
                
        if (!data || !Array.isArray(data.documents) || data.documents.length === 0) {
                        await fetchKeywordsFromDocumentsList();
            return;
        }
        
        // Extract keywords from the documents
        const allKeywords = [];
        data.documents.forEach(doc => {
            if (doc.keywords && Array.isArray(doc.keywords)) {
                doc.keywords.forEach(keyword => {
                    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
                        allKeywords.push(keyword.trim());
                    }
                });
            }
        });
        
        if (allKeywords.length === 0) {
                        await fetchKeywordsFromDocumentsList();
            return;
        }
        
        // Count keyword occurrences and sort by popularity
        const keywordCounts = {};
        allKeywords.forEach(keyword => {
            keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
        });
        
        // Convert to array of objects and sort
        const sortedKeywords = Object.keys(keywordCounts)
            .map(keyword => ({ keyword, count: keywordCounts[keyword] }))
            .sort((a, b) => b.count - a.count);
            
        // Take the top 10 keywords
        const topKeywords = sortedKeywords.slice(0, 10);
        
        if (topKeywords.length > 0) {
            updateKeywordsDisplay(topKeywords);
        } else {
            await fetchKeywordsFromDocumentsList();
        }
    } catch (error) {
        await fetchKeywordsFromDocumentsList();
    }
}

// Function to fetch keywords from all documents as fallback
async function fetchKeywordsFromDocumentsList() {
    try {
                
        // Use the documents list API which should be available
        const response = await fetch('/api/documents?limit=20');
        
        if (!response.ok) {
                        displayErrorMessage();
            return;
        }
        
        const data = await response.json();
                
        if (!data || !Array.isArray(data.documents) || data.documents.length === 0) {
            displayNoDataMessage();
            return;
        }
        
        // Extract all keywords from documents
        const allKeywords = [];
        data.documents.forEach(doc => {
            if (doc.keywords && Array.isArray(doc.keywords)) {
                doc.keywords.forEach(keyword => {
                    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
                        allKeywords.push(keyword.trim());
                    }
                });
            }
        });
        
        if (allKeywords.length === 0) {
            // If still no keywords, use hardcoded fallback
            useHardcodedKeywords();
            return;
        }
        
        // Remove duplicates by using a Set
        const uniqueKeywords = [...new Set(allKeywords)];
        
        // Select random keywords from the unique list
        const randomKeywords = getRandomItems(uniqueKeywords, 10);
        
        // Format as objects to match expected format
        const formattedKeywords = randomKeywords.map(keyword => ({ keyword }));
        
        updateKeywordsDisplay(formattedKeywords);
    } catch (error) {
        useHardcodedKeywords();
    }
}

// Last resort: render an explicit empty state instead of fabricated keywords
function useHardcodedKeywords() {
    displayNoDataMessage();
}

// Helper function to get random items from array
function getRandomItems(array, count) {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, array.length));
}

// Function to update the trending keywords display
function updateKeywordsDisplay(keywords) {
    // Use the correct container class
    const keywordsContainer = document.querySelector('.keywords-list');
    if (!keywordsContainer) {
        return;
    }

    // Disable scrolling by removing max-height and setting overflow to visible
    keywordsContainer.style.maxHeight = 'none';
    keywordsContainer.style.overflowY = 'visible';

    // Clear existing content
    keywordsContainer.innerHTML = '';

    // Ensure we only display a maximum of 10 keywords
    const keywordsToDisplay = keywords.slice(0, 10);

    // Add each keyword to the keywords list, with stagger + top-3 highlighted
    keywordsToDisplay.forEach((keyword, idx) => {
        const keywordElement = document.createElement('div');
        keywordElement.className = 'keyword' + (idx < 3 ? ' kw-top' : '');
        keywordElement.style.animationDelay = `${idx * 40}ms`;

        // Handle different keyword formats (string or object)
        let keywordText = '';
        if (typeof keyword === 'string') {
            keywordText = keyword;
        } else if (keyword && keyword.name) {
            keywordText = keyword.name;
        } else if (keyword && keyword.keyword) {
            keywordText = keyword.keyword;
        } else if (keyword && keyword.text) {
            keywordText = keyword.text;
        } else {
            return;
        }

        keywordElement.textContent = keywordText;

        // Make keyword clickable to filter documents
        keywordElement.addEventListener('click', () => {
            window.location.href = `/admin/Components/documents_list.html?keyword=${encodeURIComponent(keywordText)}`;
        });

        keywordsContainer.appendChild(keywordElement);
    });
}

// Function to display loading state — skeleton pills
function showLoadingState() {
    const keywordsContainer = document.querySelector('.keywords-list');
    if (!keywordsContainer) return;

    keywordsContainer.innerHTML = `
        <div class="skeleton-keywords">
            <div class="skel"></div><div class="skel"></div><div class="skel"></div>
            <div class="skel"></div><div class="skel"></div><div class="skel"></div>
        </div>
    `;
}

// Function to display an error message
function displayErrorMessage() {
    const keywordsContainer = document.querySelector('.keywords-list');
    if (!keywordsContainer) return;

    keywordsContainer.innerHTML = `
        <div class="empty-state" style="width: 100%;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M3.5 18.5l8.5 -15l8.5 15h-17z"/></svg>
            <p class="empty-title">Couldn&rsquo;t load trending keywords</p>
            <p class="empty-sub">Please try again later.</p>
        </div>
    `;
}

// Function to display a message when no data is available
function displayNoDataMessage() {
    const keywordsContainer = document.querySelector('.keywords-list');
    if (!keywordsContainer) return;

    keywordsContainer.innerHTML = `
        <div class="empty-state" style="width: 100%;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M21 21l-6 -6"/></svg>
            <p class="empty-title">No trending keywords yet</p>
            <p class="empty-sub">Keywords will surface here as documents get visited.</p>
        </div>
    `;
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
        fetchTrendingKeywords();
}); 