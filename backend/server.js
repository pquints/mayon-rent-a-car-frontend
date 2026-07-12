require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const resend = new Resend('re_J6Ew6keQ_GjjH5KZ3oYKAubsgtVASmL3j');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const DEBUG = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';

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

// Apply general limiter to all /api routes but exempt specific admin endpoints (e.g. login)
// This keeps customer-facing protections while allowing admin/workflow endpoints to avoid accidental blocks.
app.use('/api', (req, res, next) => {
    // Paths to exempt from the general limiter (server-side pathnames under /api)
    const exemptPaths = [
        '/users/login', // admin login endpoint
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
const QUOTES_FILE_PATH = path.join(__dirname, 'quotes.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
        if (DEBUG) console.log(`Migrated plaintext password to bcrypt for user ${user.username}`);
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

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (DEBUG) console.log('[AUTH] authorization header:', authHeader);
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (DEBUG) console.warn('[AUTH] token verify error:', err && err.message);
        res.status(401).json({ success: false, error: "Invalid token" });
    }
};

// Middleware to check if user is admin
const verifyAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: "Admin access required" });
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

app.get('/api/bookings', (req, res) => {
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

// SUBMISSION ENDPOINT (DITO SINALO AT ITINUGMA ANG MGA PANGALAN)
app.post('/api/bookings', bookingLimiter, async (req, res) => {
    try {
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

        const newBookingRecord = {
            ref: `MRAC-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
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
            return_date: rentalType === 'self-drive' ? (clientInput.return_date || '—') : '—',
            return_time: rentalType === 'self-drive' ? (clientInput.return_time || '—') : '—',
            return_address: rentalType === 'self-drive' ? (clientInput.return_address || '—') : '—',
            itinerary: clientInput.itinerary || '—',
            status,
            created_at: new Date().toISOString()
        };

        bookings.push(newBookingRecord);
        saveBookings(bookings);
        res.status(201).json({ success: true, booking: newBookingRecord });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.put('/api/bookings/:ref', (req, res) => {
    try {
        const { ref } = req.params;
        const updatedFields = req.body;
        const bookings = getBookings();
        const index = bookings.findIndex(b => b.ref === ref);
        if (index === -1) return res.status(404).json({ success: false, error: "Not found" });
        
        bookings[index] = {
            ...bookings[index],
            name: updatedFields.name || bookings[index].name,
            status: updatedFields.status || bookings[index].status,
            contact_no: updatedFields.contact_no || bookings[index].contact_no,
            email: updatedFields.email || bookings[index].email,
            rentalType: updatedFields.rentalType || bookings[index].rentalType,
            vehicleType: updatedFields.vehicleType || bookings[index].vehicleType,
            area: updatedFields.area || bookings[index].area,
            serviceOption: updatedFields.serviceOption || bookings[index].serviceOption,
            passengers: updatedFields.passengers || bookings[index].passengers,
            pickup_date: updatedFields.pickup_date || bookings[index].pickup_date,
            pickup_time: updatedFields.pickup_time || bookings[index].pickup_time,
            pickup_address: updatedFields.pickup_address || bookings[index].pickup_address,
            return_date: updatedFields.return_date || bookings[index].return_date,
            return_time: updatedFields.return_time || bookings[index].return_time,
            return_address: updatedFields.return_address || bookings[index].return_address,
            itinerary: updatedFields.itinerary || bookings[index].itinerary
        };
        saveBookings(bookings);
        res.json({ success: true, booking: bookings[index] });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.delete('/api/bookings/:ref', (req, res) => {
    try {
        const { ref } = req.params;
        const bookings = getBookings();
        const index = bookings.findIndex(b => b.ref === ref);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: "Booking not found" });
        }
        
        const deletedBooking = bookings.splice(index, 1);
        saveBookings(bookings);
        
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
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: "Username and password required" });
        }

        const users = getUsers();
        const user = users.find(u => u.username === username);

        if (!user) {
            return res.status(401).json({ success: false, error: "Invalid username or password" });
        }

        const passwordMatch = await verifyPassword(password, user.password, user, users);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, error: "Invalid username or password" });
        }

        // Update last login
        user.last_login = new Date().toISOString();
        saveUsers(users);

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            success: true, 
            token, 
            user: { id: user.id, username: user.username, fullname: user.fullname, email: user.email, role: user.role } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// GET ALL USERS (Admin only)
app.get('/api/users', verifyToken, verifyAdmin, (req, res) => {
    try {
        const users = getUsers();
        // Don't send passwords
        const safeUsers = users.map(u => ({
            id: u.id,
            username: u.username,
            fullname: u.fullname,
            email: u.email,
            role: u.role,
            created_at: u.created_at,
            last_login: u.last_login
        }));
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// CREATE NEW USER (Admin only)
app.post('/api/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { username, password, email, fullname, role } = req.body;

        if (!username || !password || !email || !fullname || !role) {
            return res.status(400).json({ success: false, error: "All fields are required" });
        }

        if (!['admin', 'driver'].includes(role)) {
            return res.status(400).json({ success: false, error: "Role must be 'admin' or 'driver'" });
        }

        const users = getUsers();
        
        // Check if username already exists
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ success: false, error: "Username already exists" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = {
            id: `USR-${Date.now()}`,
            username,
            password: hashedPassword,
            email,
            fullname,
            role,
            created_at: new Date().toISOString(),
            last_login: null
        };

        users.push(newUser);
        saveUsers(users);

        res.json({ 
            success: true, 
            message: "User created successfully",
            user: { id: newUser.id, username: newUser.username, fullname: newUser.fullname, email: newUser.email, role: newUser.role }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// UPDATE USER (Admin only)
app.put('/api/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { fullname, email, role, password, mobile } = req.body;

        const users = getUsers();
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        if (fullname) users[userIndex].fullname = fullname;
        if (email) users[userIndex].email = email;
        if (typeof mobile !== 'undefined') users[userIndex].mobile = mobile;
        if (role && ['admin', 'driver'].includes(role)) users[userIndex].role = role;
        if (password) users[userIndex].password = await bcrypt.hash(password, 10);

        saveUsers(users);

        res.json({ 
            success: true, 
            message: "User updated successfully",
            user: { id: users[userIndex].id, username: users[userIndex].username, fullname: users[userIndex].fullname, email: users[userIndex].email, role: users[userIndex].role }
        });
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

        res.json({ success: true, message: "User deleted successfully", user: deletedUser[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// ========================================================
// VEHICLE MANAGEMENT ENDPOINTS
// ========================================================

// GET ALL VEHICLES (Admin only)
app.get('/api/vehicles', verifyToken, verifyAdmin, (req, res) => {
    try {
        const vehicles = getVehicles();
        res.json({ success: true, vehicles });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// CREATE NEW VEHICLE (Admin only)
app.post('/api/vehicles', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { plate, make, model, year, type, color, seats, transmission, fuelType, status, dailyRate } = req.body;

        if (!plate || !make || !model || !year || !type || !color || !seats || !transmission || !fuelType || !status) {
            return res.status(400).json({ success: false, error: "All fields are required" });
        }

        const vehicles = getVehicles();
        
        // Check if plate already exists
        if (vehicles.find(v => v.plate === plate)) {
            return res.status(400).json({ success: false, error: "Vehicle with this plate already exists" });
        }

        // Create new vehicle
        const newVehicle = {
            id: `VEH-${Date.now()}`,
            plate,
            make,
            model,
            year: parseInt(year),
            type,
            color,
            seats: parseInt(seats),
            transmission,
            fuelType,
            status,
            dailyRate: parseFloat(dailyRate),
            created_at: new Date().toISOString(),
            lastMaintenance: new Date().toISOString()
        };

        vehicles.push(newVehicle);
        saveVehicles(vehicles);

        res.json({ 
            success: true, 
            message: "Vehicle added successfully",
            vehicle: newVehicle
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// UPDATE VEHICLE (Admin only)
app.put('/api/vehicles/:id', verifyToken, verifyAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { plate, make, model, year, type, color, seats, transmission, fuelType, status, dailyRate, lastMaintenance } = req.body;

        const vehicles = getVehicles();
        const vehicleIndex = vehicles.findIndex(v => v.id === id);

        if (vehicleIndex === -1) {
            return res.status(404).json({ success: false, error: "Vehicle not found" });
        }

        if (plate) vehicles[vehicleIndex].plate = plate;
        if (make) vehicles[vehicleIndex].make = make;
        if (model) vehicles[vehicleIndex].model = model;
        if (year) vehicles[vehicleIndex].year = parseInt(year);
        if (type) vehicles[vehicleIndex].type = type;
        if (color) vehicles[vehicleIndex].color = color;
        if (seats) vehicles[vehicleIndex].seats = parseInt(seats);
        if (transmission) vehicles[vehicleIndex].transmission = transmission;
        if (fuelType) vehicles[vehicleIndex].fuelType = fuelType;
        if (status) vehicles[vehicleIndex].status = status;
        if (dailyRate) vehicles[vehicleIndex].dailyRate = parseFloat(dailyRate);
        if (lastMaintenance) vehicles[vehicleIndex].lastMaintenance = lastMaintenance;

        saveVehicles(vehicles);

        res.json({ 
            success: true, 
            message: "Vehicle updated successfully",
            vehicle: vehicles[vehicleIndex]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
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
            savedBy: req.user.username
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
        const { bookingRef, clientEmail, clientName, quoteData } = req.body;
        
        if (!bookingRef || !clientEmail) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        // quoteData from frontend is the full quoteRecord: { totalAmount, rentalType, quoteData: {...}, ... }
        const totalAmount = quoteData?.totalAmount || 'N/A';
        const rentalType  = quoteData?.rentalType  || 'unknown';
        const qd          = quoteData?.quoteData   || {};   // flat detail object

        const vehicleType   = qd.vehicleType   || '—';
        const serviceOption = qd.serviceOption || '—';
        const itinerary     = qd.itinerary     || '';
        const pickupAddress = qd.pickupAddress || '—';
        const returnAddress = qd.returnAddress || '—';

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
        const row = (label, value) => value > 0
            ? `<tr><td style="padding:8px 12px;color:#475569;border-bottom:1px solid #f1f5f9;">${label}</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;">₱${value.toFixed(2)}</td></tr>`
            : '';

        let breakdownRows = '';
        if (rentalType === 'with-driver') {
            const fuelCost  = bd.consumption > 0 ? (bd.distance / bd.consumption) * bd.fuelPrice : 0;
            const baseTotal = bd.unitBase * bd.driverDays;
            const otTotal   = bd.overtime * bd.driverOtHours;

            breakdownRows += row(`Rental Rate (₱${(bd.unitBase||0).toFixed(2)} × ${bd.driverDays||0} Day/s)`, baseTotal);
            if (bd.driverOtHours > 0) breakdownRows += row(`Overtime Fee (₱${(bd.overtime||0).toFixed(2)} × ${bd.driverOtHours} Hr/s)`, otTotal);
            if (fuelCost > 0) breakdownRows += row(`Calculated Fuel Cost (${bd.distance}km @ ₱${bd.fuelPrice}/L, ${bd.consumption}km/L)`, fuelCost);
            breakdownRows += row('Toll Fees',               bd.tollFees   || 0);
            breakdownRows += row('Parking Fees',            bd.parkingFees|| 0);
            breakdownRows += row("Driver's Fee",            bd.driverFee  || 0);
            breakdownRows += row('Meals',                   bd.meals      || 0);
            breakdownRows += row('Lodging / Accommodation', bd.lodging    || 0);
            breakdownRows += row('Miscellaneous Expenses',  bd.misc       || 0);
        } else {
            const baseTotal = bd.unitBase * bd.days;
            const otTotal   = bd.overtime * bd.selfOtHours;

            breakdownRows += row(`Rental Rate (₱${(bd.unitBase||0).toFixed(2)} × ${bd.days||0} Day/s)`, baseTotal);
            if (bd.selfOtHours > 0) breakdownRows += row(`Overtime Fee (₱${(bd.overtime||0).toFixed(2)} × ${bd.selfOtHours} Hr/s)`, otTotal);
            breakdownRows += row('Delivery Fee',   bd.delivery  || 0);
            breakdownRows += row('Return Fee',     bd.return    || 0);
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
            <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Return Location</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${returnAddress}</td></tr>` : '';

        const itinerarySection = itinerary ? `
            <div style="margin-bottom:20px;">
                <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0f172a;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;margin-bottom:10px;">&#128506; Destination / Itinerary</div>
                <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:12px 16px;border-radius:0 6px 6px 0;font-size:13px;color:#334155;line-height:1.6;">${itinerary}</div>
            </div>` : '';

        if (DEBUG) console.log(`[EMAIL DEBUG] rentalType=${rentalType}, vehicleType=${vehicleType}, pickDate=${rawPickDate}, qd keys=${Object.keys(qd).join(',')}`);

        const htmlTemplate = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f1f5f9;color:#1e293b;">
<div style="padding:24px 0;">
<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a);color:#fff;padding:32px 24px;text-align:center;">
    <div style="font-size:28px;margin-bottom:10px;">&#128664;</div>
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;letter-spacing:-0.5px;">MAYON RENT A CAR</h1>
    <p style="margin:0;font-size:13px;opacity:0.85;">Your Trusted Rental Partner in Bicol</p>
  </div>

  <!-- Body -->
  <div style="padding:28px 24px;">
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
        <tr><td style="padding:7px 0;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.5px;width:45%;">Pickup Location</td><td style="padding:7px 0;font-size:13px;font-weight:500;">${pickupAddress}</td></tr>
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
        const { data, error } = await resend.emails.send({
            from: 'Mayon Rent a Car <no-reply@mayonrentacar.com.ph>', // Verified Resend domain!
            to: [clientEmail],
            subject: `Quotation for Your Car Rental Booking [${bookingRef}]`,
            replyTo: 'mayonrentacar@gmail.com',                      // Kapag nag-reply si client, rekta sa normal gmail niyo!
            html: htmlTemplate,
            headers: {
                'X-Mailer': 'Mayon Rent a Car Booking System',
                'Precedence': 'bulk'
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

app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
});