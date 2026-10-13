# Student face login — update your existing WSL installation

This update adds **Student → Face login → Open camera → Capture photo → Sign in with this photo**. A unique match against an active, approved enrollment opens the normal student menu. Roll-number/password login remains available. Staff and admin still use passwords. The counter identification flow remains available.

**This is a controlled-demo feature.** The existing image matcher has no liveness or presentation-attack detection. A photograph or replay can impersonate someone; opening a camera does not prevent that. Keep face-only login disabled on an exposed college service until a suitable authentication design is implemented and evaluated. Use your own demo enrollment or inform participating students of the added use of their face encoding. No face recognition accuracy or spoof-resistance has been established by the automated tests.

## Install the current release

Follow [the release update procedure](operations.md#update-an-existing-installation) to back up your database and apply the complete current source. An approved enrollment can reuse its existing face encoding; no re-enrollment is required.

## Enable student face login for your local demo

Run this block in an Ubuntu terminal. It updates only the face-login setting in your existing backend configuration:

```bash
~/campusdine/.venv/bin/python - <<'PY'
from pathlib import Path
p = Path.home() / 'campusdine/backend/.env'
s = p.read_text()
lines = [line for line in s.splitlines() if not line.lstrip().startswith('CAMPUSDINE_STUDENT_FACE_LOGIN=')]
p.write_text('\n'.join(lines) + '\nCAMPUSDINE_STUDENT_FACE_LOGIN=true\n')
print('Student face login enabled for the local demo.')
PY
```

The server defaults to disabled if this setting is absent. The local `.env.example` enables it; the production template disables it. To turn it off, change the value to `false` and restart the backend.

## Restart in two terminals

Backend terminal:

```bash
cd ~/campusdine/backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Second Ubuntu terminal:

```bash
cd ~/campusdine/frontend
npm run dev -- --hostname 127.0.0.1
```

Open **http://localhost:3000**. Sign out if already signed in. Select **Student → Face login → Open camera**, allow browser camera access, capture your face, then choose **Sign in with this photo**. The browser camera requires localhost or HTTPS. Keep only one person in view and use good front lighting.

Your existing approved enrollment photo is used. No re-enrollment is needed. If matching fails, try another capture or choose **Password login**. If Face login is missing, verify the backend `.env` setting and restart both servers, then refresh the page. If the face engine is unavailable, use password login and check the backend's face dependency installation.

## Implementation and checks

- `GET /auth/methods` reports whether student face login is enabled.
- `POST /auth/face-login` accepts multipart `face_photo`, capped at 5 MiB. Image decoding also enforces JPEG/PNG, pixel limits and exactly one face.
- Matching uses the existing stored encodings and configured tolerance. Unknown, inactive, unapproved and ambiguous matches cannot open a session. Failure responses do not return student identity.
- Anonymous attempts are limited per address and across the single API worker. Origin validation and the existing HttpOnly cookie, session rotation, CSRF and account checks apply. Restarting the worker resets its in-memory limits.
- Expensive image encoding runs before the database write transaction. Matching and session creation read current eligibility within one write transaction.
- Captures are not added to the student record or browser storage. The preview is temporary; tracks stop after capture or when switching away from face login. The endpoint processes an uploaded image, so the camera-only UI is not anti-spoofing protection.
- Backend tests replace only the image encoder and exercise actual matching, eligibility, sessions, limits and errors. Browser tests use a synthetic camera and controlled responses; real-camera recognition must still be tested on your PC.
