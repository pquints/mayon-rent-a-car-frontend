require('dotenv').config();
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const API = process.env.API_URL || 'http://127.0.0.1:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

async function run() {
  try {
    // generate admin token locally
    const token = jwt.sign({ id: 'USR-ADMIN', username: 'admin', role: 'admin', email: 'admin@mayonrentacar.com' }, JWT_SECRET, { expiresIn: '24h' });
    console.log('Using token:', token.substring(0, 20) + '...');

    // 1) create booking (public endpoint)
    const bookingRes = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Smoke Test Client',
        contact_no: '09171234567',
        email: 'smoke@example.com',
        area: 'legazpi',
        rentalType: 'with-driver',
        serviceOption: 'Airport Transfer',
        vehicleType: 'Sedan',
        passengers: 2,
        pickup_date: '2026-07-04',
        pickup_time: '09:00',
        pickup_address: 'Test Address',
        itinerary: 'Test itinerary'
      })
    });
    const bookingJson = await bookingRes.json();
    console.log('Create booking response:', bookingJson);

    const bookingRef = bookingJson.booking?.ref || bookingJson.ref || bookingJson.booking?.ref;
    if (!bookingRef) {
      console.error('Failed to create booking, aborting smoke test.');
      return;
    }

    // 2) save quote (admin)
    const quoteRes = await fetch(`${API}/quotes`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ bookingRef, totalAmount: '₱1234.00', rentalType: 'with-driver', quoteData: { breakdownDetails: { unitBase: 1234, driverDays: 1 } } })
    });
    console.log('/quotes ->', await quoteRes.json());

    // 3) send quotation email (admin)
    const emailRes = await fetch(`${API}/send-quotation-email`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ bookingRef, clientEmail: 'smoke@example.com', clientName: 'Smoke Client', quoteData: {} })
    });
    console.log('/send-quotation-email ->', await emailRes.json());

    // 4) create user (admin)
    const userRes = await fetch(`${API}/users`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ username: 'smoke_user', password: 'Password123!', email: 'smoke_user@example.com', fullname: 'Smoke User', role: 'driver' })
    });
    console.log('/users ->', await userRes.json());

    // 5) create vehicle (admin)
    const vehRes = await fetch(`${API}/vehicles`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ plate: 'SMK-001', make: 'Test', model: 'Car', year: 2022, type: 'Sedan', color: 'White', seats: 4, transmission: 'Automatic', fuelType: 'Gasoline', status: 'Available', dailyRate: 1000 })
    });
    console.log('/vehicles ->', await vehRes.json());

    console.log('Smoke test completed');
  } catch (err) {
    console.error('Smoke test error:', err);
  }
}

run();
