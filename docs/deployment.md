# Single-server deployment — Ubuntu 24.04

This guide prepares one college-controlled server: Nginx terminates HTTPS, Next.js listens on localhost:3000, and one FastAPI worker listens on localhost:8000. SQLite and its WAL live on the server's local disk. Do not put this database on a network share, run several API workers or deploy the API on an ephemeral/serverless filesystem.

These are deployment templates to review and install on your server. No server or domain was provisioned by this step. Use a domain you control in place of **canteen.example.edu** everywhere below, including certificate paths and the allowed Origin. Configure its DNS to this server and keep any AAAA record consistent with working IPv6. A private-only college server needs the college's trusted certificate/DNS process instead of this public HTTP-01 certificate flow.

## 1. Prepare the host

Install Python 3.12, system-wide Node 24, Nginx and build dependencies. Use the official Node installation instructions linked in the local guide. Do not rely on a user's `nvm` shell initialization for system services.

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-dev build-essential cmake libopenblas-dev liblapack-dev nginx certbot unzip rsync
node --version
command -v node
sudo useradd --system --user-group --home-dir /opt/campusdine --shell /usr/sbin/nologin campusdine
sudo install -d -o root -g root -m 755 /opt/campusdine
sudo install -d -o campusdine -g campusdine -m 700 /var/lib/campusdine /var/backups/campusdine
sudo install -d -o root -g campusdine -m 750 /etc/campusdine
```

Create the account once. If it already exists, inspect it rather than rerunning `useradd`. Allow inbound 80/443 for the website and restrict SSH to your administration source. Leave 3000 and 8000 unexposed. If using EC2, apply those same rules to the security group. Keep your current SSH connection while reviewing firewall changes.

## 2. Install the reviewed source and build

Extract the archive into a staging directory owned by your administrator account. From the extracted `campusdine` project root:

```bash
sudo rsync -a --exclude='.venv' --exclude='node_modules' --exclude='.next' --exclude='.env' --exclude='.env.local' --exclude='__pycache__' --exclude='test-results' --exclude='*.sqlite3*' ./ /opt/campusdine/
sudo chown -R root:root /opt/campusdine
sudo python3 -m venv /opt/campusdine/.venv
sudo /opt/campusdine/.venv/bin/python -m pip install --upgrade pip
sudo /opt/campusdine/.venv/bin/python -m pip install '/opt/campusdine/backend[face]'
cd /opt/campusdine/frontend
sudo npm ci
sudo env API_ORIGIN=http://127.0.0.1:8000 npm run build
sudo chown -R campusdine:campusdine /opt/campusdine/frontend/.next
```

Review the source and lockfile before running installation scripts with elevated privileges. Build dependencies remain installed because `next.config.ts` uses TypeScript. Do not run `npm audit fix --force` as part of this setup; review dependency upgrades separately. Record installed Python versions with `pip freeze` for the release: the backend currently uses compatible version ranges, while the frontend uses its committed npm lockfile.

## 3. Use one shared backend configuration

```bash
sudo install -o root -g campusdine -m 640 /opt/campusdine/deploy/backend.env.example /etc/campusdine/backend.env
sudoedit /etc/campusdine/backend.env
sudo ln -s /etc/campusdine/backend.env /opt/campusdine/backend/.env
```

Set the actual `https://` Origin, keep secure cookies true, and keep the database at `/var/lib/campusdine/campusdine.sqlite3`. Initially leave email disabled. The symlink makes CLI commands and the app's dotenv loader see the same settings that systemd loads through `EnvironmentFile`. The file uses `KEY=value`, no shell commands or `export`; quote values containing spaces or special characters. Do not define conflicting `CAMPUSDINE_*` variables in the operator's shell.

On an existing deployment, preserve its configuration and symlink. Do not replace an existing `.env` blindly. After editing SMTP settings, restart the API; newly started scheduled jobs read the updated file.

Initialize as the service user, from backend:

```bash
cd /opt/campusdine/backend
sudo -u campusdine /opt/campusdine/.venv/bin/python -m alembic upgrade head
sudo -u campusdine /opt/campusdine/.venv/bin/python -m scripts.create_admin --name 'Accounts office' --username accounts
sudo -u campusdine /opt/campusdine/.venv/bin/python -m scripts.create_staff --name 'Canteen counter' --username counter
sudo -u campusdine /opt/campusdine/.venv/bin/python -c 'import face_recognition; print("Face engine imported")'
```

Create accounts only once. Their passwords are entered interactively. Student enrollment and approval happen through the app, with real face photos.

## 4. Start supervised application services

```bash
sudo cp /opt/campusdine/deploy/systemd/campusdine-*.service /etc/systemd/system/
sudo cp /opt/campusdine/deploy/systemd/campusdine-*.timer /etc/systemd/system/
sudoedit /etc/systemd/system/campusdine-web.service
```

The frontend unit assumes `/usr/bin/node`. Compare it with `command -v node` and replace only that executable path if yours differs. Its executable must remain accessible outside an administrator's home directory. The API virtual environment path is `/opt/campusdine/.venv/bin/python`.

```bash
sudo systemd-analyze verify /etc/systemd/system/campusdine-*.service /etc/systemd/system/campusdine-*.timer
sudo systemctl daemon-reload
sudo systemctl enable --now campusdine-api.service campusdine-web.service
sudo systemctl status campusdine-api.service campusdine-web.service --no-pager
curl --fail http://127.0.0.1:8000/health
curl --fail --output /dev/null http://127.0.0.1:3000/sign-in
```

FastAPI has exactly one worker. The units restrict writes to the database directory and Next build/cache directory respectively. Migrations are deliberate operator steps, not automatic restart hooks. App logs go to the journal; use `journalctl -u campusdine-api -n 100 --no-pager` and the equivalent for `campusdine-web`.

## 5. Issue a certificate, then enable the HTTPS proxy

First install the **bootstrap** Nginx configuration. It exposes only the ACME challenge path while the certificate is issued:

```bash
sudo install -d -m 755 /var/lib/letsencrypt
sudo cp /opt/campusdine/deploy/nginx-bootstrap.conf /etc/nginx/sites-available/campusdine
sudoedit /etc/nginx/sites-available/campusdine
sudo ln -s /etc/nginx/sites-available/campusdine /etc/nginx/sites-enabled/campusdine
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/lib/letsencrypt -d canteen.example.edu
```

Replace the domain before the commands that use it. Follow Certbot's email/terms prompts. HTTP-01 requires public DNS and inbound port 80. Resolve certificate failures before installing the next template, which references actual certificate files.

```bash
sudo cp /opt/campusdine/deploy/nginx.conf /etc/nginx/sites-available/campusdine
sudoedit /etc/nginx/sites-available/campusdine
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://canteen.example.edu/api/health
```

Replace every sample domain, including both certificate paths. Check `certbot certificates` if the issued certificate directory has a suffix. Nginx sends `/api/` directly to FastAPI and removes that prefix; `/api/ws/orders` therefore reaches `/ws/orders`. Other routes reach Next. The proxy preserves the browser's cookie and Origin, forwards the explicit WebSocket upgrade headers and gives the connection a 90-second read timeout. Browser heartbeats keep healthy order streams active. Requests allow 6 MB of multipart overhead; application photo validation still limits the image to 5 MB.

This template assumes Nginx is the direct public edge. If you later add a CDN/load balancer, configure trusted client IP handling explicitly; do not trust arbitrary forwarded IPs. Authenticated API responses are not proxy-cached. Application ports bind only to loopback.

Install a renewal deploy hook:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo sh -c 'printf "#!/bin/sh\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n" > /etc/letsencrypt/renewal-hooks/deploy/campusdine-nginx'
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/campusdine-nginx
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
sudo /etc/letsencrypt/renewal-hooks/deploy/campusdine-nginx
```

The dry run checks renewal; the last command explicitly checks the reload hook. If your Certbot installation supplies a different renewal mechanism, inspect and use that mechanism instead of adding a duplicate timer.

## 6. Schedule existing jobs

The provided timers use explicit Nepal time for daily jobs. Retries run every minute; previous-month dues are checked daily at 00:05 Nepal time to catch a missed month-boundary run, and recommendation scores refresh at 02:00. `Persistent=true` catches a missed activation after restart, but does not replay every missed calendar date. For older missed billing months, run `app.jobs.monthly_billing --month YYYY-MM` explicitly.

Configure and test SMTP with a controlled recipient before enabling mail jobs. Pending messages created while mail was disabled may become deliverable when enabled; review that database's queue. Ready mail is attempted by the API after commit; the timer handles failed/backlogged mail. Monthly statements record a balance snapshot and never settle dues.

```bash
sudo systemctl enable --now campusdine-recommendations.timer
# Enable these after reviewing SMTP and pending messages:
sudo systemctl enable --now campusdine-retry-mail.timer campusdine-monthly-dues.timer
sudo systemctl list-timers 'campusdine-*'
```

Use these timers OR the older `backend/deploy/*.cron` examples, never both. Timers share `/etc/campusdine/backend.env` and write logs to the journal. A long-running oneshot is not launched twice by its timer. Monitor failed jobs and queue growth; SMTP acceptance still does not guarantee inbox delivery.

## 7. Back up and rehearse restoration

From backend, make a fresh backup filename each time:

```bash
cd /opt/campusdine/backend
sudo -u campusdine /opt/campusdine/.venv/bin/python -m scripts.backup_database --output "/var/backups/campusdine/campusdine-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
```

The command uses SQLite's backup API, includes committed WAL data, runs `quick_check` on the copy, and refuses to overwrite an existing backup. It creates a private file on POSIX systems and removes a failed output. Do not copy just the main `.sqlite3` file while the app is running. Treat command exit code 0 as completion; a crash or forced kill may leave an incomplete output, which must not be used without verification.

Take a backup before each upgrade and at least daily, and move a verified copy to an access-controlled off-host destination. The database contains face encodings, password hashes, student details and financial records. Keep backups private and encrypted off-host. Protect the SMTP configuration separately; it is not inside the SQLite backup. This step does not configure off-host storage or claim a retention policy has been activated.

For a restore drill, copy a backup into a separate directory, set `CAMPUSDINE_DB_PATH` to that copy, and keep SMTP disabled. Use matching application code and migrations. Check database integrity, student and order counts, wallet/credit balances and recent ledger entries. Do not test against the only backup copy.

For an actual recovery, stop web/API, all three timers and any running job services first. Preserve the failed live database **and its `-wal`/`-shm` files together** in a recovery directory. Install the verified backup into an empty database location; never overlay a restored database while old WAL/SHM sidecars remain. Set ownership to `campusdine:campusdine`, file mode 600, and restore the matching code version. Clear `login_sessions` in the restored database before reopening access so restored sessions cannot resume. Restart API/web, perform the acceptance checks, then resume the reviewed jobs. Reconcile any payments/orders after the backup time with the accounts office before normal operation. Restoring data can reintroduce pending email rows; review them before re-enabling delivery.

## 8. Upgrade with a maintenance window

1. Retain the prior source release and its dependency versions. Review migrations and back up the database.
2. Stop the web/API services, timers and running job services. Keep the public app unavailable during the change.
3. Install the reviewed new source, preserving `/etc/campusdine`, `/var/lib/campusdine` and backups. Reinstall Python dependencies; run `npm ci` and `npm run build`. Reset `.next` ownership as above.
4. From backend, apply `alembic upgrade head` as the service user with the shared environment.
5. Start API/web, check health, sign-in and both order screens; resume jobs when checks pass.
6. If a migration fails, keep services stopped. Choose a reviewed forward fix or restore the matching pre-upgrade code and database together. An old binary alone may not understand a new schema.

Do not use `--reload`, `next dev`, multiple Uvicorn workers or the browser fixture database in production. Keep financial retries in their original tabs until resolved before planned maintenance.

## 9. Acceptance checklist and troubleshooting

- Complete the three-role walkthrough in [run-guide.md](run-guide.md) on an isolated acceptance database before real use.
- On the actual HTTPS domain, verify the session cookie is HttpOnly/Secure, reload preserves sign-in, logout works and enrollment photo upload succeeds.
- Open staff queue and student tracker in separate profiles. In browser Network → WS, confirm `/api/ws/orders` returns **101**, starts with `snapshot` and receives `order.updated` through collection.
- Keep the tracker open beyond 90 seconds, then briefly interrupt the connection and restore it. Confirm a fresh snapshot and no duplicated charge/status transition.
- Validate real face recognition under counter lighting, roll fallback and operator identity confirmation. Test real email with the configured SMTP account; no test run here proves delivery.
- Restart the application services and check that data persists and sockets reconnect. Rehearse backup restoration and monitor available disk space, failed units and backup freshness.

| Symptom | Likely next check |
| --- | --- |
| Nginx 502 | API/web unit logs, loopback ports and executable paths. |
| Login loop on HTTPS | Secure cookie, canonical hostname, correctly forwarded scheme. |
| WebSocket 403/1006 | Session cookie, exact allowed Origin, correct prefix stripping. |
| No updates despite a socket connection | Verify exactly one FastAPI worker and both screens use the same deployment/database. |
| 413 on photo upload | Nginx body limit and application's separate 5 MB file limit. |
| `Read-only file system` | DB path must be `/var/lib/campusdine`; Next's writable `.next` path must exist. |
| Unit fails with `203/EXEC` | Correct system-wide Node/venv executable path and permissions. |
| Month/email job is idle | Inspect timer activation, service result, SMTP enabled setting and due outbox rows. |
| Disk full / database busy | Stop repeated new submissions; resolve space/contention and retry saved requests. Inspect job overlap and backup storage. |

`/health` is a process-liveness check, not a database-readiness or face-engine probe. The functional acceptance steps provide those additional checks.

## References and validation scope

Implementation choices were checked against the installed Next.js self-hosting documentation and these primary references:

- [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [systemd service execution and filesystem restrictions](https://www.freedesktop.org/software/systemd/man/systemd.exec.html)
- [Certbot webroot and renewal guide](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [Python SQLite backup API](https://docs.python.org/3.12/library/sqlite3.html#sqlite3.Connection.backup)

The development workspace cannot run systemd as PID 1 and does not have Nginx installed. Unit parser checks can be performed with executable paths adapted to this workspace; they do not prove the target host's ownership or sandbox behavior. The `nginx -t`, certificate renewal and live HTTPS checks above must be completed on the deployment host. No public deployment is claimed.

Release validation and its limits are recorded in [release notes](release-notes.md). Verify Nginx, TLS, SMTP and real camera matching on the target server before enabling access.

## Optional student face login

Keep `CAMPUSDINE_STUDENT_FACE_LOGIN=false` in production. The optional student face-only login uses image matching without liveness detection; photographs or replays can impersonate a student. It is intended for a controlled local demo, not established as secure authentication for an exposed service. The staff counter identification workflow remains available with staff confirmation. See [the face-login guide](face-login-update.md).
