# AUK Smart Parking System

A mobile-first full-stack parking reservation application for AUK faculty parking. The app is designed for phone use first, while desktop users interact with it inside a centered phone-style frame.

## Overview

This app supports three roles:

- `Student`: self-registers with an `@auk.org` email, verifies email ownership, reserves parking, and cancels bookings.
- `Staff`: created by Security/Admin, gets student capabilities plus staff/general lot choice and recurring reservations.
- `Security`: acts as admin, manages users, spot availability, reservation approvals, limits, and the parking map.

## Features

- Mobile-first React app with a phone mockup on desktop
- Email/password authentication with JWT
- Student-only self-registration for `@auk.org` addresses
- Email verification for new student accounts
- Forgot-password and reset-password email flow
- Lot-based reservations for students and staff
- Security-only visual parking map
- Reservation statuses: `pending`, `approved`, `rejected`, `cancelled`, `completed`
- Overlap prevention and 30-minute increment validation
- Student booking window from `07:30` to `20:00` with a 90-minute minimum reservation
- Configurable student active reservation cap
- Staff recurring reservation support
- Security dashboard, approvals, spot management, and user creation
- SQLite persistence with seed data
- Basic backend tests for auth, verification, password reset, role restrictions, overlap logic, student cap, and approval flow

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: SQLite
- DB access: `better-sqlite3`
- Auth: email/password + JWT
- Email: SMTP through `nodemailer`
- Tests: Vitest + Supertest

## Project Structure

```text
auk-smart-parking-system/
├── backend/
│   ├── src/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── app.js
│   │   ├── config.js
│   │   ├── db.js
│   │   ├── seed.js
│   │   └── server.js
│   ├── tests/
│   ├── package.json
│   └── vitest.config.js
├── frontend/
│   ├── src/
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── .env.example
├── package.json
└── README.md
```

## Local Setup

1. Copy `.env.example` to `.env`.

For simple local development, these values are enough:

```env
PORT=4000
JWT_SECRET=change-this-secret
DB_PATH=./data/auk-parking-local.db
FRONTEND_URL=http://localhost:5173
PASSWORD_RESET_TTL_HOURS=2
```

2. Install dependencies:

```bash
npm install
```

3. Seed the SQLite database:

```bash
npm run seed
```

4. Start both apps:

```bash
npm run dev
```

Open the frontend at:

```text
http://localhost:5173
```

The backend runs at:

```text
http://localhost:4000
```

## Email Setup

Email sending is optional for local development. If SMTP variables are not configured, the backend prints verification links in the terminal for development.

For real email sending, add SMTP values to `.env` or your Render backend environment:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM=AUK Smart Parking <your-email@gmail.com>
EMAIL_VERIFICATION_TTL_HOURS=24
PASSWORD_RESET_TTL_HOURS=2
```

For Gmail, `SMTP_PASS` must be a Google App Password, not your normal Gmail password.

## Windows And SQLite Notes

The backend dev script intentionally runs:

```bash
node src/server.js
```

instead of:

```bash
node --watch src/server.js
```

Node watch mode can fail with `spawn EPERM` on some Windows machines.

SQLite note: keep the project outside cloud-synced folders such as OneDrive if possible. SQLite database files can be locked by sync tools. The app uses a safer SQLite journal mode, but a normal local folder is still recommended.

## Individual Commands

```bash
npm run dev:backend
npm run dev:frontend
npm run seed
npm run test
npm run build
```

## Backend API

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/verify-email`
- `POST /auth/resend-verification`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/google` demo placeholder
- `GET /users`
- `POST /users`
- `GET /spots`
- `GET /spots/public-settings`
- `POST /spots`
- `PATCH /spots/:id`
- `DELETE /spots/:id`
- `GET /reservations`
- `POST /reservations`
- `POST /reservations/recurring`
- `GET /reservations/recurring/list`
- `PATCH /reservations/:id/status`
- `PATCH /reservations/:id/cancel`
- `GET /admin/dashboard`
- `GET /admin/settings`
- `PATCH /admin/settings`
- `GET /admin/approvals`

## Demo Accounts

- `security@auk.org` / `Admin123!`
- `staff1@auk.org` / `Staff123!`
- `student1@auk.org` / `Student123!`

## Seeding

The seed script creates:

- 1 security admin
- 2 staff users
- 1 student user
- 40 parking spots
- Sample approved and pending reservations
- Sample recurring staff reservations

## Testing

Run backend tests with:

```bash
npm run test
```

Covered flows:

- student registration
- email verification
- forgot-password and reset-password
- login and role restrictions
- overlapping reservation prevention
- student reservation cap
- unverified-user reservation blocking
- admin approval flow

## Notes For Presentation

- The UI is intentionally phone-sized for a strong mobile demo.
- Security sees admin controls in the same app shell for a cleaner presentation.
- Student and staff reservations use simple lot-based flows for quick demos.
- Security can still view and manage the visual parking map.

## Future Improvements

- Real Google OAuth integration
- Email notifications for approvals and cancellations
- Better calendar tools for recurring schedules
- Drag-and-drop parking layout editor
- Audit log screens in the frontend
- Stronger form validation and toast notifications
- Docker and CI setup
