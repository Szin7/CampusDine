# Run CampusDine and demonstrate the full flow

## 1. Choose one environment

On Windows, run both the backend and frontend inside Ubuntu on WSL2. The existing installation uses Ubuntu 26.04.1; Ubuntu 24.04 is another supported setup target. This avoids mixing Windows Python environments with Linux dlib builds. Run `wsl --install -d Ubuntu-24.04` in an Administrator PowerShell window if WSL is not installed, then reopen Ubuntu after the requested restart. Use the browser on Windows to open the app.

Extract `CampusDine.zip`. The project root is the folder containing `backend`, `frontend` and this README. In Ubuntu, copy the extracted `campusdine` folder into your Linux home folder and work there. Keep project paths free of spaces for the provided test commands. Do not reuse a `.venv` or `node_modules` copied from Windows.

The commands below assume `~/campusdine`. Substitute your actual project path. Ubuntu users can start here directly.

## 2. Install prerequisites and dependencies

Use Python 3.12 and Node.js 24 in this environment. The frontend requires at least Node 20.9, but use one consistent Node version for install, build and start. Install Node using the [official Node download instructions](https://nodejs.org/en/download); installing Node on Windows does not install it inside Ubuntu.

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-dev build-essential cmake libopenblas-dev liblapack-dev
python3 --version
node --version
npm --version
cd ~/campusdine
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e './backend[dev,face]'
.venv/bin/python -c 'import face_recognition; print("Face engine imported")'
cd frontend
npm ci
```

If `python3.12` is unavailable but uv is installed, use `uv python install 3.12` followed by `uv venv --python 3.12 --seed .venv` instead of the venv command. Do not use the system Python 3.14 for this project.

The face extra compiles/installs dlib and its model dependencies; it can take time and memory. If it fails, read the first compiler/install error and check the build tools. The plain `./backend[dev]` install can run non-face development tests, but real student enrollment and face identification require the face extra. Never seed fake face encodings into a working college database.

## 3. Prepare the database and first accounts

In **Terminal 1**, from the backend folder:

```bash
cd ~/campusdine/backend
[ -f .env ] || cp .env.example .env
../.venv/bin/python -m alembic upgrade head
../.venv/bin/python -m scripts.create_admin --name 'Accounts office' --username accounts
../.venv/bin/python -m scripts.create_staff --name 'Canteen counter' --username counter
```

Each account command prompts twice for a password of 12–128 characters. Passwords are hashed; there is no default production password. A repeated username fails instead of replacing an account. These are local operator commands and require access to the backend database. The authenticated admin API can also create staff via `POST /admin/staff`.

For this local HTTP setup, keep these settings in `backend/.env`:

```dotenv
CAMPUSDINE_DB_PATH=data/campusdine.sqlite3
CAMPUSDINE_COOKIE_SECURE=false
CAMPUSDINE_ALLOWED_ORIGINS=http://localhost:3000
CAMPUSDINE_EMAIL_ENABLED=false
```

Use `localhost` consistently in the browser. Do not substitute your LAN IP: cookies, allowed origins and camera secure-context rules differ. The default database resolves relative to `backend/`, regardless of your terminal's folder. Migrations must finish before startup.

## 4. Start both servers

**Terminal 1 — API**, leave it running:

```bash
cd ~/campusdine/backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

**Terminal 2 — website**, leave it running:

```bash
cd ~/campusdine/frontend
[ -f .env.local ] || cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open [http://localhost:3000](http://localhost:3000). The API liveness check is [http://localhost:3000/api/health](http://localhost:3000/api/health); expect `{"status":"ok","app":"CampusDine"}`. This check alone does not prove database migrations or authentication work.

Keep one API worker: the current order connection registry is in memory. The frontend forwards `/api/...` to `http://127.0.0.1:8000`; cookies stay on the website origin. This is a running Node application, not a folder of static HTML to open directly.

To stop, press Ctrl+C in each terminal. To resume later, repeat only the two startup commands. Do not create a new database or recreate the accounts. Back up the data before applying a later project's migrations.

## 5. End-to-end demonstration

Use separate browser profiles or normal/private windows for the three roles. Tabs in the same browser profile share the session cookie; signing into another role there replaces that session.

| Step | What to do | Expected result |
| --- | --- | --- |
| 1 | Admin signs in as `accounts`; add an available menu item such as Veg momo at NPR 120.00. | Student menu displays the actual price. |
| 2 | Student opens Enroll, fills their real details and uploads a clear, single-face JPEG/PNG. | Enrollment stays pending; student cannot yet sign in. |
| 3 | Admin reviews and approves that enrollment. | Student can sign in. |
| 4 | Admin → Accounts: record NPR 240.00 already received as a wallet top-up, with a reference. | Wallet shows NPR 240.00. |
| 5 | Student orders one NPR 120.00 dish and opens Track my orders. | One token/date; wallet NPR 120.00; Received stage. |
| 6 | Staff → Order queue: Start preparing, then Mark ready. | Student sees both changes live and Ready for collection. |
| 7 | Staff confirms collection only after handing over the meal. | Staff ticket disappears; student sees Collected; no extra charge. |
| 8 | Staff → Counter: look up the same roll, confirm identity, place another NPR 120.00 order. | Student tracker receives the counter order; wallet becomes NPR 0.00. |
| 9 | Admin sets a NPR 240.00 credit limit with a reason. Student orders one NPR 120.00 dish. | Whole order goes to credit; wallet stays zero; dues NPR 120.00. |
| 10 | Admin → Billing: review the student's month, record an actually verified settlement reference. | Reviewed credit is settled; wallet stays unchanged. |
| 11 | Admin → Sales: inspect today's Nepal date. | Three orders total NPR 360.00: wallet NPR 240.00, credit NPR 120.00. Top-up and settlement add no sales. |

Those amounts assume a fresh demonstration account, no other purchases and the exact price above. On a real database, use genuine payment/settlement records. There is no demo-reset button; do demonstrations in an isolated database.

Next, try the counter camera and photo upload with the enrolled student, another person, poor lighting and an ambiguous image. Staff must confirm the returned identity. Use roll lookup if the match is uncertain. The standalone check is:

```bash
cd ~/campusdine/backend
../.venv/bin/python -m scripts.check_face_match /path/enrollment.jpg /path/counter.jpg --tolerance 0.5
```

Distance is not a confidence percentage. Browser tests mock face results; this check and the onsite trial verify the actual engine and lighting. Photos supplied to this command are not copied into the database.

For a controlled local demo, `CAMPUSDINE_STUDENT_FACE_LOGIN=true` enables **Student → Face login** on the sign-in screen. Capture a face and choose **Sign in with this photo**. Only active, approved, uniquely matched enrollments can log in; password login remains available. This matcher has no liveness detection and can be fooled by photos. See [the face-login update guide](face-login-update.md) for an existing installation.

## 6. Run automated checks

Stop both development servers first so ports 3000/8000 are free. From the project root:

```bash
.venv/bin/python -m pytest backend/tests -q
cd frontend
npm run typecheck
npm run build
npx playwright install --with-deps chromium
TEST_PYTHON=../.venv/bin/python npm run test:e2e
```

The test Python path is relative to `frontend/`. Browser tests create a temporary database and disable email. They do not seed your development database, and they do not require real face photos. Build and browser tests must run sequentially because the browser suite starts Next's development server.

For a local production-mode check, run `npm run build`, then `npm run start -- --hostname 127.0.0.1` in Terminal 2 instead of `npm run dev`, while keeping the API running. Build-time `API_ORIGIN` must point to your API. Real deployment also needs HTTPS, service supervision and the proxy setup in [deployment.md](deployment.md).

## 7. Common failures

| Symptom | Check |
| --- | --- |
| `No suitable Python runtime found` in PowerShell | This guide uses Ubuntu's `python3`; do not reuse the missing Windows virtual environment. |
| `node` not found / wrong version | Install Node inside Ubuntu, then open a new terminal and check its version. |
| Login appears to succeed but returns to sign-in | On local HTTP use `COOKIE_SECURE=false`; use the same browser hostname throughout. |
| 403 on a write | Check the exact allowed Origin and sign in again to refresh CSRF state. Do not disable CSRF. |
| `no such table` | Check the selected database path; run migrations using the same environment as the API. |
| Face engine unavailable | Install the face extra and verify its import; check CMake/compiler errors. |
| Camera unavailable | Allow browser camera access on localhost or HTTPS; choose upload/roll lookup if needed. |
| Queue/tracker keeps reconnecting | Confirm one API worker, backend health, allowed Origin, cookie and WebSocket route. Close excess order tabs (five per session). |
| Port already in use | Stop the earlier dev/test process; do not start another copy against the same port. |
| Result unconfirmed after checkout or a financial edit | Keep the tab and use the saved retry action. Inspect the committed result before starting a new request. |

Email is disabled until a real SMTP account is configured. See [email setup](../backend/docs/notifications.md). It is independent of live WebSocket status; no SMS or background browser push is claimed.

## Maintenance

Password recovery, database restoration and release updates are covered in [operations](operations.md). To run the complete automated checks from the project root, use `bash scripts/check.sh`.
