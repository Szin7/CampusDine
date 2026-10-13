# CampusDine

A college canteen application for National College of Engineering, Nepal. Students order from the menu and track their meals; counter staff identify students and manage preparation; the accounts office manages balances, credit and monthly dues.

Built with **FastAPI, SQLite, Next.js, React, Tailwind CSS and WebSockets**. Face enrollment and matching use the dlib-based `face_recognition` package.

## Features

| Student | Canteen staff | Accounts administrator |
| --- | --- | --- |
| Enrollment and approval status | Face or roll-number identification | Enrollment review and student records |
| Password login; optional demo face login | Confirmed counter checkout | Menu prices and availability |
| Menu search and recommendations | Received, Preparing and Ready queue | Wallet top-ups and credit limits |
| Wallet or credit checkout | Meal collection confirmation | Monthly dues and settlements |
| Live order tracking and balance history | Live order updates | Sales reports and CSV exports |

Orders use integer paisa and database transactions. A wallet covers the entire order, or the entire amount goes to available credit. Checkout request keys prevent duplicate charges when a response is lost. Credit settlements and wallet top-ups are distinct records; neither counts as an additional food sale.

## Run locally

Use Ubuntu or Ubuntu under WSL2, **Python 3.12** and **Node.js 24**. Create the virtual environment at the project root. The face dependency requires native build tools; follow the [complete run guide](docs/run-guide.md) for prerequisites, database migrations and initial accounts.

After installation, start these in separate terminals:

```bash
# Terminal 1: backend
cd ~/campusdine/backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

```bash
# Terminal 2: frontend
cd ~/campusdine/frontend
npm run dev -- --hostname 127.0.0.1
```

Open **http://localhost:3000**. Use different browser profiles for student, staff and admin demonstrations; tabs in one profile share a login cookie. Stop both processes with Ctrl+C. Accounts and orders remain in the configured database.

## Structure

| Directory | Responsibility |
| --- | --- |
| `backend/app/` | API routes, authentication, ordering, face matching and scheduled jobs |
| `backend/migrations/` | Alembic database migrations |
| `backend/scripts/` | Account creation, password recovery, backup and face comparison tools |
| `backend/tests/` | Backend and transaction tests |
| `frontend/src/` | Role-based screens, camera controls and live order clients |
| `frontend/tests/` | Browser tests with a disposable database |
| `deploy/` | Nginx, systemd and environment templates |
| `docs/` | Setup, operation, architecture and release notes |

## Verification

Install the development dependencies and Playwright Chromium, stop both servers, then run:

```bash
bash scripts/check.sh
```

The script runs backend tests, TypeScript checks, a production build and browser tests sequentially. `CAMPUSDINE_PYTHON=/absolute/path/to/python` overrides the project interpreter. Tests create disposable databases; browser fixtures never seed the working database.

See [release notes](docs/release-notes.md) for the checks performed on this release and the remaining real-environment checks.

## Operation and limits

- [Update an existing installation, recover a password and restore a backup](docs/operations.md).
- [Enable optional student face login](docs/face-login-update.md).
- [Deploy behind HTTPS with supervised services](docs/deployment.md).
- [Understand the architecture and design decisions](docs/architecture.md).
- [Configure email notifications](backend/docs/notifications.md) and [menu recommendations](backend/docs/recommendations.md).

Use **one API worker** while WebSocket connections and request limits are held in memory. SQLite is intended for the single-canteen deployment; write contention and long-term history growth require monitoring.

Face-only login is opt-in and intended for controlled demonstrations. Image matching does not perform liveness detection and can be fooled by photographs. Password login remains available. Staff must confirm identity after counter matching. Real camera recognition accuracy has not been established by the automated tests.

Email requires a configured SMTP account. The application records payments received by the accounts office; it does not process bank or wallet-provider payments. SMS, background browser push, attendance integration and multi-college tenancy are outside this release.

The source archive contains no live database, credentials, installed dependencies or generated build output. Example domains and SMTP fields must be replaced during deployment. No public server is created by downloading the project.
