const assert = require('assert');
const { buildOperationalReport } = require('./operational-reports');

const report = buildOperationalReport([
    { status: 'Confirmed', pickup_date: '2026-11-01', rentalType: 'self-drive', serviceOption: '—', area: 'Albay', vehicleType: 'Sedan' },
    { status: 'Completed', pickup_date: '2026-11-02', rentalType: 'with-driver', serviceOption: 'Airport Transfer', area: 'albay', vehicleType: 'MPV' },
    { status: 'Cancelled - Lost', pickup_date: '2026-11-03', rentalType: 'self-drive', serviceOption: '—', area: 'Sorsogon', vehicleType: 'Sedan' },
    { status: 'Open', pickup_date: '2026-10-31', rentalType: 'self-drive', area: 'Albay', vehicleType: 'Sedan' },
    { status: 'Open', pickup_date: 'invalid', rentalType: 'self-drive', area: 'Albay', vehicleType: 'Sedan' }
], [
    { status: 'Available' },
    { status: 'Maintenance' }
], { from: '2026-11-01', to: '2026-11-03' });

assert.deepStrictEqual(report.summary, {
    totalBookings: 3,
    cancelledBookings: 1,
    cancellationRate: 33.3,
    activeFleetVehicles: 1
});
assert.deepStrictEqual(report.bookingsByService, [
    { label: 'Self-Drive', count: 2 },
    { label: 'Airport Transfer', count: 1 }
]);
assert.deepStrictEqual(report.bookingsByLocation, [
    { label: 'Albay', count: 2 },
    { label: 'Sorsogon', count: 1 }
]);
assert.deepStrictEqual(report.vehicleTypeDemand, [
    { label: 'MPV', count: 1 },
    { label: 'Sedan', count: 1 }
]);
assert.deepStrictEqual(report.cancellationsByStatus, [{ label: 'Cancelled - Lost', count: 1 }]);
assert.throws(() => buildOperationalReport([], [], { from: '2026-02-30' }), TypeError);
assert.throws(() => buildOperationalReport([], [], { from: '2026-11-03', to: '2026-11-01' }), RangeError);

console.log('operational report tests passed');
