const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeVehicleSubmission, createApprovedVehicle } = require('./vehicle-approvals');

const validSubmission = {
    plate: ' abc-123 ',
    make: ' Toyota ',
    model: ' Corolla ',
    year: 2024,
    type: 'Sedan',
    color: 'White',
    seats: 5,
    transmission: 'Automatic',
    fuelType: 'Gasoline',
    dailyRate: 2500
};

test('normalizes submitted vehicle details and plate number', () => {
    assert.deepEqual(normalizeVehicleSubmission(validSubmission), {
        plate: 'ABC-123',
        make: 'Toyota',
        model: 'Corolla',
        year: 2024,
        type: 'Sedan',
        color: 'White',
        seats: 5,
        transmission: 'Automatic',
        fuelType: 'Gasoline',
        dailyRate: 2500
    });
});

test('rejects incomplete or invalid vehicle submissions', () => {
    assert.throws(() => normalizeVehicleSubmission({ ...validSubmission, make: ' ' }), /make is required/);
    assert.throws(() => normalizeVehicleSubmission({ ...validSubmission, seats: 0 }), /Seats must be an integer/);
    assert.throws(() => normalizeVehicleSubmission({ ...validSubmission, dailyRate: -1 }), /Daily rate must be/);
});

test('allows vehicle submissions without a daily rate', () => {
    const { dailyRate, ...submission } = validSubmission;

    const request = {
        ...normalizeVehicleSubmission(submission),
        id: 'VAPR-2',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate'
    };
    const vehicle = createApprovedVehicle(request, 'VEH-2', '2025-01-01T00:00:00.000Z');

    assert.equal(Object.hasOwn(vehicle, 'dailyRate'), false);
});

test('creates approved fleet vehicles with affiliate ownership and available status', () => {
    const request = {
        ...normalizeVehicleSubmission(validSubmission),
        id: 'VAPR-1',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate'
    };

    assert.deepEqual(createApprovedVehicle(request, 'VEH-1', '2025-01-01T00:00:00.000Z'), {
        id: 'VEH-1',
        ...normalizeVehicleSubmission(validSubmission),
        status: 'Available',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate',
        approvalRequestId: 'VAPR-1',
        created_at: '2025-01-01T00:00:00.000Z',
        lastMaintenance: '2025-01-01T00:00:00.000Z'
    });
});
