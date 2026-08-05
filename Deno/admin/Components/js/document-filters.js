// Global variables for filtering and pagination
let currentPage = 1;
let currentCategoryFilter = null;
let currentSort = 'latest';
let currentSearchQuery = '';
let currentKeyword = '';
let visibleEntriesCount = 0;

/**
 * Filter documents by category
 * @param {string} categoryName - Category name to filter by
 */
function filterByCategory(categoryName) {
        
    // Check if we're clicking the already active category
    const isActiveCategory = document.querySelector(`.category-card[data-category="${categoryName}"].active`) !== null;
    
    if (isActiveCategory) {
        // If clicking the active category, clear the filter and set to All
                currentCategoryFilter = null;
        
        // Remove active class from all categories
        document.querySelectorAll('.category-card').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Set "All" category as active
        document.querySelector('.category-card[data-category="All"]').classList.add('active');
    } else {
        // For API filtering, we just use the category name as is
        // The data-category attributes now match the API values (THESIS, DISSERTATION, etc.)
        currentCategoryFilter = categoryName === 'All' ? null : categoryName;
        
                
        // Update active category styling
        document.querySelectorAll('.category-card').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-category') === categoryName);
        });
    }
    
    currentPage = 1; // Reset to first page when changing filters
    
    // Load documents with the updated filter
    if (window.documentList && window.documentList.loadDocuments) {
        window.documentList.loadDocuments(1, true);
    }
}

/**
 * Filter documents by keyword
 * @param {string} keyword - Keyword to filter by
 */
function filterByKeyword(keyword) {
        
    // Update the current keyword
    currentKeyword = keyword;
    
    // Update the search input to show the keyword
    const searchInput = document.getElementById('search-documents');
    if (searchInput) {
        searchInput.value = keyword;
        currentSearchQuery = keyword;
    }
    
    currentPage = 1; // Reset to first page when changing filters
    
    // Load documents with the updated filter
    if (window.documentList && window.documentList.loadDocuments) {
        window.documentList.loadDocuments(1, true);
    }
}

/**
 * Set up event listeners for category filters
 */
function setupCategoryFilters() {
        
    document.querySelectorAll('.category-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.getAttribute('data-category');
            filterByCategory(category);
        });
    });
}

/**
 * Load categories and update their counts
 */
async function loadCategories() {
        
    try {
        const response = await fetch('/api/categories');
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const categories = await response.json();
                
        // Update category counts
        updateCategoryCounts(categories);
        
    } catch (error) {
    }
}

/**
 * Update category counts in the UI
 * @param {Array} categories - Array of category objects with counts
 */
function updateCategoryCounts(categories) {
        
    // Calculate total documents across all categories
    let totalDocs = 0;
    categories.forEach(cat => {
        totalDocs += Number(cat.count);
    });
    
        
    // Update the "All" category count
    const allCountElement = document.querySelector('.category-card[data-category="All"] .category-count');
    if (allCountElement) {
        allCountElement.textContent = `${totalDocs} ${totalDocs === 1 ? 'entry' : 'entries'}`;
            } else {
    }
    
    // Map API document_type values to the data-category attribute values in HTML
    // Note: In document_list.html, data-category uses Title Case (Thesis, Dissertation, etc.)
    // But in archive-documents.html, data-category uses UPPERCASE (THESIS, DISSERTATION, etc.)
    // So we need to check both formats
    categories.forEach(category => {
        const categoryName = category.name; // This is in UPPERCASE from API (e.g., "THESIS")
        const count = Number(category.count);
        
        // Try both UPPERCASE and Title Case versions
        const uppercaseSelector = `.category-card[data-category="${categoryName}"] .category-count`;
        const titleCaseSelector = `.category-card[data-category="${categoryName.charAt(0) + categoryName.slice(1).toLowerCase()}"] .category-count`;
        
                
        // First try the uppercase version (for archive-documents.html)
        let countElement = document.querySelector(uppercaseSelector);
        
        // If not found, try the title case version (for documents_list.html)
        if (!countElement) {
            countElement = document.querySelector(titleCaseSelector);
        }
        
        if (countElement) {
            countElement.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
                    } else {
        }
    });
}

/**
 * Set up event listeners for sort order dropdown
 */
function setupSortOrder() {
        
    const sortOrderSelect = document.getElementById('sort-order');
    if (sortOrderSelect) {
        sortOrderSelect.addEventListener('change', function() {
            if (window.documentList && window.documentList.loadDocuments) {
                window.documentList.loadDocuments(1, true);
            }
        });
    }
}

/**
 * Set up event listeners for pagination controls
 */
function setupPaginationControls() {
        
    const pageLinks = document.getElementById('page-links');
    if (pageLinks) {
        pageLinks.addEventListener('click', function(e) {
            if (e.target.matches('.page-link')) {
                e.preventDefault();
                const page = parseInt(e.target.getAttribute('data-page'));
                if (!isNaN(page) && window.documentList && window.documentList.loadDocuments) {
                    window.documentList.loadDocuments(page);
                }
            }
        });
    }
}

/**
 * Update pagination controls based on total pages
 * @param {number} totalPages - Total number of pages
 */
function updatePagination(totalPages) {
        
    const pageLinks = document.getElementById('page-links');
    if (!pageLinks) return;
    
    // Clear existing pagination
    pageLinks.innerHTML = '';
    
    if (totalPages <= 1) {
        // No pagination needed
        return;
    }
    
    // Previous button
    const prevButton = document.createElement('button');
    prevButton.classList.add('page-link', 'prev-button');
    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevButton.disabled = currentPage === 1;
    prevButton.setAttribute('data-page', Math.max(1, currentPage - 1));
    prevButton.setAttribute('aria-label', 'Previous page');
    prevButton.title = 'Previous page';
    pageLinks.appendChild(prevButton);
    
    // Determine which page numbers to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // Adjust start page if we're near the end
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    // First page button (if not in range)
    if (startPage > 1) {
        const firstPageButton = document.createElement('button');
        firstPageButton.classList.add('page-link', 'page-number');
        firstPageButton.textContent = '1';
        firstPageButton.setAttribute('data-page', 1);
        pageLinks.appendChild(firstPageButton);
        
        // Add ellipsis if there's a gap
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.classList.add('page-ellipsis');
            ellipsis.textContent = '...';
            pageLinks.appendChild(ellipsis);
        }
    }
    
    // Page number buttons
    for (let i = startPage; i <= endPage; i++) {
        const pageButton = document.createElement('button');
        pageButton.classList.add('page-link', 'page-number');
        if (i === currentPage) {
            pageButton.classList.add('active');
        }
        pageButton.textContent = i;
        pageButton.setAttribute('data-page', i);
        pageButton.setAttribute('aria-label', `Page ${i}`);
        pageButton.title = `Go to page ${i}`;
        if (i === currentPage) {
            pageButton.setAttribute('aria-current', 'page');
        }
        pageLinks.appendChild(pageButton);
    }
    
    // Last page button (if not in range)
    if (endPage < totalPages) {
        // Add ellipsis if there's a gap
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.classList.add('page-ellipsis');
            ellipsis.textContent = '...';
            pageLinks.appendChild(ellipsis);
        }
        
        const lastPageButton = document.createElement('button');
        lastPageButton.classList.add('page-link', 'page-number');
        lastPageButton.textContent = totalPages;
        lastPageButton.setAttribute('data-page', totalPages);
        pageLinks.appendChild(lastPageButton);
    }
    
    // Next button
    const nextButton = document.createElement('button');
    nextButton.classList.add('page-link', 'next-button');
    nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextButton.disabled = currentPage === totalPages;
    nextButton.setAttribute('data-page', Math.min(totalPages, currentPage + 1));
    nextButton.setAttribute('aria-label', 'Next page');
    nextButton.title = 'Next page';
    pageLinks.appendChild(nextButton);
    
    // Update entries info
    updateEntriesInfo();
}

/**
 * Update entries information display
 */
function updateEntriesInfo() {
    const entriesInfo = document.getElementById('entries-info');
    if (entriesInfo) {
        entriesInfo.textContent = `Showing ${visibleEntriesCount} ${visibleEntriesCount === 1 ? 'entry' : 'entries'}`;
    }
}

/**
 * Update filter indicator based on current filter
 */
function updateFilterIndicator() {
    // Function intentionally left empty to remove filter indicator
    // The category buttons themselves now show the active state
}

/**
 * Initialize filters, pagination, and check for URL parameters
 */
function initializeFiltersAndPagination() {
        
    // Set up category filters
    setupCategoryFilters();
    
    // Set up sort order
    setupSortOrder();
    
    // Set up pagination
    setupPaginationControls();
    
    // Set up search input
    setupSearchInput();
    
    // Make functions available globally for external components
    window.documentFilters = {
        setCurrentPage,
        setVisibleEntriesCount,
        getCurrentCategoryFilter,
        getCurrentSortOrder,
        getCurrentSearchQuery,
        getCurrentKeyword,
        getCurrentPage,
        updatePagination,
        filterByKeyword
    };
    
    // Check for URL parameters
    const url = new URL(window.location.href);
    
    // Check for keyword parameter
    const keyword = url.searchParams.get('keyword');
    if (keyword) {
                currentKeyword = keyword;
        // Set the search query to the keyword to display matching documents
        currentSearchQuery = keyword;
        
        // Update the search input to show the keyword
        const searchInput = document.getElementById('search-documents');
        if (searchInput) {
            searchInput.value = keyword;
        }
    }
    
    // Load categories
    loadCategories();
    
    }

/**
 * Update the page number for pagination
 * @param {number} page - New page number
 */
function setCurrentPage(page) {
        currentPage = page;
}

/**
 * Update the number of visible entries for pagination info
 * @param {number} count - Number of visible entries
 */
function setVisibleEntriesCount(count) {
    visibleEntriesCount = count;
    updateEntriesInfo();
}

/**
 * Get the current category filter
 * @returns {string|null} Current category filter or null
 */
function getCurrentCategoryFilter() {
    return currentCategoryFilter;
}

/**
 * Get the current sort order
 * @returns {string} Current sort order
 */
function getCurrentSortOrder() {
    const sortSelect = document.getElementById('sort-order');
    return sortSelect ? sortSelect.value : currentSort;
}

/**
 * Get the current page number
 * @returns {number} Current page number
 */
function getCurrentPage() {
    return currentPage;
}

/**
 * Get the current keyword filter
 * @returns {string} Current keyword filter
 */
function getCurrentKeyword() {
    return currentKeyword;
}

/**
 * Set up search input event listeners
 */
function setupSearchInput() {
    const searchInput = document.getElementById('search-documents');
    if (searchInput) {
        // Function to toggle search icon visibility
        const toggleSearchIcon = () => {
            const searchIcon = document.querySelector('.search-icon');
            if (searchIcon) {
                searchIcon.style.opacity = searchInput.value.trim() ? '0' : '1';
                searchIcon.style.visibility = searchInput.value.trim() ? 'hidden' : 'visible';
            }
        };
        
        // Check icon visibility on input changes
        searchInput.addEventListener('input', function() {
            currentSearchQuery = this.value.trim();
            currentPage = 1; // Reset to first page when searching
            
            // Toggle search icon visibility
            toggleSearchIcon();
            
            if (window.documentList && window.documentList.loadDocuments) {
                // Store the search query so we can process it after loading documents
                window.documentList.currentSearchQuery = currentSearchQuery;
                
                // Load documents with search
                window.documentList.loadDocuments(1, true);
            }
        });
        
        // Also check on initial load
        toggleSearchIcon();
    }
}

/**
 * Get the current search query
 * @returns {string} Current search query
 */
function getCurrentSearchQuery() {
    return currentSearchQuery;
}

/**
 * Reset all filters to their default state
 */
function resetFilters() {
    // Reset category filter
    currentCategoryFilter = null;
    document.querySelectorAll('.category-card').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Set "All" category as active
    const allCategory = document.querySelector('.category[data-category="All"]');
    if (allCategory) {
        allCategory.classList.add('active');
    }
    
    // Reset page
    currentPage = 1;
    
    // Reset sort order
    const sortOrderSelect = document.getElementById('sort-order');
    if (sortOrderSelect) {
        sortOrderSelect.value = 'latest';
        currentSort = 'latest';
    }
    
    // Reset search query
    currentSearchQuery = '';
    const searchInput = document.getElementById('search-documents');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Load documents with reset filters
    if (window.documentList && window.documentList.loadDocuments) {
        window.documentList.loadDocuments(1, true);
    }
}

// Export functions for use in other modules - only if not already defined
if (!window.documentFilters) {
    window.documentFilters = {
        initializeFiltersAndPagination,
        setCurrentPage,
        setVisibleEntriesCount,
        getCurrentCategoryFilter,
        getCurrentSortOrder,
        getCurrentPage,
        getCurrentSearchQuery,
        getCurrentKeyword,
        updatePagination,
        updateFilterIndicator,
        resetFilters
    };
}
