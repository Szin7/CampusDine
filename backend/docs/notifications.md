# Canteen emails

Email uses the address collected during enrollment. Sparrow SMS can be added when the college has a gateway account and a student phone-number field. No SMS integration is claimed here.

When staff marks an order Ready, the same SQLite transaction inserts a notification. If that transaction fails, neither change survives. After commit, the WebSocket event goes out and a FastAPI background task starts the email attempt immediately. There is no scheduled wait on this first attempt. Inbox arrival still depends on the SMTP provider. Email failure does not reverse the order status or delay the WebSocket update.

Pending mail is stored in `notifications` so an API restart does not lose it. A worker claims one row in a short transaction, releases SQLite, and then contacts SMTP. A five-minute lease prevents concurrent workers from sending the same row during normal delivery and recovers abandoned attempts. Failed deliveries retry after 1, 2, 4, 8, 16, 32, then 60 minutes. A collected order's delayed ready-email is skipped. A collected transition racing an SMTP call already in progress cannot retract that email.

SMTP delivery is at least once. A crash after the provider accepts a message but before SQLite records success can produce a duplicate. A stable Message-ID helps with tracing but does not guarantee provider deduplication. Delivery logs must be reconciled if duplicate messages are reported.

## Configure email

Apply migration `0006` before starting the updated API:

```sh
python -m alembic upgrade head
```

Fill these values in `backend/.env` using the college's SMTP account:

```dotenv
CAMPUSDINE_EMAIL_ENABLED=true
CAMPUSDINE_SMTP_HOST=smtp.your-provider.example
CAMPUSDINE_SMTP_PORT=587
CAMPUSDINE_SMTP_SECURITY=starttls
CAMPUSDINE_SMTP_USERNAME=your-smtp-username
CAMPUSDINE_SMTP_PASSWORD=your-smtp-password
CAMPUSDINE_EMAIL_FROM=canteen@your-college-domain.example
```

Use a plain sender email address. For implicit TLS use `ssl` and port `465`. Certificate verification is enabled; plaintext SMTP is not supported. Restart the API after changing its environment. The default is email disabled: events remain queued and no mail is sent. Enabling email later allows still-relevant pending messages to send. Review the queue before enabling it against an old development database.

## Monthly statements and retry worker

From `backend` with the virtual environment active:

```sh
python -m app.jobs.retry_notifications
python -m app.jobs.monthly_billing
python -m app.jobs.monthly_billing --month 2026-08
```

The monthly command defaults to the previous completed month in Kathmandu, rejects an unfinished month, and queues one statement per student for that month. It includes all currently outstanding credit through that month, including older unpaid balances, and excludes settled entries and newer purchases. Inactive accounts can still owe money and receive a statement. A rerun does not duplicate previously queued statements. It then attempts delivery; the retry worker handles any remaining backlog, up to 100 due rows per invocation.

The amount is a snapshot when the statement is generated, with a Nepal timestamp in the text. It is not a historical month-end reconstruction: settlements entered before generation are already removed. Later payments do not rewrite queued statements. The email says to check the current account balance for subsequent payments. This job never debits an account or marks a ledger entry settled.

`deploy/notifications.cron` provides entries for a UTC server. Retry runs every minute. A daily call at 18:20 UTC checks the previous completed month: on Nepal's first day of the month this is 00:05, immediately after month-end. Daily idempotent calls also catch up when the server misses that first run. Replace installation paths before adding them to the same system user's crontab. For a Kathmandu cron daemon, change the daily expression to `5 0 * * *`; the every-minute retry expression stays the same. Configure log rotation for both job log files.

The daily job can also pick up a student's statement if an earlier run found no outstanding entries. Once a statement exists, that month's snapshot is fixed. Use the explicit `--month` command for an older missed month; the daily job only targets the most recent completed month.

## Check delivery

The `notifications` table records `status`, `attempts`, `sent_at`, `next_attempt_at`, and `last_error`. Error values are exception class names, not SMTP response text containing addresses or credentials. Read pending/sending rows and the worker log when troubleshooting. A `sent` row means the SMTP server accepted the email, not that the recipient read it or that it avoided spam filtering.

Tests replace SMTP with controlled fakes. They cover atomic enqueue, repeated status requests, publish-before-email ordering, retry delays, exclusive claims, abandoned leases, collected-order suppression, TLS setup and monthly statement boundaries. No real email was sent during development validation. The configured college SMTP account still needs a delivery check before deployment.
