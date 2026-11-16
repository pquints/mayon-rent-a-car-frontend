function normalizeIsoDate(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value.trim());
    if (!match) return null;

    const date = match[1];
    const timestamp = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
        ? date
        : null;
}

function groupCounts(items, getLabel) {
    const groups = new Map();
    items.forEach(item => {
        const label = getLabel(item) || 'Unspecified';
        const key = label.toLowerCase();
        const group = groups.get(key);
        if (group) {
            group.count += 1;
        } else {
            groups.set(key, { label, count: 1 });
        }
    });

    return [...groups.values()].sort((first, second) =>
        second.count - first.count || first.label.localeCompare(second.label)
    );
}

function getLabel(value) {
    const label = String(value || '').trim().replace(/\s+/g, ' ');
    return !label || ['—', '-', 'n/a', 'na'].includes(label.toLowerCase()) ? '' : label;
}

function isCancelled(booking) {
    return String(booking.status || '').trim().toLowerCase().startsWith('cancelled');
}

function buildOperationalReport(bookings, vehicles, { from, to } = {}) {
    if (!Array.isArray(bookings) || !Array.isArray(vehicles)) {
        throw new TypeError('Bookings and vehicles must be arrays.');
    }

    if ((from && !normalizeIsoDate(from)) || (to && !normalizeIsoDate(to))) {
        throw new TypeError('Report dates must be valid ISO calendar dates.');
    }
    if (from && to && from > to) {
        throw new RangeError('The report start date must not be after the end date.');
    }

    const filteredBookings = bookings.filter(booking => {
        if (!from && !to) return true;
        const pickupDate = normalizeIsoDate(booking.pickup_date);
        return Boolean(pickupDate && (!from || pickupDate >= from) && (!to || pickupDate <= to));
    });
    const cancelledBookings = filteredBookings.filter(isCancelled);
    const activeBookings = filteredBookings.filter(booking => !isCancelled(booking));
    const cancelledByStatus = groupCounts(cancelledBookings, booking => getLabel(booking.status));
    const totalBookings = filteredBookings.length;

    return {
        dateBasis: 'pickup_date',
        from: from || null,
        to: to || null,
        summary: {
            totalBookings,
            cancelledBookings: cancelledBookings.length,
            cancellationRate: totalBookings
                ? Math.round((cancelledBookings.length / totalBookings) * 1000) / 10
                : 0,
            activeFleetVehicles: vehicles.filter(vehicle =>
                String(vehicle.status || '').trim().toLowerCase() === 'available'
            ).length
        },
        bookingsByService: groupCounts(filteredBookings, booking => {
            const serviceOption = getLabel(booking.serviceOption);
            if (serviceOption) return serviceOption;
            const rentalType = String(booking.rentalType || '').trim().toLowerCase();
            if (rentalType === 'self-drive') return 'Self-Drive';
            if (rentalType === 'with-driver') return 'With Driver';
            return getLabel(booking.rentalType);
        }),
        bookingsByLocation: groupCounts(filteredBookings, booking => getLabel(booking.area)),
        vehicleTypeDemand: groupCounts(activeBookings, booking => getLabel(booking.vehicleType)),
        cancellationsByStatus: cancelledByStatus
    };
}

module.exports = { buildOperationalReport, isValidReportDate: value => Boolean(normalizeIsoDate(value)) };
