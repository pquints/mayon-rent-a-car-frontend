# Backend (MRAC Website v2)

This folder contains the Express backend used locally for development and production.

## Production checklist

- Create a `.env` from `.env.example` and fill real values (do NOT commit `.env`).
  - `JWT_SECRET` must be a strong, unique secret.
  - `GMAIL_USER` and `GMAIL_APP_PASSWORD` — set production email (or use a transactional email provider).
  - `RESEND_API_KEY` — required for quotation emails via Resend.
  - `QUOTATION_CC_EMAILS` — optional comma-separated emails to auto-CC on quotation sends (e.g. `ops@domain.com,sales@domain.com`). If omitted, it falls back to `GMAIL_USER` or `mayonrentacar@gmail.com`.
  - Optional notification settings for WhatsApp/Viber-style alerts: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_TO`, or `NOTIFICATION_WEBHOOK_URL`.
  - Set `DEBUG=false` in production.

- Ensure `PORT` is set to the desired listening port (e.g., `3000`).

- Add your production host to CORS in `server.js` if needed (the server currently allows all origins via `cors()`; consider tightening this).

- Run and test the server locally before pointing DNS:

```bash
# from backend folder
npm install
cp .env.example .env
# edit .env to production values
npm start
```

- For deployment, use a process manager (PM2/systemd) or platform (Render, Heroku, DigitalOcean App Platform, VPS). Ensure HTTPS termination (proxy or built-in) and environment variables are set securely.

## Quick local smoke test

To run the included smoke test (it will create or use an existing booking ref):

```bash
# from backend folder
# Optionally avoid creating a new booking by passing BOOKING_REF
BOOKING_REF=MRAC-97Z8N npm run smoke
```

## Admin activity and reports

- `GET /api/activity-log` returns the most recent admin activity events. It supports `entityType=booking|user|rate|vehicle`, an exact `entityId` lookup, and a `limit` up to 500.
- `GET /api/reports/operations` returns booking, location, service, cancellation, and vehicle-type demand summaries. Optional `from` and `to` dates filter by pickup date; omitting both includes all bookings.
- Activity events are appended to `activity-log.jsonl`. Only field names and operational summaries are recorded; passwords and edited field values are not stored.
- Vehicle-type demand is a proxy, not actual per-vehicle utilization, until a specific vehicle can be assigned to each booking.
- Quoted bookings with past pickup dates are auto-cancelled on backend startup and hourly; those system status changes are also recorded.

## Fleet vehicle approvals

- Admins and affiliates can open the Fleet menu. Affiliates submit vehicles from **Vehicles**; admins manage the fleet there.
- `POST /api/vehicle-approval-requests` accepts vehicle details from an authenticated affiliate. The affiliate identity is taken from the account, not the request body.
- `GET /api/vehicle-approval-requests` returns all requests to admins and only the signed-in affiliate's requests to affiliates.
- `PATCH /api/vehicle-approval-requests/:id` lets admins approve or reject a pending request. Approval adds the vehicle to the fleet as **Available**; rejected requests remain visible with the optional review note.
- `GET /api/vehicles` returns the full fleet to admins and only that affiliate's approved vehicles to affiliates. Vehicle edits and deletes remain admin-only.
- Approval requests are stored in the ignored runtime file `vehicle-approval-requests.json`; no ownership or request data is added to existing vehicles until approval.

## Notes

- Keep `.env` out of version control.
- If any secret was ever committed, rotate it first, then remove it from git history.
- Rotate `JWT_SECRET` and other credentials if they become exposed.
- Turn off `DEBUG` in production to avoid leaking sensitive logs.
