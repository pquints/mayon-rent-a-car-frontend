function buildBookingNotificationMessage(booking = {}) {
    const lines = [
        'New booking received',
        `Reference: ${booking.ref || '—'}`,
        `Customer: ${booking.name || '—'}`,
        `Contact: ${booking.contact_no || '—'}`,
        `Email: ${booking.email || '—'}`,
        `Pickup: ${booking.pickup_date || '—'} ${booking.pickup_time || '—'}`,
        `Pickup Address: ${booking.pickup_address || '—'}`,
        `Rental Type: ${booking.rentalType || '—'}`,
        `Service: ${booking.serviceOption || '—'}`,
        `Vehicle: ${booking.vehicleType || '—'}`,
        `Passengers: ${booking.passengers || '—'}`
    ];

    return lines.join('\n');
}

async function sendTelegramNotification(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || '';

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Telegram notification failed: ${response.status} ${text}`);
    }

    return { ok: true, channel: 'telegram' };
}

async function sendBookingNotification(booking = {}) {
    const message = buildBookingNotificationMessage(booking);
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
    const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
    const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
    const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || '';
    const targetPhone = process.env.WHATSAPP_TO || process.env.TWILIO_TO || '';
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL || '';

    if (!telegramToken && !telegramChatId && !twilioSid && !webhookUrl) {
        return { ok: true, skipped: 'No notification target configured' };
    }

    if (telegramToken && telegramChatId) {
        return sendTelegramNotification(message);
    }

    if (twilioSid && twilioToken && twilioFrom && targetPhone) {
        const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const body = new URLSearchParams({
            To: `whatsapp:${targetPhone}`,
            From: twilioFrom,
            Body: message
        });

        const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json', {
            method: 'POST',
            headers: {
                Authorization: authHeader,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Twilio WhatsApp notification failed: ${response.status} ${text}`);
        }

        return { ok: true, channel: 'whatsapp', provider: 'twilio' };
    }

    if (webhookUrl) {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, booking, channel: 'webhook' })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Webhook notification failed: ${response.status} ${text}`);
        }

        return { ok: true, channel: 'webhook' };
    }

    throw new Error('Notification service is not fully configured.');
}

module.exports = {
    buildBookingNotificationMessage,
    sendTelegramNotification,
    sendBookingNotification
};
