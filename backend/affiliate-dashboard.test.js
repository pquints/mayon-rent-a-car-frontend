const assert = require('node:assert/strict');
const {
    AFFILIATE_SHARE_PERCENT,
    getAffiliateBookings,
    getAffiliateEarnings
} = require('./affiliate-dashboard');

const vehicles = [
    { id: 'vehicle-own', affiliateId: 'affiliate-1', make: 'Toyota', model: 'Vios', plate: 'ABC-123' },
    { id: 'vehicle-other', affiliateId: 'affiliate-2', make: 'Honda', model: 'City', plate: 'XYZ-987' }
];
const bookings = [
    { ref: 'OWN-COMPLETED', vehicleId: 'vehicle-own', status: 'Completed', pickup_date: '2026-11-01' },
    { ref: 'OWN-ACTIVE', vehicleId: 'vehicle-own', status: 'Confirmed' },
    { ref: 'OTHER-AFFILIATE', vehicleId: 'vehicle-other', status: 'Completed' },
    { ref: 'UNASSIGNED', status: 'Completed' }
];
const quotes = [
    { bookingRef: 'OWN-COMPLETED', totalAmount: '₱10,000.00' },
    { bookingRef: 'OTHER-AFFILIATE', totalAmount: '₱8,000.00' }
];

const affiliateBookings = getAffiliateBookings(bookings, vehicles, quotes, 'affiliate-1');
assert.equal(AFFILIATE_SHARE_PERCENT, 70);
assert.deepEqual(affiliateBookings.map(booking => booking.ref), ['OWN-COMPLETED', 'OWN-ACTIVE']);
assert.equal(affiliateBookings[0].affiliateShare, 7000);
assert.equal(affiliateBookings[1].affiliateShare, 0);
assert.equal(Object.hasOwn(affiliateBookings[0], 'totalAmount'), false);

const earnings = getAffiliateEarnings(affiliateBookings, [], 'affiliate-1');
assert.equal(earnings.totalEarnings, 7000);
assert.equal(earnings.payoutBalance, 7000);
assert.equal(earnings.availableToRequest, 7000);

const paidEarnings = getAffiliateEarnings(affiliateBookings, [{
    affiliateId: 'affiliate-1',
    amount: 7000,
    status: 'Paid',
    bookingRefs: ['OWN-COMPLETED']
}], 'affiliate-1');
assert.equal(paidEarnings.payoutBalance, 0);
assert.equal(paidEarnings.availableToRequest, 0);
