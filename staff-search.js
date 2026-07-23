/**
 * Staff Search Feature for PWA
 * Replaces the standard <select> with a searchable dropdown
 */

document.addEventListener('DOMContentLoaded', () => {
    const originalSelect = document.getElementById('staff-name');
    if (!originalSelect) return;

    // Create container
    const container = document.createElement('div');
    container.className = 'staff-search-container';
    
    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'staff-search-input';
    input.placeholder = 'Search your name...';
    input.setAttribute('aria-label', 'Search your staff name');
    
    // Create list
    const list = document.createElement('div');
    list.className = 'staff-dropdown-list';
    
    // Populate list from original select
    const options = Array.from(originalSelect.options).filter(opt => opt.value !== "");
    
    options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'staff-option';
        item.textContent = opt.textContent;
        item.dataset.value = opt.value || opt.textContent;
        
        item.addEventListener('click', () => {
            originalSelect.value = item.dataset.value;
            input.value = item.textContent;
            list.classList.remove('show');
            
            // Trigger change event on original select
            originalSelect.dispatchEvent(new Event('change'));
        });
        
        list.appendChild(item);
    });
    
    // Toggle list on input focus/click
    input.addEventListener('focus', () => {
        list.classList.add('show');
    });
    
    // Filter list on input
    input.addEventListener('input', () => {
        const filter = input.value.toLowerCase();
        const items = list.querySelectorAll('.staff-option');
        let hasVisible = false;
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            if (text.includes(filter)) {
                item.classList.remove('hidden');
                hasVisible = true;
            } else {
                item.classList.add('hidden');
            }
        });
        
        if (hasVisible) {
            list.classList.add('show');
        }
    });
    
    // Close list when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            list.classList.remove('show');
        }
    });

    // Hide original select but keep it for logic compatibility
    originalSelect.style.display = 'none';
    
    // Assemble and insert
    container.appendChild(input);
    container.appendChild(list);
    originalSelect.parentNode.insertBefore(container, originalSelect);
    
    // Sync if original select changes (e.g. from local storage load)
    const syncInput = () => {
        const selectedOpt = originalSelect.options[originalSelect.selectedIndex];
        if (selectedOpt && selectedOpt.value !== "") {
            input.value = selectedOpt.textContent;
        }
    };
    
    originalSelect.addEventListener('change', syncInput);
    
    // Initial sync
    setTimeout(syncInput, 100);
});
