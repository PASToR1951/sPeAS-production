// dropdown-fix.js
// Fix for navbar dropdown links not navigating properly

(function() {
  // Function to run after DOM is fully loaded
  function fixDropdownNavigation() {
    // Define correct navigation paths
    const correctPaths = {
      'Profile': '/pages/userProfile.html',
      'History': '/pages/userHistory.html',
      'Library': '/pages/savedDocument.html'
    };
    
    // Fix any existing profile links in the dropdown
    document.querySelectorAll('.dropdown-menu a').forEach(link => {
      const linkText = link.textContent.trim();
      if (correctPaths[linkText]) {
        link.href = correctPaths[linkText];
        console.log(`Updated ${linkText} link to ${correctPaths[linkText]}`);
      }
    });

    // Also fix mobile menu links
    document.querySelectorAll('#mobile-menu a').forEach(link => {
      const linkText = link.textContent.trim().split(/\s+/)[0]; // Extract first word (e.g., "Library 3" -> "Library")
      if (correctPaths[linkText]) {
        link.href = correctPaths[linkText];
        console.log(`Updated mobile ${linkText} link to ${correctPaths[linkText]}`);
      }
    });

    // Add click handler to dropdown menu links
    document.addEventListener('click', function(event) {
      // Check if the clicked element is a link inside the dropdown menu
      const dropdownLink = event.target.closest('.dropdown-menu a');
      if (dropdownLink) {
        // Stop event propagation to prevent dropdown toggle from interfering
        event.stopPropagation();
        
        // Get the text content to determine which page to navigate to
        const linkText = dropdownLink.textContent.trim();
        
        // If we have a correct path for this link, use it, otherwise use the href
        const destination = correctPaths[linkText] || dropdownLink.href;
        
        // Navigate to the destination
        console.log(`Navigating to: ${destination}`);
        window.location.href = destination;
      }
    });

    // Modify any existing toggleDropdown function to exclude link clicks
    if (typeof window.toggleDropdown === 'function') {
      // Store reference to the original function
      const originalToggleDropdown = window.toggleDropdown;
      
      // Replace with our modified version
      window.toggleDropdown = function(forceClose) {
        // Don't toggle if a link was clicked
        if (event && event.target.closest('a[href]')) {
          return;
        }
        
        // Call the original function
        return originalToggleDropdown(forceClose);
      };
    }
    
    console.log("Dropdown navigation fix applied with correct paths");
  }

  // Apply fix when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixDropdownNavigation);
  } else {
    fixDropdownNavigation();
  }
})(); 