require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const { sendBookingNotification } = require('./notifications');
const { autoCancelPastQuotedBookings } = require('./booking-cleanup');
const { appendActivityEvent, getRecentActivity } = require('./activity-log');
const { buildOperationalReport, isValidReportDate } = require('./operational-reports');
const {
    normalizeVehicleSubmission,
    normalizeVehicleMetadata,
    createApprovedVehicle,
    updateApprovedVehicle
} = require('./vehicle-approvals');
const { getCustomerBookings } = require('./customer-dashboard');
const {
    AFFILIATE_SHARE_PERCENT,
    getAffiliateBookings,
    getAffiliateEarnings
} = require('./affiliate-dashboard');
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const QUOTED_BOOKING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

app.use(cors());
app.use(express.json());

const DEBUG = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const DEFAULT_TEAM_EMAIL = 'mayonrentacar@gmail.com';

function parseEmailList(input) {
    return String(input || '')
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
}

function dedupeEmails(emails) {
    const seen = new Set();
    return emails.filter((email) => {
        const key = String(email).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getQuotationCcRecipients(clientEmail) {
    const envCcList = parseEmailList(process.env.QUOTATION_CC_EMAILS);
    const fallback = process.env.GMAIL_USER ? [process.env.GMAIL_USER] : [];
    const ccList = [...envCcList, ...fallback, DEFAULT_TEAM_EMAIL];
    const blocked = String(clientEmail || '').trim().toLowerCase();

    return dedupeEmails(ccList).filter((email) => String(email).toLowerCase() !== blocked);
}

// Polyfill fetch for Node versions that don't have global fetch (use node-fetch v2 for CommonJS)
if (typeof fetch === 'undefined') {
    try {
        // node-fetch v2 supports CommonJS require
        global.fetch = require('node-fetch');
        if (DEBUG) console.log('Fetch polyfilled using node-fetch');
    } catch (err) {
        if (DEBUG) console.warn('node-fetch not available; fetch requests may fail in this Node version');
    }
}

// ========================================================
// RATE LIMITING
// ========================================================

// General API limiter — max 100 requests per 15 min per IP
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' }
});

// Booking submission — max 5 bookings per 15 min per IP (stops bots spamming)
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many booking requests. Please wait 15 minutes before trying again.' }
});

// Login — max 10 attempts per 15 min per IP in production; higher limit in development
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 10 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: isProduction ? 'Too many login attempts. Please wait 15 minutes.' : 'Too many login attempts. Please wait a moment and try again.' }
});

const passwordRecoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many recovery requests. Please wait 15 minutes before trying again.' }
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many password reset attempts. Please wait 15 minutes before trying again.' }
});

// Apply general limiter to all /api routes but exempt specific admin endpoints (e.g. login)
// This keeps customer-facing protections while allowing admin/workflow endpoints to avoid accidental blocks.
app.use('/api', (req, res, next) => {
    // Paths to exempt from the general limiter (server-side pathnames under /api)
    const exemptPaths = [
        '/users/login', // admin login endpoint
        '/users/forgot-password',
        '/users/verify-recovery-code',
        '/users/reset-password',
        '/users', // user management (POST/PUT/DELETE) performed by admins
        '/vehicles', // admin vehicle management
        '/bookings', // admin booking management (list, edit, delete)
        '/quotes' // admin quotes management
    ];

    const matchedExempt = exemptPaths.some(p => req.path.startsWith(p));
    if (matchedExempt) return next();

    // Otherwise apply general limiter
    return generalLimiter(req, res, next);
});

const FILE_PATH = path.join(__dirname, 'bookings.json');
const USERS_FILE_PATH = path.join(__dirname, 'users.json');
const VEHICLES_FILE_PATH = path.join(__dirname, 'vehicles.json');
const VEHICLE_APPROVAL_REQUESTS_FILE_PATH = path.join(__dirname, 'vehicle-approval-requests.json');
const QUOTES_FILE_PATH = path.join(__dirname, 'quotes.json');
const RATES_FILE_PATH = path.join(__dirname, 'rates.json');
const AFFILIATE_PAYOUT_REQUESTS_FILE_PATH = path.join(__dirname, 'affiliate-payout-requests.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ========================================================
// USER FILE UPLOADS (profile photo + supporting documents)
// ========================================================
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const USER_PHOTOS_DIR = path.join(UPLOADS_DIR, 'user-photos');
const USER_DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'user-documents');
const VEHICLE_PHOTOS_DIR = path.join(UPLOADS_DIR, 'vehicle-photos');
const VEHICLE_DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'vehicle-documents');
[UPLOADS_DIR, USER_PHOTOS_DIR, USER_DOCUMENTS_DIR, VEHICLE_PHOTOS_DIR, VEHICLE_DOCUMENTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

// Store with random names on disk — never trust/replay the client-supplied filename.
const userUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, file.fieldname === 'photo' ? USER_PHOTOS_DIR : USER_DOCUMENTS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${ALLOWED_UPLOAD_EXTENSIONS.includes(ext) ? ext : ''}`);
    }
});

const userUpload = multer({
    storage: userUploadStorage,
    limits: { fileSize: 5 * 1024 * 1024, files: 11 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = file.fieldname === 'photo' ? ALLOWED_PHOTO_TYPES : ALLOWED_DOCUMENT_TYPES;
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedTypes.includes(file.mimetype) || !ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
            return cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF.'));
        }
        cb(null, true);
    }
});

const handleUserUploads = (req, res, next) => {
    userUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'documents', maxCount: 10 }])(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message || 'File upload failed' });
        next();
    });
};

const vehicleUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, file.fieldname === 'documents' ? VEHICLE_DOCUMENTS_DIR : VEHICLE_PHOTOS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${ALLOWED_UPLOAD_EXTENSIONS.includes(ext) ? ext : ''}`);
    }
});

const vehicleUpload = multer({
    storage: vehicleUploadStorage,
    limits: { fileSize: 5 * 1024 * 1024, files: 31 },
    fileFilter: (req, file, cb) => {
        const isPhoto = ['photo', 'exteriorPhotos', 'interiorPhotos'].includes(file.fieldname);
        const allowedTypes = isPhoto ? ALLOWED_PHOTO_TYPES : ALLOWED_DOCUMENT_TYPES;
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedTypes.includes(file.mimetype) || !ALLOWED_UPLOAD_EXTENSIONS.includes(ext) ||
            (isPhoto && ext === '.pdf')) {
            return cb(new Error('Unsupported vehicle file type. Photos must be JPG, PNG, or WEBP; documents may also be PDF.'));
        }
        cb(null, true);
    }
});

const handleVehicleUploads = (req, res, next) => {
    vehicleUpload.fields([
        { name: 'photo', maxCount: 1 },
        { name: 'documents', maxCount: 10 },
        { name: 'exteriorPhotos', maxCount: 10 },
        { name: 'interiorPhotos', maxCount: 10 }
    ])(req, res, (err) => {
        if (err) {
            Object.values(req.files || {}).flat().forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            });
            return res.status(400).json({ success: false, error: err.message || 'Vehicle file upload failed' });
        }
        next();
    });
};

function serializeVehicleUploads(files = []) {
    return files.map(file => ({
        filename: path.basename(file.path),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storage: 'vehicle',
        uploadedAt: new Date().toISOString()
    }));
}

// ========================================================
// EMAIL CONFIGURATION (NODEMAILER + GMAIL)
// ========================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// Test email connection
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email transporter error:', error);
    } else {
        if (DEBUG) console.log('✅ Email transporter ready! Gmail connection verified.');
    }
});

const getBookings = () => {
    try {
        if (!fs.existsSync(FILE_PATH)) {
            fs.writeFileSync(FILE_PATH, JSON.stringify([]), 'utf8');
            return [];
        }
        const data = fs.readFileSync(FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const saveBookings = (bookings) => {
    fs.writeFileSync(FILE_PATH, JSON.stringify(bookings, null, 2), 'utf8');
};

function recordActivity(req, event) {
    const user = req?.user;
    const actorOverride = event.actor;
    const actor = actorOverride || user?.fullname || user?.email || 'Website';
    const actorRole = actorOverride === 'System'
        ? 'system'
        : actorOverride === 'Website'
            ? 'website'
            : user?.role || 'website';

    try {
        appendActivityEvent({
            ...event,
            actor,
            actorId: user?.id || null,
            actorRole
        });
    } catch (error) {
        console.error('[ACTIVITY] Failed to write activity event:', error);
    }
}

function cleanupPastQuotedBookings() {
    try {
        const previousBookings = getBookings();
        const { bookings, cancelledCount } = autoCancelPastQuotedBookings(previousBookings);
        if (cancelledCount === 0) return;

        saveBookings(bookings);
        console.info(`[BOOKINGS] Automatically cancelled ${cancelledCount} quoted booking(s) with past pickup dates.`);
        const previousByRef = new Map(previousBookings.map(booking => [booking.ref, booking]));
        bookings.filter(booking => booking.auto_cancelled_at).forEach(booking => {
            const previousBooking = previousByRef.get(booking.ref);
            if (String(previousBooking?.status || '').trim().toLowerCase() !== 'quoted') return;
            recordActivity(null, {
                actor: 'System',
                action: 'status_changed',
                entityType: 'booking',
                entityId: booking.ref,
                summary: 'Booking auto-cancelled after pickup date passed',
                details: {
                    fromStatus: previousBooking.status,
                    toStatus: booking.status,
                    pickupDate: booking.pickup_date
                }
            });
        });
    } catch (error) {
        console.error('[BOOKINGS] Failed to auto-cancel quoted bookings with past pickup dates:', error);
    }
}

const getBookingField = (input, snakeCaseKey, camelCaseKey) => {
    return input[snakeCaseKey] ?? input[camelCaseKey] ?? '';
};

// ========================================================
// USER MANAGEMENT FUNCTIONS
// ========================================================
const getUsers = () => {
    try {
        if (!fs.existsSync(USERS_FILE_PATH)) {
            fs.writeFileSync(USERS_FILE_PATH, JSON.stringify([]), 'utf8');
            return [];
        }
        const data = fs.readFileSync(USERS_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const saveUsers = (users) => {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf8');
};

const isHashedPassword = (value) => {
    return typeof value === 'string' && /^\$2[aby]\$.{56}$/.test(value);
};

const verifyPassword = async (plainPassword, storedPassword, user, users) => {
    if (isHashedPassword(storedPassword)) {
        return await bcrypt.compare(plainPassword, storedPassword);
    }

    const isMatch = plainPassword === storedPassword;
    if (isMatch && user && users) {
        user.password = await bcrypt.hash(plainPassword, 10);
        saveUsers(users);
        if (DEBUG) console.log(`Migrated plaintext password to bcrypt for user ${user.email}`);
    }
    return isMatch;
};

// ========================================================
// VEHICLE MANAGEMENT FUNCTIONS
// ========================================================
const getVehicles = () => {
    try {
        if (!fs.existsSync(VEHICLES_FILE_PATH)) {
            fs.writeFileSync(VEHICLES_FILE_PATH, JSON.stringify([]), 'utf8');
            return [];
        }
        const data = fs.readFileSync(VEHICLES_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const saveVehicles = (vehicles) => {
    fs.writeFileSync(VEHICLES_FILE_PATH, JSON.stringify(vehicles, null, 2), 'utf8');
};

const getVehicleApprovalRequests = () => {
    if (!fs.existsSync(VEHICLE_APPROVAL_REQUESTS_FILE_PATH)) {
        fs.writeFileSync(VEHICLE_APPROVAL_REQUESTS_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
        return [];
    }
    return JSON.parse(fs.readFileSync(VEHICLE_APPROVAL_REQUESTS_FILE_PATH, 'utf8'));
};

const saveVehicleApprovalRequests = (requests) => {
    fs.writeFileSync(VEHICLE_APPROVAL_REQUESTS_FILE_PATH, JSON.stringify(requests, null, 2), 'utf8');
};

const getAffiliatePayoutRequests = () => {
    try {
        if (!fs.existsSync(AFFILIATE_PAYOUT_REQUESTS_FILE_PATH)) {
            fs.writeFileSync(AFFILIATE_PAYOUT_REQUESTS_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        return JSON.parse(fs.readFileSync(AFFILIATE_PAYOUT_REQUESTS_FILE_PATH, 'utf8'));
    } catch (error) {
        console.error('[AFFILIATE PAYOUT] Failed to read payout requests:', error);
        throw error;
    }
};

const saveAffiliatePayoutRequests = (requests) => {
    fs.writeFileSync(AFFILIATE_PAYOUT_REQUESTS_FILE_PATH, JSON.stringify(requests, null, 2), 'utf8');
};

// ========================================================
// QUOTE MANAGEMENT FUNCTIONS
// ========================================================
const getQuotes = () => {
    try {
        if (!fs.existsSync(QUOTES_FILE_PATH)) {
            fs.writeFileSync(QUOTES_FILE_PATH, JSON.stringify([]), 'utf8');
            return [];
        }
        const data = fs.readFileSync(QUOTES_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const saveQuotes = (quotes) => {
    fs.writeFileSync(QUOTES_FILE_PATH, JSON.stringify(quotes, null, 2), 'utf8');
};

// ========================================================
// RATES MANAGEMENT FUNCTIONS
// ========================================================
const DEFAULT_RATES = {
    airportTransfers: [],
    inboundOutbound: [],
    withDriver: [],
    selfDrive: [],
    selfDriveDelivery: [],
    selfDriveReturn: [],
    addOns: []
};

const getRates = () => {
    try {
        if (!fs.existsSync(RATES_FILE_PATH)) {
            fs.writeFileSync(RATES_FILE_PATH, JSON.stringify(DEFAULT_RATES, null, 2), 'utf8');
            return DEFAULT_RATES;
        }
        const data = fs.readFileSync(RATES_FILE_PATH, 'utf8');
        const parsed = JSON.parse(data);
        return {
            airportTransfers: [],
            inboundOutbound: [],
            withDriver: [],
            selfDrive: [],
            selfDriveDelivery: [],
            selfDriveReturn: [],
            addOns: [],
            ...parsed
        };
    } catch (err) {
        return DEFAULT_RATES;
    }
};

const saveRates = (rates) => {
    fs.writeFileSync(RATES_FILE_PATH, JSON.stringify(rates, null, 2), 'utf8');
};

const redactAuthorizationHeader = (authHeader) => {
    if (!authHeader || typeof authHeader !== 'string') return '(missing)';

    const [scheme, token] = authHeader.split(' ');
    if (!token) return `${scheme || 'Bearer'} (missing token)`;

    const visiblePrefix = token.slice(0, 10);
    const visibleSuffix = token.slice(-6);
    return `${scheme || 'Bearer'} ${visiblePrefix}...${visibleSuffix}`;
};

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (DEBUG) console.log('[AUTH] authorization header:', redactAuthorizationHeader(authHeader));
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = getUsers().find(candidate => candidate.id === decoded.id);
        if (!user || user.active === false) {
            return res.status(401).json({ success: false, error: 'Account is unavailable. Please sign in again.' });
        }
        req.user = {
            id: user.id,
            fullname: user.fullname,
            email: user.email,
            role: user.role
        };
        next();
    } catch (err) {
        if (DEBUG) console.warn('[AUTH] token verify error:', err && err.message);
        res.status(401).json({ success: false, error: "Invalid token" });
    }
};

const optionalVerifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = getUsers().find(candidate => candidate.id === decoded.id);
        if (!user || user.active === false) {
            return res.status(401).json({ success: false, error: 'Account is unavailable. Please sign in again.' });
        }
        req.user = {
            id: user.id,
            fullname: user.fullname,
            email: user.email,
            role: user.role
        };
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

// Middleware to check if user is admin
const verifyAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: "Admin access required" });
    }
    next();
};

const verifyAffiliate = (req, res, next) => {
    if (req.user.role !== 'affiliate') {
        return res.status(403).json({ success: false, error: 'Affiliate access required' });
    }
    next();
};

app.get('/api/status-counts', (req, res) => {
    const bookings = getBookings();
    const counts = { 
        all: bookings.length, open: 0, quoted: 0, approved: 0, assignment: 0,
        pending: 0, confirmed: 0, ongoing: 0, completed: 0, deposited: 0, cancelled: 0, 'no-avail': 0, lost: 0
    };
    bookings.forEach(b => {
        if (b.status) {
            let statusKey = b.status.toLowerCase();
            if (statusKey === 'customer approved') statusKey = 'approved';
            if (statusKey === 'for assignment') statusKey = 'assignment';
            if (statusKey === 'pending payment') statusKey = 'pending';
            if (statusKey === 'cancelled - no availability') statusKey = 'no-avail';
            if (statusKey === 'cancelled - lost') statusKey = 'lost';
            if (counts[statusKey] !== undefined) counts[statusKey]++;
        }
    });
    res.json(counts);
});

app.get('/api/activity-log', verifyToken, verifyAdmin, (req, res) => {
    const entityType = req.query.entityType === undefined ? undefined : String(req.query.entityType);
    const entityId = req.query.entityId === undefined ? '' : String(req.query.entityId).trim();
    const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
    const allowedEntityTypes = new Set(['booking', 'user', 'rate', 'vehicle']);

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ success: false, error: 'Limit must be an integer between 1 and 500.' });
    }
    if (entityType && !allowedEntityTypes.has(entityType)) {
        return res.status(400).json({ success: false, error: 'Invalid activity entity type.' });
    }
    if (entityId.length > 100) {
        return res.status(400).json({ success: false, error: 'Record ID is too long.' });
    }

    try {
        const events = getRecentActivity({ limit, entityType, entityId });
        res.json({ success: true, events });
    } catch (error) {
        console.error('[ACTIVITY] Failed to read activity log:', error);
        res.status(500).json({ success: false, error: 'Unable to load activity history.' });
    }
});

app.get('/api/reports/operations', verifyToken, verifyAdmin, (req, res) => {
    const from = req.query.from === undefined ? '' : String(req.query.from);
    const to = req.query.to === undefined ? '' : String(req.query.to);

    if ((from && !isValidReportDate(from)) || (to && !isValidReportDate(to))) {
        return res.status(400).json({ success: false, error: 'Report dates must be valid calendar dates in YYYY-MM-DD format.' });
    }
    if (from && to && from > to) {
        return res.status(400).json({ success: false, error: 'Start date must not be after end date.' });
    }

    try {
        const report = buildOperationalReport(getBookings(), getVehicles(), { from, to });
        res.json({ success: true, report });
    } catch (error) {
        console.error('[REPORTS] Failed to build operations report:', error);
        res.status(500).json({ success: false, error: 'Unable to build operational report.' });
    }
});

app.get('/api/bookings', verifyToken, verifyAdmin, (req, res) => {
    const { status } = req.query;
    const bookings = getBookings();
    if (!status || status.toLowerCase() === 'all') return res.json(bookings);
    const filtered = bookings.filter(b => {
        if (!b.status) return false;
        let sKey = b.status.toLowerCase();
        if (sKey === 'customer approved') sKey = 'approved';
        if (sKey === 'for assignment') sKey = 'assignment';
        if (sKey === 'pending payment') sKey = 'pending';
        if (sKey === 'cancelled - no availability') sKey = 'no-avail';
        if (sKey === 'cancelled - lost') sKey = 'lost';
        return sKey === status.toLowerCase();
    });
    res.json(filtered);
});

app.get('/api/bookings/:ref/payment-proof/:filename', verifyToken, verifyAdmin, (req, res) => {
    const filename = path.basename(req.params.filename);
    const booking = getBookings().find(candidate =>
        candidate.ref === req.params.ref &&
        Array.isArray(candidate.paymentProofs) &&
        candidate.paymentProofs.some(proof => proof.filename === filename)
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Payment proof not found.' });
    const filePath = path.join(USER_DOCUMENTS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Payment proof not found.' });
    res.sendFile(filePath);
});

// SUBMISSION ENDPOINT (DITO SINALO AT ITINUGMA ANG MGA PANGALAN)
app.post('/api/bookings', bookingLimiter, optionalVerifyToken, async (req, res) => {
    try {
        if (req.user && !['admin', 'customer'].includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'This account cannot submit customer bookings.' });
        }
        const clientInput = req.body;

        // ── reCAPTCHA v3 verification ─────────────────────────────────────
        const recaptchaToken = clientInput.recaptcha_token;
        if (recaptchaToken && process.env.RECAPTCHA_SECRET_KEY) {
            try {
                const verifyRes = await fetch(
                    `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`,
                    { method: 'POST' }
                );
                const verifyData = await verifyRes.json();
                // Reject if score < 0.5 (0 = bot, 1 = human)
                if (!verifyData.success || verifyData.score < 0.5) {
                    console.warn(`[reCAPTCHA] Blocked submission — score: ${verifyData.score}`);
                    return res.status(403).json({ success: false, error: 'Bot activity detected. Please try again.' });
                }
                if (DEBUG) console.log(`[reCAPTCHA] Passed — score: ${verifyData.score}`);
            } catch (captchaErr) {
                console.warn('[reCAPTCHA] Verification failed, allowing submission:', captchaErr.message);
            }
        }
        // ─────────────────────────────────────────────────────────────────
        const bookings = getBookings();
        const rentalType = clientInput.rentalType || clientInput.rental_type || 'self-drive';
        const serviceOption = clientInput.serviceOption || clientInput.driver_service || '—';
        const status = clientInput.status || 'Open';
        const customer = req.user?.role === 'customer'
            ? getUsers().find(user =>
                user.id === req.user.id && user.role === 'customer' && user.active !== false
            )
            : null;

        const newBookingRecord = {
            ref: `MRAC-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            ...(customer ? { customerId: customer.id } : {}),
            name: clientInput.client_name || '—', // Isinalin mula client_name patungong name!
            contact_no: clientInput.contact_no || '—',
            email: clientInput.email || '—',
            area: clientInput.area || '—',                                    
            rentalType,               
            serviceOption,                  
            vehicleType: clientInput.vehicleType || 'sedan',                  
            passengers: clientInput.passengers || '—',                         
            pickup_date: clientInput.pickup_date || '—',
            pickup_time: clientInput.pickup_time || '—',
            pickup_address: clientInput.pickup_address || '—',
            pickup_location_address: getBookingField(clientInput, 'pickup_location_address', 'pickupLocationAddress') || '—',
            pickup_flight_number: getBookingField(clientInput, 'pickup_flight_number', 'pickupFlightNumber') || '—',
            return_date: rentalType === 'self-drive' ? (clientInput.return_date || '—') : '—',
            return_time: rentalType === 'self-drive' ? (clientInput.return_time || '—') : '—',
            return_address: rentalType === 'self-drive' ? (clientInput.return_address || '—') : '—',
            return_location_address: rentalType === 'self-drive' ? (getBookingField(clientInput, 'return_location_address', 'returnLocationAddress') || '—') : '—',
            return_flight_number: rentalType === 'self-drive' ? (getBookingField(clientInput, 'return_flight_number', 'returnFlightNumber') || '—') : '—',
            itinerary: clientInput.itinerary || '—',
            status,
            created_at: new Date().toISOString()
        };

        bookings.push(newBookingRecord);
        saveBookings(bookings);
        recordActivity(req, {
            action: 'created',
            entityType: 'booking',
            entityId: newBookingRecord.ref,
            summary: 'Booking created',
            details: {
                status: newBookingRecord.status,
                pickupDate: newBookingRecord.pickup_date,
                rentalType: newBookingRecord.rentalType,
                serviceOption: newBookingRecord.serviceOption,
                area: newBookingRecord.area,
                vehicleType: newBookingRecord.vehicleType
            }
        });

        try {
            await sendBookingNotification(newBookingRecord);
        } catch (notificationError) {
            console.warn('[NOTIFICATION] Booking saved, but notification failed:', notificationError.message);
        }

        res.status(201).json({ success: true, booking: newBookingRecord });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.put('/api/bookings/:ref', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { ref } = req.params;
        const updatedFields = req.body;
        const bookings = getBookings();
        const index = bookings.findIndex(b => b.ref === ref);
        if (index === -1) return res.status(404).json({ success: false, error: "Not found" });
        
        const previousBooking = bookings[index];
        let vehicleId = previousBooking.vehicleId || null;
        if (Object.prototype.hasOwnProperty.call(updatedFields, 'vehicleId')) {
            const requestedVehicleId = String(updatedFields.vehicleId || '').trim();
            if (requestedVehicleId) {
                const assignedVehicle = getVehicles().find(vehicle =>
                    vehicle.id === requestedVehicleId &&
                    (String(vehicle.status || '').toLowerCase() === 'available' ||
                        vehicle.id === previousBooking.vehicleId)
                );
                if (!assignedVehicle) {
                    return res.status(400).json({ success: false, error: 'Select an available approved vehicle.' });
                }
                vehicleId = assignedVehicle.id;
            } else {
                vehicleId = null;
            }
        }
        bookings[index] = {
            ...previousBooking,
            name: updatedFields.name || previousBooking.name,
            status: updatedFields.status || previousBooking.status,
            contact_no: updatedFields.contact_no || previousBooking.contact_no,
            email: updatedFields.email || previousBooking.email,
            rentalType: updatedFields.rentalType || previousBooking.rentalType,
            vehicleType: updatedFields.vehicleType || previousBooking.vehicleType,
            area: updatedFields.area || previousBooking.area,
            serviceOption: updatedFields.serviceOption || previousBooking.serviceOption,
            passengers: updatedFields.passengers || previousBooking.passengers,
            pickup_date: updatedFields.pickup_date || previousBooking.pickup_date,
            pickup_time: updatedFields.pickup_time || previousBooking.pickup_time,
            pickup_address: updatedFields.pickup_address || previousBooking.pickup_address,
            pickup_location_address: updatedFields.pickup_location_address || previousBooking.pickup_location_address,
            pickup_flight_number: updatedFields.pickup_flight_number || previousBooking.pickup_flight_number,
            return_date: updatedFields.return_date || previousBooking.return_date,
            return_time: updatedFields.return_time || previousBooking.return_time,
            return_address: updatedFields.return_address || previousBooking.return_address,
            return_location_address: updatedFields.return_location_address || previousBooking.return_location_address,
            return_flight_number: updatedFields.return_flight_number || previousBooking.return_flight_number,
            itinerary: updatedFields.itinerary || previousBooking.itinerary,
            vehicleId
        };
        saveBookings(bookings);
        const trackedFields = [
            'name', 'status', 'contact_no', 'email', 'rentalType', 'vehicleType', 'area',
            'serviceOption', 'passengers', 'pickup_date', 'pickup_time', 'pickup_address',
            'pickup_location_address', 'pickup_flight_number', 'return_date', 'return_time',
            'return_address', 'return_location_address', 'return_flight_number', 'itinerary', 'vehicleId'
        ];
        const changedFields = trackedFields.filter(field => previousBooking[field] !== bookings[index][field]);
        if (changedFields.length) {
            const statusChanged = previousBooking.status !== bookings[index].status;
            recordActivity(req, {
                action: statusChanged ? 'status_changed' : 'updated',
                entityType: 'booking',
                entityId: ref,
                summary: statusChanged
                    ? `Booking status changed from ${previousBooking.status} to ${bookings[index].status}`
                    : 'Booking details updated',
                details: {
                    changedFields,
                    ...(statusChanged ? {
                        fromStatus: previousBooking.status,
                        toStatus: bookings[index].status
                    } : {})
                }
            });
        }
        res.json({ success: true, booking: bookings[index] });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.delete('/api/bookings/:ref', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { ref } = req.params;
        const bookings = getBookings();
        const index = bookings.findIndex(b => b.ref === ref);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: "Booking not found" });
        }
        
        const deletedBooking = bookings.splice(index, 1);
        saveBookings(bookings);
        recordActivity(req, {
            action: 'deleted',
            entityType: 'booking',
            entityId: ref,
            summary: 'Booking deleted',
            details: { status: deletedBooking[0].status }
        });
        
        res.json({ success: true, message: `Booking ${ref} deleted successfully`, deleted: deletedBooking[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ========================================================
// USER AUTHENTICATION & MANAGEMENT ENDPOINTS
// ========================================================

// LOGIN ENDPOINT
app.post('/api/users/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: "Email and password required" });
        }

        const users = getUsers();
        const user = users.find(u => u.email && u.email.toLowerCase() === String(email).toLowerCase());

        if (!user) {
            return res.status(401).json({ success: false, error: "Invalid email or password" });
        }

        if (user.active === false) {
            return res.status(403).json({ success: false, error: "This account has been disabled." });
        }

        const passwordMatch = await verifyPassword(password, user.password, user, users);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, error: "Invalid email or password" });
        }

        if (user.role === 'driver') {
            return res.status(403).json({
                success: false,
                error: 'Driver accounts are for booking assignments only and cannot access dashboards.'
            });
        }
        if (!['admin', 'affiliate', 'customer'].includes(user.role)) {
            return res.status(403).json({ success: false, error: 'This account role cannot access dashboards.' });
        }

        // Update last login
        user.last_login = new Date().toISOString();
        saveUsers(users);

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, fullname: user.fullname, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            success: true, 
            token, 
            user: { id: user.id, fullname: user.fullname, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.get('/api/users/me', verifyToken, (req, res) => {
    if (!['admin', 'affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            error: req.user.role === 'driver'
                ? 'Driver accounts cannot access dashboards.'
                : 'This account role cannot access dashboards.',
            role: req.user.role
        });
    }

    const user = getUsers().find(candidate => candidate.id === req.user.id);
    if (!user || user.active === false) {
        return res.status(401).json({ success: false, error: 'Account is unavailable. Please sign in again.' });
    }

    res.json({
        success: true,
        user: {
            id: user.id,
            fullname: user.fullname || '',
            email: user.email || '',
            mobile: user.mobile || '',
            role: user.role,
            photo: user.photo || null,
            businessName: user.businessName || '',
            region: user.region || '',
            address: user.address || '',
            payoutBankName: user.payoutBankName || '',
            payoutAccountName: user.payoutAccountName || '',
            payoutAccountNumber: user.payoutAccountNumber || '',
            payoutGcashNumber: user.payoutGcashNumber || '',
            documents: Array.isArray(user.documents) ? user.documents : []
        }
    });
});

app.put('/api/users/me', verifyToken, (req, res) => {
    if (!['admin', 'affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'This account role cannot manage a dashboard profile.' });
    }

    const users = getUsers();
    const user = users.find(candidate => candidate.id === req.user.id);
    if (!user || user.active === false) {
        return res.status(401).json({ success: false, error: 'Account is unavailable. Please sign in again.' });
    }

    const fullname = typeof req.body.fullname === 'string' ? req.body.fullname.trim() : '';
    const mobile = typeof req.body.mobile === 'string' ? req.body.mobile.trim() : '';
    const editableFields = req.user.role === 'affiliate' ? [
        'businessName',
        'region',
        'address',
        'payoutBankName',
        'payoutAccountName',
        'payoutAccountNumber',
        'payoutGcashNumber'
    ] : [];
    if (!fullname || fullname.length > 120) {
        return res.status(400).json({ success: false, error: 'Name is required and must be 120 characters or fewer.' });
    }
    if (mobile.length > 40) {
        return res.status(400).json({ success: false, error: 'Mobile number must be 40 characters or fewer.' });
    }
    if (mobile && !/^\+639\d{9}$/.test(mobile)) {
        return res.status(400).json({ success: false, error: 'Enter a valid Philippine mobile number with the +63 prefix.' });
    }
    for (const field of editableFields) {
        const value = req.body[field];
        if (typeof value !== 'undefined' && (typeof value !== 'string' || value.length > 160)) {
            return res.status(400).json({ success: false, error: `${field} must be 160 characters or fewer.` });
        }
    }
    if (req.user.role === 'affiliate' && req.body.payoutGcashNumber &&
        !/^\+639\d{9}$/.test(String(req.body.payoutGcashNumber).trim())) {
        return res.status(400).json({ success: false, error: 'Enter a valid GCash number with the +63 prefix.' });
    }

    const changedFields = [];
    if (user.fullname !== fullname) {
        user.fullname = fullname;
        const nameParts = fullname.split(/\s+/);
        user.firstName = nameParts.shift() || '';
        user.lastName = nameParts.join(' ');
        changedFields.push('fullname');
    }
    if ((user.mobile || '') !== mobile) {
        user.mobile = mobile;
        changedFields.push('mobile');
    }
    editableFields.forEach(field => {
        if (typeof req.body[field] !== 'undefined') {
            const value = req.body[field].trim();
            if ((user[field] || '') !== value) {
                user[field] = value;
                changedFields.push(field);
            }
        }
    });

    if (changedFields.length) {
        saveUsers(users);
        recordActivity(req, {
            action: 'updated',
            entityType: 'user',
            entityId: user.id,
            summary: 'Updated own profile',
            details: { changedFields }
        });
    }

    res.json({
        success: true,
        user: {
            id: user.id,
            fullname: user.fullname || '',
            email: user.email || '',
            mobile: user.mobile || '',
            role: user.role,
            photo: user.photo || null,
            businessName: user.businessName || '',
            region: user.region || '',
            address: user.address || '',
            payoutBankName: user.payoutBankName || '',
            payoutAccountName: user.payoutAccountName || '',
            payoutAccountNumber: user.payoutAccountNumber || '',
            payoutGcashNumber: user.payoutGcashNumber || '',
            documents: Array.isArray(user.documents) ? user.documents : []
        }
    });
});

app.post('/api/users/me/password', verifyToken, async (req, res) => {
    if (!['affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Password change is not available for this account.' });
    }

    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 8 || newPassword.length > 200) {
        return res.status(400).json({ success: false, error: 'New password must be between 8 and 200 characters.' });
    }

    const users = getUsers();
    const user = users.find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === req.user.role &&
        candidate.active !== false
    );
    if (!user || !(await verifyPassword(currentPassword, user.password, user, users))) {
        return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    saveUsers(users);
    res.json({ success: true, message: 'Password updated successfully.' });
});

app.post('/api/users/me/documents', verifyToken, (req, res, next) => {
    if (!['affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Document uploads are not available for this account.' });
    }
    userUpload.fields([
        { name: 'documents', maxCount: 10 },
        { name: 'license', maxCount: 1 },
        { name: 'validId', maxCount: 1 }
    ])(req, res, error => {
        if (error) return res.status(400).json({ success: false, error: error.message || 'Document upload failed.' });
        next();
    });
}, (req, res) => {
    const users = getUsers();
    const user = users.find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === req.user.role &&
        candidate.active !== false
    );
    if (!user) return res.status(401).json({ success: false, error: 'Account is unavailable.' });

    const uploaded = Object.entries(req.files || {}).flatMap(([field, files]) => files.map(file => ({
        filename: path.basename(file.path),
        originalName: file.originalname,
        documentType: field === 'license' ? 'Driver’s License' : field === 'validId' ? 'Valid ID' : 'Supporting Document'
    })));
    user.documents = [...(Array.isArray(user.documents) ? user.documents : []), ...uploaded];
    saveUsers(users);
    res.status(201).json({ success: true, documents: uploaded });
});

app.get('/api/users/me/documents/:filename', verifyToken, (req, res) => {
    if (!['affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Document access is not available for this account.' });
    }
    const filename = path.basename(req.params.filename);
    const user = getUsers().find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === req.user.role &&
        candidate.active !== false
    );
    if (!user || !Array.isArray(user.documents) || !user.documents.some(document => document.filename === filename)) {
        return res.status(404).json({ success: false, error: 'Document not found.' });
    }
    const filePath = path.join(USER_DOCUMENTS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Document not found.' });
    res.sendFile(filePath);
});

app.delete('/api/users/me/documents/:filename', verifyToken, (req, res) => {
    if (!['affiliate', 'customer'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Document access is not available for this account.' });
    }
    const filename = path.basename(req.params.filename);
    const users = getUsers();
    const user = users.find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === req.user.role &&
        candidate.active !== false
    );
    if (!user) return res.status(401).json({ success: false, error: 'Account is unavailable.' });
    const documents = Array.isArray(user.documents) ? user.documents : [];
    const index = documents.findIndex(document => document.filename === filename);
    if (index < 0) return res.status(404).json({ success: false, error: 'Document not found.' });

    const filePath = path.join(USER_DOCUMENTS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    documents.splice(index, 1);
    user.documents = documents;
    saveUsers(users);
    res.json({ success: true });
});

app.get('/api/customer/bookings', verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }

    const user = getUsers().find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === 'customer' &&
        candidate.active !== false
    );
    if (!user) {
        return res.status(401).json({ success: false, error: 'Customer account is unavailable.' });
    }

    const quotesByRef = new Map(getQuotes().map(quote => [quote.bookingRef, quote]));
    const vehiclesById = new Map(getVehicles().map(vehicle => [vehicle.id, vehicle]));
    const bookings = getCustomerBookings(getBookings(), user).map(booking => {
        const quote = quotesByRef.get(booking.ref);
        const vehicle = vehiclesById.get(booking.vehicleId || booking.requestedVehicleId);
        return {
            ...booking,
            quote: quote ? {
                totalAmount: quote.totalAmount || null,
                rentalType: quote.rentalType || null,
                breakdownDetails: quote.quoteData?.breakdownDetails || {},
                inclusionsList: quote.quoteData?.inclusionsList || [],
                exclusionsList: quote.quoteData?.exclusionsList || []
            } : null,
            vehicle: vehicle ? {
                make: vehicle.make || '',
                model: vehicle.model || '',
                year: vehicle.year || null,
                type: vehicle.type || '',
                plate: vehicle.plate || ''
            } : null
        };
    });

    res.json({ success: true, bookings });
});

app.get('/api/customer/vehicles', verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer vehicle access required.' });
    }

    const vehicles = getVehicles()
        .filter(vehicle =>
            String(vehicle.status || '').toLowerCase() === 'available' &&
            Number.isFinite(Number(vehicle.dailyRate)) &&
            Number(vehicle.dailyRate) > 0
        )
        .map(vehicle => ({
            id: vehicle.id,
            make: vehicle.make || '',
            model: vehicle.model || '',
            year: vehicle.year || null,
            type: vehicle.type || '',
            seats: vehicle.seats || null,
            transmission: vehicle.transmission || '',
            fuelType: vehicle.fuelType || '',
            dailyRate: Number(vehicle.dailyRate) || 0,
            photo: vehicle.photo || null
        }));
    res.json({ success: true, vehicles });
});

app.post('/api/customer/bookings', bookingLimiter, verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }
    const user = getUsers().find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === 'customer' &&
        candidate.active !== false
    );
    if (!user) return res.status(401).json({ success: false, error: 'Customer account is unavailable.' });

    const {
        vehicleId,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        return_date: returnDate,
        return_time: returnTime,
        area,
        rentalType = 'self-drive',
        passengers,
        itinerary = ''
    } = req.body;
    const vehicle = getVehicles().find(candidate =>
        candidate.id === vehicleId &&
        String(candidate.status || '').toLowerCase() === 'available' &&
        Number.isFinite(Number(candidate.dailyRate)) &&
        Number(candidate.dailyRate) > 0
    );
    if (!vehicle) return res.status(400).json({ success: false, error: 'Select an available approved vehicle.' });
    if (!isValidReportDate(pickupDate) || pickupDate < new Date().toISOString().slice(0, 10)) {
        return res.status(400).json({ success: false, error: 'Choose a valid future pickup date.' });
    }
    if (!pickupTime || !/^\d{2}:\d{2}$/.test(String(pickupTime)) || !String(area || '').trim()) {
        return res.status(400).json({ success: false, error: 'Pickup time and area are required.' });
    }
    if (!['self-drive', 'with-driver'].includes(rentalType)) {
        return res.status(400).json({ success: false, error: 'Choose a valid rental type.' });
    }
    if (rentalType === 'self-drive' &&
        (!isValidReportDate(returnDate) || returnDate <= pickupDate || !/^\d{2}:\d{2}$/.test(String(returnTime || '')))) {
        return res.status(400).json({ success: false, error: 'A valid return date and time after pickup are required.' });
    }
    if (String(itinerary).length > 2000) {
        return res.status(400).json({ success: false, error: 'Trip details must be 2,000 characters or fewer.' });
    }

    const booking = {
        ref: `MRAC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        customerId: user.id,
        name: user.fullname || '',
        contact_no: user.mobile || '',
        email: user.email || '',
        area: String(area).trim(),
        rentalType,
        serviceOption: '—',
        vehicleType: vehicle.type,
        requestedVehicleId: vehicle.id,
        passengers: String(passengers || '—'),
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        pickup_address: String(area).trim(),
        pickup_location_address: '',
        pickup_flight_number: '',
        return_date: rentalType === 'self-drive' ? returnDate : '—',
        return_time: rentalType === 'self-drive' ? returnTime : '—',
        return_address: rentalType === 'self-drive' ? String(area).trim() : '—',
        return_location_address: '',
        return_flight_number: '',
        itinerary: String(itinerary).trim() || '—',
        status: 'Open',
        created_at: new Date().toISOString()
    };
    const bookings = getBookings();
    bookings.push(booking);
    saveBookings(bookings);
    recordActivity(req, {
        action: 'created',
        entityType: 'booking',
        entityId: booking.ref,
        summary: 'Customer submitted a booking request',
        details: { pickupDate, vehicleId: vehicle.id }
    });
    res.status(201).json({ success: true, booking: { ref: booking.ref, status: booking.status } });
});

app.get('/api/customer/bookings/:ref', verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }
    const user = getUsers().find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === 'customer' &&
        candidate.active !== false
    );
    if (!user) return res.status(401).json({ success: false, error: 'Customer account is unavailable.' });

    const booking = getCustomerBookings(getBookings(), user)
        .find(candidate => candidate.ref === req.params.ref);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });
    const quote = getQuotes().find(candidate => candidate.bookingRef === booking.ref);
    const vehicle = getVehicles().find(candidate => candidate.id === (booking.vehicleId || booking.requestedVehicleId));
    res.json({
        success: true,
        booking: {
            ...booking,
            quote: quote ? {
                totalAmount: quote.totalAmount || null,
                rentalType: quote.rentalType || null,
                breakdownDetails: quote.quoteData?.breakdownDetails || {},
                inclusionsList: quote.quoteData?.inclusionsList || [],
                exclusionsList: quote.quoteData?.exclusionsList || []
            } : null,
            vehicle: vehicle ? {
                make: vehicle.make || '',
                model: vehicle.model || '',
                year: vehicle.year || null,
                type: vehicle.type || '',
                plate: vehicle.plate || ''
            } : null
        }
    });
});

app.patch('/api/customer/bookings/:ref', verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }
    const user = getUsers().find(candidate =>
        candidate.id === req.user.id &&
        candidate.role === 'customer' &&
        candidate.active !== false
    );
    if (!user) return res.status(401).json({ success: false, error: 'Customer account is unavailable.' });

    const bookings = getBookings();
    const booking = bookings.find(candidate =>
        candidate.ref === req.params.ref && candidate.customerId === user.id
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });
    const action = req.body.action;
    if (action === 'approve-quote') {
        if (String(booking.status).toLowerCase() !== 'quoted' ||
            !getQuotes().some(quote => quote.bookingRef === booking.ref)) {
            return res.status(409).json({ success: false, error: 'This booking has no quote ready for approval.' });
        }
        booking.status = 'Customer Approved';
    } else if (action === 'request-cancellation') {
        if (['completed', 'cancelled'].includes(String(booking.status).toLowerCase())) {
            return res.status(409).json({ success: false, error: 'This booking can no longer be cancelled.' });
        }
        if (booking.cancellationRequestedAt) {
            return res.status(409).json({ success: false, error: 'A cancellation request is already on file.' });
        }
        booking.cancellationRequestedAt = new Date().toISOString();
    } else {
        return res.status(400).json({ success: false, error: 'Choose a valid booking action.' });
    }

    saveBookings(bookings);
    recordActivity(req, {
        action: action === 'approve-quote' ? 'status_changed' : 'updated',
        entityType: 'booking',
        entityId: booking.ref,
        summary: action === 'approve-quote' ? 'Customer approved the booking quote' : 'Customer requested booking cancellation',
        details: { status: booking.status }
    });
    res.json({ success: true, booking: { ref: booking.ref, status: booking.status, cancellationRequestedAt: booking.cancellationRequestedAt || null } });
});

app.post('/api/customer/bookings/:ref/payment-proof', verifyToken, (req, res, next) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }
    const booking = getBookings().find(candidate =>
        candidate.ref === req.params.ref && candidate.customerId === req.user.id
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });
    if (!['customer approved', 'pending payment'].includes(String(booking.status).toLowerCase())) {
        return res.status(409).json({ success: false, error: 'Payment proof can only be uploaded after quote approval.' });
    }
    userUpload.single('documents')(req, res, error => {
        if (error) return res.status(400).json({ success: false, error: error.message || 'Payment proof upload failed.' });
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Choose a payment proof file to upload.' });
    const bookings = getBookings();
    const booking = bookings.find(candidate =>
        candidate.ref === req.params.ref && candidate.customerId === req.user.id
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found.' });
    booking.paymentProofs = [
        ...(Array.isArray(booking.paymentProofs) ? booking.paymentProofs : []),
        {
            filename: path.basename(req.file.path),
            originalName: req.file.originalname,
            uploadedAt: new Date().toISOString()
        }
    ];
    saveBookings(bookings);
    res.status(201).json({ success: true, uploadedAt: booking.paymentProofs.at(-1).uploadedAt });
});

app.get('/api/customer/bookings/:ref/payment-proof/:filename', verifyToken, (req, res) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: 'Customer booking access required.' });
    }
    const filename = path.basename(req.params.filename);
    const booking = getBookings().find(candidate =>
        candidate.ref === req.params.ref &&
        candidate.customerId === req.user.id &&
        Array.isArray(candidate.paymentProofs) &&
        candidate.paymentProofs.some(proof => proof.filename === filename)
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Payment proof not found.' });
    const filePath = path.join(USER_DOCUMENTS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Payment proof not found.' });
    res.sendFile(filePath);
});

const PASSWORD_RECOVERY_CODE_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RECOVERY_MAX_ATTEMPTS = 5;
const PASSWORD_RECOVERY_RESPONSE = {
    success: true,
    message: 'If an active account exists, a recovery code will be sent if email delivery is available.'
};

function hashPasswordRecoveryCode(user, code) {
    const email = String(user.email).trim().toLowerCase();
    return crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${user.id}:${email}:${code}`)
        .digest('hex');
}

function recoveryCodeMatches(user, code) {
    const storedHash = user.passwordRecovery?.codeHash;
    if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;

    const expectedHash = Buffer.from(storedHash, 'hex');
    const submittedHash = Buffer.from(hashPasswordRecoveryCode(user, code), 'hex');
    return expectedHash.length === submittedHash.length
        && crypto.timingSafeEqual(expectedHash, submittedHash);
}

function hashPasswordResetToken(user, token) {
    return crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`password-reset:${user.id}:${token}`)
        .digest('hex');
}

async function sendPasswordRecoveryEmail(email, code) {
    const { error } = await resend.emails.send({
        from: 'Mayon Rent a Car <no-reply@mayonrentacar.com.ph>',
        to: [email],
        replyTo: 'mayonrentacar@gmail.com',
        subject: 'Mayon Rent a Car password recovery code',
        html: `
            <div style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
                <div style="max-width:520px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
                    <div style="padding:28px 24px;background:#101010;text-align:center;">
                        <h1 style="margin:0 0 8px;color:#f5b400;font-size:24px;letter-spacing:1px;">MAYON RENT A CAR</h1>
                        <p style="margin:0;color:#d1d5db;font-size:14px;">Your One-Time Password</p>
                    </div>
                    <div style="padding:30px 28px;">
                        <p style="margin:0 0 22px;color:#334155;font-size:16px;">A one-time password (OTP) was requested to reset your Mayon Rent a Car admin password.</p>
                        <div style="padding:24px 16px;background:#101010;border-radius:8px;text-align:center;">
                            <p style="margin:0 0 14px;color:#d1d5db;font-size:13px;letter-spacing:1px;">YOUR OTP CODE</p>
                            <p style="margin:0;color:#f5b400;font-size:40px;font-weight:700;letter-spacing:10px;">${code}</p>
                            <p style="margin:14px 0 0;color:#d1d5db;font-size:12px;">6-digit numeric code · Do not share with anyone</p>
                        </div>
                        <div style="margin-top:20px;padding:14px 16px;border-left:4px solid #f5b400;background:#f1f5f9;text-align:center;color:#334155;font-size:13px;">
                            <strong>This code expires in 15 minutes.</strong><br>Request a new code if it expires.
                        </div>
                        <div style="margin-top:16px;padding:14px 16px;border-left:4px solid #f5b400;background:#fee2e2;color:#7f1d1d;font-size:13px;">
                            <strong>Security notice:</strong> Never share this code. Mayon Rent a Car staff will never ask for your OTP.
                        </div>
                        <p style="margin:22px 0 0;color:#64748b;font-size:13px;">If you didn't request this code, you can ignore this email.</p>
                    </div>
                </div>
            </div>`
    });
    if (error) throw new Error(error.message);
}

app.post('/api/users/forgot-password', passwordRecoveryLimiter, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    }

    if (!resend) {
        console.error('[PASSWORD RECOVERY] Email service is not configured.');
        return res.status(503).json({ success: false, error: 'Password recovery is temporarily unavailable. Please contact support.' });
    }

    try {
        const users = getUsers();
        const user = users.find(candidate =>
            candidate.active !== false
            && candidate.email
            && candidate.email.toLowerCase() === email.toLowerCase()
        );

        if (user) {
            const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
            const recoveryHash = hashPasswordRecoveryCode(user, code);
            user.passwordRecovery = {
                codeHash: recoveryHash,
                expiresAt: null,
                attempts: 0
            };
            saveUsers(users);

            try {
                await sendPasswordRecoveryEmail(user.email, code);
                if (user.passwordRecovery?.codeHash === recoveryHash) {
                    user.passwordRecovery.expiresAt = Date.now() + PASSWORD_RECOVERY_CODE_TTL_MS;
                    saveUsers(users);
                }
            } catch (error) {
                if (user.passwordRecovery?.codeHash === recoveryHash) {
                    user.passwordRecovery = null;
                    saveUsers(users);
                }
                console.error('[PASSWORD RECOVERY] Unable to send recovery email:', error.message);
                return res.status(202).json(PASSWORD_RECOVERY_RESPONSE);
            }
        }

        return res.status(202).json(PASSWORD_RECOVERY_RESPONSE);
    } catch (error) {
        console.error('[PASSWORD RECOVERY] Request failed:', error.message);
        return res.status(500).json({ success: false, error: 'Password recovery is temporarily unavailable. Please try again later.' });
    }
});

app.post('/api/users/verify-recovery-code', passwordResetLimiter, (req, res) => {
    const { email, code } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address and six-digit recovery code.' });
    }

    try {
        const users = getUsers();
        const user = users.find(candidate =>
            candidate.active !== false
            && candidate.email
            && candidate.email.toLowerCase() === email.trim().toLowerCase()
        );
        const recovery = user?.passwordRecovery;

        if (!user || !recovery || !Number.isFinite(recovery.expiresAt) || recovery.expiresAt <= Date.now()) {
            if (user?.passwordRecovery) {
                user.passwordRecovery = null;
                saveUsers(users);
            }
            return res.status(400).json({ success: false, error: 'The recovery code is invalid or expired. Request a new code and try again.' });
        }

        if (recovery.attempts >= PASSWORD_RECOVERY_MAX_ATTEMPTS) {
            user.passwordRecovery = null;
            saveUsers(users);
            return res.status(400).json({ success: false, error: 'The recovery code is invalid or expired. Request a new code and try again.' });
        }

        if (!recoveryCodeMatches(user, code)) {
            recovery.attempts += 1;
            if (recovery.attempts >= PASSWORD_RECOVERY_MAX_ATTEMPTS) {
                user.passwordRecovery = null;
            }
            saveUsers(users);
            return res.status(400).json({ success: false, error: 'The recovery code is invalid or expired. Request a new code and try again.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        user.passwordRecovery = {
            codeHash: null,
            expiresAt: null,
            attempts: recovery.attempts,
            resetTokenHash: hashPasswordResetToken(user, resetToken),
            resetExpiresAt: Date.now() + 10 * 60 * 1000
        };
        saveUsers(users);
        return res.json({ success: true, resetToken, expiresIn: 10 * 60 });
    } catch (error) {
        console.error('[PASSWORD RECOVERY] Code verification failed:', error.message);
        return res.status(500).json({ success: false, error: 'Unable to verify the recovery code right now. Please try again later.' });
    }
});

app.post('/api/users/reset-password', passwordResetLimiter, async (req, res) => {
    const { email, resetToken, password } = req.body || {};
    if (
        typeof email !== 'string'
        || email.length > 254
        || typeof resetToken !== 'string'
        || !/^[a-f0-9]{64}$/i.test(resetToken)
        || typeof password !== 'string'
        || password.length < 8
        || password.length > 128
    ) {
        return res.status(400).json({ success: false, error: 'Enter a verified recovery code and a password between 8 and 128 characters.' });
    }

    try {
        const users = getUsers();
        const user = users.find(candidate =>
            candidate.active !== false
            && candidate.email
            && candidate.email.toLowerCase() === email.trim().toLowerCase()
        );
        const recovery = user?.passwordRecovery;
        const storedTokenHash = recovery?.resetTokenHash;
        const submittedTokenHash = user ? hashPasswordResetToken(user, resetToken) : '';
        const tokenMatches = typeof storedTokenHash === 'string'
            && /^[a-f0-9]{64}$/i.test(storedTokenHash)
            && crypto.timingSafeEqual(Buffer.from(storedTokenHash, 'hex'), Buffer.from(submittedTokenHash, 'hex'));

        if (!user || !recovery || !tokenMatches) {
            return res.status(400).json({ success: false, error: 'Your verification is invalid or expired. Verify a new recovery code.' });
        }

        if (!Number.isFinite(recovery.resetExpiresAt) || recovery.resetExpiresAt <= Date.now()) {
            user.passwordRecovery = null;
            saveUsers(users);
            return res.status(400).json({ success: false, error: 'Your verification expired. Request and verify a new recovery code.' });
        }

        user.passwordRecovery = null;
        saveUsers(users);
        user.password = await bcrypt.hash(password, 10);
        saveUsers(users);
        return res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
    } catch (error) {
        console.error('[PASSWORD RECOVERY] Password reset failed:', error.message);
        return res.status(500).json({ success: false, error: 'Unable to reset the password right now. Please try again later.' });
    }
});

// GET ALL USERS (Admin only)
app.get('/api/users', verifyToken, verifyAdmin, (req, res) => {
    try {
        const users = getUsers();
        // Don't send passwords
        const safeUsers = users.map(u => ({
            id: u.id,
            fullname: u.fullname,
            firstName: u.firstName || '',
            lastName: u.lastName || '',
            email: u.email,
            mobile: u.mobile || '',
            role: u.role,
            eligibleForCorporateBookings: u.eligibleForCorporateBookings === true,
            region: u.region || '',
            address: u.address || '',
            tin: u.tin || '',
            affiliateAccount: u.affiliateAccount || '',
            active: u.active !== false,
            hasPhoto: !!u.photo,
            documentCount: Array.isArray(u.documents) ? u.documents.length : 0,
            created_at: u.created_at,
            last_login: u.last_login
        }));
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// GET A SINGLE USER (Admin only) — used to populate the edit modal
app.get('/api/users/:id', verifyToken, verifyAdmin, (req, res) => {
    try {
        const users = getUsers();
        const user = users.find(u => u.id === req.params.id);
        if (!user) return res.status(404).json({ success: false, error: "User not found" });

        res.json({
            success: true,
            user: {
                id: user.id,
                fullname: user.fullname,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                email: user.email,
                mobile: user.mobile || '',
                role: user.role,
                eligibleForCorporateBookings: user.eligibleForCorporateBookings === true,
                region: user.region || '',
                address: user.address || '',
                tin: user.tin || '',
                affiliateAccount: user.affiliateAccount || '',
                active: user.active !== false,
                photo: user.photo || null,
                documents: Array.isArray(user.documents) ? user.documents : [],
                created_at: user.created_at,
                last_login: user.last_login
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// CREATE NEW USER (Admin only)
app.post('/api/users', verifyToken, verifyAdmin, handleUserUploads, async (req, res) => {
    try {
        const { password, email, fullname, role, mobile } = req.body;
        const active = req.body.active !== 'false';
        const nameParts = String(fullname || '').trim().split(/\s+/).filter(Boolean);
        const firstName = String(req.body.firstName || nameParts.shift() || '').trim();
        const lastName = String(req.body.lastName || nameParts.join(' ')).trim();

        if (!password || !email || !firstName || !lastName || !String(mobile || '').trim() || !role) {
            return res.status(400).json({ success: false, error: "First name, last name, email, phone number, password, and role are required" });
        }

        if (!['admin', 'affiliate', 'customer', 'driver'].includes(role)) {
            return res.status(400).json({ success: false, error: "Role must be 'admin', 'affiliate', 'customer', or 'driver'" });
        }

        const users = getUsers();
        
        // Check if email already exists
        if (users.find(u => u.email && u.email.toLowerCase() === String(email).toLowerCase())) {
            return res.status(400).json({ success: false, error: "Email already exists" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const photoFile = req.files?.photo?.[0];
        const documentFiles = req.files?.documents || [];

        // Create new user
        const newUser = {
            id: `USR-${Date.now()}`,
            password: hashedPassword,
            email,
            fullname: String(fullname || `${firstName} ${lastName}`).trim(),
            firstName,
            lastName,
            mobile: String(mobile).trim(),
            role,
            eligibleForCorporateBookings: req.body.eligibleForCorporateBookings === 'true',
            region: String(req.body.region || '').trim(),
            address: String(req.body.address || '').trim(),
            tin: String(req.body.tin || '').trim(),
            active,
            photo: photoFile ? path.basename(photoFile.path) : null,
            documents: documentFiles.map(f => ({ filename: path.basename(f.path), originalName: f.originalname })),
            created_at: new Date().toISOString(),
            last_login: null
        };

        users.push(newUser);
        saveUsers(users);
        recordActivity(req, {
            action: 'created',
            entityType: 'user',
            entityId: newUser.id,
            summary: 'User account created',
            details: { role: newUser.role }
        });

        res.json({ 
            success: true, 
            message: "User created successfully",
            user: { id: newUser.id, fullname: newUser.fullname, email: newUser.email, role: newUser.role }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// UPDATE USER (Admin only)
app.put('/api/users/:id', verifyToken, verifyAdmin, handleUserUploads, async (req, res) => {
    try {
        const { id } = req.params;
        const { fullname, email, role, password, mobile } = req.body;

        const users = getUsers();
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        const previousUser = users[userIndex];
        const previousAuditState = {
            fullname: previousUser.fullname,
            firstName: previousUser.firstName,
            lastName: previousUser.lastName,
            email: previousUser.email,
            mobile: previousUser.mobile,
            role: previousUser.role,
            eligibleForCorporateBookings: previousUser.eligibleForCorporateBookings,
            region: previousUser.region,
            address: previousUser.address,
            tin: previousUser.tin,
            active: previousUser.active,
            photo: previousUser.photo,
            documents: JSON.stringify(previousUser.documents || []),
            password: previousUser.password
        };

        if (fullname) users[userIndex].fullname = String(fullname).trim();
        if (typeof req.body.firstName !== 'undefined') users[userIndex].firstName = String(req.body.firstName).trim();
        if (typeof req.body.lastName !== 'undefined') users[userIndex].lastName = String(req.body.lastName).trim();
        if (email) users[userIndex].email = email;
        if (typeof mobile !== 'undefined') users[userIndex].mobile = mobile;
        if (typeof role !== 'undefined') {
            if (!['admin', 'affiliate', 'customer', 'driver'].includes(role)) {
                return res.status(400).json({ success: false, error: "Role must be 'admin', 'affiliate', 'customer', or 'driver'" });
            }
            users[userIndex].role = role;
        }
        if (typeof req.body.eligibleForCorporateBookings !== 'undefined') {
            users[userIndex].eligibleForCorporateBookings = req.body.eligibleForCorporateBookings === 'true';
        }
        if (typeof req.body.region !== 'undefined') users[userIndex].region = String(req.body.region).trim();
        if (typeof req.body.address !== 'undefined') users[userIndex].address = String(req.body.address).trim();
        if (typeof req.body.tin !== 'undefined') users[userIndex].tin = String(req.body.tin).trim();
        if (password) users[userIndex].password = await bcrypt.hash(password, 10);
        if (typeof req.body.active !== 'undefined') users[userIndex].active = req.body.active !== 'false';

        const photoFile = req.files?.photo?.[0];
        if (photoFile) {
            const oldPhoto = users[userIndex].photo;
            if (oldPhoto) {
                const oldPhotoPath = path.join(USER_PHOTOS_DIR, path.basename(oldPhoto));
                if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
            }
            users[userIndex].photo = path.basename(photoFile.path);
        } else if (req.body.removePhoto === 'true' && users[userIndex].photo) {
            const oldPhotoPath = path.join(USER_PHOTOS_DIR, path.basename(users[userIndex].photo));
            if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
            users[userIndex].photo = null;
        }

        const documentFiles = req.files?.documents || [];
        if (documentFiles.length) {
            const existingDocs = Array.isArray(users[userIndex].documents) ? users[userIndex].documents : [];
            users[userIndex].documents = [
                ...existingDocs,
                ...documentFiles.map(f => ({ filename: path.basename(f.path), originalName: f.originalname }))
            ];
        }

        saveUsers(users);
        const currentUser = users[userIndex];
        const changedFields = [
            'fullname', 'firstName', 'lastName', 'email', 'mobile', 'role',
            'eligibleForCorporateBookings', 'region', 'address', 'tin', 'active', 'photo', 'documents', 'password'
        ].filter(field => {
            const previousValue = previousAuditState[field];
            const currentValue = field === 'documents'
                ? JSON.stringify(currentUser.documents || [])
                : currentUser[field];
            return previousValue !== currentValue;
        });
        if (changedFields.length) {
            recordActivity(req, {
                action: 'updated',
                entityType: 'user',
                entityId: id,
                summary: 'User account updated',
                details: {
                    changedFields: changedFields.filter(field => field !== 'password'),
                    passwordChanged: changedFields.includes('password')
                }
            });
        }

        res.json({ 
            success: true, 
            message: "User updated successfully",
            user: { id: users[userIndex].id, fullname: users[userIndex].fullname, email: users[userIndex].email, role: users[userIndex].role }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// DOWNLOAD A USER'S PHOTO OR SUPPORTING DOCUMENT (Admin only) — served through auth, never exposed as static files
app.get('/api/users/:id/files/:type/:filename', verifyToken, verifyAdmin, (req, res) => {
    const { id, type, filename } = req.params;
    if (!['photo', 'documents'].includes(type)) {
        return res.status(400).json({ success: false, error: "Invalid file type" });
    }

    const users = getUsers();
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const isOwnedFile = type === 'photo'
        ? user.photo === filename
        : Array.isArray(user.documents) && user.documents.some(doc => doc.filename === filename);
    if (!isOwnedFile) return res.status(404).json({ success: false, error: "File not found" });

    // filename is validated against the user's own stored records above, and basename strips any path segments.
    const safeFilename = path.basename(filename);
    const dir = type === 'photo' ? USER_PHOTOS_DIR : USER_DOCUMENTS_DIR;
    const filePath = path.join(dir, safeFilename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: "File not found" });
    res.sendFile(filePath);
});

// DELETE A SUPPORTING DOCUMENT FROM A USER (Admin only)
app.delete('/api/users/:id/documents/:filename', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { id, filename } = req.params;
        const users = getUsers();
        const userIndex = users.findIndex(u => u.id === id);
        if (userIndex === -1) return res.status(404).json({ success: false, error: "User not found" });

        const docs = Array.isArray(users[userIndex].documents) ? users[userIndex].documents : [];
        const docIndex = docs.findIndex(d => d.filename === filename);
        if (docIndex === -1) return res.status(404).json({ success: false, error: "Document not found" });

        const filePath = path.join(USER_DOCUMENTS_DIR, path.basename(filename));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        docs.splice(docIndex, 1);
        users[userIndex].documents = docs;
        saveUsers(users);
        recordActivity(req, {
            action: 'updated',
            entityType: 'user',
            entityId: id,
            summary: 'User supporting document removed',
            details: { changedFields: ['documents'] }
        });

        res.json({ success: true, message: "Document removed successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// DELETE USER (Admin only)
app.delete('/api/users/:id', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const users = getUsers();
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        // Prevent deleting the last admin
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length === 1 && users[userIndex].role === 'admin') {
            return res.status(400).json({ success: false, error: "Cannot delete the last admin user" });
        }

        const deletedUser = users.splice(userIndex, 1);
        saveUsers(users);
        recordActivity(req, {
            action: 'deleted',
            entityType: 'user',
            entityId: id,
            summary: 'User account deleted',
            details: { role: deletedUser[0].role }
        });

        res.json({ success: true, message: "User deleted successfully", user: deletedUser[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ========================================================
// RATES MANAGEMENT ENDPOINTS
// ========================================================

// GET RATES — public so front-end pages can fetch live rates
app.get('/api/rates', (req, res) => {
    try {
        const rates = getRates();
        res.json({ success: true, rates });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// UPDATE RATES (Admin only)
app.put('/api/rates', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { rates } = req.body;
        if (!rates || typeof rates !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid rates data' });
        }
        const previousRates = getRates();
        const changedCategories = [...new Set([...Object.keys(previousRates), ...Object.keys(rates)])]
            .filter(category => JSON.stringify(previousRates[category]) !== JSON.stringify(rates[category]));
        saveRates(rates);
        if (changedCategories.length) {
            recordActivity(req, {
                action: 'updated',
                entityType: 'rate',
                entityId: 'rate-catalog',
                summary: 'Rates updated',
                details: { changedCategories }
            });
        }
        res.json({ success: true, rates });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// ========================================================
// VEHICLE MANAGEMENT ENDPOINTS
// ========================================================

// Admins see the whole fleet; affiliates see only vehicles approved for their account.
app.get('/api/vehicles', verifyToken, (req, res) => {
    try {
        if (!['admin', 'affiliate'].includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Vehicle access required' });
        }
        const allVehicles = getVehicles();
        const vehicles = req.user.role === 'admin'
            ? allVehicles
            : allVehicles.filter(vehicle => vehicle.affiliateId === req.user.id);
        res.json({ success: true, vehicles });
    } catch (error) {
        console.error('[VEHICLES] Failed to load vehicles:', error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.get('/api/vehicles/:id/files/:category/:filename', verifyToken, (req, res) => {
    if (!['admin', 'affiliate'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Vehicle file access required.' });
    }
    const vehicle = getVehicles().find(item => item.id === req.params.id);
    if (!vehicle || (req.user.role === 'affiliate' && vehicle.affiliateId !== req.user.id)) {
        return res.status(404).json({ success: false, error: 'Vehicle file not found.' });
    }

    const { category } = req.params;
    const filename = path.basename(req.params.filename);
    let filePath;
    if (category === 'photo') {
        if (vehicle.photo !== filename) return res.status(404).json({ success: false, error: 'Vehicle file not found.' });
        filePath = path.join(vehicle.photoStorage === 'vehicle' ? VEHICLE_PHOTOS_DIR : USER_PHOTOS_DIR, filename);
    } else if (['documents', 'exteriorPhotos', 'interiorPhotos'].includes(category)) {
        const file = Array.isArray(vehicle[category]) && vehicle[category].find(item => item.filename === filename);
        if (!file) return res.status(404).json({ success: false, error: 'Vehicle file not found.' });
        const directory = category === 'documents'
            ? (file.storage === 'vehicle' ? VEHICLE_DOCUMENTS_DIR : USER_DOCUMENTS_DIR)
            : VEHICLE_PHOTOS_DIR;
        filePath = path.join(directory, filename);
    } else {
        return res.status(400).json({ success: false, error: 'Invalid vehicle file category.' });
    }

    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Vehicle file not found.' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(filePath);
});

app.get('/api/vehicle-approval-requests', verifyToken, (req, res) => {
    try {
        if (!['admin', 'affiliate'].includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Vehicle approval access required' });
        }
        const requests = getVehicleApprovalRequests();
        const visibleRequests = req.user.role === 'admin'
            ? requests
            : requests.filter(request => request.affiliateId === req.user.id);
        res.json({ success: true, requests: visibleRequests });
    } catch (error) {
        console.error('[VEHICLE APPROVAL] Failed to load requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load vehicle approval requests.' });
    }
});

app.get('/api/vehicle-approval-requests/:id/files/:type/:filename', verifyToken, (req, res) => {
    const request = getVehicleApprovalRequests().find(item => item.id === req.params.id);
    if (!request || (req.user.role !== 'admin' && request.affiliateId !== req.user.id)) {
        return res.status(404).json({ success: false, error: 'Vehicle document not found.' });
    }
    const type = req.params.type;
    if (!['photo', 'documents', 'exteriorPhotos', 'interiorPhotos'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Invalid file type.' });
    }
    const filename = path.basename(req.params.filename);
    let fileRecord;
    let filePath;
    if (type === 'photo') {
        if (request.photo !== filename) return res.status(404).json({ success: false, error: 'Vehicle document not found.' });
        filePath = path.join(request.photoStorage === 'vehicle' ? VEHICLE_PHOTOS_DIR : USER_PHOTOS_DIR, filename);
    } else {
        fileRecord = Array.isArray(request[type]) && request[type].find(file => file.filename === filename);
        if (!fileRecord) return res.status(404).json({ success: false, error: 'Vehicle document not found.' });
        const isVehicleStorage = fileRecord.storage === 'vehicle';
        const directory = type === 'documents'
            ? (isVehicleStorage ? VEHICLE_DOCUMENTS_DIR : USER_DOCUMENTS_DIR)
            : VEHICLE_PHOTOS_DIR;
        filePath = path.join(directory, filename);
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Vehicle document not found.' });
    res.sendFile(filePath);
});

app.post('/api/vehicle-approval-requests', verifyToken, verifyAffiliate, handleVehicleUploads, (req, res) => {
    const removeUploadedFiles = () => {
        Object.values(req.files || {}).flat().forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
    };
    try {
        const affiliate = getUsers().find(user =>
            user.id === req.user.id && user.role === 'affiliate' && user.active !== false
        );
        if (!affiliate) {
            removeUploadedFiles();
            return res.status(403).json({ success: false, error: 'An active affiliate account is required.' });
        }

        const requestedVehicleId = String(req.body.vehicleId || '').trim();
        const vehicles = getVehicles();
        const vehicleToEdit = requestedVehicleId
            ? vehicles.find(vehicle => vehicle.id === requestedVehicleId && vehicle.affiliateId === affiliate.id)
            : null;
        if (requestedVehicleId && !vehicleToEdit) {
            removeUploadedFiles();
            return res.status(404).json({ success: false, error: 'Vehicle not found in your account.' });
        }

        let vehicleDetails;
        let vehicleMetadata;
        try {
            vehicleDetails = normalizeVehicleSubmission(req.body);
            vehicleMetadata = normalizeVehicleMetadata(req.body);
        } catch (error) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: error.message });
        }
        const requests = getVehicleApprovalRequests();
        if (requestedVehicleId && requests.some(request =>
            request.vehicleId === requestedVehicleId && request.status === 'Pending'
        )) {
            removeUploadedFiles();
            return res.status(409).json({ success: false, error: 'An edit for this vehicle is already waiting for Admin approval.' });
        }
        const normalizedPlate = vehicleDetails.plate.toUpperCase();
        const plateInUse = vehicles.some(vehicle =>
            vehicle.id !== vehicleToEdit?.id &&
            String(vehicle.plate || '').trim().toUpperCase() === normalizedPlate
        );
        const platePending = requests.some(request =>
            request.status === 'Pending' &&
            String(request.plate || '').trim().toUpperCase() === normalizedPlate
        );
        if (plateInUse || platePending) {
            removeUploadedFiles();
            return res.status(409).json({ success: false, error: 'A vehicle with this plate number already exists or is awaiting approval.' });
        }

        const photo = req.files?.photo?.[0];
        const request = {
            id: `VAPR-${crypto.randomUUID()}`,
            ...vehicleDetails,
            ...vehicleMetadata,
            affiliateId: affiliate.id,
            affiliateName: affiliate.fullname,
            photo: photo ? path.basename(photo.path) : null,
            photoStorage: photo ? 'vehicle' : null,
            documents: serializeVehicleUploads(req.files?.documents),
            exteriorPhotos: serializeVehicleUploads(req.files?.exteriorPhotos),
            interiorPhotos: serializeVehicleUploads(req.files?.interiorPhotos),
            status: 'Pending',
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null,
            reviewNote: '',
            vehicleId: vehicleToEdit?.id || null,
            isVehicleUpdate: Boolean(vehicleToEdit)
        };
        requests.push(request);
        saveVehicleApprovalRequests(requests);
        recordActivity(req, {
            action: 'submitted',
            entityType: 'vehicle',
            entityId: request.id,
            summary: vehicleToEdit
                ? 'Affiliate submitted vehicle changes for approval'
                : 'Affiliate submitted a vehicle for approval',
            details: { type: request.type, status: request.status, vehicleId: request.vehicleId }
        });

        res.status(201).json({
            success: true,
            message: vehicleToEdit ? 'Vehicle changes submitted for approval.' : 'Vehicle submitted for approval.',
            request
        });
    } catch (error) {
        removeUploadedFiles();
        console.error('[VEHICLE APPROVAL] Failed to submit request:', error);
        res.status(500).json({ success: false, error: 'Unable to submit vehicle for approval.' });
    }
});

app.patch('/api/vehicle-approval-requests/:id', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { decision, reviewNote = '' } = req.body;
        if (!['Approved', 'Rejected'].includes(decision)) {
            return res.status(400).json({ success: false, error: 'Decision must be Approved or Rejected.' });
        }
        if (typeof reviewNote !== 'string' || reviewNote.length > 500) {
            return res.status(400).json({ success: false, error: 'Review note must be 500 characters or fewer.' });
        }

        const requests = getVehicleApprovalRequests();
        const request = requests.find(item => item.id === req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, error: 'Vehicle approval request not found.' });
        }
        if (request.status !== 'Pending') {
            return res.status(409).json({ success: false, error: 'This request has already been reviewed.' });
        }

        const isVehicleEdit = request.isVehicleUpdate === true;
        let approvedVehicle = null;
        if (decision === 'Approved') {
            const vehicles = getVehicles();
            const normalizedPlate = String(request.plate || '').trim().toUpperCase();
            const existingIndex = request.vehicleId
                ? vehicles.findIndex(vehicle =>
                    vehicle.id === request.vehicleId && vehicle.affiliateId === request.affiliateId
                )
                : -1;
            if (request.vehicleId && existingIndex < 0) {
                return res.status(409).json({ success: false, error: 'The affiliate vehicle for this edit could not be found.' });
            }
            if (vehicles.some((vehicle, index) =>
                index !== existingIndex &&
                String(vehicle.plate || '').trim().toUpperCase() === normalizedPlate
            )) {
                return res.status(409).json({ success: false, error: 'A fleet vehicle already uses this plate number.' });
            }
            if (existingIndex >= 0) {
                approvedVehicle = updateApprovedVehicle(vehicles[existingIndex], request);
                vehicles[existingIndex] = approvedVehicle;
            } else {
                approvedVehicle = createApprovedVehicle(request, `VEH-${crypto.randomUUID()}`);
                vehicles.push(approvedVehicle);
            }
            saveVehicles(vehicles);
        }

        request.status = decision;
        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = req.user.fullname || req.user.email;
        request.reviewNote = reviewNote.trim();
        request.vehicleId = approvedVehicle?.id || request.vehicleId || null;
        saveVehicleApprovalRequests(requests);

        recordActivity(req, {
            action: isVehicleEdit && decision === 'Approved' ? 'updated' : decision.toLowerCase(),
            entityType: 'vehicle',
            entityId: approvedVehicle?.id || request.id,
            summary: isVehicleEdit && decision === 'Approved'
                ? 'Affiliate vehicle changes approved'
                : `Affiliate vehicle ${decision.toLowerCase()}`,
            details: { requestId: request.id, affiliateId: request.affiliateId }
        });

        res.json({ success: true, request, vehicle: approvedVehicle });
    } catch (error) {
        console.error('[VEHICLE APPROVAL] Failed to review request:', error);
        res.status(500).json({ success: false, error: 'Unable to review vehicle approval request.' });
    }
});

app.get('/api/affiliate/dashboard', verifyToken, verifyAffiliate, (req, res) => {
    try {
        const vehicles = getVehicles().filter(vehicle => vehicle.affiliateId === req.user.id);
        const requests = getVehicleApprovalRequests().filter(request => request.affiliateId === req.user.id);
        const bookings = getAffiliateBookings(getBookings(), vehicles, getQuotes(), req.user.id);
        const earnings = getAffiliateEarnings(bookings, getAffiliatePayoutRequests(), req.user.id);
        res.json({
            success: true,
            sharePercent: AFFILIATE_SHARE_PERCENT,
            summary: {
                activeVehicles: vehicles.filter(vehicle => ['available', 'rented'].includes(String(vehicle.status).toLowerCase())).length,
                pendingVehicleApprovals: requests.filter(request => request.status === 'Pending').length,
                completedBookings: bookings.filter(booking => String(booking.status).toLowerCase() === 'completed').length,
                totalEarnings: earnings.totalEarnings,
                payoutBalance: earnings.payoutBalance
            },
            recentBookings: bookings.slice(-5).reverse(),
            recentRequests: requests.slice(-5).reverse()
        });
    } catch (error) {
        console.error('[AFFILIATE] Failed to load dashboard:', error);
        res.status(500).json({ success: false, error: 'Unable to load affiliate dashboard.' });
    }
});

app.get('/api/affiliate/bookings', verifyToken, verifyAffiliate, (req, res) => {
    try {
        const vehicles = getVehicles().filter(vehicle => vehicle.affiliateId === req.user.id);
        const bookings = getAffiliateBookings(getBookings(), vehicles, getQuotes(), req.user.id);
        res.json({ success: true, bookings });
    } catch (error) {
        console.error('[AFFILIATE] Failed to load affiliate bookings:', error);
        res.status(500).json({ success: false, error: 'Unable to load affiliate bookings.' });
    }
});

app.get('/api/affiliate/earnings', verifyToken, verifyAffiliate, (req, res) => {
    try {
        const vehicles = getVehicles().filter(vehicle => vehicle.affiliateId === req.user.id);
        const bookings = getAffiliateBookings(getBookings(), vehicles, getQuotes(), req.user.id);
        const earnings = getAffiliateEarnings(bookings, getAffiliatePayoutRequests(), req.user.id);
        res.json({ success: true, earnings });
    } catch (error) {
        console.error('[AFFILIATE] Failed to load affiliate earnings:', error);
        res.status(500).json({ success: false, error: 'Unable to load affiliate earnings.' });
    }
});

app.post('/api/affiliate/payout-requests', verifyToken, verifyAffiliate, (req, res) => {
    try {
        const users = getUsers();
        const affiliate = users.find(user =>
            user.id === req.user.id && user.role === 'affiliate' && user.active !== false
        );
        if (!affiliate) return res.status(401).json({ success: false, error: 'Affiliate account is unavailable.' });
        if (!(affiliate.payoutGcashNumber || (affiliate.payoutBankName && affiliate.payoutAccountNumber))) {
            return res.status(400).json({ success: false, error: 'Add bank or GCash payout details in Account Settings first.' });
        }

        const vehicles = getVehicles().filter(vehicle => vehicle.affiliateId === affiliate.id);
        const bookings = getAffiliateBookings(getBookings(), vehicles, getQuotes(), affiliate.id);
        const payoutRequests = getAffiliatePayoutRequests();
        const earnings = getAffiliateEarnings(bookings, payoutRequests, affiliate.id);
        if (earnings.availableToRequest <= 0) {
            return res.status(409).json({ success: false, error: 'There are no unrequested completed-trip earnings available.' });
        }

        const requestedBookingRefs = new Set(
            payoutRequests
                .filter(request => request.affiliateId === affiliate.id && request.status !== 'Rejected')
                .flatMap(request => request.bookingRefs || [])
        );
        const bookingRefs = bookings
            .filter(booking =>
                String(booking.status).toLowerCase() === 'completed' &&
                booking.affiliateShare > 0 &&
                !requestedBookingRefs.has(booking.ref)
            )
            .map(booking => booking.ref);
        const request = {
            id: `PAY-${crypto.randomUUID()}`,
            affiliateId: affiliate.id,
            amount: earnings.availableToRequest,
            sharePercent: AFFILIATE_SHARE_PERCENT,
            bookingRefs,
            status: 'Pending',
            requestedAt: new Date().toISOString(),
            paidAt: null,
            reviewNote: ''
        };
        payoutRequests.push(request);
        saveAffiliatePayoutRequests(payoutRequests);
        res.status(201).json({
            success: true,
            request: {
                id: request.id,
                amount: request.amount,
                status: request.status,
                requestedAt: request.requestedAt
            }
        });
    } catch (error) {
        console.error('[AFFILIATE PAYOUT] Failed to create payout request:', error);
        res.status(500).json({ success: false, error: 'Unable to create payout request.' });
    }
});

app.get('/api/affiliate/payout-requests', verifyToken, verifyAdmin, (req, res) => {
    try {
        const usersById = new Map(getUsers().map(user => [user.id, user]));
        const requests = getAffiliatePayoutRequests().map(request => {
            const affiliate = usersById.get(request.affiliateId);
            return {
                id: request.id,
                affiliateId: request.affiliateId,
                affiliateName: affiliate?.fullname || 'Affiliate',
                affiliateEmail: affiliate?.email || '',
                amount: request.amount,
                status: request.status,
                requestedAt: request.requestedAt,
                paidAt: request.paidAt || null,
                reviewNote: request.reviewNote || '',
                payoutDestination: {
                    bankName: affiliate?.payoutBankName || '',
                    accountName: affiliate?.payoutAccountName || '',
                    accountNumber: affiliate?.payoutAccountNumber || '',
                    gcashNumber: affiliate?.payoutGcashNumber || ''
                }
            };
        });
        res.json({ success: true, requests: requests.reverse() });
    } catch (error) {
        console.error('[AFFILIATE PAYOUT] Failed to load payout requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load affiliate payout requests.' });
    }
});

app.patch('/api/affiliate/payout-requests/:id', verifyToken, verifyAdmin, (req, res) => {
    const { status, reviewNote = '' } = req.body;
    if (!['Paid', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Payout status must be Paid or Rejected.' });
    }
    if (typeof reviewNote !== 'string' || reviewNote.length > 500) {
        return res.status(400).json({ success: false, error: 'Review note must be 500 characters or fewer.' });
    }
    const payoutRequests = getAffiliatePayoutRequests();
    const request = payoutRequests.find(item => item.id === req.params.id);
    if (!request) return res.status(404).json({ success: false, error: 'Payout request not found.' });
    if (request.status !== 'Pending') {
        return res.status(409).json({ success: false, error: 'This payout request has already been reviewed.' });
    }
    request.status = status;
    request.reviewNote = reviewNote.trim();
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = req.user.fullname || req.user.email;
    request.paidAt = status === 'Paid' ? request.reviewedAt : null;
    saveAffiliatePayoutRequests(payoutRequests);
    res.json({
        success: true,
        request: {
            id: request.id,
            affiliateId: request.affiliateId,
            amount: request.amount,
            status: request.status,
            paidAt: request.paidAt,
            reviewNote: request.reviewNote
        }
    });
});

// CREATE NEW VEHICLE (Admin only)
app.post('/api/vehicles', verifyToken, verifyAdmin, handleVehicleUploads, (req, res) => {
    const removeUploadedFiles = () => {
        Object.values(req.files || {}).flat().forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
    };
    try {
        let vehicleDetails;
        let vehicleMetadata;
        try {
            vehicleDetails = normalizeVehicleSubmission(req.body);
            vehicleMetadata = normalizeVehicleMetadata(req.body);
        } catch (error) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: error.message });
        }
        const status = String(req.body.status || '').trim();
        if (!['Available', 'Maintenance', 'Rented'].includes(status)) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: 'Select a valid vehicle status.' });
        }

        const vehicles = getVehicles();
        if (vehicles.some(vehicle => String(vehicle.plate || '').trim().toUpperCase() === vehicleDetails.plate)) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: 'Vehicle with this plate already exists' });
        }

        const photo = req.files?.photo?.[0];
        const newVehicle = {
            id: `VEH-${Date.now()}`,
            ...vehicleDetails,
            ...vehicleMetadata,
            status,
            photo: photo ? path.basename(photo.path) : null,
            photoStorage: photo ? 'vehicle' : null,
            documents: serializeVehicleUploads(req.files?.documents),
            exteriorPhotos: serializeVehicleUploads(req.files?.exteriorPhotos),
            interiorPhotos: serializeVehicleUploads(req.files?.interiorPhotos),
            created_at: new Date().toISOString(),
            lastMaintenance: new Date().toISOString()
        };

        vehicles.push(newVehicle);
        saveVehicles(vehicles);
        recordActivity(req, {
            action: 'created',
            entityType: 'vehicle',
            entityId: newVehicle.id,
            summary: 'Vehicle added to fleet',
            details: { type: newVehicle.type, status: newVehicle.status }
        });

        res.status(201).json({
            success: true,
            message: 'Vehicle added successfully',
            vehicle: newVehicle
        });
    } catch (error) {
        removeUploadedFiles();
        console.error(error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// UPDATE VEHICLE (Admin only)
app.put('/api/vehicles/:id', verifyToken, verifyAdmin, handleVehicleUploads, (req, res) => {
    const removeUploadedFiles = () => {
        Object.values(req.files || {}).flat().forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
    };
    try {
        const { id } = req.params;
        const vehicles = getVehicles();
        const vehicleIndex = vehicles.findIndex(v => v.id === id);

        if (vehicleIndex === -1) {
            removeUploadedFiles();
            return res.status(404).json({ success: false, error: "Vehicle not found" });
        }

        const previousVehicle = JSON.parse(JSON.stringify(vehicles[vehicleIndex]));
        let vehicleDetails;
        let vehicleMetadata;
        try {
            vehicleDetails = normalizeVehicleSubmission({ ...vehicles[vehicleIndex], ...req.body });
            vehicleMetadata = normalizeVehicleMetadata(req.body);
        } catch (error) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: error.message });
        }
        const status = req.body.status === undefined ? vehicles[vehicleIndex].status : String(req.body.status).trim();
        if (!['Available', 'Maintenance', 'Rented'].includes(status)) {
            removeUploadedFiles();
            return res.status(400).json({ success: false, error: 'Select a valid vehicle status.' });
        }
        Object.assign(vehicles[vehicleIndex], vehicleDetails, { status });
        const metadataFields = [
            'orCrExpiryDate', 'insuranceProvider', 'insurancePolicyNumber', 'insuranceExpiryDate',
            'odometerReading', 'nextPmsDate', 'gpsTrackerId'
        ];
        if (metadataFields.some(field => Object.hasOwn(req.body, field))) {
            Object.assign(vehicles[vehicleIndex], vehicleMetadata);
        }
        if (req.body.lastMaintenance) vehicles[vehicleIndex].lastMaintenance = req.body.lastMaintenance;

        const photo = req.files?.photo?.[0];
        if (photo) {
            vehicles[vehicleIndex].photo = path.basename(photo.path);
            vehicles[vehicleIndex].photoStorage = 'vehicle';
        }
        ['documents', 'exteriorPhotos', 'interiorPhotos'].forEach(field => {
            const uploaded = serializeVehicleUploads(req.files?.[field]);
            if (uploaded.length) {
                vehicles[vehicleIndex][field] = [
                    ...(Array.isArray(vehicles[vehicleIndex][field]) ? vehicles[vehicleIndex][field] : []),
                    ...uploaded
                ];
            }
        });

        saveVehicles(vehicles);
        const changedFields = [
            'plate', 'make', 'model', 'year', 'type', 'color', 'seats', 'transmission',
            'fuelType', 'status', 'dailyRate', 'lastMaintenance', 'orCrExpiryDate',
            'insuranceProvider', 'insurancePolicyNumber', 'insuranceExpiryDate',
            'odometerReading', 'nextPmsDate', 'gpsTrackerId', 'photo', 'documents',
            'exteriorPhotos', 'interiorPhotos'
        ].filter(field => JSON.stringify(previousVehicle[field]) !== JSON.stringify(vehicles[vehicleIndex][field]));
        if (changedFields.length) {
            recordActivity(req, {
                action: 'updated',
                entityType: 'vehicle',
                entityId: id,
                summary: 'Vehicle details updated',
                details: { changedFields }
            });
        }

        res.json({
            success: true,
            message: 'Vehicle updated successfully',
            vehicle: vehicles[vehicleIndex]
        });
    } catch (error) {
        removeUploadedFiles();
        console.error(error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// DELETE VEHICLE (Admin only)
app.delete('/api/vehicles/:id', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const vehicles = getVehicles();
        const vehicleIndex = vehicles.findIndex(v => v.id === id);

        if (vehicleIndex === -1) {
            return res.status(404).json({ success: false, error: "Vehicle not found" });
        }

        const deletedVehicle = vehicles.splice(vehicleIndex, 1);
        saveVehicles(vehicles);
        recordActivity(req, {
            action: 'deleted',
            entityType: 'vehicle',
            entityId: id,
            summary: 'Vehicle removed from fleet',
            details: { type: deletedVehicle[0].type }
        });

        res.json({ success: true, message: "Vehicle deleted successfully", vehicle: deletedVehicle[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ========================================================
// QUOTE MANAGEMENT ENDPOINTS
// ========================================================

// SAVE QUOTE (Admin only)
app.post('/api/quotes', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { bookingRef, totalAmount, rentalType, quoteData } = req.body;
        
        if (!bookingRef || !totalAmount) {
            return res.status(400).json({ success: false, error: "Booking reference and total amount required" });
        }

        const bookings = getBookings();
        const bookingIndex = bookings.findIndex(b => b.ref === bookingRef);
        if (bookingIndex === -1) {
            return res.status(404).json({ success: false, error: "Booking not found" });
        }

        const quotes = getQuotes();
        const existingIndex = quotes.findIndex(q => q.bookingRef === bookingRef);
        
        const quoteRecord = {
            id: `QUOTE-${Date.now()}`,
            bookingRef,
            totalAmount,
            rentalType: rentalType || 'unknown',
            quoteData: quoteData || {},
            savedAt: new Date().toISOString(),
            savedBy: req.user.fullname || req.user.email
        };

        if (existingIndex !== -1) {
            quotes[existingIndex] = quoteRecord;
        } else {
            quotes.push(quoteRecord);
        }

        saveQuotes(quotes);
        bookings[bookingIndex] = {
            ...bookings[bookingIndex],
            status: 'Quoted'
        };
        saveBookings(bookings);
        res.json({ success: true, message: "Quote saved successfully", quote: quoteRecord });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// GET QUOTE (Admin only)
app.get('/api/quotes/:bookingRef', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { bookingRef } = req.params;
        const quotes = getQuotes();
        const quote = quotes.find(q => q.bookingRef === bookingRef);

        if (!quote) {
            return res.status(404).json({ success: false, error: "Quote not found" });
        }

        res.json({ success: true, quote });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// DELETE QUOTE (Admin only)
app.delete('/api/quotes/:bookingRef', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { bookingRef } = req.params;
        const quotes = getQuotes();
        const index = quotes.findIndex(q => q.bookingRef === bookingRef);

        if (index === -1) {
            return res.status(404).json({ success: false, error: "Quote not found" });
        }

        const deletedQuote = quotes.splice(index, 1);
        saveQuotes(quotes);
        res.json({ success: true, message: "Quote deleted successfully", quote: deletedQuote[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// Send Quotation Email Endpoint (Resend Version)
app.post('/api/send-quotation-email', verifyToken, verifyAdmin, async (req, res) => {
    try {
        if (!resend) {
            return res.status(503).json({ success: false, error: 'Email service is not configured. Set RESEND_API_KEY in the backend environment.' });
        }

        const { bookingRef, clientEmail, clientName, quoteData } = req.body;
        
        if (!bookingRef || !clientEmail) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        // quoteData from frontend is the full quoteRecord: { totalAmount, rentalType, quoteData: {...}, ... }
        const normalizeTotalAmount = (value) => {
            if (typeof value === 'string') {
                const cleaned = value.replace(/[^\d.-]/g, '');
                if (!cleaned || cleaned === '-' || cleaned === '.') return value;
                return `₱${Number(cleaned).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            if (Number.isFinite(Number(value))) {
                return `₱${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            return value || 'N/A';
        };
        const totalAmount = normalizeTotalAmount(quoteData?.totalAmount || 'N/A');
        const rentalType  = quoteData?.rentalType  || 'unknown';
        const qd          = quoteData?.quoteData   || {};   // flat detail object

        const vehicleType   = qd.vehicleType   || '—';
        const serviceOption = qd.serviceOption || '—';
        const itinerary     = qd.itinerary     || '';
        const pickupAddress = qd.pickupAddress || '—';
        const pickupLocationAddress = qd.pickupLocationAddress || '';
        const pickupFlightNumber = qd.pickupFlightNumber || '';
        const returnAddress = qd.returnAddress || '—';
        const returnLocationAddress = qd.returnLocationAddress || '';
        const returnFlightNumber = qd.returnFlightNumber || '';

        const formatMoneyNumber = (value) => {
            const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
            return numericValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const formatMoney = (value) => `₱${formatMoneyNumber(value)}`;

        const formatQuotationLocation = (location, exactAddress, flightNumber) => {
            const normalizedLocation = String(location || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedLocation.includes('citihardware')) return location;
            if (normalizedLocation.includes('bicolinternationalairport')) {
                return flightNumber ? `${location} - Flight No. ${flightNumber}` : location;
            }
            return exactAddress || location;
        };
        const pickupDisplay = formatQuotationLocation(pickupAddress, pickupLocationAddress.trim(), pickupFlightNumber.trim());
        const returnDisplay = formatQuotationLocation(returnAddress, returnLocationAddress.trim(), returnFlightNumber.trim());

        // Format dates & times
        const rawPickDate = qd.pickDate   || '';
        const rawPickTime = qd.pickTime   || '';
        const rawRetDate  = qd.returnDate || '';
        const rawRetTime  = qd.returnTime || '';

        const fmtDate = raw => raw ? new Date(raw + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
        const fmtTime = raw => raw ? new Date('1970-01-01T' + raw).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';

        const fmtPickDate = fmtDate(rawPickDate);
        const fmtPickTime = fmtTime(rawPickTime);
        const fmtRetDate  = fmtDate(rawRetDate);
        const fmtRetTime  = fmtTime(rawRetTime);

        // ── Cost breakdown rows ──────────────────────────────────────────────
        const bd  = qd.breakdownDetails || {};
        const row = (label, value, zeroLabel = '') => value > 0
            ? `<tr><td style="padding:8px 12px;color:#475569;border-bottom:1px solid #f1f5f9;">${label}</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;">${formatMoney(value)}</td></tr>`
            : value === 0 && zeroLabel
                ? `<tr><td style="padding:8px 12px;color:#475569;border-bottom:1px solid #f1f5f9;">${label}</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;">${zeroLabel}</td></tr>`
                : '';

        let breakdownRows = '';
        if (rentalType === 'with-driver') {
            const fuelCost  = bd.consumption > 0 ? (bd.distance / bd.consumption) * bd.fuelPrice : 0;
            const baseTotal = bd.unitBase * bd.driverDays;
            const otTotal   = bd.overtime * bd.driverOtHours;

            breakdownRows += row(`Rental Rate (₱${formatMoneyNumber(bd.unitBase || 0)} × ${bd.driverDays || 0} Day/s)`, baseTotal);
            if (bd.driverOtHours > 0) breakdownRows += row(`Overtime Fee (₱${formatMoneyNumber(bd.overtime || 0)} × ${bd.driverOtHours} Hr/s)`, otTotal);
            if (fuelCost > 0) breakdownRows += row(`Calculated Fuel Cost (${bd.distance}km @ ₱${formatMoneyNumber(bd.fuelPrice || 0)}/L, ${bd.consumption}km/L)`, fuelCost);
            breakdownRows += row('Toll Fees',               bd.tollFees   || 0);
            breakdownRows += row('Parking Fees',            bd.parkingFees|| 0);
            breakdownRows += row("Driver's Fee",            bd.driverFee  || 0);
            breakdownRows += row('Meals',                   bd.meals      || 0);
            breakdownRows += row('Lodging / Accommodation', bd.lodging    || 0);
            breakdownRows += row('Miscellaneous Expenses',  bd.misc       || 0);
        } else {
            const baseTotal = bd.unitBase * bd.days;
            const otTotal   = bd.overtime * bd.selfOtHours;

            breakdownRows += row(`Rental Rate (₱${formatMoneyNumber(bd.unitBase || 0)} × ${bd.days || 0} Day/s)`, baseTotal);
            if (bd.selfOtHours > 0) breakdownRows += row(`Overtime Fee (₱${formatMoneyNumber(bd.overtime || 0)} × ${bd.selfOtHours} Hr/s)`, otTotal);
            breakdownRows += row('Delivery Fee',   bd.delivery  || 0, 'Free');
            breakdownRows += row('Return Fee',     bd.return    || 0, 'Free');
            breakdownRows += row('Child Seat Fee', bd.childSeat || 0);
        }

        // ── Inclusions / Exclusions ──────────────────────────────────────────
        const inclusions  = qd.inclusionsList  || [];
        const exclusions  = qd.exclusionsList  || [];
        let incExcSection = '';
        if (rentalType === 'with-driver' && (inclusions.length > 0 || exclusions.length > 0)) {
            const incHTML = inclusions.length > 0 ? `
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:13px 16px;border-radius:6px;flex:1;min-width:0;">
                    <div style="font-size:11px;text-transform:uppercase;color:#166534;font-weight:700;margin-bottom:8px;">&#10003; Inclusions</div>
                    <ul style="margin:0;padding-left:18px;color:#15803d;font-size:13px;">
                        ${inclusions.map(i => `<li style="margin-bottom:3px;">${i}</li>`).join('')}
                    </ul>
                </div>` : '';
            const excHTML = exclusions.length > 0 ? `
                <div style="background:#fef2f2;border:1px solid #fecaca;padding:13px 16px;border-radius:6px;flex:1;min-width:0;">
                    <div style="font-size:11px;text-transform:uppercase;color:#991b1b;font-weight:700;margin-bottom:8px;">&#215; Exclusions</div>
                    <ul style="margin:0;padding-left:18px;color:#b91c1c;font-size:13px;">
                        ${exclusions.map(i => `<li style="margin-bottom:3px;">${i}</li>`).join('')}
                    </ul>
                </div>` : '';
            incExcSection = `
                <div style="margin-bottom:20px;">
                    <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128203; Inclusions &amp; Exclusions</div>
                    <div style="display:flex;gap:14px;">${incHTML}${excHTML}</div>
                </div>`;
        }

        // ── Conditional rows & sections ──────────────────────────────────────
        const serviceRow = rentalType === 'with-driver' ? `
            <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Service Option</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${serviceOption}</td></tr>` : '';

        const returnScheduleRow = rentalType === 'self-drive' ? `
            <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Return Date &amp; Time</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${fmtRetDate} at ${fmtRetTime}</td></tr>` : '';
        const returnLocationRow = rentalType === 'self-drive' ? `
            <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Return Location</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${returnDisplay}</td></tr>` : '';

        const itinerarySection = itinerary ? `
            <div style="margin-bottom:20px;">
                <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128506; Destination / Itinerary</div>
                <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:12px 16px;border-radius:0 6px 6px 0;font-size:13px;color:#334155;line-height:1.6;">${itinerary}</div>
            </div>` : '';

        if (DEBUG) console.log(`[EMAIL DEBUG] rentalType=${rentalType}, vehicleType=${vehicleType}, pickDate=${rawPickDate}, qd keys=${Object.keys(qd).join(',')}`);

        const brandBadge = `
                    <div style="padding:14px 18px 10px;background:#ffffff;text-align:center;">
                        <img src="https://www.mayonrentacar.com.ph/images/Mayon-email.png" alt="Mayon Rent a Car" width="190" style="display:block;width:100%;max-width:190px;height:auto;margin:0 auto;border:0;">
                        <div style="margin-top:4px;font-size:13px;line-height:1.4;color:#64748b;">Your Trusted Rental Partner in Bicol</div>
          </div>`;

        const htmlTemplate = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#d9f5f5;color:#1e293b;">
<div style="padding:24px 0;">
<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);border:1px solid #dbeafe;">

  ${brandBadge}

  <!-- Body -->
  <div style="padding:24px 24px 28px;">
    <p style="margin:0 0 16px;font-size:14px;">Dear <strong>${clientName}</strong>,</p>
    <p style="margin:0 0 22px;font-size:13px;color:#475569;">Thank you for choosing Mayon Rent a Car! Here is your complete quotation.</p>

    <!-- Booking Ref -->
    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;margin-bottom:20px;">
      <div style="font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;">&#128203; Booking Reference</div>
      <div style="font-size:17px;font-weight:700;color:#1d4ed8;margin-top:4px;">${bookingRef}</div>
    </div>

    <!-- Total Amount -->
    <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #2563eb;border-radius:8px;text-align:center;padding:20px;margin-bottom:24px;">
      <div style="font-size:10px;text-transform:uppercase;color:#3b82f6;letter-spacing:0.5px;margin-bottom:6px;">&#128176; Total Quotation Amount</div>
      <div style="font-size:32px;font-weight:700;color:#1d4ed8;">${totalAmount}</div>
    </div>

    <!-- Rental Details -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128665; Rental Details</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Rental Type</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${rentalType === 'with-driver' ? 'With Driver' : 'Self-Drive'}</td></tr>
        <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;">Vehicle Type</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${vehicleType}</td></tr>
        ${serviceRow}
      </table>
    </div>

    <!-- Trip Schedule -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128197; Trip Schedule</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Pickup Date &amp; Time</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${fmtPickDate} at ${fmtPickTime}</td></tr>
        ${returnScheduleRow}
      </table>
    </div>

    <!-- Locations -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128205; Locations</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Pickup Details</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${pickupDisplay}</td></tr>
        ${returnLocationRow}
      </table>
    </div>

    ${itinerarySection}

    <!-- Cost Breakdown -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128181; Cost Breakdown</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
        <tbody>${breakdownRows}</tbody>
        <tfoot><tr style="background:#eff6ff;border-top:2px solid #2563eb;"><td style="padding:10px 12px;font-weight:700;font-size:14px;color:#1d4ed8;">TOTAL AMOUNT</td><td style="padding:10px 12px;font-weight:700;font-size:14px;color:#1d4ed8;text-align:right;">${totalAmount}</td></tr></tfoot>
      </table>
    </div>

    ${incExcSection}

    <!-- CTA -->
    <div style="text-align:center;margin:24px 0 16px;">
      <a href="mailto:mayonrentacar@gmail.com?subject=Quotation%20${bookingRef}%20-%20Ready%20to%20Book" style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a);color:#ffffff;padding:13px 32px;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;display:inline-block;">&#10003; Reply to Confirm Booking</a>
    </div>

    <!-- Next Steps -->
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:14px 18px;font-size:12.5px;color:#0369a1;line-height:1.9;">
      <strong>&#128204; Next Steps:</strong><br>
      &bull; Review the details above and reply to confirm your booking<br>
      &bull; We will send you payment instructions upon confirmation<br>
      &bull; Your vehicle will be ready on the scheduled pickup date
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 24px;text-align:center;font-size:12px;color:#94a3b8;">
    <strong style="color:#475569;">MAYON RENT A CAR</strong><br>
    <span style="display:block;margin-top:6px;">&#128231; mayonrentacar@gmail.com &nbsp;|&nbsp; &#127760; Bicol Region</span>
    <span style="display:block;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px;">&copy; 2026 Mayon Rent a Car. All rights reserved.</span>
  </div>

</div>
</div>
</body></html>`;
        
        if (DEBUG) console.log(`[EMAIL] Attempting to send quotation via RESEND to ${clientEmail} for booking ${bookingRef}`);
        
        // ── GINAMIT NA SI RESEND IMBIS NA NODEMAILER ──────────────────────────
        const ccRecipients = getQuotationCcRecipients(clientEmail);

        const { data, error } = await resend.emails.send({
            from: 'Mayon Rent a Car <no-reply@mayonrentacar.com.ph>', // Verified Resend domain!
            to: [clientEmail],
            cc: ccRecipients,
            subject: `Mayon Rent a Car Quotation | ${bookingRef}`,
            replyTo: 'mayonrentacar@gmail.com',                      // Kapag nag-reply si client, rekta sa normal gmail niyo!
            html: htmlTemplate,
            headers: {
                'X-Mailer': 'Mayon Rent a Car Booking System'
                // Note: 'Precedence: bulk' removed — this is a 1:1 transactional email,
                // and that header made Yahoo's spam filter treat it as mass mail.
            }
        });

        if (error) {
            throw new Error(error.message);
        }
        
        if (DEBUG) console.log(`[EMAIL] ✅ Email sent successfully via Resend. ID: ${data.id}`);
        
        res.json({ 
            success: true, 
            message: `Quotation email sent to ${clientEmail}`,
            email: clientEmail,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error("❌ Email send error:", error.message);
        res.status(500).json({ success: false, error: "Failed to send email: " + error.message });
    }
});

// CONTACT US ENDPOINT (Public)
app.post('/api/contact', async (req, res) => {
    try {
        const name = (req.body.partner_name || req.body.customer_name || req.body.name || '').trim();
        const email = (req.body.partner_email || req.body.customer_email || req.body.email || '').trim();
        const contact = (req.body.partner_contact || req.body.customer_contact || req.body.contact_no || req.body.contact || '').trim();
        const message = (req.body.partner_message || req.body.customer_message || req.body.message || '').trim();

        if (!name || !email || !contact || !message) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const escapeHtml = (value) => {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const safeName = escapeHtml(name);
        const safeEmail = escapeHtml(email);
        const safeContact = escapeHtml(contact);
        const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

        const mailSubject = `New Website Contact Form Submission: ${name}`;
        const textBody = [
            `Name: ${name}`,
            `Email: ${email}`,
            `Contact: ${contact}`,
            '',
            'Message:',
            message
        ].join('\n');

        const htmlBody = `
            <div style="font-family: Arial, Helvetica, sans-serif; background: #f4f7fb; padding: 24px; color: #1f2937;">
                <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #dbe3ef; border-radius: 10px; padding: 20px 22px; box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);">
                    <h2 style="margin: 0 0 14px; color: #0b77c5; font-size: 32px; line-height: 1.1;">New Contact Form Submission</h2>
                    <div style="border-top: 1px solid #dbe3ef; padding-top: 16px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 16px; line-height: 1.6;">
                            <tr>
                                <td style="padding: 6px 0; width: 170px; color: #334155;"><strong>Full Name:</strong></td>
                                <td style="padding: 6px 0; color: #1e293b;">${safeName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #334155;"><strong>Email Address:</strong></td>
                                <td style="padding: 6px 0;"><a href="mailto:${safeEmail}" style="color: #0b77c5; text-decoration: none;">${safeEmail}</a></td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #334155;"><strong>Contact Number:</strong></td>
                                <td style="padding: 6px 0; color: #1e293b;">${safeContact}</td>
                            </tr>
                        </table>

                        <div style="margin-top: 14px; background: #f8fbff; border-left: 4px solid #0b77c5; border-radius: 6px; padding: 14px 14px 12px;">
                            <div style="font-weight: 700; color: #334155; margin-bottom: 8px;">Message / Inquiry:</div>
                            <div style="color: #1f2937;">${safeMessage}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (resend) {
            const { error } = await resend.emails.send({
                from: 'Mayon Rent a Car <no-reply@mayonrentacar.com.ph>',
                to: ['mayonrentacar@gmail.com'],
                replyTo: email,
                subject: mailSubject,
                text: textBody,
                html: htmlBody
            });

            if (error) {
                throw new Error(`Resend service error: ${error.message}`);
            }
        } else {
            await transporter.sendMail({
                from: process.env.GMAIL_USER,
                to: process.env.GMAIL_USER,
                replyTo: email,
                subject: mailSubject,
                text: textBody,
                html: htmlBody
            });
        }

        return res.json({ success: true, message: 'Inquiry submitted successfully.' });
    } catch (error) {
        console.error('Contact route transactional exception:', error);
        return res.status(500).json({ success: false, error: 'An internal error occurred while processing your request. Please try again later.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    cleanupPastQuotedBookings();
    setInterval(cleanupPastQuotedBookings, QUOTED_BOOKING_CLEANUP_INTERVAL_MS);
});