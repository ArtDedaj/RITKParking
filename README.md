# AUK Smart Parking System

A mobile-first full-stack parking reservation application for AUK faculty parking. The project is designed for quick demos on a phone and for desktop presentation inside a centered phone-style frame.

## Overview

This app supports three roles:

- `Student`: self-registers with an `@auk.org` email, reserves spots, cancels bookings, and reviews history.
- `Staff`: created by Security/Admin, gets all student features plus recurring and semester-long reservations.
- `Security`: acts as the admin, manages users, spot availability, reservation approvals, and reservation limits.

## Features

- Mobile-first React app with a phone mockup on desktop
- Email/password authentication with JWT
- Student-only self-registration for `@auk.org` addresses
- Interactive parking map with 40 seeded spots
- Reservation statuses: `pending`, `approved`, `rejected`, `cancelled`, `completed`
- Overlap prevention and 30-minute increment validation
- Configurable student active reservation cap
- Staff recurring reservation support
- Security dashboard, approvals, spot management, and user creation
- SQLite persistence with seed data
- Basic backend tests for auth, role restrictions, overlap logic, student cap, and approval flow

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: SQLite
- DB access: `better-sqlite3`
- Auth: email/password + JWT
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

## Setup

1. Copy `.env.example` to `.env`.
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
- `POST /auth/google` (demo placeholder)
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
- 3 student users
- 40 parking spots
- Sample approved, pending, and rejected reservations
- Sample recurring staff reservations

## Testing

Run backend tests with:

```bash
npm run test
```

Covered flows:

- student registration
- login restrictions
- role-based protection
- overlapping reservation prevention
- student reservation cap
- admin approval flow

## Notes For Presentation

- The UI is intentionally phone-sized for a strong mobile demo.
- Security sees admin controls in the same app shell for a cleaner presentation.
- The parking map is visually simple so spot status is easy to understand quickly.

## Future Improvements

- Real Google OAuth integration
- Email notifications for approvals and cancellations
- Better calendar tools for recurring schedules
- Drag-and-drop parking layout editor
- Audit log screens in the frontend
- Stronger form validation and toast notifications
- Docker and CI setup
