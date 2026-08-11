const assert = require('assert');
const { buildBookingNotificationMessage } = require('./notifications');

const booking = {
  ref: 'MRAC-ABC123',
  name: 'Maria Cruz',
  contact_no: '09171234567',
  email: 'maria@example.com',
  pickup_date: '2026-08-20',
  pickup_time: '10:00',
  pickup_address: 'Naga City',
  rentalType: 'airport-transfer',
  serviceOption: 'With Driver',
  vehicleType: 'Sedan',
  passengers: '4'
};

const message = buildBookingNotificationMessage(booking);
assert.ok(message.includes('New booking received'));
assert.ok(message.includes('MRAC-ABC123'));
assert.ok(message.includes('Maria Cruz'));
assert.ok(message.includes('Naga City'));

console.log('notifications tests passed');
