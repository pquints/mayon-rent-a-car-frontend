// ========================================================
// AUTHENTICATION & AUTHORIZATION
// ========================================================
const DEBUG = localStorage.getItem('DEBUG') === 'true';
let currentUser = null;
let authToken = null;

// Check authentication on page load
document.addEventListener("DOMContentLoaded", function() {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');
    
    if (!token || !user) {
        showLoginView();
        return;
    }
    
    try {
        currentUser = JSON.parse(user);
        authToken = token;
        showDashboardView();
        initializeDashboard();
        restoreAdminView();
        updateUserDisplay();
    } catch (error) {
        console.error("Error parsing user data:", error);
        showLoginView();
    }
});

function getNavItemByIcon(iconClass) {
    const navItems = document.querySelectorAll('.nav-item');
    return Array.from(navItems).find(item => item.querySelector(`i.${iconClass}`));
}

function showLoginView() {
    document.getElementById('loginView').style.display = 'flex';
    document.getElementById('dashboardContainer').style.display = 'none';
    
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.removeEventListener('submit', handleLogin);
        loginForm.addEventListener('submit', handleLogin);
    }

    const togglePassword = document.getElementById('togglePassword');
    const passwordField = document.getElementById('loginPassword');
    const usernameField = document.getElementById('loginUsername');
    const errorDiv = document.getElementById('loginError');
    if (togglePassword && passwordField) {
        togglePassword.addEventListener('click', () => {
            const isPassword = passwordField.type === 'password';
            passwordField.type = isPassword ? 'text' : 'password';
            togglePassword.textContent = isPassword ? 'Hide' : 'Show';
        });
    }

    const clearLoginError = () => {
        if (errorDiv && errorDiv.style.display === 'block') {
            errorDiv.style.display = 'none';
        }
    };

    if (passwordField) {
        passwordField.addEventListener('input', clearLoginError);
    }
    if (usernameField) {
        usernameField.addEventListener('input', clearLoginError);
    }
}

function showDashboardView() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('dashboardContainer').style.display = 'flex';
}

function restoreAdminView() {
    const savedView = localStorage.getItem('adminActiveView');
    if (!savedView || savedView === 'dashboard') {
        showView('dashboard');
        return;
    }

    if (savedView === 'userManagement') {
        showView('userManagement');
        loadUsers();
    } else if (savedView === 'vehicleManagement') {
        showView('vehicleManagement');
        loadVehicles();
    } else {
        showView('dashboard');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    try {
        const response = await fetch(`${API_URL}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            const message = data.error || 'Login failed';
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            showNotificationToast(message, 'error');
            return;
        }
        
        // Store auth credentials and show the dashboard directly
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        localStorage.setItem('adminActiveView', 'dashboard');
        currentUser = data.user;
        authToken = data.token;

        updateUserDisplay();
        showDashboardView();
        showView('dashboard');
        showUserManagementIfAdmin();
        initializeDashboard();
        showNotificationToast('Login successful!', 'success');
        return;
    } catch (error) {
        console.error("Login error:", error);
        const message = 'Network error. Please try again.';
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        showNotificationToast(message, 'error');
    }
}

function toggleAccountMenu() {
    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', function closeDropdown(e) {
        const userProfile = document.querySelector('.user-profile');
        const dropdown = document.getElementById('accountDropdown');
        if (dropdown && userProfile && !userProfile.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('active');
            document.removeEventListener('click', closeDropdown);
        }
    });
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        currentUser = null;
        authToken = null;
        showLoginView();
        document.getElementById('dashboardContainer').innerHTML = '<div id="mainDashboardView"></div><div id="fullPageDetailsView"></div>';
    }
}

function updateUserDisplay() {
    if (currentUser) {
        const initials = (currentUser.fullname || 'U').substring(0, 1).toUpperCase();
        document.getElementById('userAvatar').textContent = initials;
        document.getElementById('userFullname').textContent = currentUser.fullname || currentUser.username;
        document.getElementById('userRoleDisplay').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Driver';
    }
}



function showUserManagementIfAdmin() {
    const usersNavItem = getNavItemByIcon('fa-users');
    const vehiclesNavItem = getNavItemByIcon('fa-car');
    if (currentUser && currentUser.role === 'admin') {
        if (usersNavItem) usersNavItem.style.display = 'block';
        if (vehiclesNavItem) vehiclesNavItem.style.display = 'block';
        setupUserManagementNavigation();
    } else {
        if (usersNavItem) usersNavItem.style.display = 'none';
        if (vehiclesNavItem) vehiclesNavItem.style.display = 'none';
    }
}

function setupUserManagementNavigation() {
    const usersNavItem = getNavItemByIcon('fa-users');
    const dashboardNavItem = getNavItemByIcon('fa-chart-line');
    const vehiclesNavItem = getNavItemByIcon('fa-car');
    
    if (dashboardNavItem) {
        dashboardNavItem.onclick = (e) => {
            e.preventDefault();
            showView('dashboard');
        };
    }
    
    if (usersNavItem) {
        usersNavItem.onclick = (e) => {
            e.preventDefault();
            showView('userManagement');
            loadUsers();
        };
    }
    
    if (vehiclesNavItem) {
        vehiclesNavItem.onclick = (e) => {
            e.preventDefault();
            showView('vehicleManagement');
            loadVehicles();
        };
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('authToken') || authToken || '';
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

function ensureAuth() {
    const token = localStorage.getItem('authToken') || authToken || '';
    if (!token) {
        showNotificationToast('Missing authentication. Please login again.', 'error');
        showLoginView();
        setTimeout(() => document.getElementById('loginUsername')?.focus(), 120);
        return false;
    }
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            showNotificationToast('Session expired. Please login again.', 'warning');
            showLoginView();
            setTimeout(() => document.getElementById('loginUsername')?.focus(), 120);
            return false;
        }
    } catch (e) {
        showNotificationToast('Invalid auth token. Please login again.', 'error');
        showLoginView();
        setTimeout(() => document.getElementById('loginUsername')?.focus(), 120);
        return false;
    }
    return true;
}

const API_URL = 'http://127.0.0.1:3000/api';
let activeStatus = 'open';
let currentBookingsList = [];
let currentFilteredList = []; // Track filtered results for pagination
let currentPage = 1;
const ITEMS_PER_PAGE = 10;

// ========================================================
// 1. METRICS ENGINE: KUKUNIN ANG MGA BILANG MULA SA SERVER
// ========================================================
async function fetchStatusCounts() {
    try {
        const response = await fetch(`${API_URL}/status-counts`);
        if (!response.ok) throw new Error('Network response was not ok');
        
        const counts = await response.json();
        
        const statuses = [
            { id: 'all', label: 'All', count: counts['all'] || 0 },
            { id: 'open', label: 'Open', count: counts['open'] || 0 },
            { id: 'quoted', label: 'Quoted', count: counts['quoted'] || 0 },
            { id: 'approved', label: 'Customer Approved', count: counts['approved'] || 0 },
            { id: 'assignment', label: 'For Assignment', count: counts['assignment'] || 0 },
            { id: 'pending', label: 'Pending Payment', count: counts['pending'] || 0 },
            { id: 'confirmed', label: 'Confirmed', count: counts['confirmed'] || 0 },
            { id: 'ongoing', label: 'Ongoing', count: counts['ongoing'] || 0 },
            { id: 'completed', label: 'Completed', count: counts['completed'] || 0 },
            { id: 'deposited', label: 'Deposited', count: counts['deposited'] || 0 },
            { id: 'cancelled', label: 'Cancelled', count: counts['cancelled'] || 0 },
            { id: 'no-avail', label: 'Cancelled - No Availability', count: counts['no-avail'] || 0 },
            { id: 'lost', label: 'Cancelled - Lost', count: counts['lost'] || 0 }
        ];

        renderStatusPills(statuses);
    } catch (error) {
        console.error("Error fetching counts:", error);
    }
}

// ========================================================
// 2. PILLS ENGINE: I-RENDER ANG MGA TABS SA SCREEN
// ========================================================
function renderStatusPills(statuses) {
    const container = document.getElementById('statusPills');
    if (!container) return;
    container.innerHTML = '';

    statuses.forEach(status => {
        const pill = document.createElement('div');
        pill.className = `pill ${status.id === activeStatus ? 'active' : ''}`;
        
        pill.innerHTML = `
            <span class="pill-label">${status.label}</span>
            ${status.count > 0 ? `<span class="count-badge">${status.count}</span>` : ''}
        `;

        pill.addEventListener('click', () => {
            if (activeStatus === status.id) return;
            activeStatus = status.id;
            currentPage = 1;
            
            document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            
            fetchBookings();
        });

        container.appendChild(pill);
    });
}

// ========================================================
// 3. DATA FETCH ENGINE: KUKUNIN ANG BOOKINGS BASE SA TAB
// ========================================================
async function fetchBookings() {
    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7" class="loading-text">Loading bookings...</td></tr>`;
    }

    try {
        const response = await fetch(`${API_URL}/bookings?status=${activeStatus}`);
        if (!response.ok) throw new Error('Failed to fetch bookings');
        
        const bookings = await response.json();
        renderTable(bookings, currentPage);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" class="error-text" style="color: #ff4d4d; text-align: center; padding: 20px;">Nasira ang koneksyon sa server. Pakisubukan muli.</td></tr>`;
        }
    }
}

// ========================================================
// 4. GRID TABLE VIEW DISPLAY LAYOUT
// ========================================================
function renderTable(bookingsList, page = currentPage) {
    currentBookingsList = bookingsList;

    const totalPages = Math.max(1, Math.ceil((bookingsList?.length || 0) / ITEMS_PER_PAGE));
    page = Math.min(Math.max(page, 1), totalPages);
    currentPage = page;

    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!bookingsList || bookingsList.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data" style="text-align: center; padding: 30px; color: #888;">No data available</td>
            </tr>
        `;
        renderPagination([]);
        return;
    }

    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedList = bookingsList.slice(startIndex, endIndex);

    paginatedList.forEach(booking => {
        const row = document.createElement('tr');
        const displayStatus = booking.status || 'Open';
        const statusClass = `badge-${displayStatus.toLowerCase().replace(/\s+/g, '-')}`;
        const displayRentalType = booking.rentalType === 'with-driver' || booking.rentalType === 'with driver' ? 'With Driver' : 'Self-Drive';

        row.innerHTML = `
            <td><strong>${booking.ref || '—'}</strong></td>
            <td>${booking.name || '—'}</td>
            <td>${displayRentalType}</td>
            <td>${booking.serviceOption || '—'}</td>
            <td>${booking.vehicleType || '—'}</td>
            <td><span class="status-badge ${statusClass}">${displayStatus}</span></td>
            <td>
                <button class="btn-action btn-view" data-ref="${booking.ref || ''}" title="View Details"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-action btn-delete" data-ref="${booking.ref || ''}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    tableBody.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', function() {
            const ref = this.getAttribute('data-ref');
            const selectedBooking = currentBookingsList.find(b => b.ref === ref);
            if (selectedBooking) {
                openFullPageDetails(selectedBooking);
            }
        });
    });

    tableBody.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', function() {
            const ref = this.getAttribute('data-ref');
            if (ref) deleteBooking(ref);
        });
    });

    // Render pagination controls
    renderPagination(bookingsList);
}

// ========================================================
// 4B. PAGINATION CONTROLS RENDERER
// ========================================================
function renderPagination(bookingsList) {
    const tableContainer = document.querySelector('.table-container');
    if (!tableContainer) return;

    // Remove existing pagination if any
    const existingPagination = tableContainer.querySelector('.pagination-controls');
    if (existingPagination) existingPagination.remove();

    const totalPages = Math.ceil((bookingsList?.length || 0) / ITEMS_PER_PAGE);
    
    if (totalPages <= 1) return; // No pagination needed for single page

    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
    paginationDiv.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        margin-top: 20px;
        padding: 15px;
    `;

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '« Previous';
    prevBtn.style.cssText = `
        padding: 8px 12px;
        background: ${currentPage === 1 ? '#e2e8f0' : '#06B6D4'};
        color: ${currentPage === 1 ? '#999' : 'white'};
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'};
        font-weight: bold;
        transition: background 0.2s;
    `;
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable(bookingsList, currentPage);
        }
    });
    paginationDiv.appendChild(prevBtn);

    // Page numbers
    const pageNumbersContainer = document.createElement('div');
    pageNumbersContainer.style.cssText = 'display: flex; gap: 4px;';

    for (let i = 1; i <= Math.min(totalPages, 3); i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.style.cssText = `
            padding: 8px 12px;
            background: ${currentPage === i ? '#06B6D4' : 'white'};
            color: ${currentPage === i ? 'white' : '#0F172A'};
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            cursor: pointer;
            font-weight: ${currentPage === i ? 'bold' : 'normal'};
            transition: background 0.2s;
        `;
        pageBtn.addEventListener('click', () => {
            renderTable(bookingsList, i);
        });
        pageNumbersContainer.appendChild(pageBtn);
    }

    paginationDiv.appendChild(pageNumbersContainer);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'Next »';
    nextBtn.style.cssText = `
        padding: 8px 12px;
        background: ${currentPage === totalPages ? '#e2e8f0' : '#06B6D4'};
        color: ${currentPage === totalPages ? '#999' : 'white'};
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        cursor: ${currentPage === totalPages ? 'not-allowed' : 'pointer'};
        font-weight: bold;
        transition: background 0.2s;
    `;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTable(bookingsList, currentPage);
        }
    });
    paginationDiv.appendChild(nextBtn);

    tableContainer.appendChild(paginationDiv);
}

// Pagination for filtered results
function renderPaginationFiltered(filteredList) {
    const tableContainer = document.querySelector('.table-container');
    if (!tableContainer) return;

    // Remove existing pagination if any
    const existingPagination = tableContainer.querySelector('.pagination-controls');
    if (existingPagination) existingPagination.remove();

    const totalPages = Math.ceil((filteredList?.length || 0) / ITEMS_PER_PAGE);
    
    if (totalPages <= 1) return; // No pagination needed for single page

    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
    paginationDiv.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        margin-top: 20px;
        padding: 15px;
    `;

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '« Previous';
    prevBtn.style.cssText = `
        padding: 8px 12px;
        background: ${currentPage === 1 ? '#e2e8f0' : '#06B6D4'};
        color: ${currentPage === 1 ? '#999' : 'white'};
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'};
        font-weight: bold;
        transition: background 0.2s;
    `;
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTableFiltered(filteredList);
        }
    });
    paginationDiv.appendChild(prevBtn);

    // Page numbers
    const pageNumbersContainer = document.createElement('div');
    pageNumbersContainer.style.cssText = 'display: flex; gap: 4px;';

    for (let i = 1; i <= Math.min(totalPages, 3); i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.style.cssText = `
            padding: 8px 12px;
            background: ${currentPage === i ? '#06B6D4' : 'white'};
            color: ${currentPage === i ? 'white' : '#0F172A'};
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            cursor: pointer;
            font-weight: ${currentPage === i ? 'bold' : 'normal'};
            transition: background 0.2s;
        `;
        pageBtn.addEventListener('click', () => {
            currentPage = i;
            renderTableFiltered(filteredList);
        });
        pageNumbersContainer.appendChild(pageBtn);
    }

    paginationDiv.appendChild(pageNumbersContainer);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'Next »';
    nextBtn.style.cssText = `
        padding: 8px 12px;
        background: ${currentPage === totalPages ? '#e2e8f0' : '#06B6D4'};
        color: ${currentPage === totalPages ? '#999' : 'white'};
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        cursor: ${currentPage === totalPages ? 'not-allowed' : 'pointer'};
        font-weight: bold;
        transition: background 0.2s;
    `;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTableFiltered(filteredList);
        }
    });
    paginationDiv.appendChild(nextBtn);

    tableContainer.appendChild(paginationDiv);
}

// ========================================================
// 5. DELETE ENGINE: MAGBURA NG BOOKING ROW SA DATABASE
// ========================================================
async function deleteBooking(ref) {
    if (confirm(`Sigurado ka bang nais mong burahin ang booking na ${ref}?`)) {
        try {
            const response = await fetch(`${API_URL}/bookings/${ref}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (response.ok && result.success) {
                alert(`Booking ${ref} successfully deleted!`);
                fetchStatusCounts();
                fetchBookings();
            } else {
                alert('Hindi nabura: ' + (result.error || 'Server rejected the request.'));
            }
        } catch (error) {
            console.error("Error deleting booking:", error);
            alert("Naku, nagka-error sa pag-konekta sa server para magbura.");
        }
    }
}

// ========================================================
// 6. DETAILED WORKSPACE VIEW ENGINE (FIXED SAFE POSITIONING)
// ========================================================
function openFullPageDetails(booking) {
    currentQuotingRef = booking.ref;
    document.getElementById("fpRef").innerText = booking.ref;
    document.getElementById("fpEditRef").value = booking.ref;

    document.getElementById("fpName").value = booking.name || "";
    const fpStatus = document.getElementById("fpStatus");
    const bookingStatus = booking.status || "Open";
    if (fpStatus) {
        let statusExists = false;
        for (let i = 0; i < fpStatus.options.length; i++) {
            if (fpStatus.options[i].value === bookingStatus) {
                statusExists = true;
                break;
            }
        }

        if (!statusExists && bookingStatus) {
            const newStatusOption = document.createElement("option");
            newStatusOption.value = bookingStatus;
            newStatusOption.text = bookingStatus;
            fpStatus.add(newStatusOption);
        }

        fpStatus.value = bookingStatus;
    }
    document.getElementById("fpContact").value = booking.contact_no || "";
    document.getElementById("fpEmail").value = booking.email || "";
    
    const rawRental = (booking.rentalType || '').toLowerCase();
    if (rawRental.includes('driver') || rawRental === 'with-driver') {
        document.getElementById("fpRentalType").value = "with-driver";
        toggleReturnScheduleVisibility("with-driver");
    } else {
        document.getElementById("fpRentalType").value = "self-drive";
        toggleReturnScheduleVisibility("self-drive");
    }

    const vehicleSelect = document.getElementById("fpVehicleType");
    const currentVehicle = booking.vehicleType || "sedan";
    
    let optExists = false;
    for (let i = 0; i < vehicleSelect.options.length; i++) {
        if (vehicleSelect.options[i].value.toLowerCase() === currentVehicle.toLowerCase()) {
            optExists = true;
            vehicleSelect.value = vehicleSelect.options[i].value; 
            break;
        }
    }
    
    if (!optExists && currentVehicle) {
        const newOpt = document.createElement('option');
        newOpt.value = currentVehicle;
        newOpt.text = currentVehicle;
        vehicleSelect.add(newOpt);
        vehicleSelect.value = currentVehicle;
    }

    const rawArea = (booking.area || "").toLowerCase().trim();
    document.getElementById("fpArea").value = rawArea;
    
    document.getElementById("fpServiceOption").value = booking.serviceOption || "—";
    document.getElementById("fpPassengers").value = booking.passengers && booking.passengers !== "—" ? booking.passengers : "";

    document.getElementById("fpPickDate").value = booking.pickup_date || "";
    document.getElementById("fpPickTime").value = booking.pickup_time || "";
    document.getElementById("fpPickAddr").value = booking.pickup_address || "";

    // Mula sa dating fpReturnDate, fpReturnTime, fpReturnAddr:
    document.getElementById("fpReturnDate").value = booking.return_date && booking.return_date !== "—" ? booking.return_date : "";
    document.getElementById("fpReturnTime").value = booking.return_time && booking.return_time !== "—" ? booking.return_time : "";
    document.getElementById("fpReturnAddr").value = booking.return_address && booking.return_address !== "—" ? booking.return_address : "";

    document.getElementById("fpDetails").value = booking.itinerary || "";

    const drawer = document.getElementById("quickQuoteDrawer");
    if (drawer) {
        drawer.style.display = "none"; 
        drawer.style.position = "static";
        drawer.style.gridColumn = "1 / -1"; 

        const saveBtn = document.getElementById("fpSaveBtn");
        if (saveBtn && saveBtn.parentNode) {
            saveBtn.parentNode.parentNode.appendChild(drawer);
        }
    }

    const oldBtn = document.getElementById("dynamicQuickQuoteBtn");
    if (oldBtn) oldBtn.remove();

    if ((booking.status || 'Open').toLowerCase() === 'open') {
        const saveBtn = document.getElementById("fpSaveBtn");
        if (saveBtn) {
            const qqBtn = document.createElement("button");
            qqBtn.id = "dynamicQuickQuoteBtn";
            qqBtn.type = "button";
            qqBtn.style.backgroundColor = "#2563EB";
            qqBtn.style.color = "white";
            qqBtn.style.marginRight = "10px";
            qqBtn.style.padding = "14px 20px";
            qqBtn.style.border = "none";
            qqBtn.style.borderRadius = "4px";
            qqBtn.style.cursor = "pointer";
            qqBtn.style.fontWeight = "bold";
            qqBtn.style.fontSize = "0.95rem";
            qqBtn.innerHTML = `<i class="fa-solid fa-calculator"></i> Quick Cost Quote`;
            
            qqBtn.addEventListener("click", () => {
                if (drawer && drawer.style.display === "block") {
                    drawer.style.display = "none";
                    qqBtn.innerHTML = `<i class="fa-solid fa-calculator"></i> Quick Cost Quote`;
                } else {
                    openQuickQuote(booking.ref);
                    qqBtn.innerHTML = `<i class="fa-solid fa-eye-slash"></i> Hide Calculator`;
                }
            });

            saveBtn.parentNode.insertBefore(qqBtn, saveBtn);
        }
    }

    document.getElementById("mainDashboardView").style.display = "none";
    document.getElementById("fullPageDetailsView").style.display = "block";

    // Load saved quote if exists (after UI is displayed)
    setTimeout(() => loadSavedQuote(booking.ref), 100);
}

// ========================================================
// LOAD SAVED QUOTE FUNCTION
// ========================================================
async function loadSavedQuote(bookingRef) {
    if (!bookingRef) {
        console.warn("No booking reference provided to loadSavedQuote");
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.warn("No token found for quote retrieval");
            document.getElementById("savedQuoteSection").style.display = "none";
            return;
        }

        const response = await fetch(`${API_URL}/quotes/${bookingRef}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.quote) {
                const quote = result.quote;
                const savedQuoteSection = document.getElementById("savedQuoteSection");
                const savedQuoteAmount = document.getElementById("savedQuoteAmount");
                const savedQuoteDate = document.getElementById("savedQuoteDate");

                if (savedQuoteSection && savedQuoteAmount && savedQuoteDate) {
                    savedQuoteAmount.innerText = quote.totalAmount;
                    const savedDate = new Date(quote.savedAt).toLocaleString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                    savedQuoteDate.innerText = savedDate;
                    savedQuoteSection.style.display = "block";
                    if (DEBUG) console.log("Quote loaded successfully:", quote.totalAmount);
                } else {
                    console.warn("HTML elements for saved quote not found");
                }
            } else {
                // No saved quote yet, hide the section
                document.getElementById("savedQuoteSection").style.display = "none";
            }
        } else {
            // No saved quote (404 or error), hide the section
            document.getElementById("savedQuoteSection").style.display = "none";
        }
    } catch (error) {
        console.error("Error loading saved quote:", error);
        document.getElementById("savedQuoteSection").style.display = "none";
    }
}
document.getElementById("fpSaveBtn").addEventListener("click", async () => {
    const refFlag = document.getElementById("fpEditRef").value;
    const selectedStatus = document.getElementById("fpStatus").value;
    
    const updatedData = {
        name: document.getElementById("fpName").value,
        client_name: document.getElementById("fpName").value, 
        status: selectedStatus,
        contact_no: document.getElementById("fpContact").value,
        email: document.getElementById("fpEmail").value,
        rentalType: document.getElementById("fpRentalType").value,
        vehicleType: document.getElementById("fpVehicleType").value,
        area: document.getElementById("fpArea").value.toLowerCase(),
        serviceOption: document.getElementById("fpServiceOption").value,
        passengers: document.getElementById("fpPassengers").value || "—",
        pickup_date: document.getElementById("fpPickDate").value,
        pickup_time: document.getElementById("fpPickTime").value,
        pickup_address: document.getElementById("fpPickAddr").value,
        return_date: document.getElementById("fpReturnDate").value || "—", returnDate: document.getElementById("fpReturnDate").value || "—",
        return_time: document.getElementById("fpReturnTime").value || "—", returnTime: document.getElementById("fpReturnTime").value || "—",
        return_address: document.getElementById("fpReturnAddr").value || "—", returnAddress: document.getElementById("fpReturnAddr").value || "—",
        itinerary: document.getElementById("fpDetails").value
    };

    try {
        let response;
        if (refFlag === "NEW_BOOKING_FLAG") {
            response = await fetch(`${API_URL}/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
        } else {
            response = await fetch(`${API_URL}/bookings/${refFlag}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
        }

        const result = await response.json();

        if (response.ok && result.success) {
            alert(refFlag === "NEW_BOOKING_FLAG" ? "New booking created successfully!" : "Changes saved successfully!");
            document.getElementById("fullPageDetailsView").style.display = "none";
            document.getElementById("mainDashboardView").style.display = "block";
            
            fetchStatusCounts();
            fetchBookings();
        } else {
            alert("Failed to save: " + (result.error || "Server rejected."));
        }
    } catch (error) {
        console.error("Error saving booking:", error);
        alert("Nagka-error sa pagkonekta sa server sa pag-save.");
    }
});

// INITIAL PAGE TRIGGERS ON LOAD
document.addEventListener("DOMContentLoaded", () => {
    fetchStatusCounts();
    fetchBookings();

    const searchBar = document.getElementById("searchBar");
    const filterService = document.getElementById("filterService");
    const filterType = document.getElementById("filterType");
    const filterArea = document.getElementById("filterArea");
    const fpRentalType = document.getElementById("fpRentalType");

    if (fpRentalType) {
        fpRentalType.addEventListener("change", (e) => {
            toggleReturnScheduleVisibility(e.target.value);
        });
    }

    if (searchBar) searchBar.addEventListener("input", filterCurrentBookings);
    if (filterService) filterService.addEventListener("change", filterCurrentBookings);
    if (filterType) filterType.addEventListener("change", filterCurrentBookings);
    if (filterArea) filterArea.addEventListener("change", filterCurrentBookings);

    // INCLUSIONS TABLE MANAGER EFFECT
    const incExcTable = document.getElementById('incExcTableBody');
    if (incExcTable) {
        incExcTable.addEventListener('change', function(e) {
            const target = e.target;
            if (target.classList.contains('inc-check')) {
                const row = target.closest('tr');
                const excCheckbox = row.querySelector('.exc-check');
                if (target.checked && excCheckbox) excCheckbox.checked = false;
            } else if (target.classList.contains('exc-check')) {
                const row = target.closest('tr');
                const incCheckbox = row.querySelector('.inc-check');
                if (target.checked && incCheckbox) incCheckbox.checked = false;
            }
        });
    }

    // New Booking Menu Toggle
    const newBookingBtn = document.getElementById("newBookingBtn");
    const newBookingMenu = document.getElementById("newBookingMenu");

    if (newBookingBtn && newBookingMenu) {
        newBookingBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            newBookingMenu.classList.toggle("show");
        });
    }

    window.addEventListener("click", () => {
        if (newBookingMenu) newBookingMenu.classList.remove("show");
    });

    // Triggers for rental type selection
    const pickSelfDrive = document.getElementById("pickSelfDrive");
    const pickWithDriver = document.getElementById("pickWithDriver");

    if (pickSelfDrive) {
        pickSelfDrive.addEventListener("click", (e) => {
            e.preventDefault();
            prepareNewBookingForm("self-drive");
        });
    }

    if (pickWithDriver) {
        pickWithDriver.addEventListener("click", (e) => {
            e.preventDefault();
            prepareNewBookingForm("with-driver");
        });
    }
});

// ========================================================
// ENGINE: MAGASING AT MAG-FILTER NG MGA BOOKINGS SA SCREEN
// ========================================================
function filterCurrentBookings() {
    const searchQuery = document.getElementById("searchBar").value.toLowerCase().trim();
    const serviceQuery = document.getElementById("filterService").value;
    const typeQuery = document.getElementById("filterType").value;
    const areaQuery = document.getElementById("filterArea").value;

    const filteredList = currentBookingsList.filter(booking => { 
        const matchSearch = 
            (booking.ref || '').toLowerCase().includes(searchQuery) || 
            (booking.name || '').toLowerCase().includes(searchQuery) || 
            (booking.email || '').toLowerCase().includes(searchQuery) || 
            (booking.vehicleType || '').toLowerCase().includes(searchQuery); 

        const matchService = !serviceQuery || booking.serviceOption === serviceQuery; 

        let bookingRentalType = (booking.rentalType || '').toLowerCase().replace(/\s+/g, '-'); 
        const matchType = !typeQuery || bookingRentalType === typeQuery; 

        const bookingArea = (booking.area || '').toLowerCase().trim(); 
        const selectedArea = areaQuery.toLowerCase().trim();
        const matchArea = !areaQuery || bookingArea === selectedArea;

        return matchSearch && matchService && matchType && matchArea;
    });

    renderTableFiltered(filteredList);
}

function renderTableFiltered(filteredList) {
    currentFilteredList = filteredList; // Store filtered list for pagination
    currentPage = 1; // Reset to page 1 when filtering
    
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!filteredList || filteredList.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="no-data" style="text-align: center; padding: 30px; color: #888;">Walang nahanap na booking.</td></tr>`;
        renderPagination([]);
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(filteredList.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedList = filteredList.slice(startIndex, endIndex);

    paginatedList.forEach(booking => {
        const row = document.createElement('tr');
        const displayStatus = booking.status || 'Open';
        const statusClass = `badge-${displayStatus.toLowerCase().replace(/\s+/g, '-')}`;
        const displayRentalType = booking.rentalType === 'with-driver' || booking.rentalType === 'with driver' ? 'With Driver' : 'Self-Drive';

        row.innerHTML = `
            <td><strong>${booking.ref || '—'}</strong></td>
            <td>${booking.name || '—'}</td>
            <td>${displayRentalType}</td>
            <td>${booking.serviceOption || '—'}</td>
            <td>${booking.vehicleType || '—'}</td>
            <td><span class="status-badge ${statusClass}">${displayStatus}</span></td>
            <td>
                <button class="btn-action btn-view" data-ref="${booking.ref || ''}" title="View Details"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-action btn-delete" data-ref="${booking.ref || ''}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    tableBody.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', function() {
            const ref = this.getAttribute('data-ref');
            const selectedBooking = currentBookingsList.find(b => b.ref === ref);
            if (selectedBooking) openFullPageDetails(selectedBooking);
        });
    });

    tableBody.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', function() {
            const ref = this.getAttribute('data-ref');
            if (ref) deleteBooking(ref);
        });
    });

    // Render pagination for filtered results
    renderPaginationFiltered(filteredList);
}

document.getElementById("btnBackToDashboard").addEventListener("click", () => {
    document.getElementById("fullPageDetailsView").style.display = "none";
    document.getElementById("mainDashboardView").style.display = "block";
});

// ========================================================
// 8. COPY TO CLIPBOARD ENGINE
// ========================================================
document.getElementById("btnCopyDetails").addEventListener("click", async () => {
    const ref = document.getElementById("fpRef").innerText;
    const name = document.getElementById("fpName").value || "—";
    const contact = document.getElementById("fpContact").value || "—";
    
    const rawRental = document.getElementById("fpRentalType").value;
    const rentalType = rawRental === "with-driver" ? "With Driver" : "Self-Drive";
    
    const vehicleType = document.getElementById("fpVehicleType").value || "—";
    const serviceOption = document.getElementById("fpServiceOption").value || "—";
    const passengers = document.getElementById("fpPassengers").value || "—";
    
    const pickDate = document.getElementById("fpPickDate").value || "—";
    const pickTime = document.getElementById("fpPickTime").value || "—";
    const pickAddr = document.getElementById("fpPickAddr").value || "—";
    
    const retDate = document.getElementById("fpReturnDate").value || "—";
    const retTime = document.getElementById("fpReturnTime").value || "—";
    const retAddr = document.getElementById("fpReturnAddr").value || "—";
    
    const itinerary = document.getElementById("fpDetails").value || "—";

    let copyText = `Reference #: ${ref}\nType: ${rentalType}\n`;
    if (rawRental === "with-driver") {
        copyText += `Service Option: ${serviceOption}\nPassengers: ${passengers}\n`;
    }
    copyText += `Vehicle Type: ${vehicleType}\n\n`;
    copyText += `Client Name: ${name}\nContact No: ${contact}\n`;
    copyText += `Pickup Date/Time: ${pickDate} @ ${pickTime}\nPickup Location: ${pickAddr}\n`;
    if (rawRental !== "with-driver") {
        copyText += `Return Date/Time: ${retDate} @ ${retTime}\nReturn Location: ${retAddr}\n`;
    }
    copyText += `\nDestination/Itinerary details:\n${itinerary}\n`;

    try {
        await navigator.clipboard.writeText(copyText);
        const copyBtn = document.getElementById("btnCopyDetails");
        copyBtn.innerHTML = `<i class="fa-solid fa-check" style="color: #10b981;"></i>`;
        setTimeout(() => { copyBtn.innerHTML = `<i class="fa-solid fa-copy"></i>`; }, 2000);
    } catch (err) {
        alert("Hindi nagawang i-copy ang detalye. Pakisubukang muli.");
    }
});

// ========================================================
// 9. QUICK QUOTE CALCULATOR INLINE LOGIC TRIGGER
// ========================================================
let currentQuotingRef = null;
let currentQuotingType = "with-driver";

function handleRentalTypeChange() {
    const rentalType = document.getElementById("fpRentalType").value;
    
    if (rentalType === "with-driver") {
        document.getElementById("qqWithDriverSection").style.display = "block";
        document.getElementById("qqSelfDriveSection").style.display = "none";
    } else {
        document.getElementById("qqWithDriverSection").style.display = "none";
        document.getElementById("qqSelfDriveSection").style.display = "block";
    }
    
    // Recalculate with the new rental type
    calculateTotalQuote();
}

function openQuickQuote(refNum) {
    const booking = currentBookingsList.find(b => b.ref === refNum);
    if (!booking) return alert("Hindi mahanap ang data ng booking reference.");

    currentQuotingRef = refNum;
    currentQuotingType = booking.rentalType ? booking.rentalType.toLowerCase() : "with-driver";
    
    document.getElementById("qqRefLabel").innerText = refNum;
    
    const drawer = document.getElementById("quickQuoteDrawer");
    drawer.style.display = "block"; 

    if (currentQuotingType === "with-driver" || currentQuotingType === "with driver") {
        document.getElementById("qqWithDriverSection").style.display = "block";
        document.getElementById("qqSelfDriveSection").style.display = "none";
    } else {
        document.getElementById("qqWithDriverSection").style.display = "none";
        document.getElementById("qqSelfDriveSection").style.display = "block";
    }

    calculateTotalQuote();

    setTimeout(() => {
        drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
}

// ========================================================
// NOTIFICATION TOAST FUNCTION
// ========================================================
function showNotificationToast(message, type = "success") {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById("notificationToastContainer");
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "notificationToastContainer";
        toastContainer.style.position = "fixed";
        toastContainer.style.top = "20px";
        toastContainer.style.right = "20px";
        toastContainer.style.zIndex = "9999";
        toastContainer.style.display = "flex";
        toastContainer.style.flexDirection = "column";
        toastContainer.style.gap = "10px";
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toast = document.createElement("div");
    toast.style.padding = "15px 20px";
    toast.style.borderRadius = "4px";
    toast.style.color = "white";
    toast.style.fontWeight = "bold";
    toast.style.minWidth = "300px";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    toast.style.animation = "slideInRight 0.3s ease-out";
    
    if (type === "success") {
        toast.style.backgroundColor = "#16A34A";
        toast.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${message}`;
    } else if (type === "error") {
        toast.style.backgroundColor = "#DC2626";
        toast.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${message}`;
    } else if (type === "warning") {
        toast.style.backgroundColor = "#EA8C55";
        toast.innerHTML = `<i class="fa-solid fa-warning"></i> ${message}`;
    }

    toastContainer.appendChild(toast);

    // Remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = "slideOutRight 0.3s ease-out";
        setTimeout(() => {
            toastContainer.removeChild(toast);
        }, 300);
    }, 4000);
}

// Add animation styles if not present
if (!document.getElementById("toastAnimationStyles")) {
    const style = document.createElement("style");
    style.id = "toastAnimationStyles";
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

function closeQuoteDrawer() {
    const drawer = document.getElementById("quickQuoteDrawer");
    if (drawer) drawer.style.display = "none";
    const qqBtn = document.getElementById("dynamicQuickQuoteBtn");
    if (qqBtn) qqBtn.innerHTML = `<i class="fa-solid fa-calculator"></i> Quick Cost Quote`;
}


function calculateTotalQuote() {
    let subtotal = 0;
    
    // Get the rental type from the form value (not from potentially stale currentQuotingType)
    const formRentalType = document.getElementById("fpRentalType").value || "with-driver";

    if (formRentalType === "with-driver") {
        const dist = parseFloat(document.getElementById("qqDistance").value) || 0;
        const price = parseFloat(document.getElementById("qqFuelPrice").value) || 0;
        const cons = parseFloat(document.getElementById("qqConsumption").value) || 1;
        
        const fuelCost = (dist / cons) * price;
        const fuelCostEl = document.getElementById("qqFuelCost");
        if (fuelCostEl) fuelCostEl.value = "₱" + fuelCost.toFixed(2);

        const baseRate = parseFloat(document.getElementById("qqUnitBase").value) || 0;
        const driverDays = parseFloat(document.getElementById("qqDriverDays").value) || 1;
        const baseTotalCost = baseRate * driverDays;

        const otRate = parseFloat(document.getElementById("qqOvertime").value) || 0;
        const otHours = parseFloat(document.getElementById("qqDriverOtHours").value) || 0;
        const overtimeTotalCost = otRate * otHours;

        const tolls = parseFloat(document.getElementById("qqTollFees").value) || 0;
        const parking = parseFloat(document.getElementById("qqParkingFees").value) || 0;
        const driver = parseFloat(document.getElementById("qqDriverFee").value) || 0;
        const meals = parseFloat(document.getElementById("qqMeals").value) || 0;
        const lodging = parseFloat(document.getElementById("qqLodging").value) || 0;
        const misc = parseFloat(document.getElementById("qqMisc").value) || 0;

        subtotal = fuelCost + baseTotalCost + overtimeTotalCost + tolls + parking + driver + meals + lodging + misc;
    } else {
        const sBaseRate = parseFloat(document.getElementById("qqSelfUnitBase").value) || 0;
        const sDays = parseFloat(document.getElementById("qqSelfDays").value) || 1;
        const selfBaseTotal = sBaseRate * sDays;

        const sOtRate = parseFloat(document.getElementById("qqSelfOvertime").value) || 0;
        const sOtHours = parseFloat(document.getElementById("qqSelfOtHours").value) || 0;
        const selfOvertimeTotal = sOtRate * sOtHours;

        const sDel = parseFloat(document.getElementById("qqSelfDelivery").value) || 0;
        const sRet = parseFloat(document.getElementById("qqSelfReturn").value) || 0;
        const sChild = parseFloat(document.getElementById("qqSelfChildSeat").value) || 0;

        subtotal = selfBaseTotal + selfOvertimeTotal + sDel + sRet + sChild;
    }

    const qty = parseInt(document.getElementById("qqQuantity").value) || 1;
    const finalTotal = subtotal * qty;

    const totalEl = document.getElementById("lblTotal");
    if (totalEl) totalEl.innerText = "₱" + finalTotal.toFixed(2);
}

// ========================================================
// COLLECT COMPLETE QUOTE DATA (BREAKDOWN + INCLUSIONS + EXCLUSIONS)
// ========================================================
function collectCompleteQuoteData() {
    const rentalType = document.getElementById("fpRentalType").value;
    const quantity = parseInt(document.getElementById("qqQuantity").value) || 1;
    
    const completeData = {
        rentalType: rentalType,
        quantity: quantity,
        breakdownDetails: {},
        inclusionsList: [],
        exclusionsList: []
    };
    
    // Collect breakdown details based on rental type
    if (rentalType === "with-driver") {
        completeData.breakdownDetails = {
            distance: parseFloat(document.getElementById("qqDistance").value) || 0,
            fuelPrice: parseFloat(document.getElementById("qqFuelPrice").value) || 0,
            consumption: parseFloat(document.getElementById("qqConsumption").value) || 1,
            unitBase: parseFloat(document.getElementById("qqUnitBase").value) || 0,
            driverDays: parseFloat(document.getElementById("qqDriverDays").value) || 1,
            overtime: parseFloat(document.getElementById("qqOvertime").value) || 0,
            driverOtHours: parseFloat(document.getElementById("qqDriverOtHours").value) || 0,
            tollFees: parseFloat(document.getElementById("qqTollFees").value) || 0,
            parkingFees: parseFloat(document.getElementById("qqParkingFees").value) || 0,
            driverFee: parseFloat(document.getElementById("qqDriverFee").value) || 0,
            meals: parseFloat(document.getElementById("qqMeals").value) || 0,
            lodging: parseFloat(document.getElementById("qqLodging").value) || 0,
            misc: parseFloat(document.getElementById("qqMisc").value) || 0
        };
        
        // Collect inclusions and exclusions from table
        const rows = document.querySelectorAll("#incExcTableBody tr");
        rows.forEach(row => {
            const itemLabel = row.querySelector(".inc-check").getAttribute("data-item");
            const isIncluded = row.querySelector(".inc-check").checked;
            const isExcluded = row.querySelector(".exc-check").checked;
            
            if (isIncluded) {
                completeData.inclusionsList.push(itemLabel);
            } else if (isExcluded) {
                completeData.exclusionsList.push(itemLabel);
            }
        });
    } else {
        completeData.breakdownDetails = {
            unitBase: parseFloat(document.getElementById("qqSelfUnitBase").value) || 0,
            days: parseFloat(document.getElementById("qqSelfDays").value) || 1,
            overtime: parseFloat(document.getElementById("qqSelfOvertime").value) || 0,
            selfOtHours: parseFloat(document.getElementById("qqSelfOtHours").value) || 0,
            delivery: parseFloat(document.getElementById("qqSelfDelivery").value) || 0,
            return: parseFloat(document.getElementById("qqSelfReturn").value) || 0,
            childSeat: parseFloat(document.getElementById("qqSelfChildSeat").value) || 0
        };
    }
    
    return completeData;
}


// ========================================================
// SEND QUOTATION EMAIL FUNCTION
// ========================================================
async function sendQuotationEmail() {
    if (!ensureAuth()) return false;
    if (!currentQuotingRef) {
        showNotificationToast("No booking reference found", "error");
        return false;
    }
    
    try {
        const clientEmail = document.getElementById("fpEmail")?.value;
        const clientName = document.getElementById("fpName")?.value;
        
        if (!clientEmail) {
            showNotificationToast("Client email address not found", "error");
            return false;
        }
        
        showNotificationToast("Sending quotation email...", "warning");
        
        // Fetch the quote data to include in email
        const quoteResponse = await fetch(`${API_URL}/quotes/${currentQuotingRef}`, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        
        let quoteData = null;
        if (quoteResponse.ok) {
            const quoteResult = await quoteResponse.json();
            if (quoteResult.success && quoteResult.quote) {
                quoteData = quoteResult.quote;
            }
        }
        
        // Send email via API
        const emailResponse = await fetch(`${API_URL}/send-quotation-email`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                bookingRef: currentQuotingRef,
                clientEmail: clientEmail,
                clientName: clientName,
                quoteData: quoteData
            })
        });
        
        const emailResult = await emailResponse.json();
        
        if (emailResponse.ok && emailResult.success) {
            if (DEBUG) console.log("✅ Email sent successfully!");
            showNotificationToast(`Quotation email sent to ${clientEmail} successfully! ✓`, "success");
            await fetchBookings();
            return true;
        } else {
            showNotificationToast("Failed to send email. Please try again.", "warning");
            return false;
        }
    } catch (error) {
        console.error("Error sending email:", error);
        showNotificationToast("Failed to send email: " + error.message, "error");
        return false;
    }
}

// ========================================================
// SAVE QUOTE FUNCTION
// ========================================================
async function saveQuoteToServer(showNotification = true, keepViewOpen = false) {
    if (!ensureAuth()) return false;
    
    if (!currentQuotingRef) {
        if (showNotification) alert("No booking reference found");
        return false;
    }

    calculateTotalQuote();
    const totalAmount = document.getElementById("lblTotal").innerText || "₱0.00";
    const rentalType = document.getElementById("fpRentalType").value;

    // Collect complete quote data including breakdown, inclusions, exclusions
    const completeQuoteData = collectCompleteQuoteData();
    
    const quoteData = {
        vehicleType: document.getElementById("fpVehicleType").value,
        serviceOption: document.getElementById("fpServiceOption")?.value || "—",
        pickDate: document.getElementById("fpPickDate").value,
        pickTime: document.getElementById("fpPickTime").value,
        returnDate: document.getElementById("fpReturnDate").value,
        returnTime: document.getElementById("fpReturnTime").value,
        pickupAddress: document.getElementById("fpPickAddr")?.value || "—",
        returnAddress: document.getElementById("fpReturnAddr")?.value || "—",
        itinerary: document.getElementById("fpDetails")?.value || "",
        ...completeQuoteData  // Include rentalType, quantity, breakdownDetails, inclusionsList, exclusionsList
    };

    try {
        const response = await fetch(`${API_URL}/quotes`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                bookingRef: currentQuotingRef,
                totalAmount,
                rentalType,
                quoteData
            })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            const quote = result.quote || { totalAmount, savedAt: new Date().toISOString() };
            const savedQuoteSection = document.getElementById("savedQuoteSection");
            const savedQuoteAmount = document.getElementById("savedQuoteAmount");
            const savedQuoteDate = document.getElementById("savedQuoteDate");

            // Update booking status to "Quoted" in backend
            try {
                const statusUpdateResponse = await fetch(`${API_URL}/bookings/${currentQuotingRef}`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ status: 'Quoted' })
                });
                
                if (statusUpdateResponse.ok) {
                    document.getElementById("fpStatus").value = "Quoted";
                }
            } catch (statusError) {
                console.error("Error updating status:", statusError);
            }

            if (savedQuoteSection && savedQuoteAmount && savedQuoteDate) {
                savedQuoteAmount.innerText = quote.totalAmount || totalAmount;
                savedQuoteDate.innerText = new Date(quote.savedAt).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
                savedQuoteSection.style.display = "block";
            }

            if (showNotification) {
                showNotificationToast("Quote saved successfully!");
            }
            await fetchStatusCounts();
            await fetchBookings();
            return true;
        } else {
            if (showNotification) {
                showNotificationToast("Failed to save quote: " + (result.error || "Server error"), "error");
            }
            return false;
        }
    } catch (error) {
        console.error("Error saving quote:", error);
        if (showNotification) {
            showNotificationToast("Error connecting to server", "error");
        }
        return false;
    }
}

// Function to handle status change - saves to backend and clears quote if needed
async function handleStatusChange() {
    const status = document.getElementById("fpStatus").value;
    const bookingRef = document.getElementById("fpEditRef").value || currentQuotingRef;
    
    if (!bookingRef) {
        alert("No booking reference found");
        return;
    }

    currentQuotingRef = bookingRef;
    
    try {
        // First, save the status change to the backend
        const updateResponse = await fetch(`${API_URL}/bookings/${bookingRef}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: status })
        });
        
        const updateResult = await updateResponse.json();
        if (!updateResponse.ok || !updateResult.success) {
            showNotificationToast("Failed to update booking status", "error");
            return;
        }
        
        // If status changed to "Open", delete the saved quote
        if (status === "Open") {
            try {
                await fetch(`${API_URL}/quotes/${bookingRef}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
                const savedQuoteSection = document.getElementById("savedQuoteSection");
                const savedQuoteAmount = document.getElementById("savedQuoteAmount");
                const savedQuoteDate = document.getElementById("savedQuoteDate");
                if (savedQuoteSection) savedQuoteSection.style.display = "none";
                if (savedQuoteAmount) savedQuoteAmount.innerText = "₱0.00";
                if (savedQuoteDate) savedQuoteDate.innerText = "—";
                if (DEBUG) console.log("Quote cleared for reopened booking");
            } catch (error) {
                console.error("Error clearing quote:", error);
            }
        }
        
        showNotificationToast(`Status updated to '${status}'`);
        await fetchBookings();
    } catch (error) {
        console.error("Error updating status:", error);
        showNotificationToast("Error updating status", "error");
    }
}

// ========================================================
// RETRIEVE SAVED QUOTE FUNCTION
// ========================================================
async function getQuoteFromServer() {
    if (!currentQuotingRef) return null;

    try {
        const response = await fetch(`${API_URL}/quotes/${currentQuotingRef}`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        const result = await response.json();
        if (response.ok && result.success) {
            return result.quote;
        }
        return null;
    } catch (error) {
        console.error("Error retrieving quote:", error);
        return null;
    }
}

// ========================================================
// 10. DYNAMIC PDF GENERATOR ENGINE (MAYON CAR RENTAL FORMAT)
// ========================================================
async function executeQuoteAction(actionType) {
    if (actionType === 'save-only') {
        // For save-only, don't refresh the whole page, just save and show notification
        await saveQuoteToServer(true, true);
        return;
    }
    
    if (actionType === 'save-quote') {
        // For save-quote (send email), refresh the page after
        await saveQuoteToServer(true, false);
        return;
    }
    
    if (actionType === 'send-save') {
        if (DEBUG) console.log("Saving quote and sending email to", document.getElementById("fpEmail")?.value);
        
        if (!currentQuotingRef) {
            showNotificationToast("No booking opened. Please select a booking first.", "error");
            return;
        }
        
        // Save quote and send email to client
        const saved = await saveQuoteToServer(false, true);
        if (saved) {
            await sendQuotationEmail();
        }
        return;
    }
    
    if (actionType === 'download-pdf') {
        try {
            if (DEBUG) console.log("Starting PDF generation...");
            const refNum = currentQuotingRef || document.getElementById("fpRef")?.innerText || "QUOTE-TEMP";
            if (DEBUG) console.log("Reference Number:", refNum);
            
            // First, try to fetch saved quote data from server
            let savedQuoteData = null;
            try {
                const quoteResponse = await fetch(`${API_URL}/quotes/${refNum}`, {
                    method: 'GET',
                    headers: getAuthHeaders()
                });
                if (quoteResponse.ok) {
                    const quoteResult = await quoteResponse.json();
                    if (quoteResult.success && quoteResult.quote && quoteResult.quote.quoteData) {
                        savedQuoteData = quoteResult.quote.quoteData;
                        if (DEBUG) console.log("Loaded saved quote data from server:", savedQuoteData);
                    }
                }
            } catch (fetchError) {
                console.warn("Could not fetch saved quote data:", fetchError);
            }
            
            const clientName = document.getElementById("fpName")?.value || "—";
            const contactNo = document.getElementById("fpContact")?.value || "—";
            const emailAddr = document.getElementById("fpEmail")?.value || "—";
            
            const rentalTypeRaw = document.getElementById("fpRentalType")?.value || "with-driver";
            const rentalTypeDisplay = rentalTypeRaw === "with-driver" ? "With Driver" : "Self-Drive Rental";
            
            const vehicleType = document.getElementById("fpVehicleType")?.value || "—";
            const serviceOption = document.getElementById("fpServiceOption")?.value || "—";
            
            const rawPickDate = document.getElementById("fpPickDate")?.value || "";
            const rawPickTime = document.getElementById("fpPickTime")?.value || "";
            const rawRetDate = document.getElementById("fpReturnDate")?.value || "";
            const rawRetTime = document.getElementById("fpReturnTime")?.value || "";
            const pickupAddr = document.getElementById("fpPickAddr")?.value || "—";
            const returnAddr = document.getElementById("fpReturnAddr")?.value || "—";
            const itinerary = document.getElementById("fpDetails")?.value || "—";
            
            const fmtPickDate = rawPickDate ? new Date(rawPickDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "—";
            const fmtPickTime = rawPickTime ? new Date('1970-01-01T' + rawPickTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : "—";
            const fmtRetDate = rawRetDate ? new Date(rawRetDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "—";
            const fmtRetTime = rawRetTime ? new Date('1970-01-01T' + rawRetTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : "—";
            
            calculateTotalQuote();
            const totalAmount = document.getElementById("lblTotal")?.innerText || "₱0.00";
            const savedQuoteAmount = document.getElementById("savedQuoteAmount");
            const visibleSavedQuoteAmount = savedQuoteAmount ? savedQuoteAmount.innerText.trim() : "";
            const displayTotalAmount = totalAmount === "₱0.00" && visibleSavedQuoteAmount && visibleSavedQuoteAmount !== "₱0.00"
                ? visibleSavedQuoteAmount
                : totalAmount;

        let inclusionsList = [];
        let exclusionsList = [];

        // Use saved data from server if available, otherwise read from form
        if (savedQuoteData && savedQuoteData.inclusionsList) {
            inclusionsList = savedQuoteData.inclusionsList.map(item => `+ ${item}`);
            exclusionsList = savedQuoteData.exclusionsList.map(item => `- ${item}`);
        } else if (rentalTypeRaw === 'with-driver') {
            // Fallback: Read from form
            const rows = document.querySelectorAll("#incExcTableBody tr");
            rows.forEach(row => {
                const itemLabel = row.querySelector(".inc-check").getAttribute("data-item");
                const isIncluded = row.querySelector(".inc-check").checked;
                const isExcluded = row.querySelector(".exc-check").checked;

                if (isIncluded) {
                    inclusionsList.push(`+ ${itemLabel}`);
                } else if (isExcluded) {
                    exclusionsList.push(`- ${itemLabel}`);
                }
            });
        }

        let incExcHTMLSection = "";
        if (rentalTypeRaw === 'with-driver' && (inclusionsList.length > 0 || exclusionsList.length > 0)) {
            const hasInc = inclusionsList.length > 0;
            const hasExc = exclusionsList.length > 0;
            const wrapperClass = (hasInc && hasExc) ? "incexc-wrapper cols-2" : "incexc-wrapper";

            incExcHTMLSection = `
                <div class="section-title"><i class="fa-solid fa-list-check"></i> Inclusions &amp; Exclusions</div>
                <div class="${wrapperClass}">
                    ${hasInc ? `
                        <div class="incexc-box inc">
                            <h4><i class="fa-solid fa-circle-plus"></i> Inclusions</h4>
                            <ul>
                                ${inclusionsList.map(item => `<li>${item}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    ${hasExc ? `
                        <div class="incexc-box exc">
                            <h4><i class="fa-solid fa-circle-minus"></i> Exclusions</h4>
                            <ul>
                                ${exclusionsList.map(item => `<li>${item}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        let breakdownHTML = "";
        
        // Use saved breakdown data from server if available, otherwise read from form
        if (savedQuoteData && savedQuoteData.breakdownDetails) {
            const bd = savedQuoteData.breakdownDetails;
            
            if (rentalTypeRaw === 'with-driver') {
                // Build breakdown from saved data
                const fuelCost = (bd.distance / bd.consumption) * bd.fuelPrice;
                const baseTotal = bd.unitBase * bd.driverDays;
                const otTotal = bd.overtime * bd.driverOtHours;
                
                breakdownHTML = `
                    <tr><td>Rental Rate (₱${bd.unitBase.toFixed(2)} × ${bd.driverDays} Day/s)</td><td>₱${baseTotal.toFixed(2)}</td></tr>
                    ${bd.driverOtHours > 0 ? `<tr><td>Overtime Fee (₱${bd.overtime.toFixed(2)} × ${bd.driverOtHours} Hr/s)</td><td>₱${otTotal.toFixed(2)}</td></tr>` : ''}
                    ${fuelCost > 0 ? `<tr><td>Calculated Fuel Cost (${bd.distance}km @ ₱${bd.fuelPrice}/L, ${bd.consumption}km/L)</td><td>₱${fuelCost.toFixed(2)}</td></tr>` : ''}
                    ${bd.tollFees > 0 ? `<tr><td>Toll Fees</td><td>₱${bd.tollFees.toFixed(2)}</td></tr>` : ''}
                    ${bd.parkingFees > 0 ? `<tr><td>Parking Fees</td><td>₱${bd.parkingFees.toFixed(2)}</td></tr>` : ''}
                    ${bd.driverFee > 0 ? `<tr><td>Driver's Fee</td><td>₱${bd.driverFee.toFixed(2)}</td></tr>` : ''}
                    ${bd.meals > 0 ? `<tr><td>Meals</td><td>₱${bd.meals.toFixed(2)}</td></tr>` : ''}
                    ${bd.lodging > 0 ? `<tr><td>Lodging / Accommodation</td><td>₱${bd.lodging.toFixed(2)}</td></tr>` : ''}
                    ${bd.misc > 0 ? `<tr><td>Miscellaneous Expenses</td><td>₱${bd.misc.toFixed(2)}</td></tr>` : ''}
                `;
            } else {
                // Self-drive breakdown from saved data
                const baseTotal = bd.unitBase * bd.days;
                const otTotal = bd.overtime * bd.selfOtHours;
                
                breakdownHTML = `
                    <tr><td>Rental Rate (₱${bd.unitBase.toFixed(2)} × ${bd.days} Day/s)</td><td>₱${baseTotal.toFixed(2)}</td></tr>
                    ${bd.selfOtHours > 0 ? `<tr><td>Overtime Fee (₱${bd.overtime.toFixed(2)} × ${bd.selfOtHours} Hr/s)</td><td>₱${otTotal.toFixed(2)}</td></tr>` : ''}
                    ${bd.delivery > 0 ? `<tr><td>Delivery Fee</td><td>₱${bd.delivery.toFixed(2)}</td></tr>` : ''}
                    ${bd.return > 0 ? `<tr><td>Return Fee</td><td>₱${bd.return.toFixed(2)}</td></tr>` : ''}
                    ${bd.childSeat > 0 ? `<tr><td>Child Seat Fee</td><td>₱${bd.childSeat.toFixed(2)}</td></tr>` : ''}
                `;
            }
        } else {
            // Fallback: Build from form values
            if (rentalTypeRaw === 'with-driver') {
                const dist = parseFloat(document.getElementById("qqDistance").value) || 0;
                const price = parseFloat(document.getElementById("qqFuelPrice").value) || 0;
                const cons = parseFloat(document.getElementById("qqConsumption").value) || 1;
                const fuelCost = (dist / cons) * price;

                const baseRate = parseFloat(document.getElementById("qqUnitBase").value) || 0;
                const driverDays = parseFloat(document.getElementById("qqDriverDays").value) || 1;
                const otRate = parseFloat(document.getElementById("qqOvertime").value) || 0;
                const otHours = parseFloat(document.getElementById("qqDriverOtHours").value) || 0;

                const tolls = parseFloat(document.getElementById("qqTollFees").value) || 0;
                const parking = parseFloat(document.getElementById("qqParkingFees").value) || 0;
                const driverFee = parseFloat(document.getElementById("qqDriverFee").value) || 0;
                const meals = parseFloat(document.getElementById("qqMeals").value) || 0;
                const lodging = parseFloat(document.getElementById("qqLodging").value) || 0;
                const misc = parseFloat(document.getElementById("qqMisc").value) || 0;

                breakdownHTML = `
                    <tr><td>Rental Rate (₱${baseRate.toFixed(2)} × ${driverDays} Day/s)</td><td>₱${(baseRate * driverDays).toFixed(2)}</td></tr>
                    ${otHours > 0 ? `<tr><td>Overtime Fee (₱${otRate.toFixed(2)} × ${otHours} Hr/s)</td><td>₱${(otRate * otHours).toFixed(2)}</td></tr>` : ''}
                    ${fuelCost > 0 ? `<tr><td>Calculated Fuel Cost</td><td>₱${fuelCost.toFixed(2)}</td></tr>` : ''}
                    ${tolls > 0 ? `<tr><td>Toll Fees</td><td>₱${tolls.toFixed(2)}</td></tr>` : ''}
                    ${parking > 0 ? `<tr><td>Parking Fees</td><td>₱${parking.toFixed(2)}</td></tr>` : ''}
                    ${driverFee > 0 ? `<tr><td>Driver's Fee</td><td>₱${driverFee.toFixed(2)}</td></tr>` : ''}
                    ${meals > 0 ? `<tr><td>Meals</td><td>₱${meals.toFixed(2)}</td></tr>` : ''}
                    ${lodging > 0 ? `<tr><td>Lodging / Accommodation</td><td>₱${lodging.toFixed(2)}</td></tr>` : ''}
                    ${misc > 0 ? `<tr><td>Miscellaneous Expenses</td><td>₱${misc.toFixed(2)}</td></tr>` : ''}
                `;
            } else {
                const sBaseRate = parseFloat(document.getElementById("qqSelfUnitBase").value) || 0;
                const sDays = parseFloat(document.getElementById("qqSelfDays").value) || 1;
                const sOtRate = parseFloat(document.getElementById("qqSelfOvertime").value) || 0;
                const sOtHours = parseFloat(document.getElementById("qqSelfOtHours").value) || 0;
                const sDel = parseFloat(document.getElementById("qqSelfDelivery").value) || 0;
                const sRet = parseFloat(document.getElementById("qqSelfReturn").value) || 0;
                const sChild = parseFloat(document.getElementById("qqSelfChildSeat").value) || 0;

                breakdownHTML = `
                    <tr><td>Rental Rate (₱${sBaseRate.toFixed(2)} × ${sDays} Day/s)</td><td>₱${(sBaseRate * sDays).toFixed(2)}</td></tr>
                    ${sOtHours > 0 ? `<tr><td>Overtime Fee (₱${sOtRate.toFixed(2)} × ${sOtHours} Hr/s)</td><td>₱${(sOtRate * sOtHours).toFixed(2)}</td></tr>` : ''}
                    ${sDel > 0 ? `<tr><td>Delivery Fee</td><td>₱${sDel.toFixed(2)}</td></tr>` : ''}
                    ${sRet > 0 ? `<tr><td>Return Fee</td><td>₱${sRet.toFixed(2)}</td></tr>` : ''}
                    ${sChild > 0 ? `<tr><td>Child Seat Fee</td><td>₱${sChild.toFixed(2)}</td></tr>` : ''}
                `;
            }
        }

        const printWindow = window.open('', '_blank', 'width=900,height=1100');
        if (!printWindow) {
            showNotificationToast("Popup blocker detected. Please allow popups for this site.", "error");
            return;
        }
        
        const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

        printWindow.document.write(`
            <html>
            <head>
                <title>Quotation - ${refNum}</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                    * { box-sizing: border-box; font-family: 'Inter', sans-serif; margin: 0; padding: 0; }
                    body { padding: 36px 42px; color: #1e293b; background-color: #ffffff; line-height: 1.5; font-size: 14px; }
                    .header-container { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 22px; }
                    .brand-side h1 { font-size: 21px; color: #0f172a; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 3px; }
                    .brand-side p { font-size: 12px; color: #64748b; }
                    .quote-title-side { text-align: right; }
                    .quote-title-side h2 { font-size: 16px; color: #2563eb; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
                    .quote-title-side p { font-size: 12px; color: #475569; font-weight: 500; line-height: 1.4; }
                    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid #e2e8f0; }
                    .info-block h3 { font-size: 10.5px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 8px; font-weight: 700; }
                    .info-block p { font-size: 13px; color: #334155; margin-bottom: 3px; }
                    .info-block .client-name { font-size: 15px; font-weight: 600; color: #0f172a; }
                    .section-title { font-size: 12.5px; text-transform: uppercase; color: #0f172a; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 10px; display: flex; align-items: center; gap: 7px; }
                    .section-title i { color: #2563eb; font-size: 12px; }
                    .itinerary-box { background: #f8fafc; border-left: 3px solid #2563eb; padding: 14px 18px; border-radius: 0 6px 6px 0; margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
                    .point-info h4 { font-size: 10px; text-transform: uppercase; color: #64748b; margin-bottom: 3px; letter-spacing: 0.5px; }
                    .point-info p { font-size: 13px; font-weight: 500; color: #1e293b; }
                    .incexc-wrapper { display: grid; gap: 14px; margin-bottom: 20px; }
                    .incexc-wrapper.cols-2 { grid-template-columns: 1fr 1fr; }
                    .incexc-box { padding: 13px 16px; border-radius: 6px; }
                    .incexc-box.inc { background: #f0fdf4; border: 1px solid #bbf7d0; }
                    .incexc-box.exc { background: #fef2f2; border: 1px solid #fecaca; }
                    .incexc-box h4 { font-size: 10.5px; text-transform: uppercase; font-weight: 700; margin-bottom: 8px; letter-spacing: 0.4px; display: flex; align-items: center; gap: 6px; }
                    .incexc-box.inc h4 { color: #166534; }
                    .incexc-box.exc h4 { color: #991b1b; }
                    .incexc-box ul { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
                    .incexc-box li { font-size: 12.5px; font-weight: 500; }
                    .incexc-box.inc li { color: #15803d; }
                    .incexc-box.exc li { color: #b91c1c; }
                    .pricing-section { margin-top: 6px; margin-bottom: 22px; }
                    .pricing-table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
                    .pricing-table tr td { padding: 9px 16px; font-size: 13px; color: #475569; border-bottom: 1px solid #f1f5f9; }
                    .pricing-table tr td:last-child { text-align: right; font-weight: 600; color: #1e293b; }
                    .pricing-table tr:last-child td { border-bottom: none; }
                    .pricing-table tr.total td { background-color: #0f172a; color: #ffffff; font-size: 15px; font-weight: 700; padding: 13px 16px; }
                    .pricing-table tr.total td:last-child { color: #ffffff; }
                    .terms-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px; margin-bottom: 24px; }
                    .terms-box h4 { font-size: 10.5px; text-transform: uppercase; color: #475569; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.4px; }
                    .terms-box p { font-size: 11.5px; color: #64748b; line-height: 1.6; }
                    .notice-footer { border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 18px; font-size: 10.5px; color: #94a3b8; text-align: center; line-height: 1.6; }
                    @media print { .incexc-wrapper, .itinerary-box, .pricing-table tr { break-inside: avoid; } }
                </style>
            </head>
            <body>
                <div class="header-container">
                    <div class="brand-side">
                        <h1>Mayon Rent a Car</h1>
                        <p>163 Purok 3, Brgy 17, Legazpi City 4500</p>
                        <p>mayonrentacar.com | mayonrentacar@gmail.com</p>
                    </div>
                    <div class="quote-title-side">
                        <h2>Service Quotation</h2>
                        <p><strong>Quote No:</strong> ${refNum}</p>
                        <p><strong>Date:</strong> ${currentDate}</p>
                    </div>
                </div>

                <div class="info-grid">
                    <div class="info-block">
                        <h3>Prepared For</h3>
                        <p class="client-name">${clientName}</p>
                        <p><i class="fa-solid fa-phone" style="font-size:11px; color:#64748b;"></i> ${contactNo}</p>
                        <p><i class="fa-solid fa-envelope" style="font-size:11px; color:#64748b;"></i> ${emailAddr}</p>
                    </div>
                    <div class="info-block">
                        <h3>Rental Setup</h3>
                        <p><strong>Type:</strong> ${rentalTypeDisplay}</p>
                        ${rentalTypeRaw === 'with-driver' && serviceOption && serviceOption !== '—' ? `<p><strong>Service Option:</strong> ${serviceOption}</p>` : ''}
                        <p><strong>Vehicle Type:</strong> ${vehicleType}</p>
                    </div>
                </div>

                <div class="section-title"><i class="fa-solid fa-circle-info"></i> Booking Details</div>
                <div class="itinerary-box">
                    <div class="point-info">
                        <h4>Pickup Schedule</h4>
                        <p>${fmtPickDate} @ ${fmtPickTime}</p>
                    </div>
                    <div class="point-info">
                        <h4>Pickup Details</h4>
                        <p>${pickupAddr}</p>
                    </div>
                    
                    ${rentalTypeRaw !== 'with-driver' ? `
                        <div class="point-info">
                            <h4>Return Schedule</h4>
                            <p>${fmtRetDate} @ ${fmtRetTime}</p>
                        </div>
                        <div class="point-info">
                            <h4>Return Location</h4>
                            <p>${returnAddr}</p>
                        </div>
                    ` : ''}
                    <div class="point-info">
                        <h4>Route / Destination Details</h4>
                        <p style="white-space: pre-wrap; font-weight: 400; color: #475569;">${itinerary}</p>
                    </div>
                </div>

                ${incExcHTMLSection}

                <div class="section-title"><i class="fa-solid fa-receipt"></i> Cost Breakdown</div>
                <div class="pricing-section">
                    <table class="pricing-table">
                        <tbody>
                            ${breakdownHTML}
                            <tr class="total"><td>Total Amount Due</td><td>${displayTotalAmount}</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="terms-box">
                    <h4>Terms &amp; Validity</h4>
                    <p>This quotation is valid for 7 days from the date issued and is subject to vehicle availability at the time of booking confirmation. Rates are inclusive only of the items indicated above; all other expenses not listed remain the client's responsibility. A signed booking confirmation and required downpayment are needed to secure this reservation.</p>
                </div>

                <div class="notice-footer">
                    <p>© 2026 Mayon Rent a Car, Inc. All Rights Reserved.</p>
                </div>

                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    };
                </script>
            </body>
            </html>
        `);
            printWindow.document.close();
        } catch (error) {
            console.error("Error generating PDF:", error);
            console.error("Error stack:", error.stack);
            showNotificationToast("Error: " + (error.message || "Unknown PDF error"), "error");
        }
        return;
    }
}

function prepareNewBookingForm(rentalType) {
    const tempRef = "NEW-" + Math.floor(10000 + Math.random() * 90000);
    
    document.getElementById("fpRef").innerText = tempRef;
    document.getElementById("fpEditRef").value = "NEW_BOOKING_FLAG";

    document.getElementById("fpName").value = "";
    document.getElementById("fpStatus").value = "Open"; 
    document.getElementById("fpContact").value = "";
    document.getElementById("fpEmail").value = "";
    document.getElementById("fpArea").value = "";
    document.getElementById("fpServiceOption").value = "";
    document.getElementById("fpPassengers").value = "";
    
    document.getElementById("fpPickDate").value = "";
    document.getElementById("fpPickTime").value = "";
    document.getElementById("fpPickAddr").value = "";
    
    document.getElementById("fpReturnDate").value = "";
    document.getElementById("fpReturnTime").value = "";
    document.getElementById("fpReturnAddr").value = "";
    
    document.getElementById("fpDetails").value = "";
    document.getElementById("fpRentalType").value = rentalType;
    
    toggleReturnScheduleVisibility(rentalType);

    const drawer = document.getElementById("quickQuoteDrawer");
    if (drawer) drawer.style.display = "none";
    const oldBtn = document.getElementById("dynamicQuickQuoteBtn");
    if (oldBtn) oldBtn.remove();

    document.getElementById("mainDashboardView").style.display = "none";
    document.getElementById("fullPageDetailsView").style.display = "block";
}

function toggleReturnScheduleVisibility(rentalType) {
    const returnSection = document.getElementById("returnScheduleSection");
    const serviceOptionSection = document.getElementById("serviceOptionSection");
    
    if (!returnSection && !serviceOptionSection) return;

    const rDate = document.getElementById("fpReturnDate");
    const rTime = document.getElementById("fpReturnTime");
    const rAddr = document.getElementById("fpReturnAddr");
    const serviceOption = document.getElementById("fpServiceOption");

    if (rentalType === "with-driver") {
        // Hide return schedule for with-driver
        if (returnSection) returnSection.style.display = "none";
        if (rDate) rDate.value = "";
        if (rTime) rTime.value = "";
        if (rAddr) rAddr.value = "";
        
        // Show service option for with-driver
        if (serviceOptionSection) serviceOptionSection.style.display = "block";
        if (serviceOption) { serviceOption.disabled = false; serviceOption.removeAttribute("readonly"); }
    } else {
        // Show return schedule for self-drive
        if (returnSection) returnSection.style.display = "block";
        if (rDate) { rDate.disabled = false; rDate.removeAttribute("readonly"); }
        if (rTime) { rTime.disabled = false; rTime.removeAttribute("readonly"); }
        if (rAddr) { rAddr.disabled = false; rAddr.removeAttribute("readonly"); }
        
        // Hide service option for self-drive
        if (serviceOptionSection) serviceOptionSection.style.display = "none";
        if (serviceOption) serviceOption.value = "";
    }
}

// ========================================================
// USER MANAGEMENT FUNCTIONS
// ========================================================

function showView(viewType) {
    localStorage.setItem('adminActiveView', viewType);

    document.getElementById('mainDashboardView').style.display = viewType === 'dashboard' ? 'block' : 'none';
    document.getElementById('fullPageDetailsView').style.display = viewType === 'details' ? 'block' : 'none';
    document.getElementById('userManagementView').style.display = viewType === 'userManagement' ? 'block' : 'none';
    document.getElementById('vehicleManagementView').style.display = viewType === 'vehicleManagement' ? 'block' : 'none';
    
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (viewType === 'dashboard') {
        const item = getNavItemByIcon('fa-chart-line');
        if (item) item.classList.add('active');
    } else if (viewType === 'userManagement') {
        const item = getNavItemByIcon('fa-users');
        if (item) item.classList.add('active');
    } else if (viewType === 'vehicleManagement') {
        const item = getNavItemByIcon('fa-car');
        if (item) item.classList.add('active');
    }
}

async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/users`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load users');
        
        const data = await response.json();
        renderUsersTable(data.users);
        showView('userManagement');
    } catch (error) {
        console.error("Error loading users:", error);
        alert('Failed to load users');
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = users.map(user => `
        <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 12px; color: #0F172A;">${user.username}</td>
            <td style="padding: 12px; color: #0F172A;">${user.fullname}</td>
            <td style="padding: 12px; color: #0F172A;">${user.email}</td>
            <td style="padding: 12px;">
                <span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.85rem; font-weight: 600; background: ${user.role === 'admin' ? '#dbeafe' : '#dcfce7'}; color: ${user.role === 'admin' ? '#0369a1' : '#166534'};">
                    ${user.role === 'admin' ? 'Admin' : 'Driver'}
                </span>
            </td>
            <td style="padding: 12px; color: #64748b; font-size: 0.85rem;">${user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</td>
            <td style="padding: 12px; text-align: center;">
                <button type="button" onclick="editUser('${user.id}')" title="Edit" style="background: none; border: none; color: #06B6D4; cursor: pointer; font-size: 1.1rem; margin: 0 5px;"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" onclick="deleteUser('${user.id}', '${user.username}')" title="Delete" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.1rem; margin: 0 5px;"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openAddUserModal() {
    document.getElementById('modalTitle').textContent = 'Add New User';
    document.getElementById('userForm').reset();
    document.getElementById('userForm').dataset.userId = '';
    const passwordInput = document.getElementById('uPassword');
    if (passwordInput) passwordInput.required = true;
    document.getElementById('userFormError').style.display = 'none';
    document.getElementById('userModal').style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

function editUser(userId) {
    // Load user data and populate modal for editing
    alert('Edit functionality coming soon');
}

async function deleteUser(userId, username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/users/${userId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to delete user');
        
        alert('User deleted successfully');
        showView('userManagement');
        loadUsers();
    } catch (error) {
        console.error("Error deleting user:", error);
        alert('Failed to delete user');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('submit', handleSaveUser);
    }
});

async function handleSaveUser(e) {
    e.preventDefault();
    if (!ensureAuth()) return;
    
    const username = document.getElementById('uUsername').value;
    const fullname = document.getElementById('uFullname').value;
    const email = document.getElementById('uEmail').value;
    const password = document.getElementById('uPassword').value;
    const role = document.getElementById('uRole').value;
    const errorDiv = document.getElementById('userFormError');
    const userId = document.getElementById('userForm').dataset.userId;
    
    try {
        const url = userId ? `${API_URL}/users/${userId}` : `${API_URL}/users`;
        const method = userId ? 'PUT' : 'POST';
        
        const body = userId 
            ? { fullname, email, role, ...(password && { password }) }
            : { username, fullname, email, password, role };
        
        const response = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorDiv.textContent = data.error || 'Failed to save user';
            errorDiv.style.display = 'block';
            return;
        }
        
        alert(userId ? 'User updated successfully' : 'User created successfully');
        closeUserModal();
        loadUsers();
    } catch (error) {
        console.error("Error saving user:", error);
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.style.display = 'block';
    }
}

function initializeDashboard() {
    fetchStatusCounts();
    fetchBookings('open');
    showUserManagementIfAdmin();
    
    // Setup sidebar toggle
    const toggleBtn = document.getElementById('toggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

// Mobile sidebar toggle
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const dashboardContainer = document.querySelector('.dashboard-container');
    
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
    
    // Close account dropdown when opening sidebar
    const accountDropdown = document.getElementById('accountDropdownMobile');
    if (accountDropdown) {
        accountDropdown.classList.remove('active');
    }
}

// Mobile account menu toggle
function toggleMobileAccountMenu() {
    const dropdown = document.getElementById('accountDropdownMobile');
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

// Close mobile sidebar when clicking on a nav item
document.addEventListener('DOMContentLoaded', function() {
    const navItems = document.querySelectorAll('.sidebar .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const sidebar = document.getElementById('sidebar');
            if (window.innerWidth < 768 && sidebar) {
                setTimeout(() => {
                    sidebar.classList.remove('active');
                }, 100);
            }
        });
    });
});

// ========================================================
// VEHICLE MANAGEMENT FUNCTIONS
// ========================================================

async function loadVehicles() {
    try {
        const response = await fetch(`${API_URL}/vehicles`, {
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load vehicles');
        
        const data = await response.json();
        renderVehiclesTable(data.vehicles);
    } catch (error) {
        console.error("Error loading vehicles:", error);
        alert('Failed to load vehicles');
    }
}

function renderVehiclesTable(vehicles) {
    const tbody = document.getElementById('vehiclesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = vehicles.map(vehicle => `
        <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 12px; color: #0F172A; font-weight: 600;">${vehicle.plate}</td>
            <td style="padding: 12px; color: #0F172A;">${vehicle.make} ${vehicle.model}</td>
            <td style="padding: 12px; color: #0F172A;">${vehicle.type}</td>
            <td style="padding: 12px; color: #0F172A;">${vehicle.year}</td>
            <td style="padding: 12px; color: #0F172A;">${vehicle.seats}</td>
            <td style="padding: 12px;">
                <span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.85rem; font-weight: 600; background: ${vehicle.status === 'Available' ? '#dcfce7' : vehicle.status === 'Maintenance' ? '#fef2f2' : '#fef3c7'}; color: ${vehicle.status === 'Available' ? '#166534' : vehicle.status === 'Maintenance' ? '#991b1b' : '#92400e'};">
                    ${vehicle.status}
                </span>
            </td>
            <td style="padding: 12px; text-align: center;">
                <button type="button" onclick="editVehicle('${vehicle.id}')" title="Edit" style="background: none; border: none; color: #06B6D4; cursor: pointer; font-size: 1.1rem; margin: 0 5px;"><i class="fa-solid fa-pencil"></i></button>
                <button type="button" onclick="deleteVehicle('${vehicle.id}', '${vehicle.plate}')" title="Delete" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.1rem; margin: 0 5px;"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openAddVehicleModal() {
    document.getElementById('vehicleModalTitle').textContent = 'Add New Vehicle';
    document.getElementById('vehicleEditId').value = '';
    document.getElementById('vehicleForm').reset();
    document.getElementById('vehicleModal').style.display = 'flex';
}

function closeVehicleModal() {
    document.getElementById('vehicleModal').style.display = 'none';
}

async function handleSaveVehicle(e) {
    e.preventDefault();
    if (!ensureAuth()) return;
    
    const vehicleId = document.getElementById('vehicleEditId').value;
    const plate = document.getElementById('vehiclePlate').value;
    const make = document.getElementById('vehicleMake').value;
    const model = document.getElementById('vehicleModel').value;
    const year = document.getElementById('vehicleYear').value;
    const type = document.getElementById('vehicleType').value;
    const color = document.getElementById('vehicleColor').value;
    const seats = document.getElementById('vehicleSeats').value;
    const transmission = document.getElementById('vehicleTransmission').value;
    const fuelType = document.getElementById('vehicleFuelType').value;
    const status = document.getElementById('vehicleStatus').value;
    
    try {
        const url = vehicleId ? `${API_URL}/vehicles/${vehicleId}` : `${API_URL}/vehicles`;
        const method = vehicleId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify({
                plate, make, model, year, type, color, seats, transmission, fuelType, status
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            alert(data.error || 'Failed to save vehicle');
            return;
        }
        
        alert(vehicleId ? 'Vehicle updated successfully' : 'Vehicle added successfully');
        closeVehicleModal();
        loadVehicles();
    } catch (error) {
        console.error("Error saving vehicle:", error);
        alert('Network error. Please try again.');
    }
}

async function editVehicle(vehicleId) {
    try {
        const response = await fetch(`${API_URL}/vehicles`, {
            headers: getAuthHeaders()
        });
        
        const data = await response.json();
        const vehicle = data.vehicles.find(v => v.id === vehicleId);
        
        if (!vehicle) {
            alert('Vehicle not found');
            return;
        }
        
        // Populate form
        document.getElementById('vehicleModalTitle').textContent = 'Edit Vehicle';
        document.getElementById('vehicleEditId').value = vehicle.id;
        document.getElementById('vehiclePlate').value = vehicle.plate;
        document.getElementById('vehicleMake').value = vehicle.make;
        document.getElementById('vehicleModel').value = vehicle.model;
        document.getElementById('vehicleYear').value = vehicle.year;
        document.getElementById('vehicleType').value = vehicle.type;
        document.getElementById('vehicleColor').value = vehicle.color;
        document.getElementById('vehicleSeats').value = vehicle.seats;
        document.getElementById('vehicleTransmission').value = vehicle.transmission;
        document.getElementById('vehicleFuelType').value = vehicle.fuelType;
        document.getElementById('vehicleStatus').value = vehicle.status;
        
        document.getElementById('vehicleModal').style.display = 'flex';
    } catch (error) {
        console.error("Error loading vehicle:", error);
        alert('Failed to load vehicle details');
    }
}

async function deleteVehicle(vehicleId, plate) {
    if (!confirm(`Are you sure you want to delete vehicle "${plate}"?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/vehicles/${vehicleId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to delete vehicle');
        
        alert('Vehicle deleted successfully');
        loadVehicles();
    } catch (error) {
        console.error("Error deleting vehicle:", error);
        alert('Failed to delete vehicle');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const vehicleForm = document.getElementById('vehicleForm');
    if (vehicleForm) {
        vehicleForm.addEventListener('submit', handleSaveVehicle);
    }
});