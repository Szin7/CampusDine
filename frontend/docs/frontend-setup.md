# Frontend foundation

The interface uses forest green, warm ivory and muted amber, with Fraunces for headings and DM Sans for forms and tables. Fonts ship with the app through Fontsource, so opening the canteen screen does not request fonts from Google. Light and dark themes use the same colour tokens. Only the theme preference goes into local storage.

The student, staff and admin screens are implemented. Students land on the menu, staff on the counter and admins on the student register. For a complete fresh install and three-role walkthrough, start with [the run guide](../../docs/run-guide.md); production service and HTTPS templates are covered in [deployment](../../docs/deployment.md).

## Run locally

Use Node.js 20.9 or newer (Node 22 or 24 is a good fit). Next.js setup reference: https://nextjs.org/docs/app/getting-started/installation

Start the backend from `backend`, with its Python environment active:

```sh
python -m alembic upgrade head
python -m uvicorn app.main:app --workers 1
```

For local HTTP, set `CAMPUSDINE_COOKIE_SECURE=false` in `backend/.env`. Keep `http://localhost:3000` in `CAMPUSDINE_ALLOWED_ORIGINS`. Create an administrator with `python -m scripts.create_admin --name "Accounts office" --username accounts` if needed. Student enrollment still needs the backend face extra and a working dlib installation; a missing face engine produces an explicit error in the form.

In another terminal, from `frontend`:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The default backend address is `http://127.0.0.1:8000`. To change it, copy `.env.example` to `.env.local`, edit `API_ORIGIN`, and restart Next.js. That variable belongs to the Next.js server, not the browser. For a production build, set it before `npm run build` because rewrites are generated at build time.

The frontend calls `/api/...`; Next.js forwards those requests to FastAPI. This keeps session cookies on the browser's current origin. FastAPI still owns password checks, role enforcement, origin checks and CSRF validation. The session cookie is HTTP-only. The CSRF token lives in React state and is recovered from `/auth/me` on reload. Nothing about hiding a frontend screen grants or denies API access.

Both servers need to run. It is not a static export. Deployment and the WebSocket reverse-proxy route are documented in the root deployment guide. Use HTTPS and secure cookies in production.

## Check it

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The Playwright suite launches Next.js and a separate FastAPI process. The fixture API uses a temporary SQLite database, applies the real migrations, seeds approved/pending students plus staff/admin accounts, and disables email. Ports 3000 and 8000 must be free; stop your development servers before running it. Test credentials only exist in that temporary fixture.

Point `TEST_PYTHON` at the backend Python interpreter. The default is `../../.venv/bin/python`, matching this workspace. On Windows PowerShell, for example:

```powershell
$env:TEST_PYTHON = 'D:\CampusDine\.venv\Scripts\python.exe'
npm run test:e2e
```

If the interpreter path contains spaces, include quotes in the variable value for the command shell.

Login, role checks, persisted cookies, approval rejection and CSRF-protected logout use the real API. Enrollment submission uses an intercepted API response so the browser test does not pretend a one-pixel fixture is an actual face. The backend's face tests and `scripts/check_face_match.py` cover that separate boundary. Browser tests also check invalid uploads, pending confirmation, mobile overflow and saved dark theme.

Photo uploads are JPEG/PNG, at most 5 MB; the backend additionally enforces its 16-megapixel and exactly-one-face checks. The browser preview URL is released when the photo changes or the page unmounts. Successful enrollment clears the form and shows the returned roll number. Approval is still required before login, and the UI does not promise an approval email that the backend does not send.

Validation through the wallet screen: production build and TypeScript passed; all 28 browser tests passed. Real SMTP and real dlib face matching remain separate deployment checks.

## Student menu

`/menu` reads `/students/me`, every page of `/menu`, and `/menu/recommendations?limit=4`. Requests start together, and recommendation failure does not hide a successfully loaded menu. The client fetches all menu pages before applying category, search and availability filters; it does not silently stop at the API's default page size. These are initial page snapshots, not live price or balance subscriptions. The eventual checkout must still validate prices and available funds on the server.

The amber recommendation area labels every entry with its real source. A student with no history sees “From the canteen” if the backend used its catalog fallback. I do not call those items popular or personal favorites. Unavailable/archived recommendations are filtered against the current menu response, and prices come from that same menu response. The two reads are independent snapshots; they cannot guarantee an item stays available after loading.

The menu now includes a basket and real checkout. Sold-out dishes remain visible unless Available only is selected. An empty menu, no filter matches, menu request errors and unavailable recommendations have distinct messages.

The browser suite includes real fixture menu data, category/search combinations, sold-out filtering, recommendation failure, mixed snapshot availability, empty menu handling, pagination beyond 200 items, mobile overflow and sticky balances. The sample dishes are seeded only into the disposable browser-test database. Add your actual canteen items through Admin → Menu.

## Basket and checkout

Students add items from the menu and adjust quantities in the basket. The basket supports up to 50 distinct items and 50 of each, matching the backend. The desktop basket stays beside the menu; the mobile review link jumps to it. Totals stay in integer paisa until display formatting.

Before confirmation, the screen explains whether the current balance covers the order from the wallet or whether the full amount falls back to credit. It does not split payment between wallet and credit. The API decides using the latest balances inside its transaction. The receipt always uses the payment type, total, items, token and Nepal order date returned by the API. After success, the page reloads its account/menu snapshots to show updated balances.

The application saves the basket and exact pending checkout request in `sessionStorage`, keyed by student ID. This keeps each tab's draft through navigation and reload without storing authentication or CSRF tokens. The request is saved before sending. While a result is uncertain, quantities and prices are frozen and edits are blocked. Retry uses the identical checkout key, items and expected total. The backend checks that key before recalculating money, so a successful order with a lost response comes back as the same order.

A 30-second request timeout or a server/network error leaves that pending request intact. A failed session sends the student back to sign-in; the same student can recover their pending request afterward. A different student gets a different storage key. Price, availability and credit rejection responses clear the pending attempt, refresh menu/account data, and require another explicit confirmation. Conflicting checkout-key responses stay locked for investigation.

If browser storage cannot be written, checkout does not send the request. Keep the tab open while resolving a pending order: closing the tab, clearing browser storage or switching devices can lose its saved key. Duplicate protection applies to retries of the same request, not separately started orders in different tabs. The API database remains the authoritative order/payment record.

Successful receipts also survive reload within that tab. “Start another order” clears the receipt and opens a fresh basket. The receipt is a confirmation snapshot, not the live order tracker; live progress is available in My orders. It never guesses that an order is Preparing or Ready.

Browser checkout tests use real orders in the temporary database. They cover the exact-wallet boundary, full-credit boundary, insufficient funds, quantity persistence, a response dropped after server commit, price changes requiring review, rapid double confirmation, session recovery, and mobile basket access. Face matching and real email delivery remain separate runtime checks.

## Wallet and credit history

Students can open `/wallet` from the menu toolbar or their account page. It shows the wallet balance, outstanding dues, credit limit and remaining credit directly from `/wallet`. These amounts are not reconstructed from whichever history page happens to be visible. The existing backend keeps this endpoint student-only; the frontend also sends staff/admin visitors back to their own account page.

Wallet activity lists top-ups with a positive sign and wallet-paid orders with a negative sign, including the accounts reference when present. Credit purchases are a separate ledger with All entries, Outstanding and Settled filters. A settled entry still shows the original purchase amount, alongside the settlement timestamp and reference; it no longer contributes to outstanding dues. Wallet top-ups and credit settlement are different actions, which the screen explains explicitly.

Both histories show 20 rows at a time. The request asks for one extra row to determine whether a next page exists, without inventing a total count. Switching credit status resets pagination. Requests are aborted on navigation/filter changes, and results are tied to their query so an older response cannot replace a newer selection. Summary, wallet history and credit history have independent failure states. No failed balance request is displayed as a zero balance.

Dates and times use `Asia/Kathmandu`, including purchases whose UTC date differs from the date in Nepal. Billing month remains the backend's Gregorian `YYYY-MM` value. Desktop tables become vertically stacked records on phones; the column meanings remain available through table headers and visible mobile labels.

This is a read-only account screen. Students cannot top up, change their credit limit or mark their own dues settled. These are accounts-office actions on the admin screens that follow. Values are page-load snapshots; there is no polling. The current API uses offset pagination, so concurrent new entries or settlements can shift page boundaries. Reopening the wallet starts again from current data.

## Admin student register

Admins now land on `/admin/students`. I start the register on pending enrollments, with name/roll search, enrollment filters and a separate account-access filter. The table requests 21 rows to show 20 at a time; it does not guess a total count. A native dialog keeps keyboard focus inside the selected student's record and supports Escape when no write is in flight.

Approval and rejection require an explicit confirmation. The API rejects a second review or an approval without a stored face encoding; the dialog reloads the record after a failed decision so another administrator's changes become visible. Original enrollment photos are not retained, so this screen does not offer a photo preview. Check the submitted details against college records.

Edits send only changed name, department, semester and email fields. Balances are read-only here. Suspension uses a separate confirmation and revokes existing student sessions; reactivation does not restore those sessions or approve a pending enrollment. The backend enforces admin authorization and CSRF on every write. The admin layout also redirects students and counter staff to their own screens.

## Admin menu management

The admin navigation now includes `/admin/menu`. I load the current and archived catalog in pages of 200, then search dish names and categories locally. That keeps filtering simple for one canteen without silently dropping anything beyond the first API page. Failed loads show an error and disable creation until the catalog can be checked again.

The editor accepts rupees with up to two decimal places and converts them to integer paisa before sending. It sends only changed fields when editing. Existing orders keep their stored item names and unit prices; editing the catalog never rewrites a sale.

Availability is a one-click switch. Sold-out dishes stay on the student menu, but checkout rejects them. Archiving requires confirmation, hides a dish from students and retains its order history. Restoration deliberately leaves it sold out until the kitchen marks it available. No menu records are deleted.

Writes are disabled while a request is pending. If a create/edit response is lost or the server fails, the editor stops accepting another submission and asks the admin to close it and check the reloaded catalog. Creation has no backend idempotency key, so blindly retrying an uncertain POST could create a duplicate dish. Menu data is a page-load snapshot with an explicit reload action; order tracking uses WebSockets.

Browser tests create a dish, place an actual order, change its price, mark it sold out, archive and restore it, then verify that the original order price survived. They also cover decimal validation, a response lost after a committed create, failed catalog loads, and tablet/mobile layouts in the existing theme.

## Admin wallet top-ups and credit limits

Open **Admin → Accounts**, search by name or roll number, then select the student's account. Balances come from the account summary endpoint; wallet activity and credit-limit audit history have their own pagination and retry controls. Dates use Nepal time. Pending and rejected enrollments cannot receive top-ups or credit-limit edits. Suspended approved students cannot be topped up, but the accounts office can still review their balance and change the credit limit within the backend rules.

Amounts are entered in NPR with at most two decimal places and converted to integer paisa without floating-point rounding. Review the student's name, roll number, amount and receipt reference before confirming a top-up. The form records funds already received; it does not collect payments. Top-ups do not clear credit dues.

Before sending a top-up, the application saves the exact request and its unique key in sessionStorage, scoped to the signed-in admin. A lost response, timeout, or expired session keeps the request locked for retry, including after navigation or reload in the same tab. Return to Accounts after signing back in with the same admin to recover it. A retry returns the original receipt rather than adding funds again. If browser storage cannot be written, no request is sent. Keep the tab until a pending top-up is resolved: closing it or clearing its storage loses the retry key. Separately started requests in other tabs are separate payments, so reconcile receipt references before recording them.

Credit-limit changes require a reason and confirmation. The request carries the limit last loaded by the admin. If another admin changed it, the backend rejects the stale update and the screen refreshes balances and audit history. It also rejects limits below outstanding dues. A lost limit-edit response requires reviewing the refreshed history before making a new change; it is not silently replayed.

Account edits use the authenticated account APIs. Browser tests cover exact paisa, confirmation, committed-response loss and reload recovery, stale limit updates, enrollment restrictions, unavailable balances, blocked storage, duplicate clicks, and mobile dark mode.

## Admin billing and settlements

Open **Admin → Billing** to review outstanding credit grouped by student and Nepal billing month. Choose a month or all months, then search by name or roll number. Visible totals describe only the filtered rows. Suspended students remain included because their debt still needs to be accounted for.

**Export dues CSV** downloads the authenticated backend export for the selected month (or all months). The name search does not filter the CSV. The export is a fresh server snapshot, so new orders may have arrived since the screen loaded. The CSV includes exact ledger IDs, integer paisa and formatted NPR; enrollment text is escaped by the existing backend for spreadsheet safety.

Review one student-month group, check its amount and ledger IDs, enter the accounts transfer reference, and confirm that the transfer has been verified. This records an accounts transfer; it does not initiate a bank payment. The request carries the exact reviewed ledger IDs and amount, so a later order remains outstanding. Already-settled entries or inconsistent balances reject the operation and refresh the dues for another review. The wallet never changes.

Before sending a settlement, the application saves its exact request and unique key in sessionStorage, scoped to the admin. A lost response or session keeps that request locked for recovery. Reload, or sign back in as the same admin and return to Billing, to retry it and recover the original receipt. No settlement is sent if browser storage cannot be written. Keep the same tab until the request is resolved; closing it or clearing browser data loses the recovery key. Independent requests in other tabs still go through the backend's ledger-state checks.

The receipt shows the amount, reference and Nepal timestamp. Settlement history is paginated and can be filtered to a student using the row's History action; it is independent of the dues month filter. Receipt details expose the ledger IDs, recording admin ID and receipt key for reconciliation. Global history uses student IDs because the existing history endpoint does not include student names; filtering from a dues row also shows the student's name and roll number.

The existing endpoint accepts at most 500 ledger entries and 2,147,483,647 paisa per settlement. A group beyond either limit remains visible and exportable, but its settlement button is disabled; smaller-batch reconciliation is outside this screen. This module uses the existing billing API and requires no new migration.

Browser tests verify filtering and CSV downloads, inactive accounts, settlement of reviewed IDs while newer debt remains, lost-response recovery after reload, concurrent settlement rejection, blocked storage, rapid clicks, load/export failures, cancellation, and mobile dark-mode review.

## Admin sales dashboard

Open **Admin → Sales** for daily and monthly reports. The initial view is month-to-date in Asia/Kathmandu, independent of the device's timezone. Today in Nepal and Month to date are quick presets. Daily ranges allow 1–366 days inclusive; the monthly report covers all twelve months of the selected year (1900–9999). Editing filter inputs does not change the displayed report until Apply report is pressed; its heading identifies the actual loaded range.

The four totals are sales, order count, wallet-funded sales and credit-funded sales. Average order value divides the full report's sales by its order count and rounds to paisa for display; it is shown as unavailable when there are no orders. The API's integer-paisa amounts stay unchanged until formatting. These are order-based sales, not profit or cash receipts. An order counts once when placed, including before collection; wallet top-ups and credit settlement do not add sales. Credit-funded sales are not the current unpaid balance.

The stacked chart uses green for wallet sales and patterned brass for credit sales, with a zero baseline and an NPR axis. Click or keyboard-focus a column for exact order count and payment breakdown. The exact-figures table supplies the same data without relying on colour or a chart. On small screens the chart scrolls inside its own labelled region; the page itself stays within the viewport.

Daily reports longer than 31 periods have chart/table pages. Headline totals always cover the full requested report, while the chart and table label their visible slice. All pages use the same vertical scale for comparison. Zero-sales days/months stay in the timeline; no-data reports explicitly show zero totals, not invented chart data. The default chart selection is the first largest-sales period on its current page.

Loading and errors hide previous totals to avoid showing an old report under a new date range. Abort handling prevents late responses from replacing a newer selection. Refresh report and Retry sales report load a new snapshot; this dashboard does not poll. Existing admin authentication protects both the page and report endpoints. No database migration or new frontend dependency is needed.

Browser checks cover real daily/monthly totals, payment splits, zero periods, long-range paging, date validation, error recovery, Nepal's midnight boundary, keyboard chart inspection, desktop/mobile dark mode, and unchanged sales after a real top-up and credit settlement.

## Staff counter identification and ordering

Staff now land on **/staff/counter** after sign-in. My account still provides logout and a link back to the counter. The staff layout checks the authenticated role; the backend independently enforces staff-only identification and counter ordering.

Choose Open camera to request camera access (HTTPS or localhost is required), capture a photo and press Identify student. Alternatively upload a JPEG/PNG up to 5 MB, or look up the exact student roll number. The backend validates photo content, size and face count. Ambiguous, unmatched and unavailable-engine responses leave the counter at identification; no student is guessed and no charge occurs. Lookup considers only active, approved students. Confirm the returned name and roll number with the student before adding items.

Camera tracks stop on capture, replacement, cancellation or leaving the identification screen. Late permission responses are also stopped. Photo previews are temporary object URLs, revoked on replacement/unmount, and no photo or encoding is placed in browser order storage. The server's existing identification route does not retain the uploaded image. Browser coverage uses a synthetic video stream and mocked face-match responses; real camera recognition and dlib accuracy remain unverified and require the planned onsite check.

After confirming identity, staff browse/search/filter the real menu and adjust the basket. Payment uses the student's whole wallet balance only when it covers the whole order; otherwise the whole order uses credit within its available limit. The backend always checks the latest balances, prices and availability. A rejected checkout refreshes the menu and requires refreshing and reconfirming the student before another attempt.

The exact checkout request, student identity and basket snapshot are saved before POST, under a sessionStorage key scoped to the staff account. Uncertain checkouts lock student switching and basket edits. Reload, or sign back in as the same staff member, to retry the same request and recover its original token without charging again. A confirmed receipt survives reload until Next student is pressed. Keep the same browser tab until pending checkout is resolved; clearing storage or closing the tab loses the recovery key. Separate tabs may start separate orders.

Unsubmitted drafts are kept only while this page is open. Change student requires discarding the current basket explicitly. Next student clears the confirmed receipt and identity. If storage is unavailable, no checkout request is sent. After restoring storage, reload and identify the student again.

The receipt names the student and shows the original items, payment source, token and Nepal-local order date. The live staff queue and student tracker share the order WebSocket. No new database migration or frontend dependency is required.

Browser checks cover staff login, confirmed roll lookup, wallet/credit boundaries, student-switch confirmation, lost-response and reauthentication recovery, camera permission denial, upload validation, ambiguous matching, synthetic camera cleanup, price-change rejection, blocked storage, rapid clicks, and desktop/mobile layouts. Face recognition responses are mocked; financial checkout and lookup use the real disposable backend.

## Live staff order queue

Open **Staff → Order queue** for Received, Preparing and Ready columns. Tickets show the student, original item quantities, payment source, date and token. Oldest orders appear first within each stage; all uncollected orders remain visible, including previous days. Search by student name, token, date or order ID. Tokens restart each day, so confirm the date as well as the number. Collection requires a separate handover confirmation and removes the ticket from the board.

The browser connects to the existing read-only order WebSocket through `/api/ws/orders`. It first replaces its board with the complete snapshot, then applies committed events using the snapshot watermark and newest revision per order. Collected revisions are retained for that connection so delayed events cannot restore a collected ticket. Independent orders can publish out of commit order; the client does not advance a global watermark after individual updates. There is no order polling.

Status changes use the existing CSRF-protected PATCH endpoint with both expected and target statuses. Rapid duplicate clicks are blocked. A stale request is rejected by the server and triggers a fresh snapshot. Status changes never charge the student again. Ready transitions use the existing notification outbox when email delivery is configured.

Before sending a transition, the browser saves its exact expected and target statuses in sessionStorage, scoped to the staff account. Lost responses or timeouts leave an update awaiting confirmation, even if a socket event has already moved its ticket. Reload in the same tab and retry the saved update; this repeats the original transition and cannot advance another stage. Reauthentication as the same staff member preserves recovery. If the order has moved farther on another screen, the backend rejects the old request and the queue refreshes. An uncertain collection stays in the recovery section even after its ticket leaves the board. Keep the tab until pending updates are resolved; closing the tab or clearing storage discards recovery data. Unavailable or invalid storage pauses writes.

Disconnects retain the last visible board but disable all status controls until a fresh snapshot arrives. Heartbeats check the connection; reconnects use bounded exponential backoff, and staff can request a manual resync. Failed handshakes check the current authenticated session before retrying. Logout or expired/revoked sessions return to sign-in. The backend permits five simultaneous order connections per session.

Deployment must forward WebSocket upgrades for `/api/ws/orders` to FastAPI `/ws/orders` and preserve the session cookie and Origin. The current Next rewrite works with the tested Node development server; configure and verify the production reverse proxy as well. Keep the backend on one worker while its connection hub is in memory. HTTPS uses WSS, and the public browser origin must be in `CAMPUSDINE_ALLOWED_ORIGINS`. No database migration or new dependency is required.

Browser tests cover real same-origin WebSocket delivery across two staff screens, new orders, all transitions, collection confirmation, duplicate clicks, unchanged balances, lost-response reload recovery, stale-request rejection, out-of-order revisions, collected tombstones, disconnect control locking, replacement snapshots, old-date tokens, search, blocked storage, logout and desktop/mobile dark mode. Synthetic socket messages exercise ordering and reconnect edge cases; lifecycle and payment assertions use the real disposable backend.

## Student live order tracker

Students can open **My orders** from the menu or wallet navigation, use Track your orders in My account, or choose Track my orders after checkout. `/orders` shows every active order, including orders placed by staff at the counter, and the 20 most recent collected orders. The recent list is intentionally limited and is labelled accordingly; this page is not a complete purchase-history export.

Each ticket keeps its token, Nepal-local order date and order ID together. The four-stage progress display follows Received → Preparing → Ready → Collected. Ready for collection tells the student to show the token at the canteen counter. Collected orders move to the recent section without disappearing from the student's view. All active orders remain visible, oldest first, while collected orders follow the backend's descending order-ID convention. Stage labels and accessible current-step text supplement colour; ready-count changes are announced to assistive technology.

Order details expand to show original quantities and prices, total, payment source and Nepal placement time. Credit wording describes how the order was charged and directs students to Wallet & credit for current dues; it does not imply a previously settled order is still unpaid. No estimated preparation time or stage timestamp is invented. Staff remain responsible for all status changes, including handover.

The page reuses the authenticated WebSocket connection and revision handling used by the staff queue. The backend filters both snapshots and updates to the signed-in student. This read-only tracker does not send order-status writes or poll order endpoints. Staff and admin accounts are redirected to My account; unauthenticated students return to sign-in. Session-check failures show a retry action instead of a misleading empty state. Logout and revocation remove access to the tracker.

During a disconnect, existing cards remain visible with a last-known label and a waiting-for-update message. A stale Ready card does not continue claiming the order is currently ready. Reconnection replaces the collection with a fresh snapshot; delayed older revisions cannot move an order backward. Refresh orders explicitly requests another connection and snapshot. Live updates apply while this page is open; background browser push notifications and sound are not implemented. The deployment requirements used by the staff queue still apply: WebSocket proxy support, allowed public Origin, secure cookies/WSS in production, and one FastAPI worker for the in-memory hub.

Browser checks exercise checkout-to-tracker navigation, actual staff actions through collection, unchanged balances, new counter orders, owner-only snapshots and events, HTTP ownership restrictions, rejected student status writes, logout, multiple active tickets, the recent-list bound, reconnection and stale events, empty/error states, role guards, credit wording, Nepal timestamps and desktop/mobile layouts. No backend migration or new dependency is required.
