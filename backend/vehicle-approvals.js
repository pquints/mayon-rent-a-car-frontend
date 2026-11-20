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
    const currentYear = new Date().getFullYear();

    if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
        throw new Error('Year must be a valid four-digit year.');
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 100) {
        throw new Error('Seats must be an integer between 1 and 100.');
    }
    if (rateInput && (!Number.isFinite(Number(rateInput)) || Number(rateInput) < 0)) {
        throw new Error('Daily rate must be a non-negative number.');
    }

    return {
        ...vehicle,
        year,
        seats,
        ...(rateInput ? { dailyRate: Number(rateInput) } : {})
    };
}

function createApprovedVehicle(request, id, now = new Date().toISOString()) {
    const {
        plate, make, model, year, type, color, seats, transmission, fuelType, dailyRate,
        affiliateId, affiliateName
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
        ...(dailyRate === undefined ? {} : { dailyRate }),
        affiliateId,
        affiliateName,
        approvalRequestId: request.id,
        created_at: now,
        lastMaintenance: now
    };
}

module.exports = { normalizeVehicleSubmission, createApprovedVehicle };
