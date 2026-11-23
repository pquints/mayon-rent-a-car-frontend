function normalizeVehicleSubmission(input) {
    const textFields = ['plate', 'make', 'model', 'type', 'color', 'transmission', 'fuelType'];
    const vehicle = Object.fromEntries(textFields.map(field => [
        field,
        String(input?.[field] ?? '').trim()
    ]));
    vehicle.plate = vehicle.plate.toUpperCase();

    for (const field of textFields) {
        if (!vehicle[field]) throw new Error(`${field} is required.`);
        if (vehicle[field].length > 100) throw new Error(`${field} is too long.`);
    }

    const year = Number(input?.year);
    const seats = Number(input?.seats);
    const rateInput = String(input?.dailyRate ?? '').trim();
    const dailyRate = Number(rateInput);
    const currentYear = new Date().getFullYear();

    if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
        throw new Error('Year must be a valid four-digit year.');
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 100) {
        throw new Error('Seats must be an integer between 1 and 100.');
    }
    if (rateInput && (!Number.isFinite(dailyRate) || dailyRate < 0)) {
        throw new Error('Daily rate must be a non-negative number.');
    }

    return {
        ...vehicle,
        year,
        seats,
        ...(rateInput ? { dailyRate } : {})
    };
}

function normalizeVehicleMetadata(input) {
    const textFields = {
        insuranceProvider: 120,
        insurancePolicyNumber: 100,
        gpsTrackerId: 100
    };
    const metadata = Object.fromEntries(Object.entries(textFields).map(([field, maxLength]) => {
        const value = String(input?.[field] ?? '').trim();
        if (value.length > maxLength) throw new Error(`${field} is too long.`);
        return [field, value];
    }));

    for (const field of ['orCrExpiryDate', 'insuranceExpiryDate', 'nextPmsDate']) {
        const value = String(input?.[field] ?? '').trim();
        if (!value) {
            metadata[field] = '';
            continue;
        }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
        if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
            throw new Error(`${field} must be a valid date.`);
        }
        metadata[field] = value;
    }

    const odometerInput = String(input?.odometerReading ?? '').trim();
    if (!odometerInput) {
        metadata.odometerReading = null;
    } else {
        const odometerReading = Number(odometerInput);
        if (!Number.isInteger(odometerReading) || odometerReading < 0 || odometerReading > 1000000000) {
            throw new Error('Odometer reading must be a non-negative whole number.');
        }
        metadata.odometerReading = odometerReading;
    }

    return metadata;
}

function createApprovedVehicle(request, id, now = new Date().toISOString()) {
    const {
        plate, make, model, year, type, color, seats, transmission, fuelType, dailyRate,
        affiliateId, affiliateName, photo, photoStorage, documents,
        exteriorPhotos, interiorPhotos, orCrExpiryDate, insuranceProvider,
        insurancePolicyNumber, insuranceExpiryDate, odometerReading, nextPmsDate, gpsTrackerId
    } = request;

    return {
        id,
        plate,
        make,
        model,
        year,
        type,
        color,
        seats,
        transmission,
        fuelType,
        status: 'Available',
        dailyRate,
        affiliateId,
        affiliateName,
        photo: photo || null,
        photoStorage: photoStorage || null,
        documents: Array.isArray(documents) ? documents : [],
        exteriorPhotos: Array.isArray(exteriorPhotos) ? exteriorPhotos : [],
        interiorPhotos: Array.isArray(interiorPhotos) ? interiorPhotos : [],
        orCrExpiryDate: orCrExpiryDate || '',
        insuranceProvider: insuranceProvider || '',
        insurancePolicyNumber: insurancePolicyNumber || '',
        insuranceExpiryDate: insuranceExpiryDate || '',
        odometerReading: odometerReading ?? null,
        nextPmsDate: nextPmsDate || '',
        gpsTrackerId: gpsTrackerId || '',
        approvalRequestId: request.id,
        created_at: now,
        lastMaintenance: now
    };
}

function updateApprovedVehicle(vehicle, request, now = new Date().toISOString()) {
    const updated = { ...vehicle };
    const fields = [
        'plate', 'make', 'model', 'year', 'type', 'color', 'seats', 'transmission',
        'fuelType', 'dailyRate', 'orCrExpiryDate', 'insuranceProvider',
        'insurancePolicyNumber', 'insuranceExpiryDate', 'odometerReading',
        'nextPmsDate', 'gpsTrackerId'
    ];
    fields.forEach(field => {
        if (Object.hasOwn(request, field)) updated[field] = request[field];
    });

    if (request.photo) {
        updated.photo = request.photo;
        updated.photoStorage = request.photoStorage || null;
    }
    ['documents', 'exteriorPhotos', 'interiorPhotos'].forEach(field => {
        if (Array.isArray(request[field]) && request[field].length) {
            updated[field] = [
                ...(Array.isArray(vehicle[field]) ? vehicle[field] : []),
                ...request[field]
            ];
        }
    });
    updated.approvalRequestId = request.id;
    updated.updated_at = now;
    return updated;
}

module.exports = {
    normalizeVehicleSubmission,
    normalizeVehicleMetadata,
    createApprovedVehicle,
    updateApprovedVehicle
};
