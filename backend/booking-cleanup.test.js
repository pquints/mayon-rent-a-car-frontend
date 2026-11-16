const assert = require('assert');
const { autoCancelPastQuotedBookings } = require('./booking-cleanup');

const now = new Date('2026-11-16T16:30:00.000Z');
const bookings = [
    { ref: 'past', status: 'Quoted', pickup_date: '2026-11-16' },
    { ref: 'past-with-time', status: 'quoted ', pickup_date: '2026-11-15T10:00:00' },
    { ref: 'today', status: 'Quoted', pickup_date: '2026-11-17' },
    { ref: 'open-past', status: 'Open', pickup_date: '2026-11-01' },
    { ref: 'invalid-date', status: 'Quoted', pickup_date: '2026-02-30' },
    { ref: 'missing-date', status: 'Quoted', pickup_date: '—' }
];

const result = autoCancelPastQuotedBookings(bookings, now);

assert.strictEqual(result.cancelledCount, 2);
assert.deepStrictEqual(result.bookings.map(booking => booking.status), [
    'Cancelled',
    'Cancelled',
    'Quoted',
    'Open',
    'Quoted',
    'Quoted'
]);
assert.strictEqual(result.bookings[0].auto_cancelled_at, now.toISOString());
assert.strictEqual(result.bookings[0].auto_cancel_reason, 'Pickup date passed while booking remained quoted');
assert.strictEqual(bookings[0].status, 'Quoted', 'The original bookings array should not be mutated.');

console.log('booking cleanup tests passed');
