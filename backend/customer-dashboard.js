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
    'vehicleId',
    'requestedVehicleId',
    'status',
    'created_at',
    'cancellationRequestedAt',
    'paymentProofs'
];

function getCustomerBookings(bookings, user) {
    const userId = String(user?.id || '').trim();
    if (!userId) return [];

    return bookings
        .filter(booking => {
            if (!booking || typeof booking !== 'object') return false;
            const linkedCustomerId = String(booking.customerId || '').trim();
            return linkedCustomerId === userId;
        })
        .map(booking => Object.fromEntries(
            CUSTOMER_BOOKING_FIELDS.map(field => [field, booking[field] ?? null])
        ));
}

module.exports = { getCustomerBookings };
