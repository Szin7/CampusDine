# CampusDine release — 13 October 2026

This release completes the implemented college-project scope and consolidates setup and maintenance instructions. It is ready for a local demonstration after installation and the real-camera acceptance check. It is not a certification of production security or biometric accuracy.

## Included workflows

Student enrollment and approval; password and optional face login; menu browsing and recommendations; wallet/credit checkout; counter identification and ordering; live staff queue and student tracking; wallet and credit histories; top-ups, credit limits, monthly settlements and sales reporting. Email outbox and scheduled-job templates are included but require deployment configuration.

## Changes in this release

- Added server-console password recovery for student, staff and admin accounts. Recovery validates the new password, revokes the selected account's sessions and preserves approval, suspension and financial state. Stop the API before use.
- Applied no-store cache headers and MIME-sniffing protection consistently to HTTP API responses, including authentication errors.
- Guarded password submission while the face-login method or an existing session is active.
- Corrected the default Playwright interpreter to the virtual environment inside the project.
- Added `scripts/check.sh` for sequential backend tests, type checks, production build and browser tests.
- Corrected WSL/Python setup instructions and made initial environment-file copies preserve existing configuration.
- Replaced development-step narration with current architecture, operation and release documentation.
- Expanded Git exclusions for local configuration, database files, backups and test/build output. Local editor assistant instruction files are excluded from the release archive; required third-party notices are not removed.

No new database migration or application dependency is introduced. See [operations](operations.md) before updating an existing installation.

## Verification performed

| Check | Result |
| --- | --- |
| Complete backend suite | 197 passed |
| Complete browser suite | 76 passed |
| TypeScript check | Passed |
| Next.js production build | Passed |
| Shell syntax for the check script | Passed |
| Local documentation links | Checked |

Validation used Python 3.12.14, Node.js 24.19.0 and Chromium 153. Browser tests used a disposable migrated SQLite database. Backend tests exercised actual authentication, matching against synthetic encodings, financial transactions and session revocation; browser camera tests used synthetic video and controlled recognition responses. The native face engine was not validated against real people in this release run.

One non-failing test-library deprecation warning was emitted by the FastAPI/Starlette test client for its HTTPX adapter. It did not affect the test results.

## Checks required on the installation

- Apply the source update to the laptop; downloading the archive does not update WSL automatically.
- Test actual enrollment and matching with the laptop camera, lighting and installed dlib engine.
- Demonstrate the complete three-role flow with distinct browser profiles.
- For a public server, configure and verify HTTPS, Nginx/WebSocket forwarding, backups and service supervision. SMTP delivery requires a real account and a delivery trial.
- Keep face-only login restricted to a controlled demo: photographs and replays can fool the matcher because it has no liveness detection.

The application does not include online payment collection, SMS, attendance integration, browser push or multiple-college tenancy. These are outside the current scope.
