const AFFILIATE_SHARE_PERCENT = 70;

function parseMoney(value) {
    const amount = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function getAffiliateBookings(bookings, vehicles, quotes, affiliateId) {
    const affiliateVehicles = new Map(
        vehicles
            .filter(vehicle => vehicle.affiliateId === affiliateId)
            .map(vehicle => [vehicle.id, vehicle])
    );
    const quoteByBooking = new Map(quotes.map(quote => [quote.bookingRef, quote]));

    return bookings.flatMap(booking => {
        const vehicle = affiliateVehicles.get(booking.vehicleId);
        if (!vehicle) return [];

        const quote = quoteByBooking.get(booking.ref);
        const totalAmount = parseMoney(quote?.totalAmount);
        const completed = String(booking.status || '').trim().toLowerCase() === 'completed';

        return [{
            ref: booking.ref,
            pickup_date: booking.pickup_date || null,
            return_date: booking.return_date || null,
            area: booking.area || null,
            pickup_address: booking.pickup_address || null,
            return_address: booking.return_address || null,
            status: booking.status || 'Unknown',
            vehicle: {
                id: vehicle.id,
                make: vehicle.make || '',
                model: vehicle.model || '',
                plate: vehicle.plate || ''
            },
            affiliateShare: completed && totalAmount
                ? Math.round(totalAmount * AFFILIATE_SHARE_PERCENT) / 100
                : 0,
            hasFinalQuote: Boolean(quote)
        }];
    });
}

function getAffiliateEarnings(affiliateBookings, payoutRequests, affiliateId) {
    const completedBookings = affiliateBookings.filter(booking =>
        String(booking.status).toLowerCase() === 'completed'
    );
    const totalEarnings = completedBookings.reduce((sum, booking) => sum + booking.affiliateShare, 0);
    const requests = payoutRequests.filter(request => request.affiliateId === affiliateId);
    const paidBookingRefs = new Set(
        requests
            .filter(request => request.status === 'Paid')
            .flatMap(request => request.bookingRefs || [])
    );
    const paidAmount = requests
        .filter(request => request.status === 'Paid')
        .reduce((sum, request) => sum + parseMoney(request.amount), 0);
    const requestedBookingRefs = new Set(
        requests
            .filter(request => request.status !== 'Rejected')
            .flatMap(request => request.bookingRefs || [])
    );
    const availableToRequest = completedBookings
        .filter(booking => !requestedBookingRefs.has(booking.ref))
        .reduce((sum, booking) => sum + booking.affiliateShare, 0);

    return {
        sharePercent: AFFILIATE_SHARE_PERCENT,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        payoutBalance: Math.round(Math.max(0, totalEarnings - paidAmount) * 100) / 100,
        availableToRequest: Math.round(availableToRequest * 100) / 100,
        paidBookingRefs: Array.from(paidBookingRefs),
        requests: requests.map(({ id, amount, status, requestedAt, paidAt, reviewNote }) => ({
            id,
            amount: parseMoney(amount),
            status,
            requestedAt,
            paidAt: paidAt || null,
            reviewNote: reviewNote || ''
        }))
    };
}

module.exports = {
    AFFILIATE_SHARE_PERCENT,
    getAffiliateBookings,
    getAffiliateEarnings,
    parseMoney
};
