# Operating CampusDine

These instructions assume an existing WSL installation at `~/campusdine`. Run them in Ubuntu. Keep the current database and configuration; creating new accounts or a new database is not part of an upgrade.

## Update an existing installation

1. Download the new `CampusDine.zip` to Windows Downloads. Ensure its filename is exactly `CampusDine.zip`, replacing the old downloaded ZIP if necessary.
2. Stop both running servers with Ctrl+C. All commands below run in the same Ubuntu terminal. Run one block at a time and stop if it reports an error.
3. Back up the configured database and the source/configuration files:

```bash
cd ~/campusdine/backend
backup_dir=$(mktemp -d "$HOME/campusdine-backup.XXXXXX")
../.venv/bin/python -m scripts.backup_database --output "$backup_dir/campusdine.sqlite3"
tar -czf "$backup_dir/source.tar.gz" -C ~/campusdine --exclude=.venv --exclude=node_modules --exclude=.next --exclude=backend/data --exclude=.git .
printf 'Backup: %s\n' "$backup_dir"
```

4. Extract to a separate directory and inspect the release notes:

```bash
update_dir=$(mktemp -d "$HOME/campusdine-update.XXXXXX")
~/campusdine/.venv/bin/python -m zipfile -e /mnt/c/Users/acer/Downloads/CampusDine.zip "$update_dir"
cat "$update_dir/campusdine/docs/release-notes.md"
```

The Windows path above uses the existing laptop account `acer`; change that part on another computer. If the release notes do not exist, stop: that is an older archive.

5. Apply the source update. This release does not change dependencies or database schema:

```bash
(
set -e
cd ~/campusdine
for directory in backend/app backend/scripts backend/tests frontend/src frontend/tests docs scripts; do
    mkdir -p "$directory"
    cp -a "$update_dir/campusdine/$directory/." "$directory/"
done
cp "$update_dir/campusdine/frontend/playwright.config.ts" frontend/playwright.config.ts
cp "$update_dir/campusdine/README.md" README.md
cp "$update_dir/campusdine/.gitignore" .gitignore
cp "$update_dir/campusdine/frontend/docs/frontend-setup.md" frontend/docs/frontend-setup.md
cp "$update_dir/campusdine/backend/docs/notifications.md" backend/docs/notifications.md
cp "$update_dir/campusdine/backend/docs/recommendations.md" backend/docs/recommendations.md
)
```

Only application source, tests and documentation are copied. Your existing `.env`, `.env.local`, database, `.venv`, `node_modules`, orders and balances remain in place. The new `.gitignore` does not remove files already tracked by Git; review `git status` before committing.

6. Restart the two processes using the commands in the README. For a production-mode frontend, rebuild with `npm run build` before `npm run start`.

Student face login remains controlled by `CAMPUSDINE_STUDENT_FACE_LOGIN` in `backend/.env`. Enable it only for the local demo by setting it to `true` and restarting the API. Existing approved face encodings can be reused. The setting is not enabled by this upgrade.

## Password recovery

Only the server operator should run this procedure. Verify the account holder through the accounts office first. The command changes only the password and revokes that account's sessions; it does not approve an enrollment, reactivate a suspended account or alter balances.

1. Stop the API. For local development, press Ctrl+C in its terminal. For a supervised server, use `sudo systemctl stop campusdine-api`.
2. From `backend`, run one of the following commands:

```bash
../.venv/bin/python -m scripts.reset_password --role student --username NCE-001 --api-stopped
../.venv/bin/python -m scripts.reset_password --role staff --username counter --api-stopped
../.venv/bin/python -m scripts.reset_password --role admin --username accounts --api-stopped
```

Choose the required account; do not run all three. For a student, `--username` is the roll number. Enter the new password twice at the hidden prompts. Never put passwords in command arguments, screenshots or Git.

3. Restart the API and sign in with the new password. Existing browser cookies are invalidated.

Stopping the API is required because the console command cannot reach the in-memory WebSocket hub of a running process. It closes existing connections before their session rows are removed. On a server, run the command under the same service account and configuration as the API. Keep a private record of who authorized the recovery.

## Backups and restoration

Create a backup with the provided SQLite backup command, not a copy of a running database file. Keep backups private: they contain personal details, password hashes, biometric encodings and financial records. The backup command verifies SQLite integrity and refuses to overwrite an existing file.

For restoration, stop the API and all jobs that write to SQLite. Preserve the current database and any `-wal`/`-shm` files together in a recovery directory. Restore the verified backup to the exact configured `CAMPUSDINE_DB_PATH`, with the original ownership and permissions. Do not combine a restored database with old WAL files. Restore the matching code version when rolling back a schema change. See the [deployment guide](deployment.md) for the supervised-server procedure.

After restart, verify admin/student login, menu data, account balances, order history and the live staff queue. Keep the failed database copy until reconciliation is complete.

## Before presenting

Use the run guide's end-to-end demonstration with separate browser profiles. Check real camera permission and matching on the presentation laptop. Confirm an actual enrollment, one wallet order, one credit order, staff status changes, collection and settlement. Use a demo database for practice and record only actual payments in a working college database.

Before publishing to GitHub, review `git status` and the staged diff. Include source, tests, lockfiles and `.env.example`; exclude `.env`, databases, biometric photos, backup archives, build output and dependency folders. Dependency licenses remain with their packages. Select a project license before inviting reuse if you intend to distribute under an open-source license.
