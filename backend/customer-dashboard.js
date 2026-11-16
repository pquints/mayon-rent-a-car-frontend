const CUSTOMER_BOOKING_FIELDS = [
    'ref',
    'name',
    'area',
    'rentalType',
    'serviceOption',
    'vehicleType',
    'passengers',
    'pickup_date',
    'pickup_time',
    'pickup_address',
    'pickup_location_address',
    'pickup_flight_number',
    'return_date',
    'return_time',
    'return_address',
    'return_location_address',
    'return_flight_number',
    'itinerary',
    'status',
    'created_at'
];

function getCustomerBookings(bookings, user) {
    const userId = String(user?.id || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!userId && !email) return [];

    return bookings
        .filter(booking => {
            if (!booking || typeof booking !== 'object') return false;
            const linkedCustomerId = String(booking.customerId || '').trim();
            if (linkedCustomerId) return linkedCustomerId === userId;
            return email && String(booking.email || '').trim().toLowerCase() === email;
        })
        .map(booking => Object.fromEntries(
            CUSTOMER_BOOKING_FIELDS.map(field => [field, booking[field] ?? null])
        ));
}

module.exports = { getCustomerBookings };
