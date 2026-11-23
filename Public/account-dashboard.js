const requiredDashboardRole = document.body.dataset.dashboardRole;
const isLocalDashboard = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const dashboardApiBases = isLocalDashboard
    ? ['http://127.0.0.1:3000/api', 'http://localhost:3000/api', '/api']
    : ['/api', 'https://api.mayonrentacar.com.ph/api'];
const portalPrefix = requiredDashboardRole === 'customer' ? '/customer' : '/affiliate';
let portalUser = null;
let affiliateVehicles = [];
let affiliateRequests = [];
let affiliateBookings = [];
let affiliateEarnings = null;
let affiliateVehicleSelectedFiles = { documents: [], exteriorPhotos: [], interiorPhotos: [] };
let affiliateVehicleExistingFiles = { documents: [], exteriorPhotos: [], interiorPhotos: [] };
const affiliateVehicleUploadLimit = 10;
const affiliateVehicleUploadMaxBytes = 5 * 1024 * 1024;
const affiliateVehicleUploadTypes = {
    documents: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    exteriorPhotos: ['image/jpeg', 'image/png', 'image/webp'],
    interiorPhotos: ['image/jpeg', 'image/png', 'image/webp']
};
const affiliateVehicleUploadInputIds = {
    documents: 'affiliateVehicleDocumentsInput',
    exteriorPhotos: 'affiliateVehicleExteriorPhotosInput',
    interiorPhotos: 'affiliateVehicleInteriorPhotosInput'
};
let customerBookings = [];
let customerVehicles = [];
let currentCustomerBooking = null;
let currentBookingFilter = 'upcoming';
let selectedVehicleId = '';

function getPortalLoginPath() {
    return window.getDashboardPath?.('admin') || '/admin';
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

async function dashboardApiFileRequest(path, options = {}) {
    let lastError = null;
    for (const base of dashboardApiBases) {
        try {
            const response = await fetch(`${base}${path}`, {
                ...options,
                headers: { ...options.headers, ...dashboardAuthHeaders() }
            });
            if (response.status === 401) {
                clearPortalAuthentication();
                window.location.replace(getPortalLoginPath());
            }
            if (response.status !== 404) return response;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('The document service is unavailable.');
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
    const amount = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return `₱${Number.isFinite(amount) ? amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
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
    if (['approved', 'customer approved', 'confirmed', 'completed', 'ongoing', 'deposited', 'available', 'approved / active'].includes(normalized)) return 'is-confirmed';
    if (normalized === 'quoted') return 'is-quoted';
    if (normalized.includes('pending') || ['open', 'for assignment', 'cancellation requested'].includes(normalized)) return 'is-pending';
    if (normalized.includes('maintenance')) return 'is-inactive';
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
    if (!tbody) return;
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columnCount;
    cell.className = 'portal-subtle';
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
    document.querySelectorAll('.portal-nav [data-route]').forEach(link => {
        const activeView = ['booking-detail', 'vehicle-new'].includes(viewName) ? (viewName === 'booking-detail' ? 'bookings' : 'vehicles') : viewName;
        const active = routeView(link.dataset.route) === activeView;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function routeView(route) {
    const path = String(route || '');
    if (requiredDashboardRole === 'affiliate') {
        if (path === '/affiliate/vehicles/new' || /^\/affiliate\/vehicles\/[^/]+\/edit$/.test(path)) return 'vehicle-new';
        return path.split('/')[2] || 'dashboard';
    }
    if (/^\/customer\/bookings\/[^/]+/.test(path)) return 'booking-detail';
    return path.split('/')[2] || 'dashboard';
}

function currentPortalRoute() {
    if (isLocalDashboard && window.location.hash.startsWith('#/')) {
        return `${portalPrefix}${window.location.hash.slice(1)}`;
    }
    if (window.location.pathname === '/affiliate-dashboard' || window.location.pathname.endsWith('/affiliate-dashboard.html')) {
        return '/affiliate/dashboard';
    }
    if (window.location.pathname === '/customer-dashboard' || window.location.pathname.endsWith('/customer-dashboard.html')) {
        return '/customer/dashboard';
    }
    return window.location.pathname;
}

function portalHref(route) {
    if (!isLocalDashboard) return route;
    const suffix = route.slice(portalPrefix.length) || '/dashboard';
    return `${window.location.pathname}#${suffix}`;
}

function navigateToRoute(route, replace = false) {
    const href = portalHref(route);
    if (replace) window.history.replaceState({}, '', href);
    else window.history.pushState({}, '', href);
    loadPortalRoute();
}

function bindPortalNavigation() {
    document.querySelectorAll('[data-route]').forEach(control => {
        control.addEventListener('click', event => {
            const route = control.dataset.route;
            if (!route) return;
            event.preventDefault();
            navigateToRoute(route);
        });
    });
    document.querySelectorAll('[data-logout]').forEach(button => {
        button.addEventListener('click', () => {
            clearPortalAuthentication();
            window.location.replace(getPortalLoginPath());
        });
    });
}

function toLocalPhoneNumber(value) {
    return String(value || '').replace(/^(?:\+63|63|0)\s*/, '').replace(/\D/g, '');
}

function toInternationalPhoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    const local = digits.replace(/^(?:63|0)/, '');
    return `+63${local}`;
}

function populatePortalProfile(user) {
    const fullname = user.fullname || '';
    const userName = document.getElementById('portalUserName');
    const initials = document.getElementById('portalUserInitials');
    if (userName) userName.textContent = fullname || (user.role === 'affiliate' ? 'Affiliate' : 'Customer');
    if (initials) initials.textContent = fullname.trim().charAt(0).toUpperCase() || 'U';
    const values = {
        profileFullname: fullname,
        profileEmail: user.email || '',
        profileMobile: toLocalPhoneNumber(user.mobile),
        profileBusinessName: user.businessName || '',
        profileRegion: user.region || '',
        profileAddress: user.address || '',
        payoutBankName: user.payoutBankName || '',
        payoutAccountName: user.payoutAccountName || '',
        payoutAccountNumber: user.payoutAccountNumber || '',
        payoutGcashNumber: toLocalPhoneNumber(user.payoutGcashNumber)
    };
    Object.entries(values).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });
    renderUserDocuments(user.documents || []);
}

async function savePortalProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const body = {
        fullname: document.getElementById('profileFullname').value.trim(),
        mobile: toInternationalPhoneNumber(document.getElementById('profileMobile').value)
    };
    if (requiredDashboardRole === 'affiliate') {
        body.businessName = document.getElementById('profileBusinessName').value.trim();
        body.region = document.getElementById('profileRegion').value.trim();
        body.address = document.getElementById('profileAddress').value.trim();
        body.payoutBankName = document.getElementById('payoutBankName').value.trim();
        body.payoutAccountName = document.getElementById('payoutAccountName').value.trim();
        body.payoutAccountNumber = document.getElementById('payoutAccountNumber').value.trim();
        body.payoutGcashNumber = toInternationalPhoneNumber(document.getElementById('payoutGcashNumber').value);
    }

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
        portalUser = { ...portalUser, ...data.user };
        localStorage.setItem('currentUser', JSON.stringify(portalUser));
        populatePortalProfile(portalUser);
        showPortalNotice('Your profile has been updated.');
    } catch (error) {
        console.error('Profile update failed:', error);
        showPortalNotice('Unable to connect to the account service. Please try again.', 'error');
    }
}

async function changePortalPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const newPassword = String(formData.get('newPassword') || '');
    if (newPassword !== String(formData.get('confirmPassword') || '')) {
        showPortalNotice('New passwords do not match.', 'error');
        return;
    }
    try {
        const { response, data } = await dashboardApiRequest('/users/me/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword: String(formData.get('currentPassword') || ''),
                newPassword
            })
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to update your password.', 'error');
            return;
        }
        form.reset();
        showPortalNotice('Your password has been updated.');
    } catch (error) {
        console.error('Password update failed:', error);
        showPortalNotice('Unable to connect to the account service. Please try again.', 'error');
    }
}

function renderUserDocuments(documents) {
    const list = document.getElementById('customerDocumentsList');
    if (!list) return;
    list.replaceChildren();
    if (!documents.length) {
        list.textContent = 'No renter documents uploaded yet.';
        return;
    }
    documents.forEach(documentInfo => {
        const row = document.createElement('div');
        row.className = 'portal-document-item';
        const name = document.createElement('span');
        name.textContent = documentInfo.originalName || 'Renter document';
        const actions = document.createElement('span');
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'View';
        open.addEventListener('click', () => openPrivateFile(`/users/me/documents/${encodeURIComponent(documentInfo.filename)}`));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => deleteUserDocument(documentInfo.filename));
        actions.append(open, document.createTextNode(' · '), remove);
        row.append(name, actions);
        list.appendChild(row);
    });
}

async function openPrivateFile(path) {
    try {
        const response = await dashboardApiFileRequest(path);
        if (!response.ok) {
            showPortalNotice('Unable to open this document.', 'error');
            return;
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = objectUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
        console.error('Private document access failed:', error);
        showPortalNotice('Unable to connect to the document service.', 'error');
    }
}

async function deleteUserDocument(filename) {
    if (!window.confirm('Remove this document from your account?')) return;
    try {
        const { response, data } = await dashboardApiRequest(`/users/me/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to remove the document.', 'error');
            return;
        }
        await refreshPortalUser();
        showPortalNotice('Document removed.');
    } catch (error) {
        console.error('Document removal failed:', error);
        showPortalNotice('Unable to connect to the document service.', 'error');
    }
}

async function refreshPortalUser() {
    const { response, data } = await dashboardApiRequest('/users/me');
    if (!response.ok) throw new Error(data.error || 'Unable to refresh your account.');
    portalUser = data.user;
    localStorage.setItem('currentUser', JSON.stringify(portalUser));
    populatePortalProfile(portalUser);
}

async function uploadCustomerDocuments(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (!formData.get('license')?.size && !formData.get('validId')?.size) {
        showPortalNotice('Choose a Driver’s License or Valid ID to upload.', 'error');
        return;
    }
    try {
        const { response, data } = await dashboardApiRequest('/users/me/documents', { method: 'POST', body: formData });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to upload documents.', 'error');
            return;
        }
        form.reset();
        await refreshPortalUser();
        showPortalNotice('Renter documents uploaded securely.');
    } catch (error) {
        console.error('Renter document upload failed:', error);
        showPortalNotice('Unable to connect to the document service.', 'error');
    }
}

function isCancelledOrCompleted(booking) {
    const status = String(booking.status || '').toLowerCase();
    return status.includes('cancel') || status === 'completed';
}

function isUpcomingBooking(booking) {
    return !isCancelledOrCompleted(booking) &&
        (!booking.pickup_date || booking.pickup_date === '—' || booking.pickup_date >= new Date().toISOString().slice(0, 10));
}

function isPastBooking(booking) {
    return isCancelledOrCompleted(booking) ||
        (booking.return_date && booking.return_date !== '—' && booking.return_date < new Date().toISOString().slice(0, 10));
}

function createCustomerBookingCard(booking) {
    const card = document.createElement('article');
    card.className = 'portal-booking-card';
    const heading = document.createElement('div');
    heading.className = 'portal-booking-heading';
    const titleGroup = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = `Booking ${booking.ref || ''}`;
    const subtitle = document.createElement('p');
    subtitle.className = 'portal-booking-subtitle';
    subtitle.textContent = [booking.vehicle?.make, booking.vehicle?.model, booking.vehicleType, booking.rentalType]
        .filter(Boolean)
        .join(' · ') || 'Rental booking';
    titleGroup.append(title, subtitle);
    const status = booking.cancellationRequestedAt ? 'Cancellation Requested' : booking.status;
    heading.append(titleGroup, createStatusBadge(status));

    const details = document.createElement('dl');
    details.className = 'portal-booking-details';
    const fields = [
        ['Pickup', `${formatDate(booking.pickup_date)}${booking.pickup_time && booking.pickup_time !== '—' ? ` · ${booking.pickup_time}` : ''}`],
        ['Pickup area', booking.pickup_address || booking.area || '—'],
        ['Return', `${formatDate(booking.return_date)}${booking.return_time && booking.return_time !== '—' ? ` · ${booking.return_time}` : ''}`],
        ['Status', status || 'Unknown']
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
    const open = document.createElement('a');
    const route = `/customer/bookings/${encodeURIComponent(booking.ref)}`;
    open.className = 'portal-button portal-button-secondary portal-card-link';
    open.href = portalHref(route);
    open.dataset.route = route;
    open.textContent = 'View Details';
    open.addEventListener('click', event => {
        event.preventDefault();
        navigateToRoute(route);
    });
    card.append(heading, details, open);
    return card;
}

function renderCustomerBookings() {
    const list = document.getElementById('customerBookingsList');
    if (!list) return;
    let visibleBookings = customerBookings;
    if (currentBookingFilter === 'quoted') {
        visibleBookings = customerBookings.filter(booking => String(booking.status).toLowerCase() === 'quoted');
    } else if (currentBookingFilter === 'past') {
        visibleBookings = customerBookings.filter(isPastBooking);
    } else {
        visibleBookings = customerBookings.filter(booking =>
            isUpcomingBooking(booking) && String(booking.status).toLowerCase() !== 'quoted'
        );
    }

    list.replaceChildren();
    if (!visibleBookings.length) {
        const empty = document.createElement('div');
        empty.className = 'portal-empty-state';
        empty.textContent = currentBookingFilter === 'quoted'
            ? 'There are no pending quotes.'
            : currentBookingFilter === 'past'
                ? 'Your past and cancelled trips will appear here.'
                : 'No upcoming bookings yet. Browse the fleet to book a vehicle.';
        list.appendChild(empty);
        return;
    }
    visibleBookings.forEach(booking => list.appendChild(createCustomerBookingCard(booking)));
}

function renderCustomerDashboard() {
    const summary = document.getElementById('customerSummary');
    const activeBookingSlot = document.getElementById('customerActiveBooking');
    const recentTrips = document.getElementById('customerRecentTrips');
    if (!summary || !activeBookingSlot || !recentTrips) return;
    const upcoming = customerBookings.filter(isUpcomingBooking);
    const quoted = customerBookings.filter(booking => String(booking.status).toLowerCase() === 'quoted').length;
    const completed = customerBookings.filter(booking => String(booking.status).toLowerCase() === 'completed').length;
    summary.replaceChildren(
        createSummaryCard('Total bookings', customerBookings.length),
        createSummaryCard('Upcoming / active', upcoming.length),
        createSummaryCard('Pending quotes', quoted),
        createSummaryCard('Past trips', completed)
    );

    const active = upcoming.sort((left, right) => String(left.pickup_date).localeCompare(String(right.pickup_date)))[0];
    activeBookingSlot.replaceChildren();
    if (active) {
        const card = document.createElement('article');
        card.className = 'portal-active-booking-card';
        const titleGroup = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = `Next trip · ${active.ref}`;
        const vehicle = document.createElement('p');
        vehicle.textContent = active.vehicle
            ? `${active.vehicle.make} ${active.vehicle.model} · ${active.vehicle.type || active.vehicleType}`
            : active.vehicleType || 'Vehicle details pending';
        const status = createStatusBadge(active.cancellationRequestedAt ? 'Cancellation Requested' : active.status);
        titleGroup.append(title, vehicle);
        const details = document.createElement('dl');
        details.className = 'portal-booking-details';
        [['Pickup', `${formatDate(active.pickup_date)} · ${active.pickup_time || '—'}`], ['Area', active.area || '—']]
            .forEach(([label, value]) => {
                const item = document.createElement('div');
                const term = document.createElement('dt');
                term.textContent = label;
                const description = document.createElement('dd');
                description.textContent = value;
                item.append(term, description);
                details.appendChild(item);
            });
        const open = document.createElement('a');
        const route = `/customer/bookings/${encodeURIComponent(active.ref)}`;
        open.className = 'portal-button portal-button-secondary';
        open.href = portalHref(route);
        open.textContent = 'View Booking';
        open.addEventListener('click', event => {
            event.preventDefault();
            navigateToRoute(route);
        });
        card.append(titleGroup, status, details, open);
        activeBookingSlot.appendChild(card);
    } else {
        const empty = document.createElement('div');
        empty.className = 'portal-empty-state';
        empty.textContent = 'You have no upcoming bookings.';
        activeBookingSlot.appendChild(empty);
    }

    recentTrips.replaceChildren();
    const recent = [...customerBookings].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 3);
    if (!recent.length) {
        recentTrips.textContent = 'Your trips will appear here after you submit a booking request.';
        return;
    }
    recent.forEach(booking => recentTrips.appendChild(createCustomerBookingCard(booking)));
}

async function loadCustomerBookings() {
    const { response, data } = await dashboardApiRequest('/customer/bookings');
    if (!response.ok) throw new Error(data.error || 'Unable to load your bookings.');
    if (!Array.isArray(data.bookings)) throw new Error('The booking service returned invalid data.');
    customerBookings = data.bookings;
    renderCustomerBookings();
    renderCustomerDashboard();
}

async function loadCustomerVehicles() {
    const { response, data } = await dashboardApiRequest('/customer/vehicles');
    if (!response.ok) throw new Error(data.error || 'Unable to load available vehicles.');
    if (!Array.isArray(data.vehicles)) throw new Error('The fleet service returned invalid data.');
    customerVehicles = data.vehicles;
    renderCustomerVehicleCards();
}

function renderCustomerVehicleCards() {
    const container = document.getElementById('availableVehicleCards');
    if (!container) return;
    container.replaceChildren();
    if (!customerVehicles.length) {
        const empty = document.createElement('div');
        empty.className = 'portal-empty-state';
        empty.textContent = 'There are no available approved vehicles right now.';
        container.appendChild(empty);
        return;
    }
    customerVehicles.forEach(vehicle => {
        const card = document.createElement('article');
        card.className = `portal-vehicle-card${selectedVehicleId === vehicle.id ? ' is-selected' : ''}`;
        const title = document.createElement('h2');
        title.textContent = `${vehicle.make} ${vehicle.model}`.trim();
        const details = document.createElement('p');
        details.textContent = [vehicle.year, vehicle.type, vehicle.seats ? `${vehicle.seats} seats` : '', vehicle.transmission, vehicle.fuelType]
            .filter(Boolean)
            .join(' · ');
        const rate = document.createElement('strong');
        rate.textContent = `${formatMoney(vehicle.dailyRate)} / day`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `portal-button ${selectedVehicleId === vehicle.id ? 'portal-button-primary' : 'portal-button-secondary'}`;
        button.setAttribute('aria-pressed', String(selectedVehicleId === vehicle.id));
        button.textContent = selectedVehicleId === vehicle.id ? 'Selected' : 'Select Vehicle';
        button.addEventListener('click', () => selectCustomerVehicle(vehicle.id));
        card.append(title, details, rate, button);
        container.appendChild(card);
    });
}

function selectCustomerVehicle(vehicleId) {
    selectedVehicleId = vehicleId;
    const vehicle = customerVehicles.find(item => item.id === vehicleId);
    const hiddenInput = document.getElementById('selectedVehicleId');
    if (hiddenInput) hiddenInput.value = vehicleId;
    const message = document.getElementById('selectedVehicleMessage');
    if (message) message.textContent = vehicle ? `Selected: ${vehicle.make} ${vehicle.model} · ${formatMoney(vehicle.dailyRate)} / day` : 'Select a vehicle above to continue.';
    renderCustomerVehicleCards();
}

function updateRentalTypeFields() {
    const withDriver = document.getElementById('customerRentalType')?.value === 'with-driver';
    const returnDate = document.getElementById('customerReturnDate');
    const returnTime = document.getElementById('customerReturnTime');
    if (returnDate) {
        returnDate.required = !withDriver;
        returnDate.disabled = withDriver;
        if (withDriver) returnDate.value = '';
    }
    if (returnTime) {
        returnTime.required = !withDriver;
        returnTime.disabled = withDriver;
        if (withDriver) returnTime.value = '';
    }
    document.getElementById('returnRequiredMark')?.classList.toggle('is-hidden', withDriver);
    document.getElementById('returnTimeRequiredMark')?.classList.toggle('is-hidden', withDriver);
}

async function submitCustomerBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!selectedVehicleId) {
        showPortalNotice('Select an available vehicle before submitting your booking.', 'error');
        return;
    }
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.passengers = payload.passengers || '';
    try {
        const { response, data } = await dashboardApiRequest('/customer/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to submit your booking.', 'error');
            return;
        }
        form.reset();
        selectedVehicleId = '';
        showPortalNotice('Booking request submitted. Admin will review availability and send your quote.');
        await loadCustomerBookings();
        if (data.booking?.ref) navigateToRoute(`/customer/bookings/${encodeURIComponent(data.booking.ref)}`);
    } catch (error) {
        console.error('Customer booking submission failed:', error);
        showPortalNotice('Unable to connect to the booking service. Please try again.', 'error');
    }
}

function appendDetailField(container, label, value) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || '—';
    item.append(term, description);
    container.appendChild(item);
}

function getCustomerQuoteBreakdown(quote) {
    const breakdown = quote?.breakdownDetails || {};
    const rows = [];
    const add = (label, amount, zeroLabel = '') => {
        const value = Number(amount);
        if (Number.isFinite(value) && value > 0) rows.push([label, formatMoney(value)]);
        else if (value === 0 && zeroLabel) rows.push([label, zeroLabel]);
    };
    if (String(quote?.rentalType || '').toLowerCase().includes('driver')) {
        const fuelCost = Number(breakdown.consumption) > 0
            ? (Number(breakdown.distance || 0) / Number(breakdown.consumption)) * Number(breakdown.fuelPrice || 0)
            : 0;
        add(`Rental rate (${formatMoney(breakdown.unitBase || 0)} × ${breakdown.driverDays || 0} day/s)`, Number(breakdown.unitBase || 0) * Number(breakdown.driverDays || 0));
        if (Number(breakdown.driverOtHours) > 0) {
            add(`Overtime (${formatMoney(breakdown.overtime || 0)} × ${breakdown.driverOtHours} hr/s)`, Number(breakdown.overtime || 0) * Number(breakdown.driverOtHours));
        }
        add('Calculated fuel cost', fuelCost);
        add('Toll fees', breakdown.tollFees);
        add('Parking fees', breakdown.parkingFees);
        add("Driver's fee", breakdown.driverFee);
        add('Meals', breakdown.meals);
        add('Lodging / accommodation', breakdown.lodging);
        add('Miscellaneous expenses', breakdown.misc);
    } else {
        add(`Rental rate (${formatMoney(breakdown.unitBase || 0)} × ${breakdown.days || 0} day/s)`, Number(breakdown.unitBase || 0) * Number(breakdown.days || 0));
        if (Number(breakdown.selfOtHours) > 0) {
            add(`Overtime (${formatMoney(breakdown.overtime || 0)} × ${breakdown.selfOtHours} hr/s)`, Number(breakdown.overtime || 0) * Number(breakdown.selfOtHours));
        }
        add('Delivery fee', breakdown.delivery, 'Free');
        add('Return fee', breakdown.return, 'Free');
        add('Child seat fee', breakdown.childSeat);
    }
    return rows;
}

function renderCustomerBookingDetails(booking) {
    const container = document.getElementById('customerBookingDetails');
    if (!container) return;
    document.getElementById('customerBookingTitle').textContent = `Booking ${booking.ref}`;
    container.replaceChildren();

    const card = document.createElement('section');
    card.className = 'portal-card portal-booking-detail-card';
    const heading = document.createElement('div');
    heading.className = 'portal-card-heading';
    const title = document.createElement('h2');
    title.textContent = booking.vehicle
        ? `${booking.vehicle.make} ${booking.vehicle.model}`.trim()
        : booking.vehicleType || 'Vehicle request';
    heading.append(title, createStatusBadge(booking.cancellationRequestedAt ? 'Cancellation Requested' : booking.status));
    const details = document.createElement('dl');
    details.className = 'portal-booking-details';
    [
        ['Booking Ref', booking.ref],
        ['Pickup date & time', `${formatDate(booking.pickup_date)} · ${booking.pickup_time || '—'}`],
        ['Pickup area', booking.pickup_address || booking.area],
        ['Pickup address', booking.pickup_location_address || '—'],
        ['Return date & time', `${formatDate(booking.return_date)} · ${booking.return_time || '—'}`],
        ['Return area', booking.return_address || '—'],
        ['Return address', booking.return_location_address || '—'],
        ['Rental type', booking.rentalType],
        ['Vehicle', title.textContent],
        ['Passengers', booking.passengers],
        ['Itinerary', booking.itinerary]
    ].forEach(([label, value]) => appendDetailField(details, label, value));
    card.append(heading, details);

    const quoteCard = document.createElement('section');
    quoteCard.className = 'portal-card portal-booking-detail-card portal-spaced-form';
    const quoteHeading = document.createElement('h2');
    quoteHeading.textContent = 'Pricing';
    quoteCard.appendChild(quoteHeading);
    if (booking.quote) {
        const total = document.createElement('p');
        total.className = 'portal-quote-total';
        total.textContent = `Quoted total: ${formatMoney(booking.quote.totalAmount)}`;
        quoteCard.appendChild(total);
        const lineItems = getCustomerQuoteBreakdown(booking.quote);
        if (lineItems.length) {
            const inputList = document.createElement('dl');
            inputList.className = 'portal-booking-details portal-quote-inputs';
            lineItems.forEach(([label, value]) => appendDetailField(inputList, label, value));
            quoteCard.appendChild(inputList);
        }
        const inclusions = (booking.quote.inclusionsList || []).join(', ');
        const exclusions = (booking.quote.exclusionsList || []).join(', ');
        if (inclusions || exclusions) {
            const lists = document.createElement('dl');
            lists.className = 'portal-booking-details';
            if (inclusions) appendDetailField(lists, 'Inclusions', inclusions);
            if (exclusions) appendDetailField(lists, 'Exclusions', exclusions);
            quoteCard.appendChild(lists);
        }
    } else {
        const note = document.createElement('p');
        note.className = 'portal-muted-note';
        note.textContent = 'Your quote has not been prepared yet.';
        quoteCard.appendChild(note);
    }
    container.append(card, quoteCard);

    const status = String(booking.status || '').toLowerCase();
    document.getElementById('approveCustomerQuote').hidden = status !== 'quoted' || !booking.quote;
    document.getElementById('requestCustomerCancellation').hidden =
        isCancelledOrCompleted(booking) || Boolean(booking.cancellationRequestedAt);
    document.getElementById('paymentProofForm').hidden =
        !['customer approved', 'pending payment'].includes(status);
    const proofForm = document.getElementById('paymentProofForm');
    proofForm.querySelector('.payment-proof-note')?.remove();
    if (Array.isArray(booking.paymentProofs) && booking.paymentProofs.length) {
        const proofNote = document.createElement('p');
        proofNote.className = 'portal-muted-note payment-proof-note';
        proofNote.textContent = `Payment proof uploaded: ${booking.paymentProofs.map(proof => proof.originalName || 'file').join(', ')}`;
        proofForm.prepend(proofNote);
    }
}

async function loadCustomerBookingDetails(ref) {
    const container = document.getElementById('customerBookingDetails');
    container.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'portal-empty-state';
    loading.textContent = 'Loading booking details…';
    container.appendChild(loading);
    try {
        const { response, data } = await dashboardApiRequest(`/customer/bookings/${encodeURIComponent(ref)}`);
        if (!response.ok) throw new Error(data.error || 'Booking could not be found.');
        currentCustomerBooking = data.booking;
        renderCustomerBookingDetails(data.booking);
    } catch (error) {
        console.error('Customer booking details failed to load:', error);
        container.replaceChildren();
        const message = document.createElement('div');
        message.className = 'portal-empty-state';
        message.textContent = error.message || 'Booking details could not be loaded.';
        container.appendChild(message);
    }
}

async function updateCustomerBooking(action) {
    if (!currentCustomerBooking) return;
    if (action === 'request-cancellation' && !window.confirm('Send a cancellation request to Admin?')) return;
    try {
        const { response, data } = await dashboardApiRequest(`/customer/bookings/${encodeURIComponent(currentCustomerBooking.ref)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to update this booking.', 'error');
            return;
        }
        showPortalNotice(action === 'approve-quote' ? 'Quote approved. Admin will confirm the booking.' : 'Cancellation request sent to Admin.');
        await loadCustomerBookings();
        await loadCustomerBookingDetails(currentCustomerBooking.ref);
    } catch (error) {
        console.error('Customer booking action failed:', error);
        showPortalNotice('Unable to connect to the booking service.', 'error');
    }
}

async function uploadPaymentProof(event) {
    event.preventDefault();
    if (!currentCustomerBooking) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
        const { response, data } = await dashboardApiRequest(
            `/customer/bookings/${encodeURIComponent(currentCustomerBooking.ref)}/payment-proof`,
            { method: 'POST', body: new FormData(form) }
        );
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to upload payment proof.', 'error');
            return;
        }
        form.reset();
        showPortalNotice('Payment proof uploaded securely.');
        await loadCustomerBookings();
        await loadCustomerBookingDetails(currentCustomerBooking.ref);
    } catch (error) {
        console.error('Payment proof upload failed:', error);
        showPortalNotice('Unable to connect to the payment upload service.', 'error');
    }
}

function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value || '—';
    row.appendChild(cell);
    return cell;
}

function setAffiliateVehicleTab(tabName, focusTab = false) {
    document.querySelectorAll('#affiliateVehicleTabs [data-vehicle-tab]').forEach(tab => {
        const active = tab.dataset.vehicleTab === tabName;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focusTab) tab.focus();
    });
    document.querySelectorAll('#vehicleRequestForm [data-vehicle-tab-panel]').forEach(panel => {
        panel.hidden = panel.dataset.vehicleTabPanel !== tabName;
    });
}

function normalizeAffiliateVehicleFiles(files) {
    return (Array.isArray(files) ? files : [])
        .map(file => typeof file === 'string' ? { filename: file, originalName: file } : file)
        .filter(file => file && typeof file.filename === 'string');
}

function renderAffiliateVehicleUploads() {
    Object.keys(affiliateVehicleUploadTypes).forEach(kind => {
        const titleCase = kind[0].toUpperCase() + kind.slice(1);
        const list = document.getElementById(`affiliate${titleCase}List`);
        const count = document.getElementById(`affiliate${titleCase}Count`);
        if (!list) return;

        const existing = affiliateVehicleExistingFiles[kind] || [];
        const selected = affiliateVehicleSelectedFiles[kind] || [];
        if (count) count.textContent = `${existing.length + selected.length}/${affiliateVehicleUploadLimit}`;
        list.replaceChildren();

        existing.forEach(file => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = file.originalName || file.originalname || file.filename;
            const open = document.createElement('button');
            open.type = 'button';
            open.textContent = 'View';
            open.dataset.viewVehicleFile = file.category || kind;
            open.dataset.filename = file.filename;
            row.append(name, open);
            list.appendChild(row);
        });

        selected.forEach((file, index) => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            const size = file.size < 1024 * 1024
                ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
            name.textContent = `${file.name} (${size})`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Remove';
            remove.dataset.removeUpload = kind;
            remove.dataset.fileIndex = String(index);
            row.append(name, remove);
            list.appendChild(row);
        });
    });
}

function resetAffiliateVehicleUploads(vehicle = null) {
    affiliateVehicleSelectedFiles = { documents: [], exteriorPhotos: [], interiorPhotos: [] };
    affiliateVehicleExistingFiles = {
        documents: normalizeAffiliateVehicleFiles(vehicle?.documents),
        exteriorPhotos: normalizeAffiliateVehicleFiles(vehicle?.exteriorPhotos),
        interiorPhotos: normalizeAffiliateVehicleFiles(vehicle?.interiorPhotos)
    };
    if (vehicle?.photo && typeof vehicle.photo === 'string') {
        affiliateVehicleExistingFiles.exteriorPhotos.unshift({
            filename: vehicle.photo,
            originalName: 'Vehicle photo',
            category: 'photo'
        });
    }
    Object.values(affiliateVehicleUploadInputIds).forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    renderAffiliateVehicleUploads();
}

function addAffiliateVehicleFiles(kind, files) {
    if (!affiliateVehicleUploadTypes[kind]) return;
    const accepted = [];
    let unsupported = false;
    let oversized = false;
    for (const file of files) {
        if (!affiliateVehicleUploadTypes[kind].includes(file.type)) unsupported = true;
        else if (file.size > affiliateVehicleUploadMaxBytes) oversized = true;
        else accepted.push(file);
    }
    const remaining = Math.max(
        0,
        affiliateVehicleUploadLimit -
            affiliateVehicleExistingFiles[kind].length -
            affiliateVehicleSelectedFiles[kind].length
    );
    affiliateVehicleSelectedFiles[kind].push(...accepted.slice(0, remaining));
    renderAffiliateVehicleUploads();

    const messages = [];
    if (unsupported) messages.push('Unsupported file type');
    if (oversized) messages.push('Files must be 5 MB or smaller');
    if (accepted.length > remaining) messages.push(`Only ${affiliateVehicleUploadLimit} files can be attached in this section`);
    if (messages.length) showPortalNotice(`${messages.join('. ')}. Some files were not added.`, 'error');
}

function configureAffiliateVehicleForm(route) {
    const form = document.getElementById('vehicleRequestForm');
    if (!form) return;
    const editMatch = route.match(/^\/affiliate\/vehicles\/([^/]+)\/edit$/);
    const vehicleId = editMatch ? decodeURIComponent(editMatch[1]) : '';
    const vehicle = vehicleId ? affiliateVehicles.find(item => item.id === vehicleId) : null;
    const pendingUpdate = vehicleId && affiliateRequests.some(request =>
        request.vehicleId === vehicleId && request.status === 'Pending'
    );
    if (vehicleId && (!vehicle || pendingUpdate)) {
        showPortalNotice(pendingUpdate
            ? 'An edit for this vehicle is already waiting for Admin approval.'
            : 'Vehicle not found in your account.', 'error');
        navigateToRoute('/affiliate/vehicles');
        return;
    }

    form.reset();
    form.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
    const error = document.getElementById('affiliateVehicleFormError');
    if (error) {
        error.hidden = true;
        error.textContent = '';
    }
    setAffiliateVehicleTab('details');
    resetAffiliateVehicleUploads(vehicle);
    const title = document.getElementById('affiliateVehicleFormTitle');
    const subtitle = document.getElementById('affiliateVehicleFormSubtitle');
    const saveButton = document.getElementById('affiliateVehicleSaveButton');
    const idField = document.getElementById('affiliateVehicleId');
    if (idField) idField.value = vehicle?.id || '';
    if (title) title.textContent = vehicle ? 'Edit Vehicle' : 'Submit New Vehicle';
    if (subtitle) {
        subtitle.textContent = vehicle
            ? 'Your changes will be sent to Admin for approval before updating the fleet.'
            : 'Vehicle details and documents are sent to the Admin Fleet Approvals queue.';
    }
    if (saveButton) saveButton.textContent = vehicle ? 'Submit Changes for Approval' : 'Submit for Approval';

    if (vehicle) {
        const values = {
            plate: vehicle.plate,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            type: vehicle.type,
            color: vehicle.color,
            seats: vehicle.seats,
            transmission: vehicle.transmission,
            fuelType: vehicle.fuelType,
            dailyRate: vehicle.dailyRate,
            orCrExpiryDate: vehicle.orCrExpiryDate || '',
            insuranceProvider: vehicle.insuranceProvider || '',
            insurancePolicyNumber: vehicle.insurancePolicyNumber || '',
            insuranceExpiryDate: vehicle.insuranceExpiryDate || '',
            odometerReading: vehicle.odometerReading ?? '',
            nextPmsDate: vehicle.nextPmsDate || '',
            gpsTrackerId: vehicle.gpsTrackerId || ''
        };
        Object.entries(values).forEach(([name, value]) => {
            const field = form.elements.namedItem(name);
            if (field) field.value = value;
        });
    }
}

function validateAffiliateVehicleForm(form) {
    form.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
    const invalidFields = Array.from(form.querySelectorAll('input, select, textarea'))
        .filter(control => control.willValidate && !control.validity.valid);
    if (!invalidFields.length) return true;

    invalidFields.forEach(control => control.setAttribute('aria-invalid', 'true'));
    const invalidField = invalidFields[0];
    const panel = invalidField.closest('[data-vehicle-tab-panel]');
    if (panel) setAffiliateVehicleTab(panel.dataset.vehicleTabPanel);
    const error = document.getElementById('affiliateVehicleFormError');
    if (error) {
        error.textContent = 'Please complete the highlighted fields before submitting.';
        error.hidden = false;
    }
    invalidField.focus();
    invalidField.reportValidity();
    return false;
}

async function openAffiliateVehicleFile(vehicleId, category, filename) {
    await openPrivateFile(
        `/vehicles/${encodeURIComponent(vehicleId)}/files/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`
    );
}

function renderAffiliateVehicleRows() {
    const tbody = document.getElementById('affiliateVehiclesBody');
    if (!tbody) return;
    tbody.replaceChildren();
    const pendingVehicleEdits = new Set(affiliateRequests
        .filter(request => request.vehicleId && request.status === 'Pending')
        .map(request => request.vehicleId));
    const rows = [
        ...affiliateVehicles.map(vehicle => ({
            ...vehicle,
            isApprovedVehicle: true,
            hasPendingEdit: pendingVehicleEdits.has(vehicle.id),
            displayStatus: String(vehicle.status).toLowerCase() === 'maintenance'
                ? 'In Maintenance'
                : 'Approved / Active',
            reviewNote: ''
        })),
        ...affiliateRequests
            .filter(request => request.status !== 'Approved')
            .map(request => ({
                ...request,
                displayStatus: request.status === 'Pending'
                    ? (request.vehicleId ? 'Update Pending Approval' : 'Pending Approval')
                    : request.status
            }))
    ];
    if (!rows.length) {
        setTableEmptyState(tbody, 7, 'No vehicles or submissions yet. Submit a vehicle to get started.');
        return;
    }
    rows.forEach(vehicle => {
        const row = document.createElement('tr');
        appendCell(row, `${vehicle.make || ''} ${vehicle.model || ''}`.trim());
        appendCell(row, vehicle.plate);
        appendCell(row, [vehicle.year, vehicle.type, vehicle.seats ? `${vehicle.seats} seats` : '', vehicle.transmission, vehicle.fuelType]
            .filter(Boolean)
            .join(' · '));
        const status = row.insertCell();
        status.appendChild(createStatusBadge(vehicle.displayStatus || vehicle.status));
        appendCell(row, vehicle.dailyRate === undefined ? '—' : formatMoney(vehicle.dailyRate));
        appendCell(row, vehicle.reviewNote || '—');
        const actions = row.insertCell();
        if (vehicle.isApprovedVehicle && vehicle.hasPendingEdit) {
            const pending = document.createElement('button');
            pending.type = 'button';
            pending.className = 'portal-button portal-button-secondary portal-table-action';
            pending.textContent = 'Pending';
            pending.disabled = true;
            actions.appendChild(pending);
        } else if (vehicle.isApprovedVehicle) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'portal-button portal-button-secondary portal-table-action';
            edit.textContent = 'Edit';
            edit.dataset.editAffiliateVehicle = vehicle.id;
            actions.appendChild(edit);
        } else {
            actions.textContent = '—';
        }
        tbody.appendChild(row);
    });
    tbody.onclick = event => {
        const button = event.target.closest('button[data-edit-affiliate-vehicle]');
        if (!button) return;
        navigateToRoute(`/affiliate/vehicles/${encodeURIComponent(button.dataset.editAffiliateVehicle)}/edit`);
    };
}

function renderAffiliateBookingsRows(targetId, bookings) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;
    tbody.replaceChildren();
    if (!bookings.length) {
        setTableEmptyState(tbody, 6, 'Assigned vehicle bookings will appear here. Earnings begin after a saved quote and completed trip.');
        return;
    }
    bookings.forEach(booking => {
        const row = document.createElement('tr');
        appendCell(row, booking.ref);
        appendCell(row, `${formatDate(booking.pickup_date)} – ${formatDate(booking.return_date)}`);
        appendCell(row, [booking.pickup_address || booking.area, booking.return_address].filter(Boolean).join(' → '));
        appendCell(row, `${booking.vehicle?.make || ''} ${booking.vehicle?.model || ''} · ${booking.vehicle?.plate || ''}`);
        row.insertCell().appendChild(createStatusBadge(booking.status));
        appendCell(row, String(booking.status).toLowerCase() === 'completed' && booking.hasFinalQuote
            ? formatMoney(booking.affiliateShare)
            : '—');
        tbody.appendChild(row);
    });
}

function renderAffiliateRequests() {
    const list = document.getElementById('affiliateRecentRequests');
    if (!list) return;
    list.replaceChildren();
    if (!affiliateRequests.length) {
        list.textContent = 'No vehicle submissions yet.';
        return;
    }
    affiliateRequests.slice(-3).reverse().forEach(request => {
        const item = document.createElement('div');
        item.className = 'portal-compact-item';
        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${request.make || ''} ${request.model || ''}`.trim() || request.plate || 'Vehicle';
        const subtitle = document.createElement('small');
        subtitle.textContent = `${request.isVehicleUpdate ? 'Change request · ' : ''}${formatDateTime(request.submittedAt)}${request.reviewNote ? ` · ${request.reviewNote}` : ''}`;
        text.append(title, subtitle);
        item.append(text, createStatusBadge(request.status === 'Pending' ? 'Pending Approval' : request.status));
        list.appendChild(item);
    });
}

function renderAffiliateEarnings() {
    const summary = document.getElementById('affiliateEarningsSummary');
    const tbody = document.getElementById('affiliatePayoutsBody');
    const earningRows = document.getElementById('affiliateEarningsRows');
    if (!summary || !affiliateEarnings) return;
    const earnings = affiliateEarnings;
    summary.replaceChildren(
        createSummaryCard('Total completed-trip earnings', formatMoney(earnings.totalEarnings)),
        createSummaryCard('Payout balance', formatMoney(earnings.payoutBalance)),
        createSummaryCard('Available to request', formatMoney(earnings.availableToRequest)),
        createSummaryCard('Affiliate share', `${earnings.sharePercent}%`)
    );
    if (earningRows) {
        earningRows.replaceChildren();
        const completedBookings = affiliateBookings.filter(booking =>
            String(booking.status).toLowerCase() === 'completed'
        );
        if (!completedBookings.length) {
            setTableEmptyState(earningRows, 4, 'Completed trip earnings will appear here after Admin marks an assigned booking complete and saves its quote.');
        } else {
            completedBookings.forEach(booking => {
                const row = document.createElement('tr');
                appendCell(row, booking.ref);
                appendCell(row, `${formatDate(booking.pickup_date)} – ${formatDate(booking.return_date)}`);
                appendCell(row, `${booking.vehicle?.make || ''} ${booking.vehicle?.model || ''} · ${booking.vehicle?.plate || ''}`);
                appendCell(row, booking.hasFinalQuote ? formatMoney(booking.affiliateShare) : 'Awaiting saved quote');
                earningRows.appendChild(row);
            });
        }
    }
    if (!tbody) return;
    tbody.replaceChildren();
    if (!earnings.requests.length) {
        setTableEmptyState(tbody, 4, 'No payout requests yet.');
        return;
    }
    earnings.requests.slice().reverse().forEach(request => {
        const row = document.createElement('tr');
        appendCell(row, formatDateTime(request.requestedAt));
        appendCell(row, formatMoney(request.amount));
        const status = row.insertCell();
        status.appendChild(createStatusBadge(request.status));
        appendCell(row, request.reviewNote || (request.paidAt ? `Paid ${formatDateTime(request.paidAt)}` : '—'));
        tbody.appendChild(row);
    });
}

async function loadAffiliateData() {
    const results = await Promise.all([
        dashboardApiRequest('/affiliate/dashboard'),
        dashboardApiRequest('/vehicles'),
        dashboardApiRequest('/vehicle-approval-requests'),
        dashboardApiRequest('/affiliate/bookings'),
        dashboardApiRequest('/affiliate/earnings')
    ]);
    const [dashboardResult, vehiclesResult, requestsResult, bookingsResult, earningsResult] = results;
    for (const result of results) {
        if (!result.response.ok) throw new Error(result.data.error || 'Unable to load affiliate data.');
    }
    affiliateVehicles = vehiclesResult.data.vehicles;
    affiliateRequests = requestsResult.data.requests;
    affiliateBookings = bookingsResult.data.bookings;
    affiliateEarnings = earningsResult.data.earnings;
    const summary = dashboardResult.data.summary;
    document.getElementById('affiliateSummary').replaceChildren(
        createSummaryCard('Active vehicles', summary.activeVehicles),
        createSummaryCard('Pending vehicle approvals', summary.pendingVehicleApprovals),
        createSummaryCard('Bookings completed', summary.completedBookings),
        createSummaryCard('Payout balance', formatMoney(summary.payoutBalance))
    );
    renderAffiliateVehicleRows();
    renderAffiliateBookingsRows('affiliateBookingsBody', affiliateBookings);
    renderAffiliateBookingsRows('affiliateRecentBookingsBody', dashboardResult.data.recentBookings);
    renderAffiliateRequests();
    renderAffiliateEarnings();
}

async function submitVehicleRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateAffiliateVehicleForm(form)) return;
    const saveButton = document.getElementById('affiliateVehicleSaveButton');
    if (saveButton) saveButton.disabled = true;
    try {
        const formData = new FormData(form);
        Object.entries(affiliateVehicleSelectedFiles).forEach(([kind, files]) => {
            files.forEach(file => formData.append(kind, file));
        });
        const isEdit = Boolean(document.getElementById('affiliateVehicleId')?.value);
        const { response, data } = await dashboardApiRequest('/vehicle-approval-requests', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to submit this vehicle.', 'error');
            return;
        }
        form.reset();
        resetAffiliateVehicleUploads();
        showPortalNotice(isEdit
            ? 'Vehicle changes submitted to Admin for approval.'
            : 'Vehicle and documents submitted to Admin for approval.');
        await loadAffiliateData();
        navigateToRoute('/affiliate/vehicles');
    } catch (error) {
        console.error('Vehicle submission failed:', error);
        showPortalNotice(error.message || 'Unable to connect to the vehicle approval service.', 'error');
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

async function requestAffiliatePayout() {
    if (!window.confirm('Submit all available completed-trip earnings for payout review?')) return;
    try {
        const { response, data } = await dashboardApiRequest('/affiliate/payout-requests', { method: 'POST' });
        if (!response.ok) {
            showPortalNotice(data.error || 'Unable to submit a payout request.', 'error');
            return;
        }
        showPortalNotice('Payout request submitted to Admin for review.');
        await loadAffiliateData();
    } catch (error) {
        console.error('Payout request failed:', error);
        showPortalNotice('Unable to connect to the payout service.', 'error');
    }
}

function bindAffiliateVehicleFormEvents() {
    const form = document.getElementById('vehicleRequestForm');
    if (!form) return;

    form.addEventListener('submit', submitVehicleRequest);
    form.addEventListener('input', event => {
        const control = event.target;
        if (control?.validity?.valid) control.removeAttribute('aria-invalid');
        if (form.checkValidity()) {
            const error = document.getElementById('affiliateVehicleFormError');
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
        }
    });
    form.addEventListener('change', event => {
        const control = event.target;
        if (control?.validity?.valid) control.removeAttribute('aria-invalid');
        if (form.checkValidity()) {
            const error = document.getElementById('affiliateVehicleFormError');
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
        }
    });
    form.addEventListener('click', event => {
        const remove = event.target.closest('button[data-remove-upload]');
        if (remove) {
            const kind = remove.dataset.removeUpload;
            affiliateVehicleSelectedFiles[kind]?.splice(Number(remove.dataset.fileIndex), 1);
            renderAffiliateVehicleUploads();
            return;
        }
        const view = event.target.closest('button[data-view-vehicle-file]');
        if (view) {
            const vehicleId = document.getElementById('affiliateVehicleId')?.value;
            if (vehicleId) openAffiliateVehicleFile(vehicleId, view.dataset.viewVehicleFile, view.dataset.filename);
        }
    });

    const tabs = Array.from(document.querySelectorAll('#affiliateVehicleTabs [data-vehicle-tab]'));
    tabs.forEach(tab => tab.addEventListener('click', () => setAffiliateVehicleTab(tab.dataset.vehicleTab)));
    document.getElementById('affiliateVehicleTabs')?.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const activeIndex = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? tabs.length - 1
                : (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setAffiliateVehicleTab(tabs[nextIndex].dataset.vehicleTab, true);
    });

    Object.entries(affiliateVehicleUploadInputIds).forEach(([kind, id]) => {
        document.getElementById(id)?.addEventListener('change', event => {
            addAffiliateVehicleFiles(kind, Array.from(event.currentTarget.files || []));
            event.currentTarget.value = '';
        });
    });
    document.querySelectorAll('#vehicleRequestForm .portal-upload-dropzone').forEach(dropzone => {
        dropzone.addEventListener('dragover', event => {
            event.preventDefault();
            dropzone.classList.add('is-dragging');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
        dropzone.addEventListener('drop', event => {
            event.preventDefault();
            dropzone.classList.remove('is-dragging');
            addAffiliateVehicleFiles(dropzone.dataset.vehicleUploadType, Array.from(event.dataTransfer?.files || []));
        });
    });
}

function bindPortalEvents() {
    bindPortalNavigation();
    document.getElementById('profileForm')?.addEventListener('submit', savePortalProfile);
    document.getElementById('passwordForm')?.addEventListener('submit', changePortalPassword);
    bindAffiliateVehicleFormEvents();
    document.getElementById('refreshCustomerBookings')?.addEventListener('click', () => {
        loadCustomerBookings().catch(error => {
            console.error('Customer booking refresh failed:', error);
            showPortalNotice('Unable to refresh your bookings.', 'error');
        });
    });
    document.getElementById('customerBookingForm')?.addEventListener('submit', submitCustomerBooking);
    document.getElementById('customerRentalType')?.addEventListener('change', updateRentalTypeFields);
    document.getElementById('customerDocumentsForm')?.addEventListener('submit', uploadCustomerDocuments);
    document.getElementById('paymentProofForm')?.addEventListener('submit', uploadPaymentProof);
    document.getElementById('approveCustomerQuote')?.addEventListener('click', () => updateCustomerBooking('approve-quote'));
    document.getElementById('requestCustomerCancellation')?.addEventListener('click', () => updateCustomerBooking('request-cancellation'));
    document.getElementById('requestAffiliatePayout')?.addEventListener('click', requestAffiliatePayout);
    document.querySelectorAll('[data-booking-filter]').forEach(button => {
        button.addEventListener('click', () => {
            currentBookingFilter = button.dataset.bookingFilter;
            document.querySelectorAll('[data-booking-filter]').forEach(tab => {
                const active = tab === button;
                tab.classList.toggle('is-active', active);
                tab.setAttribute('aria-selected', String(active));
            });
            renderCustomerBookings();
        });
    });
    window.addEventListener('popstate', loadPortalRoute);
    window.addEventListener('hashchange', loadPortalRoute);
}

async function loadPortalRoute() {
    const route = currentPortalRoute();
    const isRoleRoute = route === portalPrefix || route.startsWith(`${portalPrefix}/`);
    if (!isRoleRoute) {
        navigateToRoute(`${portalPrefix}/dashboard`, true);
        return;
    }
    let viewName = routeView(route);
    if (requiredDashboardRole === 'affiliate' && !['dashboard', 'vehicles', 'vehicle-new', 'bookings', 'earnings', 'settings'].includes(viewName)) {
        navigateToRoute('/affiliate/dashboard', true);
        return;
    }
    if (requiredDashboardRole === 'customer' && !['dashboard', 'bookings', 'booking-detail', 'book', 'profile'].includes(viewName)) {
        navigateToRoute('/customer/dashboard', true);
        return;
    }
    if (requiredDashboardRole === 'affiliate' && viewName === 'vehicles' && route.endsWith('/new')) viewName = 'vehicle-new';
    setPortalView(viewName);
    try {
        if (requiredDashboardRole === 'customer') {
            await loadCustomerBookings();
            if (viewName === 'book' && !customerVehicles.length) await loadCustomerVehicles();
            if (viewName === 'booking-detail') {
                const ref = decodeURIComponent(route.split('/')[3] || '');
                if (!ref) throw new Error('Booking reference is missing.');
                await loadCustomerBookingDetails(ref);
            }
        } else {
            await loadAffiliateData();
            if (viewName === 'vehicle-new') configureAffiliateVehicleForm(route);
        }
    } catch (error) {
        console.error('Portal view data failed to load:', error);
        showPortalNotice(error.message || 'Unable to load portal data. Please try again.', 'error');
    }
}

async function initializePortalDashboard() {
    bindPortalEvents();
    updateRentalTypeFields();
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
        const route = currentPortalRoute();
        if (route === portalPrefix || route === `${portalPrefix}/`) {
            navigateToRoute(`${portalPrefix}/dashboard`, true);
            return;
        }
        await loadPortalRoute();
    } catch (error) {
        console.error('Dashboard access verification failed:', error);
        showPortalAccessMessage('We could not verify your account with the server. Check your connection and try again.');
    }
}

document.addEventListener('DOMContentLoaded', initializePortalDashboard);
