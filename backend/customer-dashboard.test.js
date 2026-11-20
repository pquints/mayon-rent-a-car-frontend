const assert = require('node:assert/strict');
const { getCustomerBookings } = require('./customer-dashboard');

const user = { id: 'customer-1', email: 'customer@example.com' };
const bookings = [
    null,
    {
        ref: 'LEGACY-MATCH',
        email: ' Customer@Example.com ',
        contact_no: 'private contact',
        status: 'Quoted'
    },
    {
        ref: 'ID-MATCH',
        customerId: 'customer-1',
        email: 'old-address@example.com',
        status: 'Confirmed'
    },
    {
        ref: 'ID-MISMATCH',
        customerId: 'customer-2',
        email: 'customer@example.com',
        status: 'Open'
    },
    {
        ref: 'OTHER-EMAIL',
        email: 'someone-else@example.com',
        status: 'Open'
    }
];

const result = getCustomerBookings(bookings, user);
assert.deepEqual(result.map(booking => booking.ref), ['ID-MATCH']);
assert.equal(Object.hasOwn(result[0], 'contact_no'), false);
assert.equal(Object.hasOwn(result[0], 'email'), false);
assert.deepEqual(getCustomerBookings(bookings, {}), []);

console.log('Customer dashboard booking-scope tests passed.');
