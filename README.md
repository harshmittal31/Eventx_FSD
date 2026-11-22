# EventX Event Management

EventX is an event booking application with a React/Vite frontend and an Express API backed by MySQL. The backend manages event and venue creation, seat locking, booking confirmation and cancellation, ticket validation, waitlists, and ticket transfers.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the four-layer system architecture, end-to-end workflows, step-by-step authentication and authorization, data relationships, the [architecture diagram](docs/eventx-architecture.svg), and the [authentication flow diagram](docs/eventx-auth-flow.svg).

- `frontend/`: React application built with Vite.
- `backend/src/app.js`: Express API and route registration.
- `backend/src/controllers/`: event, booking, seat-lock, ticket, waitlist, and account workflows.
- `backend/src/config/venueConfig.json`: default venue layout and tier prices.
- `backend/src/config/venues/`: sample layouts suitable for event-specific `venueLayout` input.
- MySQL: persistent events, seats, seat locks, bookings, booking seats, tickets, users, and waitlist entries.

Booking confirmation consumes active seat locks in a database transaction and creates booking seats and tickets as one operation. Cancellation releases seats and reserves released seats for the earliest waitlisted users within its transaction.

## Setup

Requirements: Node.js, npm, and a MySQL database initialized with the EventX tables.

1. Configure `backend/.env` with `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, and `TICKET_HMAC_SECRET`.
2. Install backend dependencies and start the API:

   ```powershell
   cd backend
   npm install
   npm run dev
   ```

3. In another terminal, install and start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

The API health check is `GET /api/health`.

## API overview

All paths below are relative to the API origin. Authenticated requests must include the JWT in the `Authorization` header using the `Bearer` scheme.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Register a customer |
| `POST` | `/api/auth/login` | Sign in and receive a JWT |
| `GET` | `/api/events` | List published events |
| `POST` | `/api/events` | Create an event and its seats (staff/admin) |
| `GET` | `/api/events/:eventId/seats` | Read event seats |
| `POST` | `/api/events/:eventId/seats/:seatId/lock` | Temporarily lock an available seat |
| `POST` | `/api/bookings/confirm` | Confirm a seat lock; supports `lockId` or `lockIds` |
| `GET` | `/api/bookings/my-bookings` | Read the authenticated customer's bookings |
| `PATCH` | `/api/bookings/:bookingId/cancel` | Cancel a confirmed booking |
| `POST` | `/api/tickets` | Create a ticket for a confirmed booking seat |
| `GET` | `/api/tickets/my` | Read the authenticated customer's tickets |
| `POST` | `/api/tickets/verify` | Verify a ticket (staff/admin) |
| `POST` | `/api/tickets/transfer` | Initiate a ticket transfer |
| `POST` | `/api/tickets/transfer/:transferId/accept` | Accept a pending transfer (recipient only) |
| `POST` | `/api/tickets/transfer/:transferId/reject` | Reject/cancel a pending transfer (either party) |
| `POST` | `/api/waitlist/:eventId` | Join a sold-out event's waitlist |
| `GET` | `/api/waitlist/my` | Read the authenticated customer's waitlist entries |
| `POST` | `/api/waitlist/:eventId/promote` | Promote the next waiter (staff/admin) |

## Venue layouts and pricing

When `venueLayout` is omitted from `POST /api/events`, the backend uses `backend/src/config/venueConfig.json`. Its default tiers are VIP (rows A-B, ₹1000), PREMIUM (rows C-E, ₹750), and REGULAR (rows F-J, ₹500).

An event can instead provide a complete layout in its request body:

```json
{
  "name": "Community Conference",
  "venueName": "Conference Hall",
  "eventDate": "2035-06-15T20:00:00",
  "venueLayout": {
    "rows": 3,
    "seatsPerRow": 8,
    "sections": [
      { "name": "FRONT", "rows": ["A"], "price": 1000 },
      { "name": "MIDDLE", "rows": ["B"], "price": 650 },
      { "name": "BACK", "rows": ["C"], "price": 350 }
    ]
  }
}
```

Rows must be between 1 and 26 and seats per row between 1 and 50. Sections must cover each generated row exactly once, and each section needs a non-empty name and a positive numeric price. Sample definitions are in [amphitheater.json](backend/src/config/venues/amphitheater.json) and [conference_hall.json](backend/src/config/venues/conference_hall.json); send their JSON contents as `venueLayout` when creating an event.

## Ticket transfers

Transfers use two authenticated steps:

1. The current ticket owner posts `{ "ticketId": 123, "recipientEmail": "recipient@example.test" }` to `/api/tickets/transfer`. The recipient must already have an account. In one transaction, the ticket changes from `VALID` to `PENDING_TRANSFER` and a `PENDING` transfer row is created.
2. The intended recipient accepts via `/api/tickets/transfer/:transferId/accept`. A single transaction creates the recipient's confirmed booking, reassigns the booking-seat row, restores the ticket to `VALID`, and completes the transfer. No intermediate committed state assigns the ticket to both users or neither.

Either party can reject a pending transfer using `/api/tickets/transfer/:transferId/reject`; the sender retains the ticket and it returns to `VALID`. Accept/reject races serialize on the transfer row, so only one transition can succeed.

Cancelling the owning booking or event also cancels the pending ticket and marks its transfer `REJECTED` in the same transaction.

Apply [20261122_ticket_transfers.sql](backend/migrations/20261122_ticket_transfers.sql) before deploying the new endpoints. It creates `ticket_transfers` and widens `tickets.status` to support `PENDING_TRANSFER`.

## Verification results

<!-- CONCURRENCY_RESULTS_START -->
Last run: 2026-11-22T05:03:12.558Z

| Scenario | Result | Details |
|---|---|---|
| Per-event venue layout and tier pricing | PASS | custom JSON accepted, 6 seats priced by tier, incomplete row coverage rejected |
| N-of-M headline (500 users / 100 seats) | PASS | initial_attempts=500, users=500, booked=100, failed=400, retries=0, oversold=0, double-booked=0 |
| Lock expiry under load (200 seats) | PASS | locked=200, confirmed=100, expired-and-returned=100, rebooked=100 |
| Sold-out → cancellation → waitlist (E2E) | PASS | sold-out=5, cancelled=1, first waiter promoted and confirmed, seat leaks=0 |
| Atomic ticket transfer and race | PASS | pending status verified, accepted owner=13416, race=COMPLETED |
<!-- CONCURRENCY_RESULTS_END -->

| Area | Result |
|---|---|
| Backend unit tests | PASS — 13/13 |
| Backend integration tests | PASS — 15/15, including auth/profile, events, seats/bookings, tickets/audit, cancellation, waitlist, wishlist/reviews/support, notifications, and refund status transitions |
| Concurrency and E2E | PASS — all 5 scenarios above |
| Backend JavaScript syntax | PASS — 40 files |
| Frontend production build | PASS — build emits a warning for a minified JavaScript chunk over 500 kB |
| Frontend browser smoke test | PASS — event listing/search/filter/details, login/register form, and required-field validation |
| Frontend lint | PASS — `npm run lint` |
| Read-only k6 load test | PASS — 100 VUs, 8,610 requests/checks, 0 failed requests/checks; p95 response time 5.62 ms |
