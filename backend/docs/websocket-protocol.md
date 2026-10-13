# Order socket contract

Run one FastAPI worker. The connection registry is in memory; SQLite remains the source of truth. `websockets` is included in the backend dependencies for Uvicorn transport support.

Connect to `/ws/orders` using the existing session cookie. Browser connections must send an Origin listed in `CAMPUSDINE_ALLOWED_ORIGINS`. Student and staff roles are supported; admins use the reporting APIs. Cookies are not accepted in URLs.

The first message is `snapshot`, containing `role`, `watermark`, and `orders`. Replace the local order collection on every new snapshot. Staff receive all uncollected orders, including older dates. Students receive their own active orders and their 20 most recent collected orders.

Subsequent messages have `type: "order.updated"` and an `order` object matching the HTTP order response. `revision` is the latest status-log ID for that order. Keep the newest revision per order when combining HTTP and socket responses. Staff remove a ticket when its status becomes `collected`; students update its tracker to Collected.

I register the connection before reading the snapshot. Changes during that read enter its queue. The snapshot watermark suppresses events already represented in the snapshot, including collected tickets that are no longer present. Afterward, revisions are compared per order rather than globally: two independent requests can finish publishing in a different order from their commits.

Order and status writes still use authenticated HTTP endpoints with CSRF protection. The socket is read-only. The only accepted client message is the text `ping`, answered with `{"type":"pong"}`. No order polling is required.

The server closes live connections on logout, session replacement, student suspension, and session expiry. A session may have up to five connections. Each connection has a 64-message queue and a five-second send timeout. On overflow or send timeout it closes with 1013; reconnect with bounded backoff and accept the fresh snapshot. Shutdown uses 1012. Invalid or expired sessions use 4401, and unsupported client messages use 1008. Failed handshakes may appear as HTTP 403 or browser close code 1006; check `/auth/me` before repeatedly reconnecting.

Updates are queued only after commit. Checkout and status retries do not broadcast a second event. This is not a durable event bus: a process restart drops sockets, and reconnect retrieves current committed state. Ready email notifications use the separate notification outbox when delivery is configured; socket delivery does not depend on email delivery.
