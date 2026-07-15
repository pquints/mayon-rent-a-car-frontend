# Backend (MRAC Website v2)

This folder contains the Express backend used locally for development and production.

## Production checklist

- Create a `.env` from `.env.example` and fill real values (do NOT commit `.env`).
  - `JWT_SECRET` must be a strong, unique secret.
  - `GMAIL_USER` and `GMAIL_APP_PASSWORD` — set production email (or use a transactional email provider).
  - `RESEND_API_KEY` — required for quotation emails via Resend.
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

## Notes

- Keep `.env` out of version control.
- If any secret was ever committed, rotate it first, then remove it from git history.
- Rotate `JWT_SECRET` and other credentials if they become exposed.
- Turn off `DEBUG` in production to avoid leaking sensitive logs.
