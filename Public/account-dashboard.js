const requiredDashboardRole = document.body.dataset.dashboardRole;
const isLocalDashboard = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const dashboardApiBases = isLocalDashboard
    ? ['http://127.0.0.1:3000/api', 'http://localhost:3000/api', '/api']
    : ['/api', 'https://api.mayonrentacar.com.ph/api'];
let portalUser = null;
let affiliateVehicles = [];
let affiliateRequests = [];

function getPortalLoginPath() {
    return window.getDashboardPath?.('admin') || '/dashboard';
}

function dashboardAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function dashboardApiRequest(path, options = {}) {
    let lastError = null;

    for (let index = 0; index < dashboardApiBases.length; index += 1) {
        const base = dashboardApiBases[index];
        try {
            const headers = { ...options.headers, ...dashboardAuthHeaders() };
            const response = await fetch(`${base}${path}`, { ...options, headers });
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`Unexpected API response (${response.status}): ${text.slice(0, 120)}`);
            }

            const data = await response.json();
            if (response.status === 404 && index < dashboardApiBases.length - 1) continue;
            if (response.status >= 500 && index < dashboardApiBases.length - 1) {
                lastError = new Error(data.error || `The service returned ${response.status}.`);
                continue;
            }
            if (response.status === 401) {
                clearPortalAuthentication();
                window.location.replace(getPortalLoginPath());
            }
            return { response, data };
        } catch (error) {
            lastError = error;
            if (index === dashboardApiBases.length - 1) throw error;
        }
    }

    throw lastError || new Error('The dashboard service is unavailable.');
}

function showPortalNotice(message, type = 'info') {
    const notice = document.getElementById('portalNotice');
    if (!notice) return;
    notice.textContent = message;
    notice.classList.toggle('is-error', type === 'error');
    notice.hidden = false;
}

function showPortalAccessMessage(message, type = 'error') {
    const app = document.getElementById('portalApp');
    const panel = document.getElementById('portalAccessMessage');
    const heading = panel?.querySelector('h1');
    const description = panel?.querySelector('p');
    if (app) app.hidden = true;
    if (!panel) return;
    panel.hidden = false;
    panel.classList.toggle('is-error', type === 'error');
    if (heading) heading.textContent = type === 'error' ? 'Dashboard access unavailable' : 'Verifying your account';
    if (description) description.textContent = message;

    let loginLink = panel.querySelector('a');
    if (!loginLink) {
        loginLink = document.createElement('a');
        loginLink.textContent = 'Go to the sign-in portal';
        panel.appendChild(loginLink);
    }
    loginLink.href = getPortalLoginPath();
}

function clearPortalAuthentication() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('adminActiveView');
}

function formatMoney(value) {
    const amount = Number(value);
    return `₱${Number.isFinite(amount) ? amount.toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '0'}`;
}

function formatDate(value) {
    if (!value || value === '—') return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        .toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function getStatusClass(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized.includes('cancel') || normalized === 'rejected') return 'is-cancelled';
    if (['approved', 'customer approved', 'confirmed', 'completed', 'ongoing', 'deposited', 'available'].includes(normalized)) return 'is-confirmed';
    if (normalized === 'quoted') return 'is-quoted';
    if (normalized === 'pending' || normalized === 'open' || normalized === 'for assignment' || normalized === 'pending payment') return 'is-pending';
    if (normalized === 'maintenance') return 'is-inactive';
    return '';
}

function createStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `portal-status ${getStatusClass(status)}`;
    badge.textContent = status || 'Unknown';
    return badge;
}

function createSummaryCard(label, value) {
    const card = document.createElement('article');
    card.className = 'portal-summary-card';
    const title = document.createElement('span');
    title.textContent = label;
    const count = document.createElement('strong');
    count.textContent = String(value);
    card.append(title, count);
    return card;
}

function setTableEmptyState(tbody, columnCount, message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columnCount;
    cell.textContent = message;
    row.appendChild(cell);
    tbody.replaceChildren(row);
}

function setPortalView(viewName) {
    const view = document.querySelector(`[data-view="${viewName}"]`);
    if (!view) return;
    document.querySelectorAll('.portal-view').forEach(section => {
        section.hidden = section !== view;
    });
    document.querySelectorAll('.portal-nav [data-view-target]').forEach(link => {
        const active = link.dataset.viewTarget === viewName;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    document.querySelector('.portal-main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindPortalNavigation() {
    document.querySelectorAll('[data-view-target]').forEach(control => {
        control.addEventListener('click', event => {
            event.preventDefault();
            setPortalView(control.dataset.viewTarget);
        });
    });
    document.querySelectorAll('[data-logout]').forEach(button => {
        button.addEventListener('click', () => {
            clearPortalAuthentication();
            window.location.replace(getPortalLoginPath());
        });
    });
}

function populatePortalProfile(user) {
    const fullname = user.fullname || '';
    document.getElementById('portalUserName').textContent = fullname || (user.role === 'affiliate' ? 'Affiliate' : 'Customer');
    document.getElementById('portalUserInitials').textContent = fullname.trim().charAt(0).toUpperCase() || 'U';
    document.getElementById('profileFullname').value = fullname;
    document.getElementById('profileEmail').value = user.email || '';
    document.getElementById('profileMobile').value = user.mobile || '';
}

async function savePortalProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const body = {
        fullname: document.getElementById('profileFullname').value.trim(),
        mobile: document.getElementById('profileMobile').value.trim()
    };

    try {
        const { response, data } = await dashboardApiRequest('/users/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to save your profile.', 'error');
            return;
        }
        portalUser = data.user;
        localStorage.setItem('currentUser', JSON.stringify(portalUser));
        populatePortalProfile(portalUser);
        showPortalNotice('Your profile has been updated.');
    } catch (error) {
        console.error('Profile update failed:', error);
        showPortalNotice('Unable to connect to the account service. Please try again.', 'error');
    }
}

function renderCustomerBookings(bookings) {
    const summary = document.getElementById('customerSummary');
    const list = document.getElementById('customerBookingsList');
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = bookings.filter(booking =>
        booking.pickup_date && booking.pickup_date !== '—' &&
        booking.pickup_date >= today &&
        !String(booking.status || '').toLowerCase().includes('cancel')
    ).length;
    const awaiting = bookings.filter(booking => ['open', 'quoted', 'pending payment'].includes(String(booking.status || '').toLowerCase())).length;
    const completed = bookings.filter(booking => String(booking.status || '').toLowerCase() === 'completed').length;
    summary.replaceChildren(
        createSummaryCard('Total bookings', bookings.length),
        createSummaryCard('Upcoming trips', upcoming),
        createSummaryCard('Awaiting response', awaiting),
        createSummaryCard('Completed', completed)
    );
    list.replaceChildren();

    if (!bookings.length) {
        const empty = document.createElement('div');
        empty.className = 'portal-empty-state';
        const icon = document.createElement('i');
        icon.className = 'fa-regular fa-calendar';
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = 'No bookings found';
        const description = document.createElement('p');
        description.textContent = `Bookings associated with ${portalUser.email} will appear here. Public booking forms remain available without an account.`;
        empty.append(icon, title, description);
        list.appendChild(empty);
        return;
    }

    bookings.forEach(booking => {
        const card = document.createElement('article');
        card.className = 'portal-booking-card';
        const heading = document.createElement('div');
        heading.className = 'portal-booking-heading';
        const titleGroup = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = `Booking ${booking.ref || ''}`;
        const subtitle = document.createElement('p');
        subtitle.className = 'portal-booking-subtitle';
        subtitle.textContent = [booking.rentalType, booking.serviceOption]
            .filter(value => value && value !== '—')
            .join(' · ') || 'Rental booking';
        titleGroup.append(title, subtitle);
        heading.append(titleGroup, createStatusBadge(booking.status));

        const details = document.createElement('dl');
        details.className = 'portal-booking-details';
        const fields = [
            ['Pickup', `${formatDate(booking.pickup_date)}${booking.pickup_time && booking.pickup_time !== '—' ? ` · ${booking.pickup_time}` : ''}`],
            ['Pickup location', booking.pickup_location_address || booking.pickup_address || '—'],
            ['Return', `${formatDate(booking.return_date)}${booking.return_time && booking.return_time !== '—' ? ` · ${booking.return_time}` : ''}`],
            ['Return location', booking.return_location_address || booking.return_address || '—'],
            ['Vehicle type', booking.vehicleType || '—'],
            ['Passengers', booking.passengers || '—'],
            ['Area', booking.area || '—'],
            ['Trip details', booking.itinerary || '—']
        ];
        fields.forEach(([label, value]) => {
            const item = document.createElement('div');
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            item.append(term, description);
            details.appendChild(item);
        });
        card.append(heading, details);
        list.appendChild(card);
    });
}

async function loadCustomerBookings() {
    const list = document.getElementById('customerBookingsList');
    list.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'portal-empty-state';
    loading.textContent = 'Loading your bookings…';
    list.appendChild(loading);

    try {
        const { response, data } = await dashboardApiRequest('/customer/bookings');
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to load your bookings.', 'error');
            showCustomerBookingsError('Your bookings could not be loaded.');
            return;
        }
        if (!Array.isArray(data.bookings)) throw new Error('Booking response is not a list.');
        renderCustomerBookings(data.bookings);
    } catch (error) {
        console.error('Customer bookings failed to load:', error);
        showPortalNotice('Unable to connect to the booking service. Please try again.', 'error');
        showCustomerBookingsError('Your bookings could not be loaded.');
    }
}

function showCustomerBookingsError(message) {
    const list = document.getElementById('customerBookingsList');
    const state = document.createElement('div');
    state.className = 'portal-empty-state';
    state.textContent = message;
    list.replaceChildren(state);
}

function appendTableCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value || '—';
    row.appendChild(cell);
    return cell;
}

function renderAffiliateVehicles() {
    const tbody = document.getElementById('affiliateVehiclesBody');
    tbody.replaceChildren();
    if (!affiliateVehicles.length) {
        setTableEmptyState(tbody, 4, 'You do not have any approved vehicles yet.');
        return;
    }
    affiliateVehicles.forEach(vehicle => {
        const row = document.createElement('tr');
        const vehicleCell = document.createElement('td');
        const name = document.createElement('strong');
        name.textContent = `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle';
        const plate = document.createElement('small');
        plate.textContent = vehicle.plate || '—';
        vehicleCell.append(name, document.createElement('br'), plate);
        row.appendChild(vehicleCell);
        appendTableCell(row, [vehicle.year, vehicle.type, vehicle.color].filter(Boolean).join(' · ') || '—');
        const statusCell = document.createElement('td');
        statusCell.appendChild(createStatusBadge(vehicle.status));
        row.appendChild(statusCell);
        appendTableCell(row, formatMoney(vehicle.dailyRate));
        tbody.appendChild(row);
    });
}

function renderAffiliateRequests() {
    const tbody = document.getElementById('affiliateRequestsBody');
    tbody.replaceChildren();
    if (!affiliateRequests.length) {
        setTableEmptyState(tbody, 4, 'You have not submitted any vehicles for approval.');
        return;
    }
    affiliateRequests.forEach(request => {
        const row = document.createElement('tr');
        const vehicleCell = document.createElement('td');
        const name = document.createElement('strong');
        name.textContent = `${request.make || ''} ${request.model || ''}`.trim() || 'Vehicle';
        const plate = document.createElement('small');
        plate.textContent = request.plate || '—';
        vehicleCell.append(name, document.createElement('br'), plate);
        row.appendChild(vehicleCell);
        appendTableCell(row, formatDateTime(request.submittedAt));
        const statusCell = document.createElement('td');
        statusCell.appendChild(createStatusBadge(request.status));
        row.appendChild(statusCell);
        appendTableCell(row, request.reviewNote || '—');
        tbody.appendChild(row);
    });
}

function renderAffiliateOverview() {
    const summary = document.getElementById('affiliateSummary');
    const pending = affiliateRequests.filter(request => request.status === 'Pending').length;
    const available = affiliateVehicles.filter(vehicle => vehicle.status === 'Available').length;
    summary.replaceChildren(
        createSummaryCard('Approved vehicles', affiliateVehicles.length),
        createSummaryCard('Available', available),
        createSummaryCard('Pending review', pending),
        createSummaryCard('Reviewed requests', affiliateRequests.length - pending)
    );

    const recentRequests = document.getElementById('affiliateRecentRequests');
    const recentVehicles = document.getElementById('affiliateRecentVehicles');
    recentRequests.replaceChildren();
    recentVehicles.replaceChildren();
    if (!affiliateRequests.length) {
        recentRequests.textContent = 'No vehicle requests yet.';
    } else {
        affiliateRequests.slice(-3).reverse().forEach(request => {
            const item = document.createElement('div');
            item.className = 'portal-compact-item';
            const text = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = `${request.make || ''} ${request.model || ''}`.trim() || request.plate || 'Vehicle';
            const subtitle = document.createElement('small');
            subtitle.textContent = formatDateTime(request.submittedAt);
            text.append(title, subtitle);
            item.append(text, createStatusBadge(request.status));
            recentRequests.appendChild(item);
        });
    }
    if (!affiliateVehicles.length) {
        recentVehicles.textContent = 'No approved vehicles yet.';
    } else {
        affiliateVehicles.slice(-3).reverse().forEach(vehicle => {
            const item = document.createElement('div');
            item.className = 'portal-compact-item';
            const text = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || vehicle.plate || 'Vehicle';
            const subtitle = document.createElement('small');
            subtitle.textContent = vehicle.plate || '—';
            text.append(title, subtitle);
            item.append(text, createStatusBadge(vehicle.status));
            recentVehicles.appendChild(item);
        });
    }
}

async function loadAffiliateData() {
    try {
        const [vehiclesResult, requestsResult] = await Promise.all([
            dashboardApiRequest('/vehicles'),
            dashboardApiRequest('/vehicle-approval-requests')
        ]);
        if (!vehiclesResult.response.ok) {
            throw new Error(vehiclesResult.data.error || 'Unable to load your vehicles.');
        }
        if (!requestsResult.response.ok) {
            throw new Error(requestsResult.data.error || 'Unable to load your vehicle requests.');
        }
        if (!Array.isArray(vehiclesResult.data.vehicles) || !Array.isArray(requestsResult.data.requests)) {
            throw new Error('The affiliate dashboard returned invalid vehicle data.');
        }
        affiliateVehicles = vehiclesResult.data.vehicles;
        affiliateRequests = requestsResult.data.requests;
        renderAffiliateVehicles();
        renderAffiliateRequests();
        renderAffiliateOverview();
    } catch (error) {
        console.error('Affiliate dashboard data failed to load:', error);
        showPortalNotice(error.message || 'Unable to load affiliate data. Please try again.', 'error');
        setTableEmptyState(document.getElementById('affiliateVehiclesBody'), 4, 'Vehicle data could not be loaded.');
        setTableEmptyState(document.getElementById('affiliateRequestsBody'), 4, 'Approval requests could not be loaded.');
    }
}

async function submitVehicleRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const payload = {
        plate: String(formData.get('plate') || '').trim(),
        make: String(formData.get('make') || '').trim(),
        model: String(formData.get('model') || '').trim(),
        year: Number(formData.get('year')),
        type: String(formData.get('type') || ''),
        color: String(formData.get('color') || '').trim(),
        seats: Number(formData.get('seats')),
        transmission: String(formData.get('transmission') || ''),
        fuelType: String(formData.get('fuelType') || ''),
        dailyRate: Number(formData.get('dailyRate'))
    };

    try {
        const { response, data } = await dashboardApiRequest('/vehicle-approval-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to submit this vehicle.', 'error');
            return;
        }
        form.reset();
        showPortalNotice('Vehicle submitted for approval.');
        await loadAffiliateData();
    } catch (error) {
        console.error('Vehicle submission failed:', error);
        showPortalNotice('Unable to connect to the vehicle approval service. Please try again.', 'error');
    }
}

async function initializePortalDashboard() {
    bindPortalNavigation();
    document.getElementById('profileForm')?.addEventListener('submit', savePortalProfile);
    document.getElementById('vehicleRequestForm')?.addEventListener('submit', submitVehicleRequest);
    document.getElementById('refreshCustomerBookings')?.addEventListener('click', loadCustomerBookings);

    if (!localStorage.getItem('authToken')) {
        window.location.replace(getPortalLoginPath());
        return;
    }
    if (typeof window.getDashboardPath !== 'function') {
        showPortalAccessMessage('Dashboard routing could not be initialized. Please use the sign-in portal.');
        return;
    }

    try {
        const { response, data } = await dashboardApiRequest('/users/me');
        if (!response.ok) {
            if (response.status === 401) {
                clearPortalAuthentication();
                window.location.replace(getPortalLoginPath());
                return;
            }
            if (data.role === 'driver') {
                clearPortalAuthentication();
                showPortalAccessMessage('Driver accounts are for booking assignments only and cannot access dashboards.');
                return;
            }
            showPortalAccessMessage(data.error || 'Your account is not authorized to use this dashboard.');
            return;
        }

        portalUser = data.user;
        if (portalUser.role !== requiredDashboardRole) {
            const ownDashboard = window.getDashboardPath(portalUser.role);
            if (ownDashboard) {
                window.location.replace(ownDashboard);
                return;
            }
            clearPortalAuthentication();
            showPortalAccessMessage('This account role cannot access dashboards.');
            return;
        }

        populatePortalProfile(portalUser);
        document.getElementById('portalAccessMessage').hidden = true;
        document.getElementById('portalApp').hidden = false;
        setPortalView(document.querySelector('.portal-nav .is-active')?.dataset.viewTarget || 'overview');

        if (requiredDashboardRole === 'customer') {
            await loadCustomerBookings();
        } else if (requiredDashboardRole === 'affiliate') {
            await loadAffiliateData();
        }
    } catch (error) {
        console.error('Dashboard access verification failed:', error);
        showPortalAccessMessage('We could not verify your account with the server. Check your connection and try again.');
    }
}

document.addEventListener('DOMContentLoaded', initializePortalDashboard);
