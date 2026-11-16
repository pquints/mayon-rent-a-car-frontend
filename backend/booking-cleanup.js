const manilaDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

function getManilaDate(date) {
    const parts = Object.fromEntries(
        manilaDateFormatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(({ type, value }) => [type, value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getPickupDate(booking) {
    if (typeof booking.pickup_date !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(booking.pickup_date.trim());
    if (!match) return null;

    const pickupDate = match[1];
    const timestamp = Date.parse(`${pickupDate}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== pickupDate) {
        return null;
    }

    return pickupDate;
}

function autoCancelPastQuotedBookings(bookings, now = new Date()) {
    if (!Array.isArray(bookings)) throw new TypeError('Bookings must be an array.');

    const todayInManila = getManilaDate(now);
    const cancelledAt = now.toISOString();
    let cancelledCount = 0;

    const updatedBookings = bookings.map(booking => {
        if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return booking;
        if (typeof booking.status !== 'string' || booking.status.trim().toLowerCase() !== 'quoted') return booking;

        const pickupDate = getPickupDate(booking);
        if (!pickupDate || pickupDate >= todayInManila) return booking;

        cancelledCount += 1;
        return {
            ...booking,
            status: 'Cancelled',
            auto_cancelled_at: cancelledAt,
            auto_cancel_reason: 'Pickup date passed while booking remained quoted'
        };
    });

    return { bookings: updatedBookings, cancelledCount };
}

module.exports = { autoCancelPastQuotedBookings };
