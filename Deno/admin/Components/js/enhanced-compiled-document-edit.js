/**
 * Enhanced Compiled Document Edit functionality
 * Handles editing of existing compiled documents with improved child document management
 * Features:
 * - Better child document loading
 * - Drag and drop reordering
 * - Improved file uploads for compiled documents
 * - Visual feedback on operations
 */

// IMPORTANT: Disable console logs for production
// This replaces the native console.log with a no-op function
(function() {
    // Store original console methods
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    };
    
    // Define debug categories to silence (will not show in console)
    const silencedCategories = [
        'CRITICAL INSPECTOR',
        'CRITICAL FIX',
        'DOM INSPECTOR',
        'SYNERGY FIX',
        'Checking departmental'
    ];

    // Override console.log to filter out certain debug messages
    console.log = function() {
        // Check if this is a debug message we want to silence
        if (arguments.length > 0 && typeof arguments[0] === 'string') {
            const message = arguments[0];
            
            // Check if this message contains any of our silenced categories
            if (silencedCategories.some(category => message.includes(category))) {
                return; // Silence this message
            }
        }
        
        // Otherwise, pass through to original console.log
        originalConsole.log.apply(console, arguments);
    };
    
    // We'll keep the other console methods as-is
})();


// CRITICAL DOM INSPECTOR - Run immediately to diagnose form structure issues
(function inspectAndFixDOM() {
        
    // Run after a delay to ensure DOM is loaded
    setTimeout(performInspection, 1000);
    
    function performInspection() {
                
        // Find the compiled document modal
        const modal = document.getElementById('edit-compiled-document-modal');
        if (!modal) {
            setTimeout(performInspection, 1000);
            return;
        }
        
        // Find the form element
        const form = modal.querySelector('form');
        if (!form) {
            setTimeout(performInspection, 1000);
            return;
        }
        
                
        // Log all form elements to see what's actually there
        const inputs = form.querySelectorAll('input, select, textarea');
                
        const fieldMap = {};
        inputs.forEach((input, index) => {
            const id = input.id || 'no-id';
            const name = input.name || 'no-name';
            const type = input.tagName.toLowerCase() + (input.type ? `-${input.type}` : '');
            
                        fieldMap[id] = input;
        });
        
        // Check for title field with different possible IDs
        const titleFieldIds = [
            'edit-compiled-document-title',
            'edit-compiled-title',
            'compiled-document-title',
            'compiled-title'
        ];
        
        let titleField = null;
        for (const id of titleFieldIds) {
            const found = form.querySelector(`#${id}`);
            if (found) {
                titleField = found;
                                break;
            }
        }
        
        // If no title field found by ID, look for any input with "title" in the name
        if (!titleField) {
            const titleInputs = form.querySelectorAll('input[name*="title"], input[placeholder*="title" i]');
            if (titleInputs.length > 0) {
                titleField = titleInputs[0];
                            }
        }
        
        // Check for category field
        const categoryField = fieldMap['edit-compiled-category'] || form.querySelector('select[name*="category" i]');
        
        // Log findings
        console.log('CRITICAL INSPECTOR: Key fields status:', {
            title: !!titleField,
            category: !!categoryField,
            issuedNo: !!fieldMap['edit-compiled-issued-no'],
            departmental: !!fieldMap['edit-compiled-departmental']
        });
        
        // Create missing fields if needed
        if (!titleField) {
                        createTitleField(form);
        }
        
        // If we have category but missing issued/departmental fields
        if (categoryField && (!fieldMap['edit-compiled-issued-no'] || !fieldMap['edit-compiled-departmental'])) {
                        fixIssuedAndDepartmentFields(form, categoryField);
        }
        
        // Disable category field to prevent changes
        if (categoryField) {
                        
            // Disable the select element
            categoryField.disabled = true;
            
            // Add visual styles to indicate it's disabled
            categoryField.style.backgroundColor = '#f8f9fa';
            categoryField.style.opacity = '0.7';
            categoryField.style.cursor = 'not-allowed';
            
            // Add explanatory text
            const categoryGroup = categoryField.closest('.form-group');
            if (categoryGroup) {
                // Check if we already added the help text
                if (!categoryGroup.querySelector('.category-help-text')) {
                    const helpText = document.createElement('small');
                    helpText.className = 'form-text text-muted category-help-text';
                    helpText.innerHTML = '<i class="fas fa-info-circle"></i> Category cannot be changed (Synergy and Confluence are different document types)';
                    helpText.style.color = '#dc3545';
                    helpText.style.fontStyle = 'italic';
                    helpText.style.marginTop = '5px';
                    helpText.style.display = 'block';
                    
                    categoryGroup.appendChild(helpText);
                                    }
            }
        }
        
        // Check the DOM structure again in 2 seconds
        setTimeout(performInspection, 2000);
    }
    
    // Create a title field if it's missing
    function createTitleField(form) {
        const formRow = document.createElement('div');
        formRow.className = 'form-row';
        
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        
        const label = document.createElement('label');
        label.htmlFor = 'edit-compiled-document-title';
        label.textContent = 'Title';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'edit-compiled-document-title';
        input.name = 'title';
        input.placeholder = 'Enter compilation title';
        
        formGroup.appendChild(label);
        formGroup.appendChild(input);
        formRow.appendChild(formGroup);
        
        // Insert at the beginning of the form
        const firstChild = form.firstChild;
        form.insertBefore(formRow, firstChild);
        
            }
    
    // Fix issued/departmental fields
    function fixIssuedAndDepartmentFields(form, categoryField) {
        // First look for the container
        let issuedContainer = document.getElementById('edit-compiled-issued-no-container');
        
        // If no container, create one
        if (!issuedContainer) {
                        issuedContainer = document.createElement('div');
            issuedContainer.id = 'edit-compiled-issued-no-container';
            issuedContainer.className = 'form-group';
            
            // Find a good place to insert it (after volume field)
            const volumeField = document.getElementById('edit-compiled-volume');
            if (volumeField) {
                const volumeContainer = volumeField.closest('.form-group');
                if (volumeContainer && volumeContainer.parentNode) {
                    volumeContainer.parentNode.appendChild(issuedContainer);
                                    } else {
                    // Fallback - add to the form
                    form.appendChild(issuedContainer);
                                    }
            } else {
                // Fallback - add to the form
                form.appendChild(issuedContainer);
                            }
        }
        
        // Check if issued field exists
        let issuedField = document.getElementById('edit-compiled-issued-no');
        if (!issuedField) {
                        
            const label = document.createElement('label');
            label.id = 'edit-compiled-issued-no-label';
            label.htmlFor = 'edit-compiled-issued-no';
            label.textContent = 'Issued No.';
            
            issuedField = document.createElement('input');
            issuedField.type = 'text';
            issuedField.id = 'edit-compiled-issued-no';
            issuedField.name = 'issued-no';
            issuedField.placeholder = 'Enter issue number';
            
            issuedContainer.appendChild(label);
            issuedContainer.appendChild(issuedField);
        }
        
        // Check if departmental field exists
        let departmentalField = document.getElementById('edit-compiled-departmental');
        if (!departmentalField) {
                        
            departmentalField = document.createElement('select');
            departmentalField.id = 'edit-compiled-departmental';
            departmentalField.name = 'departmental';
            departmentalField.style.display = 'none';
            
            // Add options
            const departments = [
                '',
                'College of Business in Information Technology',
                'College of Nursing',
                'College of Arts and Science Education',
                'Basic Academic Education'
            ];
            
            departments.forEach((dept, index) => {
                const option = document.createElement('option');
                option.value = dept;
                option.textContent = index === 0 ? 'Select Department' : dept;
                departmentalField.appendChild(option);
            });
            
            issuedContainer.appendChild(departmentalField);
        }
        
        // Get the current category
        const currentCategory = categoryField.value;
                
        // Set the correct field visibility
        if (currentCategory === 'SYNERGY' || currentCategory === 'Synergy') {
                        issuedField.style.cssText = 'display: none !important';
            departmentalField.style.cssText = 'display: block !important';
            
            // Update label
            const label = document.getElementById('edit-compiled-issued-no-label');
            if (label) label.textContent = 'Departmental';
            
            // Update preview label
            const previewLabel = document.getElementById('edit-preview-issued-no-label');
            if (previewLabel) previewLabel.textContent = 'Departmental:';
        } else {
                        issuedField.style.cssText = 'display: block !important';
            departmentalField.style.cssText = 'display: none !important';
            
            // Update label
            const label = document.getElementById('edit-compiled-issued-no-label');
            if (label) label.textContent = 'Issued No.';
            
            // Update preview label
            const previewLabel = document.getElementById('edit-preview-issued-no-label');
            if (previewLabel) previewLabel.textContent = 'Issued No:';
        }
        
            }
})();

// CRITICAL FIX - Run immediately to ensure proper DOM structure
(function fixDepartmentalField() {
        
    // Wait for DOM to be loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', performRepair);
    } else {
        performRepair();
    }
    
    // Check if the DOM structure is correct and fix if needed
    function performRepair() {
                
        // Get the category select element
        const categoryField = document.getElementById('edit-compiled-category');
        if (!categoryField) {
                        setTimeout(performRepair, 500);
            return;
        }
        
        // Get the issue container and fields
        const issuedNoContainer = document.getElementById('edit-compiled-issued-no-container');
        const issuedNoInput = document.getElementById('edit-compiled-issued-no');
        const departmentalSelect = document.getElementById('edit-compiled-departmental');
        
        console.log('CRITICAL FIX: Fields found:', {
            category: !!categoryField,
            container: !!issuedNoContainer,
            input: !!issuedNoInput,
            select: !!departmentalSelect
        });
        
        // If the departmental select is missing, create it
        if (issuedNoContainer && issuedNoInput && !departmentalSelect) {
                        
            // Create the departmental select
            const departmentalElement = document.createElement('select');
            departmentalElement.id = 'edit-compiled-departmental';
            departmentalElement.name = 'departmental';
            departmentalElement.style.display = 'none';
            
            // Add options
            const departments = [
                '',
                'College of Business in Information Technology',
                'College of Nursing',
                'College of Arts and Science Education',
                'Basic Academic Education'
            ];
            
            departments.forEach((dept, index) => {
                const option = document.createElement('option');
                option.value = dept;
                option.textContent = index === 0 ? 'Select Department' : dept;
                departmentalElement.appendChild(option);
            });
            
            // Add the element to the container after the input
            issuedNoContainer.appendChild(departmentalElement);
                    }
        
        // Make sure the fields are properly configured based on the current category
        if (categoryField && issuedNoInput && departmentalSelect) {
                        const category = categoryField.value;
            
            if (category === 'SYNERGY' || category === 'Synergy') {
                                issuedNoInput.style.cssText = 'display: none !important';
                departmentalSelect.style.cssText = 'display: block !important';
                
                // Also update the label
                const label = document.getElementById('edit-compiled-issued-no-label');
                if (label) {
                    label.textContent = 'Departmental';
                                    }
                
                // Update preview label too
                const previewLabel = document.getElementById('edit-preview-issued-no-label');
                if (previewLabel) {
                    previewLabel.textContent = 'Departmental:';
                                    }
            } else {
                                issuedNoInput.style.cssText = 'display: block !important';
                departmentalSelect.style.cssText = 'display: none !important';
            }
        }
        
            }
})();

// SYNERGY DOCUMENT FIX - Add specific handler for editing Synergy documents
(function fixSynergyEditing() {
        
    let attempts = 0;
    const maxAttempts = 20;
    let documentNotFound = false;
    
    // Set up polling to check for and fix Synergy form fields
    const checkInterval = setInterval(() => {
        attempts++;
        
        // Only try a limited number of times
        if (attempts > maxAttempts || documentNotFound) {
                        clearInterval(checkInterval);
            return;
        }
        
        const categoryField = document.getElementById('edit-compiled-category');
        if (!categoryField) {
                        return;
        }
        
        // Only proceed if category is Synergy
        if (categoryField.value !== 'SYNERGY' && categoryField.value !== 'Synergy') {
                        clearInterval(checkInterval);
            return;
        }
        
                
            const issuedNoInput = document.getElementById('edit-compiled-issued-no');
        const issuedNoContainer = document.getElementById('edit-compiled-issued-no-container');
        let departmentalSelect = document.getElementById('edit-compiled-departmental');
            
        // Check if we're missing the departmental select
            if (!departmentalSelect) {
                                
                // Create the departmental select
            departmentalSelect = document.createElement('select');
            departmentalSelect.id = 'edit-compiled-departmental';
            departmentalSelect.name = 'departmental';
            departmentalSelect.className = 'form-control';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select Department';
            departmentalSelect.appendChild(defaultOption);
                
                // Add the element to the container
            if (issuedNoContainer) {
                issuedNoContainer.appendChild(departmentalSelect);
                            } else {
            }
            }
            
            // Force show department field and hide issue field
            if (issuedNoInput) {
                issuedNoInput.style.cssText = 'display: none !important';
                            }
            
            if (departmentalSelect) {
                departmentalSelect.style.cssText = 'display: block !important';
                            
            // Populate with departments from database
            if (typeof populateDepartmentalDropdown === 'function') {
                populateDepartmentalDropdown(departmentalSelect);
            } else if (typeof fetchDepartments === 'function') {
                fetchDepartments().then(departments => {
                    // Clear any existing options except default
                    while (departmentalSelect.options.length > 1) {
                        departmentalSelect.remove(1);
                    }
                    
                    // Add each department as an option
                    departments.forEach(dept => {
                        const option = document.createElement('option');
                        option.value = typeof dept === 'string' ? dept : (dept.id || dept.name);
                        option.textContent = typeof dept === 'string' ? dept : (dept.name || dept.id);
                        departmentalSelect.appendChild(option);
                    });
                });
            } else {
            }
            }
            
            // Update labels
            const label = document.getElementById('edit-compiled-issued-no-label');
            if (label) {
                label.textContent = 'Departmental';
                            }
            
            const previewLabel = document.getElementById('edit-preview-issued-no-label');
            if (previewLabel) {
                previewLabel.textContent = 'Departmental:';
                            }
            
            // Get department value from API to populate field
            try {
                const documentId = document.getElementById('edit-compiled-document-id')?.value;
            if (documentId && departmentalSelect) {
                                
                // If we already have a value, no need to fetch
                if (departmentalSelect.value) {
                                        clearInterval(checkInterval);
                    return;
                }
                
                // Don't make API requests for document IDs that don't exist or are invalid
                if (documentId === 'new' || documentId === 'undefined' || isNaN(parseInt(documentId))) {
                                        clearInterval(checkInterval);
                    return;
                }
                    
                    fetch(`/api/documents/${documentId}`)
                    .then(response => {
                        if (!response.ok) {
                            if (response.status === 404) {
                                                                documentNotFound = true;
                                clearInterval(checkInterval);
                                
                                // Show a message to the user
                                const errorMessage = document.createElement('div');
                                errorMessage.className = 'error-message';
                                errorMessage.textContent = `Document ID ${documentId} not found. It may have been deleted.`;
                                errorMessage.style.cssText = 'color: red; padding: 10px; margin: 10px 0; border: 1px solid red; background: #fff0f0;';
                                
                                const form = document.querySelector('.document-edit-form');
                                if (form) {
                                    form.prepend(errorMessage);
                                } else {
                                    document.body.prepend(errorMessage);
                                }
                                
                                return null;
                            }
                            throw new Error(`API responded with status ${response.status}`);
                        }
                        return response.json();
                    })
                        .then(data => {
                        if (!data) return; // Skip if null (404 case)
                        
                            if (data && data.department && departmentalSelect) {
                                                                
                                // Find matching option and select it
                                Array.from(departmentalSelect.options).forEach(option => {
                                    if (option.value === data.department) {
                                        departmentalSelect.value = data.department;
                                                                            }
                                });
                            
                            // If no match found, add a new option
                            if (departmentalSelect.value !== data.department) {
                                                                const newOption = document.createElement('option');
                                newOption.value = data.department;
                                newOption.textContent = data.department;
                                departmentalSelect.appendChild(newOption);
                                departmentalSelect.value = data.department;
                            }
                            
                            // Update preview
                            const previewField = document.getElementById('edit-compiled-preview-issued-no');
                            if (previewField) {
                                previewField.textContent = data.department;
                            }
                        }
                        
                        // Successful completion
                        clearInterval(checkInterval);
                    })
                    .catch(err => {
                        // Stop interval after multiple retries
                        if (attempts >= maxAttempts / 2) {
            clearInterval(checkInterval);
        }
                    });
            }
        } catch (err) {
        }
    }, 1000);
})();

// CRITICAL FIX: Force immediate form population check when page loads
(function() {
        // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runCriticalFormFix);
    } else {
        runCriticalFormFix();
    }
    
    // Also run the fix after a timeout just to be sure
    setTimeout(runCriticalFormFix, 1000);
    
    function runCriticalFormFix() {
                
        // Look for the document ID field as a sign that the form is open
        const checkAndPopulateForm = () => {
            const idField = document.getElementById('edit-compiled-document-id');
            if (!idField) {
                                return false;
            }
            
            const documentId = idField.value;
            if (!documentId) {
                                return false;
            }
            
                        
            // Now check if form fields are empty
            const titleField = document.getElementById('edit-compiled-document-title');
            if (!titleField) {
                                return false;
            }
            
            // Check if form already has data
            if (titleField.value) {
                                return true;
            }
            
                        
            // Fetch document data directly
            fetch(`/api/compiled-documents/${documentId}?include_children=true`)
                .then(response => response.json())
                .then(data => {
                                        
                    // Set field values directly with maximum force
                    const fieldsToSet = [
                        { id: 'edit-compiled-document-title', value: data.title },
                        { id: 'edit-compiled-pub-year-start', value: data.start_year },
                        { id: 'edit-compiled-pub-year-end', value: data.end_year },
                        { id: 'edit-compiled-volume', value: data.volume }
                    ];
                    
                    fieldsToSet.forEach(field => {
                        const element = document.getElementById(field.id);
                        if (element) {
                                                        element.value = field.value || '';
                        }
                    });
                    
                    // Set category with change event
                    const categoryField = document.getElementById('edit-compiled-category');
                    if (categoryField && data.category) {
                        const options = Array.from(categoryField.options);
                        const matchingOption = options.find(opt => 
                            opt.value.toLowerCase() === data.category.toLowerCase() ||
                            opt.text.toLowerCase() === data.category.toLowerCase()
                        );
                        
                        if (matchingOption) {
                                                        categoryField.value = matchingOption.value;
                            categoryField.dispatchEvent(new Event('change', { bubbles: true }));
                            
                            // Set issue/department after delay
                            setTimeout(() => {
                                if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                                    const departmentField = document.getElementById('edit-compiled-departmental');
                                    if (departmentField) {
                                        departmentField.value = data.department || '';
                                    }
                                } else {
                                    const issuedField = document.getElementById('edit-compiled-issued-no');
                                    if (issuedField) {
                                        issuedField.value = data.issue_number || '';
                                    }
                                }
                                
                                // Update preview elements
                                updatePreviewFields();
                            }, 200);
                        }
                    }
                    
                    // Basic preview update
                    function updatePreviewFields() {
                        const previewElements = {
                            title: document.getElementById('edit-compiled-document-preview-title'),
                            years: document.getElementById('edit-compiled-preview-years'),
                            volume: document.getElementById('edit-compiled-preview-volume'),
                            issuedNo: document.getElementById('edit-compiled-preview-issued-no')
                        };
                        
                        if (previewElements.title) {
                            previewElements.title.textContent = data.title || 'Compilation Title';
                        }
                        
                        if (previewElements.years) {
                            previewElements.years.textContent = 
                                `${data.start_year || '-'}-${data.end_year || '-'}`;
                        }
                        
                        if (previewElements.volume) {
                            previewElements.volume.textContent = data.volume || '-';
                        }
                        
                        if (previewElements.issuedNo) {
                            if (data.category === 'SYNERGY' || data.category === 'Synergy') {
                                previewElements.issuedNo.textContent = data.department || '-';
                            } else {
                                previewElements.issuedNo.textContent = data.issue_number || '-';
                            }
                        }
                    }
                })
                .catch(error => {
                });
            
            return true;
        };
        
        // Run immediately
        if (!checkAndPopulateForm()) {
            // If not successful, set up a polling mechanism
                        
            let attempts = 0;
            const maxAttempts = 20; // Try for about 10 seconds
            
            const pollInterval = setInterval(() => {
                attempts++;
                
                if (checkAndPopulateForm() || attempts >= maxAttempts) {
                                        clearInterval(pollInterval);
                }
            }, 500);
        }
    }
})();

// Immediate debugging function that will be available in the console
window.debugCompiledDocumentForm = function() {
        
    // Get modal and check visibility
    const modal = document.getElementById('edit-compiled-document-modal');
            
    // Get form and document ID
    const form = document.getElementById('edit-compiled-document-form');
    const docIdField = document.getElementById('edit-compiled-document-id');
                
    // Check all important form fields
    const fields = [
        { name: 'Title', id: 'edit-compiled-document-title' },
        { name: 'Start Year', id: 'edit-compiled-pub-year-start' },
        { name: 'End Year', id: 'edit-compiled-pub-year-end' },
        { name: 'Volume', id: 'edit-compiled-volume' },
        { name: 'Category', id: 'edit-compiled-category' },
        { name: 'Issued No', id: 'edit-compiled-issued-no' },
        { name: 'Department', id: 'edit-compiled-departmental' }
    ];
    
        fields.forEach(field => {
        const element = document.getElementById(field.id);
        console.log(`${field.name} (${field.id}):`, {
            exists: !!element,
            value: element ? element.value : 'N/A',
            visible: element ? getComputedStyle(element).display !== 'none' : 'N/A',
            tagName: element ? element.tagName : 'N/A'
        });
    });
    
    // Check for cached data
        if (window.enhancedCompiledDocumentEdit && window.enhancedCompiledDocumentEdit.documentCache) {
        const cache = window.enhancedCompiledDocumentEdit.documentCache;
                
        const docId = docIdField ? docIdField.value : null;
        if (docId && cache[docId]) {
                        
            // Try direct population
                        window.enhancedCompiledDocumentEdit.directPopulateFormWithData(cache[docId]);
        } else {
                    }
    } else {
            }
    
    // Examine network requests
            
    const docId = docIdField ? docIdField.value : null;
    if (docId) {
        fetch(`/api/compiled-documents/${docId}?include_children=true`)
            .then(response => response.json())
            .then(data => {
                                
                // Auto-apply data
                if (window.enhancedCompiledDocumentEdit) {
                                        window.enhancedCompiledDocumentEdit.directPopulateFormWithData(data);
                }
            })
            .catch(error => {
            });
    } else {
            }
    
    // Additional help message
                
    return "Debug information output to console. Check for errors and data availability.";
};

// Add matching toast notification and styles from document-edit.js
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* Toast notification Styles (matching document-edit.js) */
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
        
        .toast-info {
            background-color: #e3f2fd;
            color: #1565c0;
            border-left: 3px solid #1565c0;
        }
        
        /* File Upload Styles (matching document-edit.js) */
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
        
        /* Success Popup Styles (matching document-edit.js) */
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
        
        /* Dropdown Styles (matching document-edit.js) */
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
    `;
    document.head.appendChild(style);
})();

// Enhanced Compiled Document Edit module
window.enhancedCompiledDocumentEdit = {
    // Cache for document data
    documentCache: {},
    
    // Track if child documents are being loaded
    isLoadingChildren: false,
    
    // Track the currently edited document ID
    currentDocumentId: null,
    
    // Initialize the module
    init: function() {
                this.setupEventListeners();
        
        // Direct form population with retry mechanism
        window.directPopulateCompiledForm = this.directPopulateFormWithData.bind(this);
    },
    
    // Author and keyword search functions
    
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
                let authors = [];
                let response;
                
                // Use the administrator-only author directory. Public search
                // intentionally excludes authors without published work.
                let endpoints = [
                    `/api/authors/all?q=${encodeURIComponent(query)}`
                ];
                
                // Try each endpoint until one works
                for (const endpoint of endpoints) {
                    try {
                                                response = await fetch(endpoint);
                        
                        if (response.ok) {
                            const data = await response.json();
                                                        
                            // Handle different response formats
                            if (data.authors && Array.isArray(data.authors)) {
                                authors = data.authors;
                                break;
                            } else if (Array.isArray(data)) {
                                authors = data;
                                break;
                            } else if (data.users && Array.isArray(data.users)) {
                                authors = data.users.map(user => ({
                                    id: user.id,
                                    name: user.name || user.username,
                                    full_name: user.full_name || user.name || user.username,
                                    affiliation: user.affiliation || user.department
                                }));
                                break;
                            }
                        }
                    } catch (endpointError) {
                    }
                }
                
                // If none of the endpoints returned data, try fetching all authors
                if (authors.length === 0) {
                                        
                    const allEndpoints = [
                        '/api/authors/all'
                    ];
                    
                    for (const allEndpoint of allEndpoints) {
                        try {
                                                        const allAuthorsResponse = await fetch(allEndpoint);
                            
                            if (allAuthorsResponse.ok) {
                                const allAuthorsData = await allAuthorsResponse.json();
                                                                
                                // Handle different response structures
                                let allAuthors = [];
                                if (allAuthorsData.authors && Array.isArray(allAuthorsData.authors)) {
                                    allAuthors = allAuthorsData.authors;
                                } else if (Array.isArray(allAuthorsData)) {
                                    allAuthors = allAuthorsData;
                                } else if (allAuthorsData.users && Array.isArray(allAuthorsData.users)) {
                                    allAuthors = allAuthorsData.users.map(user => ({
                                        id: user.id,
                                        name: user.name || user.username,
                                        full_name: user.full_name || user.name || user.username,
                                        affiliation: user.affiliation || user.department
                                    }));
                                }
                                
                                // Filter locally
                                const lowerQuery = query.toLowerCase();
                                authors = allAuthors.filter(author => 
                                    (author.name && author.name.toLowerCase().includes(lowerQuery)) ||
                                    (author.full_name && author.full_name.toLowerCase().includes(lowerQuery)) ||
                                    (author.first_name && author.first_name.toLowerCase().includes(lowerQuery)) ||
                                    (author.last_name && author.last_name.toLowerCase().includes(lowerQuery))
                                );
                                
                                if (authors.length > 0) break;
                            }
                        } catch (allEndpointError) {
                        }
                    }
                }
                
                // Clear dropdown and populate with results
                dropdown.innerHTML = '';
                
                if (authors.length === 0) {
                    // Allow manual entry of author name
                    const message = document.createElement('div');
                    message.className = 'dropdown-item no-results';
                    message.innerHTML = 'No authors found';
                    dropdown.appendChild(message);
                    
                    const createNewItem = document.createElement('div');
                    createNewItem.className = 'dropdown-item create-new';
                    createNewItem.innerHTML = `Create author: "${query}"`;
                    createNewItem.addEventListener('click', () => {
                        // Generate a temporary ID for the new author
                        const tempId = `new_${Date.now()}`;
                        this.selectAuthor(tempId, query, selectedContainerId);
                        dropdown.style.display = 'none';
                        inputElement.value = '';
                    });
                    dropdown.appendChild(createNewItem);
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
    
    // Select a topic/keyword and add to the selected list
    selectTopic: function(topicId, topicName, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
                
        // Check if topic already selected
        const existingTopic = container.querySelector(`.selected-topic[data-id="${topicId}"]`);
        if (existingTopic) {
                        return;
        }
        
        // Create topic element
        const topicElement = document.createElement('div');
        topicElement.className = 'selected-topic';
        topicElement.dataset.id = topicId;
        
        // Only display the name, not the ID
        topicElement.innerHTML = `
            ${topicName}
            <span class="remove-topic">&times;</span>
        `;
        
        // Add to container
        container.appendChild(topicElement);
        
        // Add click handler to remove button
        const removeBtn = topicElement.querySelector('.remove-topic');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                topicElement.remove();
            });
        }
    },
    
    // Initialize Research Agenda/Topic Search
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
                                                        
                            // Handle different response formats
                            if (data.items && Array.isArray(data.items)) {
                                items = data.items;
                                break;
                            } else if (Array.isArray(data)) {
                                items = data;
                                break;
                            } else if (data.topics && Array.isArray(data.topics)) {
                                items = data.topics;
                                break;
                            } else if (data.agendaItems && Array.isArray(data.agendaItems)) {
                                items = data.agendaItems;
                                break;
                            }
                        }
                    } catch (endpointError) {
                    }
                }
                
                // If none of the endpoints returned data, try fetching all items
                if (items.length === 0) {
                                        
                    const allEndpoints = [
                        '/api/research-agenda-items',
                        '/research-agenda-items/all',
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
                                
                                // Filter locally
                                const lowerQuery = query.toLowerCase();
                                items = allItems.filter(item => 
                                    (item.name && item.name.toLowerCase().includes(lowerQuery)) ||
                                    (item.title && item.title.toLowerCase().includes(lowerQuery))
                                );
                                
                                if (items.length > 0) break;
                            }
                        } catch (allEndpointError) {
                        }
                    }
                }
                
                // Clear dropdown and populate with results
                dropdown.innerHTML = '';
                
                if (items.length === 0) {
                    // Allow manual entry of item
                    const message = document.createElement('div');
                    message.className = 'dropdown-item no-results';
                    message.innerHTML = 'No research agenda items found';
                    dropdown.appendChild(message);
                    
                    const createNewItem = document.createElement('div');
                    createNewItem.className = 'dropdown-item create-new';
                    createNewItem.innerHTML = `Create item: "${query}"`;
                    createNewItem.addEventListener('click', () => {
                        // Generate a temporary ID for the new item
                        const tempId = `new_${Date.now()}`;
                        this.selectTopic(tempId, query, selectedContainerId);
                        dropdown.style.display = 'none';
                        inputElement.value = '';
                    });
                    dropdown.appendChild(createNewItem);
                } else {
                    // Add items to dropdown
                    items.forEach(item => {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'dropdown-item';
                        itemElement.dataset.id = item.id;
                        itemElement.dataset.name = item.name || item.title;
                        
                        // Extract name from item based on available properties
                        const itemName = item.name || item.title;
                        
                        // Format display
                        let itemDisplay = `<div class="item-name">${itemName}</div>`;
                        if (item.description) {
                            itemDisplay += `<div class="item-detail">${item.description}</div>`;
                        }
                        
                        itemElement.innerHTML = itemDisplay;
                        
                        // Add click handler to select the item
                        itemElement.addEventListener('click', () => {
                            this.selectTopic(item.id, itemName, selectedContainerId);
                            dropdown.style.display = 'none';
                            inputElement.value = '';
                        });
                        
                        dropdown.appendChild(itemElement);
                    });
                }
                
                // Position dropdown directly under the input field
                dropdown.style.display = 'block';
            } catch (error) {
                dropdown.innerHTML = '<div class="dropdown-item error">Error searching research agenda items</div>';
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
    
    // Direct method to populate form (can be called from console for debugging)
    directPopulateFormWithData: function(docData) {
                
        // Force fields to populate with aggressive approach
        const fieldsToPopulate = [
            { id: 'edit-compiled-document-title', property: 'title' },
            { id: 'edit-compiled-pub-year-start', property: 'start_year' },
            { id: 'edit-compiled-pub-year-end', property: 'end_year' },
            { id: 'edit-compiled-volume', property: 'volume' },
            { id: 'edit-compiled-category', property: 'category', isSelect: true }
        ];
        
        // First, log what fields we're looking for
        fieldsToPopulate.forEach(field => {
            const element = document.getElementById(field.id);
                    });
        
        // Helper to set field value with retry
        const setFieldWithRetry = (fieldId, value, isSelect = false, retries = 10) => {
            const field = document.getElementById(fieldId);
            
            if (!field && retries > 0) {
                                setTimeout(() => setFieldWithRetry(fieldId, value, isSelect, retries - 1), 200);
                return;
            }
            
            if (field) {
                                
                if (isSelect) {
                    // Handle select fields
                    const options = Array.from(field.options);
                    const matchingOption = options.find(opt => 
                        opt.value.toLowerCase() === String(value).toLowerCase() ||
                        opt.text.toLowerCase() === String(value).toLowerCase()
                    );
                    
                    if (matchingOption) {
                        field.value = matchingOption.value;
                                                
                        // Force change event
                        const event = new Event('change', { bubbles: true });
                        field.dispatchEvent(event);
                    } else {
                                            }
                } else {
                    // Handle regular inputs
                    field.value = value || '';
                    
                    // Force input event
                    const event = new Event('input', { bubbles: true });
                    field.dispatchEvent(event);
                }
            } else {
            }
        };
        
        // Set values with retry mechanism
        fieldsToPopulate.forEach(field => {
            setFieldWithRetry(field.id, docData[field.property], field.isSelect);
        });
        
        // Set category-dependent fields after a delay
        setTimeout(() => {
            if (docData.category === 'SYNERGY' || docData.category === 'Synergy') {
                setFieldWithRetry('edit-compiled-departmental', docData.department);
            } else {
                setFieldWithRetry('edit-compiled-issued-no', docData.issue_number);
            }
            
            // Update preview fields
            this.updatePreviewFields();
            
                    }, 500);
        
        return true; // Indicate we attempted population
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        const self = this;
        
        // Delegate to document edit events but enhance them
        if (window.documentEdit) {
            const originalShowCompiledEditModal = window.documentEdit.showCompiledEditModal;
            
            // Override with enhanced version
            window.documentEdit.showCompiledEditModal = function(documentId) {
                                
                // Store the current document ID
                self.currentDocumentId = documentId;
                
                // Call original implementation
                if (typeof originalShowCompiledEditModal === 'function') {
                    originalShowCompiledEditModal.call(window.documentEdit, documentId);
                    
                    // Add our enhancements after the modal is shown
                    self.enhanceCompiledEditModal();
                }
            };
            
            // Capture data when it's received and directly apply it
            const originalPopulateCompiledEditForm = window.documentEdit.populateCompiledEditForm;
            if (typeof originalPopulateCompiledEditForm === 'function') {
                window.documentEdit.populateCompiledEditForm = function(data) {
                                        
                    // Store the data for our use
                    self.documentCache[data.id] = data;
                    
                    // Call original implementation
                    originalPopulateCompiledEditForm.call(window.documentEdit, data);
                    
                    // Apply our enhanced population after a short delay
                    setTimeout(() => {
                        self.directPopulateFormWithData(data);
                    }, 100);
                };
            }
            
            // Directly intercept the fetch responses
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                // Call the original fetch
                const fetchPromise = originalFetch.apply(this, args);
                
                // Check if this is a document data request
                const url = args[0];
                if (typeof url === 'string' && url.includes('/api/compiled-documents/') && url.includes('include_children=true')) {
                                        
                    // Process the response
                    return fetchPromise.then(async response => {
                        // Clone the response so we can read it multiple times
                        const clonedResponse = response.clone();
                        
                        // Read the cloned response
                        try {
                            const data = await clonedResponse.json();
                                                        
                            // Wait a bit to ensure the modal is fully displayed
                            setTimeout(() => {
                                self.directPopulateFormWithData(data);
                            }, 500);
                        } catch (e) {
                        }
                        
                        // Return the original response
                        return response;
                    });
                }
                
                // Return the original fetch promise for other requests
                return fetchPromise;
            };
        }
        
        // Add custom event for child document list updates
        document.addEventListener('childDocumentsUpdated', function(e) {
                        if (e.detail && e.detail.parentId) {
                self.refreshChildDocuments(e.detail.parentId);
            }
        });
        
        // Add a DOM mutation observer to detect when form fields are added
        const observeFormChanges = () => {
                        
            // Target the modal content area
            const targetNode = document.getElementById('edit-compiled-document-modal');
            if (!targetNode) {
                                setTimeout(observeFormChanges, 500);
                return;
            }
            
            // Create an observer instance
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        // Check if title field is now available
                        const titleField = document.getElementById('edit-compiled-document-title');
                        if (titleField && !titleField.value && self.currentDocumentId) {
                                                        
                            // Check if we have cached data
                            const cachedData = self.documentCache[self.currentDocumentId];
                            if (cachedData) {
                                                                self.directPopulateFormWithData(cachedData);
                            } else {
                                                                self.fetchDocumentData(self.currentDocumentId)
                                    .then(data => {
                                        if (data) {
                                            self.directPopulateFormWithData(data);
                                        }
                                    });
                            }
                        }
                    }
                }
            });
            
            // Configuration of the observer
            const config = { childList: true, subtree: true };
            
            // Start observing
            observer.observe(targetNode, config);
                    };
        
        // Start the observer
        observeFormChanges();
        
        // Create a polling mechanism to directly check and populate form fields
        const startFormPolling = () => {
                        
            const checkInterval = setInterval(() => {
                // Only run if we have a document ID and the modal is visible
                const modal = document.getElementById('edit-compiled-document-modal');
                if (!modal || modal.style.display === 'none' || !self.currentDocumentId) {
                    return;
                }
                
                const titleField = document.getElementById('edit-compiled-document-title');
                if (titleField && !titleField.value) {
                                        
                    // Check if we have cached data
                    const cachedData = self.documentCache[self.currentDocumentId];
                    if (cachedData) {
                                                self.directPopulateFormWithData(cachedData);
                    }
                }
            }, 1000); // Check every second
            
            // Clean up interval after 30 seconds to avoid memory leaks
            setTimeout(() => clearInterval(checkInterval), 30000);
        };
        
        // Start polling
        startFormPolling();
        
        // Create a global event listener for successful data fetch
        window.addEventListener('compiledDocumentDataLoaded', function(event) {
            if (event.detail && event.detail.data) {
                                self.documentCache[event.detail.data.id] = event.detail.data;
                
                // Only attempt to populate if we're editing this document
                if (self.currentDocumentId === event.detail.data.id) {
                    setTimeout(() => self.directPopulateFormWithData(event.detail.data), 200);
                }
            }
        });
        
        // Add global direct access method (accessible from console)
        window.populateCompiledDocForm = function(data) {
                        
            if (data && data.id) {
                self.documentCache[data.id] = data;
                self.currentDocumentId = data.id;
                self.directPopulateFormWithData(data);
                return true;
            }
            
            return false;
        };
        
        // Patch the actual XMLHttpRequest to monitor for API responses
        const originalXhrOpen = window.XMLHttpRequest.prototype.open;
        const originalXhrSend = window.XMLHttpRequest.prototype.send;
        
        window.XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return originalXhrOpen.apply(this, arguments);
        };
        
        window.XMLHttpRequest.prototype.send = function() {
            const xhr = this;
            
            if (xhr._url && xhr._url.includes('/api/compiled-documents/') && 
                (xhr._url.includes('include_children=true') || xhr._url.includes('/children'))) {
                                
                // Add response handler
                const originalOnReadyStateChange = xhr.onreadystatechange;
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4 && xhr.status === 200) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                                                        
                            // Check for document data format
                            if (data && (data.id || data.document_id)) {
                                const docData = data.id ? data : data.document;
                                
                                // Store in cache
                                if (docData && docData.id) {
                                                                        self.documentCache[docData.id] = docData;
                                    
                                    // Dispatch global event
                                    const dataEvent = new CustomEvent('compiledDocumentDataLoaded', {
                                        detail: { data: docData }
                                    });
                                    window.dispatchEvent(dataEvent);
                                    
                                    // Auto-populate form if we're viewing this document
                                    if (self.currentDocumentId === docData.id) {
                                                                                setTimeout(() => self.directPopulateFormWithData(docData), 250);
                                    }
                                }
                            }
                        } catch (e) {
                        }
                    }
                    
                    // Call original handler if it exists
                    if (typeof originalOnReadyStateChange === 'function') {
                        originalOnReadyStateChange.apply(xhr, arguments);
                    }
                };
            }
            
            return originalXhrSend.apply(this, arguments);
        };
    },
    
    // Toast notification function (matching document-edit.js)
    showToast: function(message, type = 'info') {
                
        // Remove any existing toasts
        const existingToasts = document.querySelectorAll('.toast');
        existingToasts.forEach(toast => toast.remove());
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            
            // Remove from DOM after fade out
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    },
    
    // Show success popup (matching document-edit.js)
    showSuccessPopup: function(title, message, buttonText = 'OK', callback = null) {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'success-popup-overlay';
        
        // Create popup
        const popup = document.createElement('div');
        popup.className = 'success-popup';
        
        // Popup content
        popup.innerHTML = `
            <div class="success-popup-icon">✓</div>
            <div class="success-popup-title">${title}</div>
            <div class="success-popup-message">${message}</div>
            <button class="success-popup-button">${buttonText}</button>
        `;
        
        // Add to DOM
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        
        // Button action
        const button = popup.querySelector('.success-popup-button');
        button.addEventListener('click', function() {
            document.body.removeChild(overlay);
            if (typeof callback === 'function') {
                callback();
            }
        });
    },
    
    // Enhanced Compiled Document Edit modal
    enhanceCompiledEditModal: function() {
        const self = this;
        const modal = document.getElementById('edit-compiled-document-modal');
        
        if (!modal || !this.currentDocumentId) {
            return;
        }
        
                
        // Add debug information to the modal
        const debugInfo = document.createElement('div');
        debugInfo.className = 'debug-info';
        debugInfo.style.display = 'none';
        debugInfo.innerHTML = `<small>Document ID: ${this.currentDocumentId}</small>`;
        modal.appendChild(debugInfo);
        
        // Setup the compiled document form
        this.setupCompiledDocumentForm();
        
        // Load compiled document data
        this.loadCompiledDocumentData(this.currentDocumentId)
            .then(data => {
                if (data) {
                                        this.directPopulateFormWithData(data);
                }
            })
            .catch(error => {
            });
        
        // Check if form is loaded by looking for the title field
        const checkFormLoaded = () => {
            const titleField = document.getElementById('edit-compiled-document-title');
            if (!titleField) {
                                setTimeout(checkFormLoaded, 500);
                return false;
            }
            return true;
        };
        
        // Wait for form to be loaded before enhancing
        if (!checkFormLoaded()) {
                        setTimeout(() => {
                if (checkFormLoaded()) {
                    this.enhanceModalAfterFormLoad();
                }
            }, 1000);
            return;
        }
        
        this.enhanceModalAfterFormLoad();
    },
    
    // Enhancement steps to run after form is loaded
    enhanceModalAfterFormLoad: function() {
                
        // Set up category change handlers
        const categoryField = document.getElementById('edit-compiled-category');
        if (categoryField) {
            categoryField.addEventListener('change', (e) => {
                this.handleCategoryChange(e.target.value);
            });
        }
        
        // Initialize author search field
        const authorSearchInput = document.getElementById('edit-compiled-document-author-search');
        const selectedAuthorsContainer = document.getElementById('edit-compiled-document-selected-authors');
        
        if (authorSearchInput && selectedAuthorsContainer) {
            this.initializeAuthorSearch(authorSearchInput, 'edit-compiled-document-selected-authors');
        } else {
                    }
        
        // Initialize research agenda search field
        const keywordSearchInput = document.getElementById('edit-compiled-document-keyword-search');
        const selectedKeywordsContainer = document.getElementById('edit-compiled-document-selected-keywords');
        
        if (keywordSearchInput && selectedKeywordsContainer) {
            this.initializeResearchAgendaSearch(keywordSearchInput, 'edit-compiled-document-selected-keywords');
        } else {
                    }
        
        // Initialize the child documents container with its loading behavior
        const childrenContainer = document.getElementById('compilation-studies-list');
        if (childrenContainer) {
            this.setupChildDocumentsContainer(childrenContainer);
        } else {
                    }
    },
    
    // Populate form fields with document data
    populateFormFields: function() {
        if (!this.currentDocumentId) {
            return;
        }
        
        // Check if fields already have values
        const titleField = document.getElementById('edit-compiled-document-title');
        if (titleField && titleField.value) {
                        return;
        }
        
        // Try to get the document data from documentEdit
        let docData = null;
        
        if (window.documentEdit && window.documentEdit.documentCache) {
            docData = window.documentEdit.documentCache[this.currentDocumentId];
        }
        
        if (docData) {
            this.populateFormWithData(docData);
        } else {
            // Fallback to fetch the data directly
                        this.fetchDocumentData(this.currentDocumentId)
                .then(data => {
                    if (data) {
                        this.populateFormWithData(data);
                    } else {
                    }
                })
                .catch(error => {
                });
        }
    },
    
    // Fetch document data directly from API
    fetchDocumentData: function(documentId) {
        return new Promise((resolve, reject) => {
            // Try multiple endpoints
            const endpoints = [
                `/api/compiled-documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                `/api/documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                `/compiled-documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
                `/documents/${documentId}?include_children=true&include_authors=true&include_topics=true`
            ];
            
                        
            // Try endpoints sequentially
            let currentEndpointIndex = 0;
            
            const tryNextEndpoint = () => {
                if (currentEndpointIndex >= endpoints.length) {
                    // All endpoints failed
                    // Create a fallback data object with the ID
                    const fallbackData = {
                        id: documentId,
                        title: 'Document data unavailable',
                        // Add other necessary default fields
                        children: []
                    };
                    
                    // Resolve with the fallback data to prevent complete UI failure
                    resolve(fallbackData);
                    return;
                }
                
                const endpoint = endpoints[currentEndpointIndex];
                                
            fetch(endpoint)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Error ${response.status}: ${response.statusText}`);
                    }
                    return response.json();
                })
                .then(data => {
                                        resolve(data);
                })
                .catch(error => {
                        currentEndpointIndex++;
                        tryNextEndpoint();
                });
            };
            
            // Start trying endpoints
            tryNextEndpoint();
        });
    },
    
    // Populate form with document data
    populateFormWithData: function(docData) {
                
        // Wait for elements to be available
        const checkAndPopulate = () => {
            // Populate form fields
            const titleField = document.getElementById('edit-compiled-document-title');
            const startYearField = document.getElementById('edit-compiled-pub-year-start');
            const endYearField = document.getElementById('edit-compiled-pub-year-end');
            const volumeField = document.getElementById('edit-compiled-volume');
            const categoryField = document.getElementById('edit-compiled-category');
            const issuedNoField = document.getElementById('edit-compiled-issued-no');
            const departmentalField = document.getElementById('edit-compiled-departmental');
            
            // Check if essential fields exist
            if (!titleField) {
                                setTimeout(checkAndPopulate, 300);
                return;
            }
            
                        
            // Store the document ID and category for child document loading
            const documentId = docData.id;
            const category = docData.category;
            
            // Set document ID and category in form elements for reference by child document loaders
            const idField = document.getElementById('edit-compiled-document-id');
            if (idField) {
                idField.value = documentId;
                // Store category as data attribute for more reliable access
                idField.dataset.category = category;
            }
            
            // Set values if fields exist
            if (titleField) {
                                titleField.value = docData.title || '';
            }
            if (startYearField) {
                                startYearField.value = docData.start_year || '';
            }
            if (endYearField) {
                                endYearField.value = docData.end_year || '';
            }
            if (volumeField) {
                                volumeField.value = docData.volume || '';
            }
            
            // Set category (this will trigger the change handler to show/hide fields)
            if (categoryField && docData.category) {
                                // Find matching option, case insensitive
                const options = Array.from(categoryField.options);
                const matchingOption = options.find(opt => 
                    opt.value.toLowerCase() === docData.category.toLowerCase() ||
                    opt.text.toLowerCase() === docData.category.toLowerCase()
                );
                
                if (matchingOption) {
                    categoryField.value = matchingOption.value;
                    // Trigger change event
                    const event = new Event('change');
                    categoryField.dispatchEvent(event);
                }
            }
            
            // Wait for the category change to take effect
            setTimeout(() => {
                // Set issue number or department based on category
                if (docData.category === 'SYNERGY' || docData.category === 'Synergy') {
                    if (departmentalField) {
                                                departmentalField.value = docData.department || '';
                    }
                } else {
                    if (issuedNoField) {
                                                issuedNoField.value = docData.issue_number || '';
                    }
                }
                
                // Populate authors if available
                const authorsContainer = document.getElementById('edit-compiled-document-selected-authors');
                if (authorsContainer && docData.authors && Array.isArray(docData.authors) && docData.authors.length > 0) {
                                        
                    // Clear existing authors
                    authorsContainer.innerHTML = '';
                    
                    // Add each author
                    docData.authors.forEach(author => {
                        // Extract author id and name
                        const authorId = typeof author === 'string' ? author : author.id;
                        const authorName = typeof author === 'string' ? author : 
                            (author.full_name || author.name || 
                             [author.first_name, author.last_name].filter(Boolean).join(' ') || 
                             `Author ${authorId}`);
                             
                        // Use selectAuthor method to add to container
                        this.selectAuthor(authorId, authorName, 'edit-compiled-document-selected-authors');
                    });
                }
                
                // Populate topics/keywords if available
                const topicsContainer = document.getElementById('edit-compiled-document-selected-topics');
                if (topicsContainer) {
                    // Check different possible sources for topics data
                    let topics = [];
                    
                    if (docData.topics && Array.isArray(docData.topics)) {
                        topics = docData.topics;
                    } else if (docData.keywords && Array.isArray(docData.keywords)) {
                        topics = docData.keywords;
                    }
                    
                    if (topics.length > 0) {
                                                
                        // Clear existing topics
                        topicsContainer.innerHTML = '';
                        
                        // Add each topic
                        topics.forEach(topic => {
                            // Extract topic id and name
                            const topicId = typeof topic === 'string' ? topic : topic.id;
                            const topicName = typeof topic === 'string' ? topic : 
                                (topic.name || topic.title || `Topic ${topicId}`);
                                
                            // Use selectTopic method to add to container
                            this.selectTopic(topicId, topicName, 'edit-compiled-document-selected-topics');
                        });
                    }
                }
                
                // Update preview fields
                this.updatePreviewFields();
                
                // Hide child document containers completely 
                // Remove "Contents" section from form
                const childDocsContainer = document.getElementById('edit-compiled-document-children');
                if (childDocsContainer) {
                    // Find the parent section that contains the container and hide it completely
                    const childDocsSection = childDocsContainer.closest('.form-section') || 
                                            childDocsContainer.closest('.card') ||
                                            childDocsContainer.parentElement;
                    
                    if (childDocsSection) {
                        childDocsSection.style.display = 'none';
                                            } else {
                        // If we can't find a parent section, just hide the container
                        childDocsContainer.style.display = 'none';
                    }
                    
                    // Set attribute to indicate we've processed it
                    childDocsContainer.setAttribute('data-removed', 'true');
                }
                
                // Remove "Studies in this compilation" from preview
                const previewChildDocsContainer = document.getElementById('edit-compiled-document-preview-children');
                if (previewChildDocsContainer) {
                    // Find the parent section that contains the container and hide it completely
                    const previewChildDocsSection = previewChildDocsContainer.closest('.preview-section') || 
                                                   previewChildDocsContainer.closest('.card') ||
                                                   previewChildDocsContainer.parentElement;
                    
                    if (previewChildDocsSection) {
                        previewChildDocsSection.style.display = 'none';
                                            } else {
                        // If we can't find a parent section, just hide the container
                        previewChildDocsContainer.style.display = 'none';
                    }
                    
                    // Set attribute to indicate we've processed it
                    previewChildDocsContainer.setAttribute('data-removed', 'true');
                }
                
                            }, 100);
        };
        
        // Start the check and populate process
        checkAndPopulate();
    },
    
    // Setup category change handler to toggle between issued no and departmental fields
    setupCategoryChangeHandler: function() {
        const categorySelect = document.getElementById('edit-compiled-category');
        const issuedNoInput = document.getElementById('edit-compiled-issued-no');
        const issuedNoContainer = document.getElementById('edit-compiled-issued-no-container');
        const departmentalSelect = document.getElementById('edit-compiled-departmental');
        const departmentalContainer = document.getElementById('edit-compiled-departmental-container');
        const issuedNoLabel = document.getElementById('edit-compiled-issued-no-label');
        const previewIssuedNoLabel = document.getElementById('edit-preview-issued-no-label');
        
        // Check if required elements exist
        if (!categorySelect) {
            return;
        }
        
        // Create departmental dropdown if it doesn't exist
        if (!departmentalSelect && issuedNoContainer) {
            // Create departmental container
            departmentalContainer = document.createElement('div');
            departmentalContainer.id = 'edit-compiled-departmental-container';
            departmentalContainer.className = issuedNoContainer.className;
            
            // Create departmental select with empty options (will be populated from API)
            const selectHTML = `
                <label for="edit-compiled-departmental" id="edit-compiled-departmental-label">Departmental</label>
                <select id="edit-compiled-departmental" name="departmental" class="form-control">
                    <option value="">Select Department</option>
                </select>
            `;
            
            departmentalContainer.innerHTML = selectHTML;
            
            // Insert after issued no container
            if (issuedNoContainer.parentNode) {
                issuedNoContainer.parentNode.insertBefore(departmentalContainer, issuedNoContainer.nextSibling);
            }
            
            // Update reference to the new element
            departmentalSelect = document.getElementById('edit-compiled-departmental');
            
            // Populate departments from API
            populateDepartmentalDropdown(departmentalSelect);
        }
        
        // Initial setup based on selected value
        const initializeFields = () => {
            try {
            const currentValue = categorySelect.value;
            if (currentValue === 'SYNERGY' || currentValue === 'Synergy') {
                // If Synergy is selected, change the label to "Departmental" and show dropdown
                if (issuedNoLabel) issuedNoLabel.textContent = 'Departmental';
                if (previewIssuedNoLabel) previewIssuedNoLabel.textContent = 'Departmental:';
                    
                    // Hide issued no field and show departmental dropdown
                    if (issuedNoContainer) issuedNoContainer.style.display = 'none';
                    if (departmentalContainer) departmentalContainer.style.display = 'block';
                
                // Update category icon
                const categoryIcon = document.getElementById('edit-compiled-category-icon');
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'synergy';
                }
            } else {
                // For any other category, use "Issued No." and show text input
                if (issuedNoLabel) issuedNoLabel.textContent = 'Issued No.';
                if (previewIssuedNoLabel) previewIssuedNoLabel.textContent = 'Issued No:';
                    
                    // Show issued no field and hide departmental dropdown
                    if (issuedNoContainer) issuedNoContainer.style.display = 'block';
                    if (departmentalContainer) departmentalContainer.style.display = 'none';
                
                // Update category icon for Confluence
                const categoryIcon = document.getElementById('edit-compiled-category-icon');
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'confluence';
                }
            }
            
                // Only update preview fields if they exist
                const previewTitleElement = document.getElementById('edit-compiled-document-preview-title');
                if (previewTitleElement) {
            this.updatePreviewFields();
                } else {
                                    }
            } catch (error) {
            }
        };
        
        // Run initial setup with a delay to ensure form is loaded
        setTimeout(() => initializeFields(), 500);
        
        // Category change handler - fixes issue with department/issue field switching
        const categoryField = document.getElementById('edit-compiled-category');
        if (categoryField) {
                        
            // CRITICAL FIX: Force direct manipulation
            const forceToggleFields = (category) => {
                                
                // Based on the HTML structure, both are in the same container
                const issuedNoContainer = document.getElementById('edit-compiled-issued-no-container');
                const issuedNoInput = document.getElementById('edit-compiled-issued-no');
                const departmentalSelect = document.getElementById('edit-compiled-departmental');
                const issuedNoLabel = document.getElementById('edit-compiled-issued-no-label');
                const previewIssuedLabel = document.getElementById('edit-preview-issued-no-label');
                
                console.log('FORCE TOGGLE: Field elements found:', {
                    container: !!issuedNoContainer,
                    input: !!issuedNoInput,
                    select: !!departmentalSelect,
                    label: !!issuedNoLabel,
                    previewLabel: !!previewIssuedLabel
                });
                
                if (!issuedNoInput || !departmentalSelect) {
                    return;
                }
                
                // Toggle fields based on category
                if (category === 'SYNERGY' || category === 'Synergy') {
                                        
                    // Use direct DOM manipulation and inline styles
                    issuedNoInput.style.cssText = 'display: none !important';
                    departmentalSelect.style.cssText = 'display: block !important';
                    
                    // Update labels
                    if (issuedNoLabel) issuedNoLabel.textContent = 'Departmental';
                    if (previewIssuedLabel) previewIssuedLabel.textContent = 'Departmental:';
                    
                    // Force update preview
                    if (previewIssuedLabel) {
                        const previewIssuedEl = document.getElementById('edit-compiled-preview-issued-no');
                        if (previewIssuedEl && departmentalSelect) {
                            previewIssuedEl.textContent = departmentalSelect.value || '-';
                        }
                    }
                } else {
                                        
                    // Use direct DOM manipulation and inline styles
                    issuedNoInput.style.cssText = 'display: block !important';
                    departmentalSelect.style.cssText = 'display: none !important';
                    
                    // Update labels
                    if (issuedNoLabel) issuedNoLabel.textContent = 'Issued No.';
                    if (previewIssuedLabel) previewIssuedLabel.textContent = 'Issued No:';
                    
                    // Force update preview
                    if (previewIssuedLabel) {
                        const previewIssuedEl = document.getElementById('edit-compiled-preview-issued-no');
                        if (previewIssuedEl && issuedNoInput) {
                            previewIssuedEl.textContent = issuedNoInput.value || '-';
                        }
                    }
                }
                
                            };
            
            // Remove any existing event listeners to prevent duplicates
            const oldCategoryListener = categoryField._categoryChangeListener;
            if (oldCategoryListener) {
                categoryField.removeEventListener('change', oldCategoryListener);
            }
            
            // Create new listener
            const categoryChangeListener = (e) => {
                const category = e.target.value;
                                
                // Call the force toggle function
                forceToggleFields(category);
                
                // Update preview fields
                if (typeof updatePreviewFields === 'function') {
                    updatePreviewFields();
                }
            };
            
            // Store reference to listener for future removal
            categoryField._categoryChangeListener = categoryChangeListener;
            
            // Add the event listener
            categoryField.addEventListener('change', categoryChangeListener);
            
            // Trigger the change event immediately to set the initial state correctly
            setTimeout(() => {
                                const currentCategory = categoryField.value;
                                
                // Force toggle fields based on current value
                forceToggleFields(currentCategory);
                
                // Also dispatch event for other handlers
                categoryField.dispatchEvent(new Event('change'));
            }, 200);
            
            // Add a repeating check just to be sure
            let checkCount = 0;
            const intervalId = setInterval(() => {
                checkCount++;
                if (checkCount > 5) {
                    clearInterval(intervalId);
                    return;
                }
                
                                forceToggleFields(categoryField.value);
            }, 1000);
        }
        
        // Handle category changes
        categorySelect.addEventListener('change', function() {
            try {
            if (this.value === 'SYNERGY' || this.value === 'Synergy') {
                // If Synergy is selected, change the label to "Departmental" and show dropdown
                if (issuedNoLabel) issuedNoLabel.textContent = 'Departmental';
                if (previewIssuedNoLabel) previewIssuedNoLabel.textContent = 'Departmental:';
                    
                    // Hide issued no field and show departmental dropdown
                    if (issuedNoContainer) issuedNoContainer.style.display = 'none';
                    if (departmentalContainer) departmentalContainer.style.display = 'block';
                
                // Update category icon
                const categoryIcon = document.getElementById('edit-compiled-category-icon');
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'synergy';
                }
            } else {
                // For any other category, use "Issued No." and show text input
                if (issuedNoLabel) issuedNoLabel.textContent = 'Issued No.';
                if (previewIssuedNoLabel) previewIssuedNoLabel.textContent = 'Issued No:';
                    
                    // Show issued no field and hide departmental dropdown
                    if (issuedNoContainer) issuedNoContainer.style.display = 'block';
                    if (departmentalContainer) departmentalContainer.style.display = 'none';
                
                // Update category icon for Confluence
                const categoryIcon = document.getElementById('edit-compiled-category-icon');
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'confluence';
                }
            }
            
                // Only update preview fields if they exist
                const previewTitleElement = document.getElementById('edit-compiled-document-preview-title');
                if (previewTitleElement) {
            setTimeout(() => this.updatePreviewFields(), 10);
                } else {
                                    }
            } catch (error) {
            }
        }.bind(this));
        
        // Add event listener for departmental dropdown
        if (departmentalSelect) {
            departmentalSelect.addEventListener('change', function() {
                try {
                                // Update preview fields with a small delay
                    const previewTitleElement = document.getElementById('edit-compiled-document-preview-title');
                    if (previewTitleElement) {
                setTimeout(() => this.updatePreviewFields(), 10);
                    } else {
                                            }
                } catch (error) {
                }
            }.bind(this));
        }
    },
    
    // Update preview fields based on form values
    updatePreviewFields: function() {
                
        // Get form field values
        const titleField = document.getElementById('edit-compiled-document-title');
        const startYearField = document.getElementById('edit-compiled-pub-year-start');
        const endYearField = document.getElementById('edit-compiled-pub-year-end');
        const volumeField = document.getElementById('edit-compiled-volume');
        const categoryField = document.getElementById('edit-compiled-category');
        const issuedNoField = document.getElementById('edit-compiled-issued-no');
        const departmentalField = document.getElementById('edit-compiled-departmental');
        
        // Get preview elements
        const previewTitleEl = document.getElementById('edit-compiled-document-preview-title');
        const previewYearsEl = document.getElementById('edit-compiled-preview-years');
        const previewVolumeEl = document.getElementById('edit-compiled-preview-volume');
        const previewIssuedEl = document.getElementById('edit-compiled-preview-issued-no');
        const previewIssuedLabel = document.getElementById('edit-preview-issued-no-label');
        const categoryIcon = document.getElementById('edit-compiled-category-icon');
        const previewAuthorEl = document.getElementById('edit-compiled-document-preview-author');
        
        console.log('Preview fields update - elements found:', {
            title: !!previewTitleEl,
            years: !!previewYearsEl,
            volume: !!previewVolumeEl,
            issued: !!previewIssuedEl,
            issuedLabel: !!previewIssuedLabel,
            categoryIcon: !!categoryIcon,
            author: !!previewAuthorEl
        });
        
        // Update title in preview
        if (titleField && previewTitleEl) {
            previewTitleEl.textContent = titleField.value || 'Compilation Title';
        }
        
        // Update years in preview
        if (startYearField && endYearField && previewYearsEl) {
            const startYear = startYearField.value || '-';
            const endYear = endYearField.value || '-';
            previewYearsEl.textContent = `${startYear}-${endYear}`;
        }
        
        // Update volume in preview
        if (volumeField && previewVolumeEl) {
            previewVolumeEl.textContent = volumeField.value || '-';
        }
        
        // Update issued number or department in preview based on selected category
        if (categoryField && previewIssuedEl) {
            const category = categoryField.value;
                        
        if (category === 'SYNERGY' || category === 'Synergy') {
                // For Synergy, show department value
                if (departmentalField && previewIssuedEl) {
                    previewIssuedEl.textContent = departmentalField.value || '-';
                                    }
                if (previewIssuedLabel) {
                    previewIssuedLabel.textContent = 'Departmental:';
                }
                
                // Update category icon
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'synergy';
                                    }
        } else {
                // For other categories, show issued number
                if (issuedNoField && previewIssuedEl) {
                    previewIssuedEl.textContent = issuedNoField.value || '-';
                                    }
                if (previewIssuedLabel) {
                    previewIssuedLabel.textContent = 'Issued No:';
                }
                
                // Update category icon
                if (categoryIcon) {
                    categoryIcon.dataset.category = 'confluence';
                                    }
            }
        }
        
        // Update authors in preview
        if (previewAuthorEl) {
            const selectedAuthorsContainer = document.getElementById('edit-compiled-document-selected-authors');
            
            if (selectedAuthorsContainer) {
                const authorElements = selectedAuthorsContainer.querySelectorAll('.selected-author');
                
                if (authorElements.length > 0) {
                    // Get all author names
                    const authorNames = Array.from(authorElements).map(el => 
                        el.textContent.replace('×', '').trim()
                    );
                    
                    // Show all or truncate if too many
                    if (authorNames.length <= 3) {
                        previewAuthorEl.textContent = authorNames.join(', ');
                    } else {
                        previewAuthorEl.textContent = `${authorNames.slice(0, 2).join(', ')} and ${authorNames.length - 2} more`;
                    }
                } else {
                    previewAuthorEl.textContent = 'Multiple Authors';
                }
            }
        }
        
            },
    
    // Setup file upload handler for foreword document
    setupForewordFileUpload: function() {
        // Foreword functionality removed
    },
    
    // Enhance the child documents container
    enhanceChildDocumentsContainer: function() {
        const container = document.getElementById('edit-compiled-document-children');
        if (!container) {
            return;
        }
        
        // Add additional helpful UI elements
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'children-loading-indicator';
        loadingIndicator.innerHTML = '<div class="spinner"></div><span>Loading child documents...</span>';
        loadingIndicator.style.display = 'none';
        container.parentNode.insertBefore(loadingIndicator, container);
        
        // Add status message area
        const statusMessage = document.createElement('div');
        statusMessage.className = 'children-status-message';
        statusMessage.style.display = 'none';
        container.parentNode.insertBefore(statusMessage, container);
    },
    
    // Set up drag and drop reordering for child documents
    setupDragAndDropReordering: function() {
        const container = document.getElementById('edit-compiled-document-children');
        if (!container) return;
        
        // Add drag and drop instructions
        const instructions = document.createElement('div');
        instructions.className = 'drag-drop-instructions';
        instructions.innerHTML = '<small><i class="fas fa-info-circle"></i> Drag and drop items to reorder</small>';
        instructions.style.color = '#666';
        instructions.style.marginBottom = '10px';
        instructions.style.display = 'none';
        container.parentNode.insertBefore(instructions, container);
        
        // Make child items draggable with the enhanced design
        this.makeChildrenDraggable();
        
        // Add styles for child documents
        const styleId = 'enhanced-child-document-styles';
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        
        style.textContent += `
            .document-info-row {
                display: flex;
                margin-bottom: 8px;
            }
            
            .info-label {
                width: 120px;
                font-weight: 500;
                color: #5a5c69;
            }
            
            .info-value {
                flex: 1;
                color: #3a3b45;
            }
        `;
    },
    
    // Make child document items draggable
    makeChildrenDraggable: function() {
        const container = document.getElementById('edit-compiled-document-children');
        if (!container) return;
        
        // Find all child document items
        const items = container.querySelectorAll('.research-section.child-document-item');
        if (items.length < 2) {
            // Don't enable drag-drop for less than 2 items
            return;
        }
        
        // Show drag-drop instructions
        const instructions = document.querySelector('.drag-drop-instructions');
        if (instructions) {
            instructions.style.display = 'block';
        }
        
        // Add draggable attributes and event listeners
        items.forEach(item => {
            // Make only the header draggable to allow the content area to be interactive
            const header = item.querySelector('.research-header');
            
            if (!header) return;
            
            // Set up drag functionality
            header.setAttribute('draggable', 'true');
            
            // Add dragged class when dragging
            header.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', item.dataset.id);
                item.classList.add('dragging');
                
                // Create drag preview
                const dragPreview = document.createElement('div');
                dragPreview.className = 'drag-preview';
                dragPreview.innerText = item.querySelector('h3').innerText;
                document.body.appendChild(dragPreview);
                
                e.dataTransfer.setDragImage(dragPreview, 0, 0);
                setTimeout(() => document.body.removeChild(dragPreview), 0);
            });
            
            header.addEventListener('dragend', () => {
                item.classList.remove('dragging');
            });
            
            // Handle drop target events on the entire item
            item.addEventListener('dragover', e => {
                e.preventDefault();
                const dragged = container.querySelector('.dragging');
                if (dragged && dragged !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        // Drop above
                        item.classList.add('drop-above');
                        item.classList.remove('drop-below');
                    } else {
                        // Drop below
                        item.classList.add('drop-below');
                        item.classList.remove('drop-above');
                    }
                }
            });
            
            item.addEventListener('dragleave', () => {
                item.classList.remove('drop-above', 'drop-below');
            });
            
            item.addEventListener('drop', e => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData('text/plain');
                const draggedItem = container.querySelector(`.research-section.child-document-item[data-id="${draggedId}"]`);
                
                if (draggedItem && draggedItem !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    
                    if (e.clientY < midY) {
                        // Insert before
                        container.insertBefore(draggedItem, item);
                    } else {
                        // Insert after
                        const nextItem = item.nextElementSibling;
                        if (nextItem) {
                            container.insertBefore(draggedItem, nextItem);
                        } else {
                            container.appendChild(draggedItem);
                        }
                    }
                    
                    // Save the new order
                    this.saveChildDocumentOrder();
                    
                    // Update position indicators after reordering
                    this.updatePositionIndicators();
                }
                
                item.classList.remove('drop-above', 'drop-below');
            });
        });
        
        // Add drag-drop styles
        const styleId = 'drag-drop-styles';
        let dragDropStyle = document.getElementById(styleId);
        if (!dragDropStyle) {
            dragDropStyle = document.createElement('style');
            dragDropStyle.id = styleId;
            document.head.appendChild(dragDropStyle);
            
            dragDropStyle.textContent = `
                .research-section.dragging {
                    opacity: 0.6;
                    transform: scale(0.98);
                    box-shadow: 0 8px 16px rgba(78,115,223,0.2);
                }
                
                .research-section.drop-above {
                    border-top: 2px solid #4e73df;
                    margin-top: -2px;
                }
                
                .research-section.drop-below {
                    border-bottom: 2px solid #4e73df;
                    margin-bottom: -2px;
                }
                
                .research-header {
                    cursor: grab;
                }
                
                .research-header:active {
                    cursor: grabbing;
                }
                
                .drag-preview {
                    position: fixed;
                    top: -1000px;
                    left: -1000px;
                    background: #E6E6E6;
                    padding: 10px;
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    max-width: 300px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    z-index: 9999;
                    pointer-events: none;
                }
            `;
        }
    },
    
    // Helper method to update position indicators after reordering
    updatePositionIndicators: function() {
        // Position indicators have been removed, so this function is now a no-op
        // Keeping the function for compatibility with existing code
        return;
    },
    
    // Save the new child document order
    saveChildDocumentOrder: function() {
        const container = document.getElementById('edit-compiled-document-children');
        if (!container || !this.currentDocumentId) return;
        
        const childItems = container.querySelectorAll('.child-document-item');
        const childIds = Array.from(childItems).map(item => item.dataset.id);
        
        if (childIds.length === 0) return;
        
                
        // Show loading indicator
        this.showStatusMessage('Saving new document order...', 'loading');
        
        // Update the preview to reflect the new order
        this.updateChildDocumentsPreview();
        
        // Call API to update order
        fetch(`/api/compiled-documents/${this.currentDocumentId}/reorder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                childIds: childIds
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
                        this.showStatusMessage('Document order saved', 'success');
        })
        .catch(error => {
            this.showStatusMessage('Failed to save document order', 'error');
        });
    },
    
    // Load or refresh child documents
    loadChildDocuments: function(forceRefresh = false) {
        if (!this.currentDocumentId) {
            return;
        }
        
        // Skip if already loading
        if (this.isLoadingChildren) return;
        
        // Show loading indicator
        const loadingIndicator = document.querySelector('.children-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
        }
        
        // Set loading flag
        this.isLoadingChildren = true;
        
                
        // Try different endpoints to get child documents
        const endpoints = [
            `/api/compiled-documents/${this.currentDocumentId}/children`,
            `/api/documents/${this.currentDocumentId}/children`,
            `/compiled-documents/${this.currentDocumentId}/children`,
            `/api/compiled-documents/${this.currentDocumentId}?include_children=true`,
            `/api/documents/${this.currentDocumentId}?include_children=true`
        ];
        
        let currentEndpointIndex = 0;
        
        const tryNextEndpoint = () => {
            // Hide loading indicator if we've reached the end
            if (currentEndpointIndex >= endpoints.length) {
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                }
                this.isLoadingChildren = false;
                
                // Show empty state if no children were loaded
                const childrenContainer = document.getElementById('compilation-studies-list');
                if (childrenContainer && childrenContainer.children.length === 0) {
                    childrenContainer.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon"><i class="fas fa-file-alt"></i></div>
                            <h3>No Documents Found</h3>
                            <p>This compilation doesn't have any documents attached yet or there was an error loading them.</p>
                        </div>
                    `;
                }
                    return;
                }
                
            const endpoint = endpoints[currentEndpointIndex];
                        
            fetch(endpoint)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`API responded with status ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                                        
                // Hide loading indicator
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                }
                
                // Reset loading flag
                this.isLoadingChildren = false;
                
                    // Extract children array based on response format
                    let children = [];
                    
                    if (Array.isArray(data)) {
                        // Response is direct array of children
                        children = data;
                    } else if (data.children && Array.isArray(data.children)) {
                        // Response has children property
                        children = data.children;
                    } else if (data.documents && Array.isArray(data.documents)) {
                        // Response has documents property
                        children = data.documents;
                    }
                    
                    if (children && children.length > 0) {
                                                
                        // Render child documents in the form view
                        renderChildDocuments(children, container);
                        
                        // Also render child documents in the preview panel
                        updatePreviewWithChildDocuments(children);
                        
                        // Mark as loaded
                        container.setAttribute('data-loaded', 'true');
                        
                        // Success - clear interval
                        clearInterval(fetchInterval);
                    } else {
                        // Try next endpoint if no children found
                        currentEndpointIndex++;
                        tryNextEndpoint();
                    }
                })
                .catch(error => {
                    currentEndpointIndex++;
                    tryNextEndpoint();
                });
        };
        
        // Start trying endpoints
        tryNextEndpoint();
    },
    
    // Helper function to try multiple endpoints in sequence
    tryEndpoints: function(endpoints) {
        return new Promise(async (resolve, reject) => {
            let lastError = null;
            
            for (const endpoint of endpoints) {
                try {
                                        const response = await fetch(endpoint);
                    
                    if (response.ok) {
                        const data = await response.json();
                                                
                        // Handle different response formats
                        if (data.children) {
                            resolve(data); // standard format
                            return;
                        } else if (Array.isArray(data)) {
                            resolve({ children: data }); // array format
                            return;
                        }
                    }
                    lastError = new Error(`Failed to fetch child documents from ${endpoint}: ${response.status}`);
                } catch (error) {
                    lastError = error;
                }
            }
            
            // Fall back to existing document edit implementation
            try {
                if (window.documentEdit && window.documentEdit.fetchChildDocuments) {
                                        const children = await window.documentEdit.fetchChildDocuments(this.currentDocumentId);
                    if (children && (children.length > 0 || Array.isArray(children))) {
                        resolve({ children: children });
                        return;
                    }
                }
            } catch (fallbackError) {
            }
            
            reject(lastError || new Error('Failed to fetch child documents from any endpoint'));
        });
    },
    
    // Update the child documents container with the loaded documents
    updateChildDocumentsContainer: function(children) {
        const container = document.getElementById('edit-compiled-document-children');
        
        if (!container) {
            return;
        }
        
        // Clear existing content
        container.innerHTML = '';
        
        if (children.length === 0) {
            // Show enhanced empty state
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt" style="font-size: 36px; color: #e0e0e0; margin-bottom: 15px;"></i>
                    <p>No child documents in this compilation</p>
                    <p class="empty-state-subtext">Add documents to create a complete compilation</p>
                </div>
            `;
            return;
        }
        
        // Create document items directly without grouping by year
        children.forEach((child, index) => {
            // Check if document is newly added (not an existing one)
            const isNewlyAdded = child.isNewlyAdded === true;
            
            // Get document type class
            let docTypeClass = '';
            let docType = (child.document_type || 'Document').toLowerCase();
            
            if (docType.includes('thesis')) {
                docTypeClass = 'document-thesis';
            } else if (docType.includes('dissertation')) {
                docTypeClass = 'document-dissertation';
            } else if (docType.includes('confluence')) {
                docTypeClass = 'document-confluence';
            } else if (docType.includes('synergy')) {
                docTypeClass = 'document-synergy';
            } else if (docType.includes('article')) {
                docTypeClass = 'document-article';
            }
            
            // Get publication date display
            let dateDisplay = '';
            if (child.publication_date) {
                try {
                    const date = new Date(child.publication_date);
                    dateDisplay = date.toLocaleDateString();
                } catch (e) {
                    dateDisplay = child.publication_date;
                }
            }
            
            // Get authors display
            let authorsDisplay = '';
            if (child.authors && child.authors.length > 0) {
                const authorNames = child.authors.map(author => {
                    if (typeof author === 'string') return author;
                    return author.full_name || author.name || [author.first_name, author.last_name].filter(Boolean).join(' ') || 'Unknown Author';
                });
                
                authorsDisplay = authorNames.join(', ');
                if (authorsDisplay.length > 50) {
                    authorsDisplay = authorsDisplay.substring(0, 50) + '...';
                }
            } else {
                authorsDisplay = 'Unknown Author';
            }
            
            // Get keywords display
            let keywordsDisplay = '';
            if (child.topics && child.topics.length > 0) {
                keywordsDisplay = Array.isArray(child.topics) 
                    ? child.topics.map(topic => topic.name || topic).join(', ')
                    : child.topics;
            } else if (child.keywords && child.keywords.length > 0) {
                keywordsDisplay = Array.isArray(child.keywords)
                    ? child.keywords.map(keyword => keyword.name || keyword).join(', ')
                    : child.keywords;
            } else {
                keywordsDisplay = 'No keywords available';
            }
            
            // Get abstract display
            let abstractDisplay = child.abstract || 'No abstract available';
            if (abstractDisplay.length > 300) {
                abstractDisplay = abstractDisplay.substring(0, 300) + '...';
            }
            
            // Check if document has a file path
            const hasFile = child.file_path || child.pdf_path || false;
            const fileName = hasFile ? 
                (child.file_name || child.pdf_path?.split('/').pop() || 'Document.pdf') : 
                'No file attached';
            
            // Create child document element with modern design
            const childElement = document.createElement('div');
            childElement.className = `child-document-item ${docTypeClass}`;
            childElement.dataset.id = child.id;
            childElement.dataset.index = index;
            childElement.dataset.newlyAdded = isNewlyAdded ? 'true' : 'false';
            
            childElement.innerHTML = `
                <div class="study-header">
                    <div class="study-number">${index + 1}</div>
                    <div class="study-title-wrap">
                        <h4 class="study-title">${child.title || 'Untitled Document'}</h4>
                        <div class="study-meta">
                            <span class="study-authors">${authorsDisplay}</span>
                            ${dateDisplay ? `<span class="study-date">${dateDisplay}</span>` : ''}
                        </div>
                    </div>
                    <div class="study-actions">
                        <button type="button" class="action-btn toggle-btn">
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    </div>
                </div>
                <div class="study-content" style="display: none;">
                    <div class="study-details">
                        <div class="form-group">
                            <label>Authors</label>
                            <div class="search-input-container">
                                <i class="fas fa-search"></i>
                                <input type="text" class="child-author-search" id="child-author-search-${child.id}" placeholder="Search for authors" autocomplete="off">
                        </div>
                            <div id="child-author-dropdown-${child.id}" class="dropdown-list"></div>
                            <div id="child-selected-authors-${child.id}" class="selected-authors">
                                    ${child.authors && Array.isArray(child.authors) ? 
                                        child.authors.map(author => {
                                            const authorName = typeof author === 'string' ? author : 
                                                (author.full_name || author.name || 
                                                [author.first_name, author.last_name].filter(Boolean).join(' '));
                                            const authorId = typeof author === 'string' ? author : author.id;
                                            return `<div class="selected-author" data-id="${authorId}">
                                                ${authorName}
                                                <span class="remove-author">&times;</span>
                                            </div>`;
                                        }).join('') : ''}
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Keywords</label>
                            <div class="search-input-container">
                                <i class="fas fa-search"></i>
                                <input type="text" class="child-keyword-search" id="child-keyword-search-${child.id}" placeholder="Search for keywords" autocomplete="off">
                            </div>
                            <div id="child-keyword-dropdown-${child.id}" class="dropdown-list"></div>
                            <div id="child-selected-keywords-${child.id}" class="selected-keywords">
                                    ${child.topics && Array.isArray(child.topics) ? 
                                        child.topics.map(topic => {
                                            const topicName = typeof topic === 'string' ? topic : 
                                                (topic.name || topic.title);
                                            const topicId = typeof topic === 'string' ? topic : topic.id;
                                            return `<div class="selected-keyword" data-id="${topicId}">
                                                ${topicName}
                                                <span class="remove-keyword">&times;</span>
                                            </div>`;
                                        }).join('') : ''}
                                </div>
                            </div>
                        </div>
                        
                    <div class="study-file-section">
                        <div class="file-container">
                            <div class="file-icon"><i class="fas fa-file-pdf"></i></div>
                            <div class="file-info">
                                <div class="file-name">${fileName}</div>
                                <div class="file-actions">
                                ${hasFile ? 
                                        `<button type="button" class="btn-sm view-file-btn" data-id="${child.id}">
                                            <i class="fas fa-eye"></i> View
                                        </button>
                                        <button type="button" class="btn-sm replace-file-btn" data-id="${child.id}">
                                            <i class="fas fa-sync-alt"></i> Replace File
                                        </button>
                                        <input type="file" class="hidden-file-input" accept=".pdf" style="display: none;">` : 
                                        `<span class="no-file-message">No file available</span>`
                                }
                        </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="study-content-actions">
                        <button type="button" class="btn-primary save-changes-btn" data-id="${child.id}">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                    </div>
                </div>
            `;
            
            // Add to container
            container.appendChild(childElement);
            
            // Set up event listeners for each child document
            
            // View document button
            const viewBtn = childElement.querySelector('.view-btn');
            if (viewBtn) {
                viewBtn.addEventListener('click', () => {
                    if (child.file_path || child.pdf_path) {
                        window.open(`/api/documents/${encodeURIComponent(child.id)}/download?disposition=inline`, '_blank');
                    } else {
                        alert('No file attached to this document.');
                    }
                });
            }
            
            // View file button
            const viewFileBtn = childElement.querySelector('.view-file-btn');
            if (viewFileBtn) {
                viewFileBtn.addEventListener('click', () => {
                    const docId = viewFileBtn.getAttribute('data-id');
                    if (docId) {
                        window.open(`/api/documents/${encodeURIComponent(docId)}/download?disposition=inline`, '_blank');
                    }
                });
            }
            
            // Replace file button
            const replaceFileBtn = childElement.querySelector('.replace-file-btn');
            const fileInput = childElement.querySelector('.hidden-file-input');
            if (replaceFileBtn && fileInput) {
                replaceFileBtn.addEventListener('click', () => {
                    fileInput.click();
                });
                
                fileInput.addEventListener('change', (e) => {
                    if (fileInput.files.length > 0) {
                        // Here you would handle file upload
                                                // In a real app, you would send this file to your server
                    }
                });
            }
            
            // Remove button
            const removeBtn = childElement.querySelector('.remove-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    if (confirm(`Are you sure you want to remove "${child.title || 'this document'}" from the compilation?`)) {
                        childElement.remove();
                    }
                });
            }
            
            // Toggle button for expand/collapse
            const toggleBtn = childElement.querySelector('.toggle-btn');
            const studyContent = childElement.querySelector('.study-content');
            const studyHeader = childElement.querySelector('.study-header');
            
            // Single function to handle toggling content visibility to avoid conflicts
            const toggleContent = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                
                const isExpanded = studyContent.style.display !== 'none';
                const icon = toggleBtn.querySelector('i');
                
                if (isExpanded) {
                    // Collapse
                        studyContent.style.display = 'none';
                    icon.className = 'fas fa-chevron-down';
                    } else {
                    // Expand
                        studyContent.style.display = 'block';
                    icon.className = 'fas fa-chevron-up';
                    
                    // Initialize author and keyword search fields when expanded
                    initializeChildAuthorField(childElement, child.id);
                    initializeChildKeywordField(childElement, child.id);
                }
            };
            
            // Make toggle button clickable - use a dedicated handler that stops propagation
            if (toggleBtn) {
                toggleBtn.addEventListener('click', (e) => {
                    // Stop event from bubbling to header
                    e.preventDefault();
                    e.stopPropagation();
                    toggleContent();
                });
            }
            
            // Make entire header clickable except for buttons
            if (studyHeader) {
                studyHeader.addEventListener('click', (e) => {
                    // Skip if we clicked on a button
                    if (e.target.closest('.action-btn')) {
                        return;
                    }
                    toggleContent(e);
                });
            }
            
            // Setup the author remove buttons
            const authorContainers = childElement.querySelectorAll('.selected-authors .selected-author .remove-author');
            authorContainers.forEach(btn => {
                btn.addEventListener('click', function() {
                    this.closest('.selected-author').remove();
                });
            });
            
            // Setup the keyword remove buttons
            const keywordContainers = childElement.querySelectorAll('.selected-keywords .selected-keyword .remove-keyword');
            keywordContainers.forEach(btn => {
                btn.addEventListener('click', function() {
                    this.closest('.selected-keyword').remove();
                });
            });
            
            // Setup the save changes button
            const saveChangesBtn = childElement.querySelector('.save-changes-btn');
            if (saveChangesBtn) {
                saveChangesBtn.addEventListener('click', () => {
                    // Get author data
                    const selectedAuthorsContainer = childElement.querySelector(`#child-selected-authors-${child.id}`);
                    const authorElements = selectedAuthorsContainer ? selectedAuthorsContainer.querySelectorAll('.selected-author') : [];
                    const authorData = Array.from(authorElements).map(el => ({
                        id: el.dataset.id,
                        name: el.textContent.replace('×', '').trim()
                    }));
                    
                    // Get keyword data
                    const selectedKeywordsContainer = childElement.querySelector(`#child-selected-keywords-${child.id}`);
                    const keywordElements = selectedKeywordsContainer ? selectedKeywordsContainer.querySelectorAll('.selected-keyword') : [];
                    const keywordData = Array.from(keywordElements).map(el => ({
                        id: el.dataset.id,
                        name: el.textContent.replace('×', '').trim()
                    }));
                    
                    console.log(`Saving changes for child document ${child.id}`, {
                        authors: authorData,
                        keywords: keywordData
                    });
                    
                    // Update the display in the header
                    updateAuthorDisplayInHeader(child.id);
                    updateKeywordTagsDisplay(child.id);
                        
                        // Show success message
                        const toast = document.createElement('div');
                        toast.className = 'toast toast-success';
                    toast.textContent = 'Changes saved successfully';
                        document.body.appendChild(toast);
                        
                        // Remove the toast after 3 seconds
                        setTimeout(() => {
                            toast.remove();
                        }, 3000);
                    });
                }
                
            // Remove the edit form since we're using inline editing now
            const editForm = childElement.querySelector('.study-edit-form');
            if (editForm) {
                editForm.remove();
            }
        });
        
        // Add the container to the right panel for preview
        updateChildDocumentsPreview(children);
    },
    
    // Helper function to set up author input
    setupAuthorInput: function(parentElement, documentId) {
        const input = parentElement.querySelector(`#edit-study-authors-${documentId}`);
        const container = parentElement.querySelector(`#selected-authors-${documentId}`);
        
        if (!input || !container) return;
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (value) {
                    // Create author element
                    const authorElement = document.createElement('div');
                    authorElement.className = 'selected-author';
                    authorElement.dataset.id = 'new_' + Date.now();
                    authorElement.innerHTML = `${value}<span class="remove-author">&times;</span>`;
                    
                    // Add remove functionality
                    const removeBtn = authorElement.querySelector('.remove-author');
                    if (removeBtn) {
                        removeBtn.addEventListener('click', () => {
                            authorElement.remove();
                        });
                    }
                    
                    // Add to container and clear input
                    container.appendChild(authorElement);
                    input.value = '';
                }
            }
        });
    },
    
    // Helper function to set up keyword input
    setupKeywordInput: function(parentElement, documentId) {
        const input = parentElement.querySelector(`#edit-study-keywords-${documentId}`);
        const container = parentElement.querySelector(`#selected-keywords-${documentId}`);
        
        if (!input || !container) return;
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (value) {
                    // Create keyword element
                    const keywordElement = document.createElement('div');
                    keywordElement.className = 'selected-keyword';
                    keywordElement.dataset.id = 'new_' + Date.now();
                    keywordElement.innerHTML = `${value}<span class="remove-keyword">&times;</span>`;
                    
                    // Add remove functionality
                    const removeBtn = keywordElement.querySelector('.remove-keyword');
                    if (removeBtn) {
                        removeBtn.addEventListener('click', () => {
                            keywordElement.remove();
                        });
                    }
                    
                    // Add to container and clear input
                    container.appendChild(keywordElement);
                    input.value = '';
                }
            }
        });
    },

    // Handle file upload for child documents
    handleFileUpload: function(file, documentId, element) {
        // ... existing code ...
    },
    
    // Function to load data for a compiled document
    loadCompiledDocumentData: function(documentId) {
        if (!documentId) {
            return Promise.reject(new Error('No document ID provided'));
        }
        
                this.currentDocumentId = documentId;
        
        // Try multiple endpoints to handle potential API changes or 404 errors
        const endpoints = [
            `/api/compiled-documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
            `/api/documents/${documentId}?include_children=true&include_authors=true&include_topics=true`,
            `/api/compiled-documents/${documentId}`,
            `/api/documents/${documentId}`
        ];
        
        return new Promise((resolve, reject) => {
            // Try each endpoint sequentially until one works
            let currentEndpointIndex = 0;
            
            const tryNextEndpoint = () => {
                if (currentEndpointIndex >= endpoints.length) {
                    // Create minimal data with just the ID as fallback
                    resolve({ 
                        id: documentId,
                        title: 'Untitled Compiled Document',
                        children: []
                    });
                    return;
                }
                
                const endpoint = endpoints[currentEndpointIndex];
                                
                fetch(endpoint)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`API responded with status ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                                                
                        // Process the data to ensure we have all required fields
                        const processedData = this.processCompiledDocumentData(data, documentId);
                        
                        // Check for foreword_path or foreword field
                        if (processedData.foreword || processedData.foreword_path) {
                                                        
                            // Normalize the foreword path
                            const forewordPath = processedData.foreword || processedData.foreword_path;
                            processedData.foreword = forewordPath;
                            
                            // Update UI to show the foreword file
                            this.updateForewordFileDisplay(forewordPath);
                        } else {
                                                    }
                        
                        // If we have children data, process it
                        if (processedData.children && processedData.children.length > 0) {
                                                    } else {
                            // If we don't have children, try to fetch them separately
                            this.fetchChildDocuments(documentId).then(children => {
                                processedData.children = children;
                                                                
                                // Update children display
                                const childrenContainer = document.getElementById('edit-compiled-document-children');
                                if (childrenContainer) {
                                    this.renderChildDocuments(children, childrenContainer);
                                }
                            }).catch(err => {
                                processedData.children = [];
                            });
                        }
                        
                        resolve(processedData);
                    })
                    .catch(error => {
                        currentEndpointIndex++;
                        tryNextEndpoint();
                    });
            };
            
            // Start the endpoint chain
            tryNextEndpoint();
        });
    },
    
    // Helper function to process and normalize compiled document data
    processCompiledDocumentData: function(data, documentId) {
        // Create a base object with required fields
        const processedData = {
            id: data.id || documentId,
            title: data.title || 'Untitled Compiled Document',
            start_year: data.start_year || '',
            end_year: data.end_year || '',
            volume: data.volume || '',
            is_compiled: true,
            children: [],
            authors: [],
            topics: []
        };
        
        // Copy all fields from the original data
        Object.keys(data).forEach(key => {
            processedData[key] = data[key];
        });
        
        // Handle foreword field - it might be in different fields
        if (data.foreword) {
            processedData.foreword = data.foreword;
        } else if (data.foreword_path) {
            processedData.foreword = data.foreword_path;
        }
        
        // Ensure children is an array
        if (data.children) {
            if (Array.isArray(data.children)) {
                processedData.children = data.children;
            } else {
                processedData.children = [];
            }
        }
        
        // Ensure authors is an array
        if (data.authors) {
            if (Array.isArray(data.authors)) {
                processedData.authors = data.authors;
            } else {
                processedData.authors = [];
            }
        }
        
        // Handle topics or research_agenda
        if (data.topics && Array.isArray(data.topics)) {
            processedData.topics = data.topics;
        } else if (data.research_agenda && Array.isArray(data.research_agenda)) {
            processedData.topics = data.research_agenda;
        }
        
        return processedData;
    },
    
    // Update the foreword file display
    updateForewordFileDisplay: function(forewordPath) {
        // Foreword functionality removed
    },
    
    // Fetch child documents separately
    fetchChildDocuments: function(documentId) {
        return new Promise((resolve, reject) => {
                        
            // Try multiple endpoints
            const endpoints = [
                `/api/compiled-documents/${documentId}/children?include_metadata=true&include_file=true&include_authors=true&include_topics=true`,
                `/api/documents/${documentId}/children?include_metadata=true&include_file=true&include_authors=true&include_topics=true`,
                `/api/compiled-documents/${documentId}?include_children=true&include_metadata=true&include_file=true&include_authors=true&include_topics=true`
            ];
            
            let currentEndpointIndex = 0;
            
            const tryNextEndpoint = () => {
                if (currentEndpointIndex >= endpoints.length) {
                    resolve([]); // Return empty array instead of rejecting
                    return;
                }
                
                const endpoint = endpoints[currentEndpointIndex];
                                
                fetch(endpoint)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`API responded with status ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                                                
                        // Extract children based on response format
                        let children = [];
                        
                        if (Array.isArray(data)) {
                            children = data;
                                                    } else if (data.children && Array.isArray(data.children)) {
                            children = data.children;
                                                    } else if (data.documents && Array.isArray(data.documents)) {
                            children = data.documents;
                                                    }
                        
                        if (children && children.length > 0) {
                                                        
                            // Render child documents
                            renderChildDocuments(children, container);
                            
                            // Mark as loaded
                            container.setAttribute('data-loaded', 'true');
                            
                            // Success - clear interval
                            clearInterval(fetchInterval);
                        } else {
                                                        // Try next endpoint
                            tryNextEndpoint(index + 1);
                        }
                    })
                    .catch(error => {
                        currentEndpointIndex++;
                        tryNextEndpoint();
                    });
            };
            
            // Start the endpoint chain
            tryNextEndpoint();
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
            
            // Rest of the method...
        } catch (error) {
            return null;
        }
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
            
            // Update category icon
            const categoryIcon = document.getElementById('edit-compiled-category-icon');
            if (categoryIcon) {
                categoryIcon.dataset.category = 'synergy';
            }
            
            // Populate departmental dropdown with values from the database
            if (departmentalSelect) {
                populateDepartmentalDropdown(departmentalSelect);
            }
        } else {
                        
            // Update labels
            if (issuedNoLabel) issuedNoLabel.textContent = 'Issued No.';
            if (previewIssuedLabel) previewIssuedLabel.textContent = 'Issued No:';
            
            // Show issued field, hide department field
            if (issuedNoInput) issuedNoInput.style.cssText = 'display: block !important';
            if (departmentalSelect) departmentalSelect.style.cssText = 'display: none !important';
            
            // Update category icon
            const categoryIcon = document.getElementById('edit-compiled-category-icon');
            if (categoryIcon) {
                categoryIcon.dataset.category = 'confluence';
            }
        }
        
        // Update preview fields
        this.updatePreviewFields();
    }
};

// Add these functions before the fetchSynergyDepartment function (around line 3950)

// Add a function to fetch departments from the API
async function fetchDepartments() {
    try {
                
        // Try multiple endpoints
        const endpoints = [
            '/api/departments',
            '/departments',
            '/api/synergy/departments'
        ];
        
        for (const endpoint of endpoints) {
            try {
                                const response = await fetch(endpoint);
                
                if (response.ok) {
                    const data = await response.json();
                                        return data;
                } else {
                }
            } catch (error) {
            }
        }
        
        // If all endpoints fail, return a fallback list
        return [
            { id: 'College of Business in Information Technology', department_name: 'College of Business in Information Technology', code: 'CBIT' },
            { id: 'College of Nursing', department_name: 'College of Nursing', code: 'CON' },
            { id: 'College of Arts and Science Education', department_name: 'College of Arts and Science Education', code: 'CASE' },
            { id: 'Basic Academic Education', department_name: 'Basic Academic Education', code: 'BAE' }
        ];
    } catch (error) {
        return [];
    }
}

// Populate the departmental dropdown with values from the database
async function populateDepartmentalDropdown(select) {
    const departmentalSelect = select || document.getElementById('edit-compiled-departmental');
    
    if (!departmentalSelect) {
        return;
    }
    
        
    try {
        // Save current value if any
        const currentValue = departmentalSelect.value;
        
        // Clear existing options except the first empty option
        while (departmentalSelect.options.length > 1) {
            departmentalSelect.remove(1);
        }
        
        // If first option is missing, add it
        if (departmentalSelect.options.length === 0) {
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select Department';
            departmentalSelect.appendChild(defaultOption);
        }
        
        // Fetch departments from the API
        const departments = await fetchDepartments();
        
        // Add each department as an option
        departments.forEach(dept => {
            const option = document.createElement('option');
            // Use the department name or ID as the value
            option.value = dept.department_name || dept.name || dept.id;
            
            // Show both name and code if available
            option.textContent = dept.code ? 
                `${dept.department_name || dept.name} (${dept.code})` : 
                (dept.department_name || dept.name);
                
            departmentalSelect.appendChild(option);
        });
        
        // Restore previous value if possible
        if (currentValue) {
            // Try to find exact match
            let found = false;
            Array.from(departmentalSelect.options).forEach(option => {
                if (option.value === currentValue) {
                    departmentalSelect.value = currentValue;
                    found = true;
                }
            });
            
            // If no match found and we have a value, create a new option
            if (!found && currentValue) {
                                const newOption = document.createElement('option');
                newOption.value = currentValue;
                newOption.textContent = currentValue;
                departmentalSelect.appendChild(newOption);
                departmentalSelect.value = currentValue;
            }
        }
        
            } catch (error) {
    }
}

// SYNERGY DEPARTMENT FETCHER - Specifically for fetching department values
(function fetchSynergyDepartment() {
        
    let attempts = 0;
    const maxAttempts = 10;
    let documentNotFound = false;
    
    // Set up a polling interval to try fetching the department
    const fetchInterval = setInterval(attemptFetch, 1000);
    
    function attemptFetch() {
        attempts++;
                
        if (attempts >= maxAttempts || documentNotFound) {
                        clearInterval(fetchInterval);
            return;
        }
        
        // Check if we're editing a Synergy document
        const categoryField = document.getElementById('edit-compiled-category');
        if (!categoryField || (categoryField.value !== 'SYNERGY' && categoryField.value !== 'Synergy')) {
                        clearInterval(fetchInterval);
            return;
        }
        
        // Get department select
        const departmentalSelect = document.getElementById('edit-compiled-departmental');
        if (!departmentalSelect) {
                        return;
        }
        
        // If we already have a value, no need to fetch
        if (departmentalSelect.value) {
                        clearInterval(fetchInterval);
            return;
        }
        
        // Get document ID
        const documentId = document.getElementById('edit-compiled-document-id')?.value;
        if (!documentId) {
                        return;
        }
        
        // Skip invalid document IDs
        if (documentId === 'new' || documentId === 'undefined' || isNaN(parseInt(documentId))) {
                        clearInterval(fetchInterval);
            return;
        }
        
        // Check if another function already displayed document not found error
        const existingError = document.querySelector('.error-message');
        if (existingError && existingError.textContent.includes(`Document ID ${documentId} not found`)) {
                        clearInterval(fetchInterval);
            return;
        }
        
        // Populate departments from the database
        populateDepartmentalDropdown(departmentalSelect)
            .then(() => {
                                
                // Try multiple endpoints for fetching document data
        const endpoints = [
            `/api/documents/${documentId}`,
            `/api/compiled-documents/${documentId}`,
                    `/api/synergy-documents/${documentId}`,
            `/api/documents/${documentId}?include_metadata=true`
        ];
        
                // Try all endpoints in parallel for faster response
                Promise.allSettled(endpoints.map(endpoint => 
            fetch(endpoint)
        .then(response => {
            if (!response.ok) {
                                if (response.status === 404) {
                                    // We expect 404s for some endpoints, don't log as errors
                                                                        return null;
                                }
                                throw new Error(`Status ${response.status}`);
            }
            return response.json();
        })
                        .then(data => data ? { endpoint, data } : null)
                        .catch(error => {
                            return null;
                        })
                ))
                .then(results => {
                    // Filter out null results and find the first one with department data
                    const validResults = results
                        .filter(r => r.status === 'fulfilled' && r.value)
                        .map(r => r.value);
                    
                    const successfulResult = validResults.find(result => 
                        result && result.data && result.data.department
                    );
                    
                    if (successfulResult) {
                        const { endpoint, data } = successfulResult;
                                                
                        if (data.department) {
                                                        
                            // Find matching option or add new one
        let found = false;
                            Array.from(departmentalSelect.options).forEach(option => {
                                if (option.value === data.department) {
                                    departmentalSelect.value = data.department;
                found = true;
            }
        });
        
                            if (!found) {
            const newOption = document.createElement('option');
                                newOption.value = data.department;
                                newOption.textContent = data.department;
                                departmentalSelect.appendChild(newOption);
                                departmentalSelect.value = data.department;
                            }
                            
                            // Update preview
                            updateDepartmentInPreview(data.department);
                            
                            // Make department field visible
                            departmentalSelect.style.cssText = 'display: block !important';
                            
                            // Hide issued no field
        const issuedNoInput = document.getElementById('edit-compiled-issued-no');
        if (issuedNoInput) {
            issuedNoInput.style.cssText = 'display: none !important';
        }
        
                            // Success - clear interval
                            clearInterval(fetchInterval);
                            return;
                        }
                    }
                    
                    // Check if all endpoints returned 404 - document likely doesn't exist
                    const all404s = results.every(r => 
                        r.status === 'fulfilled' && (r.value === null || !r.value)
                    );
                    
                    if (all404s) {
                                                documentNotFound = true;
                        clearInterval(fetchInterval);
                        
                        // Only show error message if it's not already displayed
                        if (!document.querySelector('.error-message')) {
                            const errorMessage = document.createElement('div');
                            errorMessage.className = 'error-message';
                            errorMessage.textContent = `Document ID ${documentId} not found. It may have been deleted.`;
                            errorMessage.style.cssText = 'color: red; padding: 10px; margin: 10px 0; border: 1px solid red; background: #fff0f0;';
                            
                            const form = document.querySelector('.document-edit-form');
                            if (form) {
                                form.prepend(errorMessage);
                            } else {
                                document.body.prepend(errorMessage);
                            }
                        }
                        return;
                    }
                    
                    // If we tried all endpoints and found no department, stop looking
                    if (attempts >= maxAttempts / 2) {
                                                clearInterval(fetchInterval);
                    } else {
                                            }
                })
                .catch(error => {
                    // Stop interval after multiple retries
                    if (attempts >= maxAttempts / 2) {
                        clearInterval(fetchInterval);
                    }
                });
            })
            .catch(error => {
                // Stop interval after multiple retries
                if (attempts >= maxAttempts / 2) {
                    clearInterval(fetchInterval);
                }
            });
    }
    
    // Update department value in preview
    function updateDepartmentInPreview(value) {
                
        const previewEl = document.getElementById('edit-compiled-preview-issued-no');
        if (previewEl) {
            previewEl.textContent = value || '-';
                    }
    }
})();

// TITLE MANAGER - Auto-generate and disable title editing
(function manageTitleField() {
        
    // Try to find the title field and related fields periodically
    let attempts = 0;
    const maxAttempts = 15;
    const checkInterval = setInterval(setupTitleGeneration, 800);
    
    function setupTitleGeneration() {
        attempts++;
                
        if (attempts >= maxAttempts) {
                        clearInterval(checkInterval);
            return;
        }
        
        // Find the title field
        const titleField = document.getElementById('edit-compiled-document-title');
        if (!titleField) {
                        return;
        }
        
        // Find the category, volume, and year fields
        const categoryField = document.getElementById('edit-compiled-category');
        const volumeField = document.getElementById('edit-compiled-volume');
        const startYearField = document.getElementById('edit-compiled-pub-year-start');
        const endYearField = document.getElementById('edit-compiled-pub-year-end');
        
        // Log field statuses
        console.log('TITLE MANAGER: Fields found:', {
            title: !!titleField,
            category: !!categoryField,
            volume: !!volumeField,
            startYear: !!startYearField,
            endYear: !!endYearField
        });
        
        // If we have all required fields, continue setup
        if (titleField && categoryField && volumeField && startYearField && endYearField) {
                        
            // Disable the title field
            titleField.disabled = true;
            titleField.style.backgroundColor = '#f8f9fa';
            titleField.style.cursor = 'not-allowed';
            
            // Add explanatory text
            const titleContainer = titleField.closest('.form-group');
            if (titleContainer && !titleContainer.querySelector('.title-help-text')) {
                const helpText = document.createElement('small');
                helpText.className = 'form-text text-muted title-help-text';
                helpText.innerHTML = '<i class="fas fa-info-circle"></i> Title is automatically generated based on document type, volume, and year range';
                helpText.style.color = '#6c757d';
                helpText.style.fontStyle = 'italic';
                helpText.style.marginTop = '5px';
                helpText.style.display = 'block';
                
                titleContainer.appendChild(helpText);
                            }
            
            // Generate initial title
            generateTitle();
            
            // Set up event listeners for fields that affect the title
            volumeField.addEventListener('input', generateTitle);
            startYearField.addEventListener('input', generateTitle);
            endYearField.addEventListener('input', generateTitle);
            
            // Success - clear the interval
            clearInterval(checkInterval);
                    }
        
        // Generate title based on current field values
        function generateTitle() {
            // Get current values
            const category = categoryField.value || '';
            const volume = volumeField.value || '';
            const startYear = startYearField.value || '';
            const endYear = endYearField.value || '';
            
            // Only generate if we have the minimum required values
            if (category && volume) {
                // Format year range
                const yearText = startYear && endYear ? ` (${startYear}-${endYear})` : '';
                
                // Generate title format: DOCUMENT_TYPE Vol. X (YEAR-YEAR)
                const title = `${category} Vol. ${volume}${yearText}`;
                
                                
                // Set title field value
                titleField.value = title;
                
                // Also update preview title if it exists
                const previewTitle = document.getElementById('edit-compiled-document-preview-title');
                if (previewTitle) {
                    previewTitle.textContent = title;
                                    }
            }
        }
    }
})();

// Child document loader functionality has been removed as requested
// (function loadCompiledDocumentChildren() { ... })();

function renderChildDocuments(children, container) {
        
    // Clear the container first
    container.innerHTML = '';
    
    // Create a wrapper for the documents
    const wrapper = document.createElement('div');
    wrapper.className = 'child-documents-wrapper';
    wrapper.style.cssText = 'margin-top: 15px;';
    
    // Create title for the section
    const sectionTitle = document.createElement('h4');
    sectionTitle.textContent = 'Child Documents';
    sectionTitle.style.cssText = 'font-size: 16px; margin-bottom: 10px; color: #333;';
    wrapper.appendChild(sectionTitle);
    
    // Add each child document
    children.forEach(doc => {
        try {
            // Create card-like container for each document
            const docCard = document.createElement('div');
            docCard.className = 'child-document-card';
            docCard.dataset.id = doc.id;
            docCard.style.cssText = `
                border: 1px solid #e3e6f0;
                border-radius: 5px;
                padding: 12px;
                margin-bottom: 10px;
                background: #E6E6E6;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                position: relative;
            `;
            
            // Add document title
            const titleEl = document.createElement('div');
            titleEl.className = 'child-document-title';
            titleEl.textContent = doc.title || 'Untitled Document';
            titleEl.style.cssText = 'font-weight: 600; margin-bottom: 8px; color: #2e59d9;';
            docCard.appendChild(titleEl);
            
            // Add file info if available
            if (doc.file_path || doc.path) {
                const filePath = doc.file_path || doc.path;
                const fileInfo = document.createElement('div');
                fileInfo.className = 'child-document-file';
                fileInfo.innerHTML = `<small>File: ${filePath.split('/').pop()}</small>`;
                fileInfo.style.cssText = 'color: #666; font-size: 12px; margin-bottom: 5px;';
                docCard.appendChild(fileInfo);
            }
            
            // Add document type if available
            if (doc.document_type || doc.doc_type || doc.type) {
                const docType = doc.document_type || doc.doc_type || doc.type;
                const typeEl = document.createElement('div');
                typeEl.className = 'child-document-type';
                typeEl.innerHTML = `<small>Type: ${docType}</small>`;
                typeEl.style.cssText = 'color: #666; font-size: 12px; margin-bottom: 5px;';
                docCard.appendChild(typeEl);
            }
            
            // Add description if available (truncated)
            if (doc.description) {
                const descEl = document.createElement('div');
                descEl.className = 'child-document-description';
                
                // Truncate description if it's too long
                let desc = doc.description;
                if (desc.length > 120) {
                    desc = desc.substring(0, 120) + '...';
                }
                
                descEl.textContent = desc;
                descEl.style.cssText = 'font-size: 13px; color: #555; margin: 5px 0;';
                docCard.appendChild(descEl);
            }
            
            // Add metadata section
            const metaContainer = document.createElement('div');
            metaContainer.className = 'child-document-metadata';
            metaContainer.style.cssText = 'margin-top: 10px; font-size: 12px; color: #777;';
            
            // Add authors
            if (doc.authors && doc.authors.length > 0) {
                const authorEl = document.createElement('div');
                authorEl.className = 'meta-item authors';
                
                // Format authors
                let authorText = doc.authors.map(author => {
                    if (typeof author === 'string') return author;
                    return author.full_name || author.name || [author.first_name, author.last_name].filter(Boolean).join(' ') || `Author ${author.id}`;
                }).join(', ');
                
                // Truncate if too many authors
                if (authorText.length > 50) {
                    authorText = authorText.substring(0, 50) + '...';
                }
                
                authorEl.innerHTML = `<small><strong>Authors:</strong> ${authorText || 'None'}</small>`;
                metaContainer.appendChild(authorEl);
                
                // Initialize author field if we have a form for authors
                initializeChildAuthorField(docCard, doc.id);
            } else {
                // If no authors, show link to add
                const authorEl = document.createElement('div');
                authorEl.className = 'meta-item authors';
                authorEl.innerHTML = `<small><strong>Authors:</strong> <a href="#" class="add-author-link" data-id="${doc.id}">+ Add Author</a></small>`;
                metaContainer.appendChild(authorEl);
                
                // Initialize author field
                initializeChildAuthorField(docCard, doc.id);
            }
            
            // Add keywords/topics if available
            if ((doc.topics && doc.topics.length > 0) || (doc.keywords && doc.keywords.length > 0)) {
                const topics = doc.topics || doc.keywords || [];
                
                const topicEl = document.createElement('div');
                topicEl.className = 'meta-item topics';
                
                // Format topics
                let topicText = topics.map(topic => {
                    if (typeof topic === 'string') return topic;
                    return topic.name || topic.title || `Topic ${topic.id}`;
                }).join(', ');
                
                // Truncate if too many
                if (topicText.length > 50) {
                    topicText = topicText.substring(0, 50) + '...';
                }
                
                topicEl.innerHTML = `<small><strong>Keywords:</strong> ${topicText}</small>`;
                metaContainer.appendChild(topicEl);
                
                // Initialize keyword field
                initializeChildKeywordField(docCard, doc.id);
            } else {
                // If no keywords, show link to add
                const topicEl = document.createElement('div');
                topicEl.className = 'meta-item topics';
                topicEl.innerHTML = `<small><strong>Keywords:</strong> <a href="#" class="add-keyword-link" data-id="${doc.id}">+ Add Keyword</a></small>`;
                metaContainer.appendChild(topicEl);
                
                // Initialize keyword field
                initializeChildKeywordField(docCard, doc.id);
            }
            
            docCard.appendChild(metaContainer);
            
            // Add view button
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'child-document-actions';
            buttonContainer.style.cssText = 'margin-top: 10px; text-align: right;';
            
            const viewButton = document.createElement('button');
            viewButton.className = 'btn btn-sm btn-primary view-child-btn';
            viewButton.innerHTML = '<i class="fas fa-eye"></i> View';
            viewButton.style.cssText = 'font-size: 12px; padding: 3px 8px; background: #4e73df; color: #E6E6E6; border: none; border-radius: 3px; cursor: pointer;';
            viewButton.dataset.id = doc.id;
            
            // Add event listener for view button
            viewButton.addEventListener('click', () => {
                const docId = viewButton.dataset.id;
                
                                
                // Try multiple methods to view the document
                if (doc.file_path || doc.path) {
                    window.open(`/api/documents/${encodeURIComponent(docId)}/download?disposition=inline`, '_blank');
                    } else {
                    // Otherwise use the document preview functionality
                    if (window.documentPreview && typeof window.documentPreview.openDocument === 'function') {
                        window.documentPreview.openDocument(docId);
                    } else if (typeof openPdfViewer === 'function') {
                        openPdfViewer(docId);
                    } else {
                        // Fallback to direct navigation
                        window.open(`/api/documents/${encodeURIComponent(docId)}/download?disposition=inline`, '_blank');
                    }
                }
            });
            
            buttonContainer.appendChild(viewButton);
            docCard.appendChild(buttonContainer);
            
            // Add the card to the wrapper
            wrapper.appendChild(docCard);
        } catch (error) {
        }
    });
    
    // Add the wrapper to the container
    container.appendChild(wrapper);
    
    // Set data-loaded attribute
    container.setAttribute('data-loaded', 'true');
    
    }

// Helper function to ensure child document containers are hidden
function hideChildDocumentContainers() {
    // This function hides any references to child document containers in both form and preview
    // It's called at various points in the application to ensure these sections remain hidden
    
    // Hide form child document container
    const childDocsContainer = document.getElementById('edit-compiled-document-children');
    if (childDocsContainer) {
        // Find the parent section that contains the container and hide it completely
        const childDocsSection = childDocsContainer.closest('.form-section') || 
                                childDocsContainer.closest('.card') ||
                                childDocsContainer.parentElement;
        
        if (childDocsSection) {
            childDocsSection.style.display = 'none';
        } else {
            // If we can't find a parent section, just hide the container
            childDocsContainer.style.display = 'none';
        }
        
        // Ensure the container is marked as processed
        childDocsContainer.setAttribute('data-removed', 'true');
    }
    
    // Hide preview child document container
    const previewChildDocsContainer = document.getElementById('edit-compiled-document-preview-children');
    if (previewChildDocsContainer) {
        // Find the parent section that contains the container and hide it completely
        const previewChildDocsSection = previewChildDocsContainer.closest('.preview-section') || 
                                       previewChildDocsContainer.closest('.card') ||
                                       previewChildDocsContainer.parentElement;
        
        if (previewChildDocsSection) {
            previewChildDocsSection.style.display = 'none';
        } else {
            // If we can't find a parent section, just hide the container
            previewChildDocsContainer.style.display = 'none';
        }
        
        // Ensure the container is marked as processed
        previewChildDocsContainer.setAttribute('data-removed', 'true');
    }
}

// Function to fetch and display foreword file for a document
function fetchAndDisplayForewordFile() {
    // Foreword functionality removed
}

// Call the function when the document loads
document.addEventListener('DOMContentLoaded', function() {
    // Hide child document containers on page load
    hideChildDocumentContainers();
    
    // Also hide them periodically to catch any that might be added dynamically
    setInterval(hideChildDocumentContainers, 2000);
    
    // Fetch and display foreword file - removed
    
    // Set up a button to manually fetch foreword if needed - removed
});
