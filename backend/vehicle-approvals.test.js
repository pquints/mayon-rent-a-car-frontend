const assert = require('node:assert/strict');
const test = require('node:test');
const {
    normalizeVehicleSubmission,
    normalizeVehicleMetadata,
    createApprovedVehicle,
    updateApprovedVehicle
} = require('./vehicle-approvals');

const validSubmission = {
    plate: ' abc-123 ',
    make: ' Toyota ',
    model: ' Corolla ',
    year: 2024,
    type: 'Sedan',
    color: 'White',
    seats: 5,
    transmission: 'Automatic',
    fuelType: 'Gasoline'
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
        fuelType: 'Gasoline'
    });
});

test('rejects incomplete or invalid vehicle submissions', () => {
    assert.throws(() => normalizeVehicleSubmission({ ...validSubmission, make: ' ' }), /make is required/);
    assert.throws(() => normalizeVehicleSubmission({ ...validSubmission, seats: 0 }), /Seats must be an integer/);
});

test('ignores affiliate-submitted daily rates', () => {
    const submission = normalizeVehicleSubmission({ ...validSubmission, dailyRate: 2500 });
    assert.equal(Object.hasOwn(submission, 'dailyRate'), false);
});

test('normalizes optional registration, insurance, and maintenance details', () => {
    assert.deepEqual(normalizeVehicleMetadata({
        orCrExpiryDate: '2027-03-15',
        insuranceProvider: '  Mayon Insurance ',
        insurancePolicyNumber: ' POL-123 ',
        insuranceExpiryDate: '2027-08-20',
        odometerReading: '42500',
        nextPmsDate: '2026-12-01',
        gpsTrackerId: ' GPS-42 '
    }), {
        orCrExpiryDate: '2027-03-15',
        insuranceProvider: 'Mayon Insurance',
        insurancePolicyNumber: 'POL-123',
        insuranceExpiryDate: '2027-08-20',
        odometerReading: 42500,
        nextPmsDate: '2026-12-01',
        gpsTrackerId: 'GPS-42'
    });
});

test('rejects malformed dates and invalid odometer readings', () => {
    assert.throws(() => normalizeVehicleMetadata({ orCrExpiryDate: '2027-02-30' }), /valid date/);
    assert.throws(() => normalizeVehicleMetadata({ odometerReading: '-1' }), /non-negative whole number/);
    assert.throws(() => normalizeVehicleMetadata({ odometerReading: '12.5' }), /non-negative whole number/);
});

test('creates approved fleet vehicles with affiliate ownership and available status', () => {
    const request = {
        ...normalizeVehicleSubmission(validSubmission),
        id: 'VAPR-1',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate',
        orCrExpiryDate: '2027-03-15',
        insuranceProvider: 'Mayon Insurance',
        insurancePolicyNumber: 'POL-123',
        insuranceExpiryDate: '2027-08-20',
        odometerReading: 42500,
        nextPmsDate: '2026-12-01',
        gpsTrackerId: 'GPS-42',
        exteriorPhotos: [{ filename: 'outside.jpg', storage: 'vehicle' }],
        interiorPhotos: [{ filename: 'inside.jpg', storage: 'vehicle' }]
    };

    assert.deepEqual(createApprovedVehicle(request, 'VEH-1', '2025-01-01T00:00:00.000Z'), {
        id: 'VEH-1',
        ...normalizeVehicleSubmission(validSubmission),
        status: 'Available',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate',
        photo: null,
        photoStorage: null,
        documents: [],
        exteriorPhotos: [{ filename: 'outside.jpg', storage: 'vehicle' }],
        interiorPhotos: [{ filename: 'inside.jpg', storage: 'vehicle' }],
        orCrExpiryDate: '2027-03-15',
        insuranceProvider: 'Mayon Insurance',
        insurancePolicyNumber: 'POL-123',
        insuranceExpiryDate: '2027-08-20',
        odometerReading: 42500,
        nextPmsDate: '2026-12-01',
        gpsTrackerId: 'GPS-42',
        approvalRequestId: 'VAPR-1',
        created_at: '2025-01-01T00:00:00.000Z',
        lastMaintenance: '2025-01-01T00:00:00.000Z'
    });
});

test('applies approved affiliate edits without changing ownership or vehicle status', () => {
    const existing = {
        id: 'VEH-1',
        affiliateId: 'USR-1',
        affiliateName: 'Alex Affiliate',
        status: 'Maintenance',
        plate: 'ABC-123',
        dailyRate: 3200,
        documents: [{ filename: 'old-orcr.pdf' }],
        exteriorPhotos: [],
        interiorPhotos: [],
        created_at: '2025-01-01T00:00:00.000Z'
    };
    const request = {
        ...normalizeVehicleSubmission({ ...validSubmission, plate: 'XYZ-789' }),
        ...normalizeVehicleMetadata({ odometerReading: '50000', gpsTrackerId: 'GPS-99' }),
        id: 'VAPR-2',
        documents: [{ filename: 'new-insurance.pdf', storage: 'vehicle' }],
        exteriorPhotos: [{ filename: 'new-exterior.jpg', storage: 'vehicle' }]
    };
    const updated = updateApprovedVehicle(existing, request, '2026-01-01T00:00:00.000Z');

    assert.equal(updated.id, 'VEH-1');
    assert.equal(updated.affiliateId, 'USR-1');
    assert.equal(updated.affiliateName, 'Alex Affiliate');
    assert.equal(updated.status, 'Maintenance');
    assert.equal(updated.plate, 'XYZ-789');
    assert.equal(updated.dailyRate, 3200);
    assert.equal(updated.odometerReading, 50000);
    assert.equal(updated.gpsTrackerId, 'GPS-99');
    assert.deepEqual(updated.documents, [
        { filename: 'old-orcr.pdf' },
        { filename: 'new-insurance.pdf', storage: 'vehicle' }
    ]);
    assert.deepEqual(updated.exteriorPhotos, [{ filename: 'new-exterior.jpg', storage: 'vehicle' }]);
    assert.equal(updated.updated_at, '2026-01-01T00:00:00.000Z');
    assert.equal(updated.created_at, existing.created_at);
});
