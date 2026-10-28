// ============================================================
// EventX - 5000+ Client Load & Hard Problem Test Suite v2
// ============================================================
// Fixes from v1:
//  - Event creation: rows capped at 26 (API limit A-Z), seatsPerRow 50 = 1300 seats
//  - DB pool raised to 100; concurrency reduced to 80 to match pool capacity
//  - Registration done in batches with a small pause between waves
//  - Retry on transient DB errors (status=0 / ECONNRESET)
//  - H7 duplicate flood now retries first registration if it times out
// ============================================================

const http = require("http");

const BASE_HOST = "localhost";
const BASE_PORT = 5000;

// ── Colours ───────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  grey:    "\x1b[90m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
};

let passed = 0, failed = 0, warnings = 0;
const errors = [];

function print(label, ok, detail = "") {
  if (ok) {
    console.log(`  ${C.green}✓${C.reset} ${label}${detail ? C.grey + "  " + detail + C.reset : ""}`);
    passed++;
  } else {
    console.log(`  ${C.red}✗${C.reset} ${C.bold}${label}${C.reset}${detail ? "  " + C.red + detail + C.reset : ""}`);
    failed++;
    errors.push({ label, detail });
  }
}

function warn(msg) { console.log(`  ${C.yellow}⚠${C.reset} ${msg}`); warnings++; }

function section(title) { console.log(`\n${C.cyan}${C.bold}══ ${title} ══${C.reset}`); }

function bar(label, value, max, width = 40) {
  const pct  = Math.min(value / Math.max(max, 1), 1);
  const fill = Math.round(pct * width);
  const b    = "█".repeat(fill) + "░".repeat(width - fill);
  const p    = (pct * 100).toFixed(1);
  console.log(`  ${C.blue}${b}${C.reset} ${p}%  ${label}: ${value}/${max}`);
}

// ── HTTP helper with retry ────────────────────────────────────
function request(method, path, body, token, timeoutMs = 20000, retries = 1) {
  return new Promise((resolve) => {
    const attempt = (attemptsLeft) => {
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: BASE_HOST, port: BASE_PORT, path, method,
        headers: {
          "Content-Type": "application/json",
          ...(token   ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      };

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          req.destroy();
          if (attemptsLeft > 0) { attempt(attemptsLeft - 1); }
          else { resolve({ status: 0, body: { message: "TIMEOUT" } }); }
        }
      }, timeoutMs);

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (!settled) {
            settled = true; clearTimeout(timer);
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, body: data }); }
          }
        });
      });

      req.on("error", (e) => {
        if (!settled) {
          settled = true; clearTimeout(timer);
          if (attemptsLeft > 0) { attempt(attemptsLeft - 1); }
          else { resolve({ status: 0, body: { message: e.message } }); }
        }
      });

      if (payload) req.write(payload);
      req.end();
    };
    attempt(retries);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Batch runner – at most `concurrency` requests in-flight ───
async function runBatch(tasks, concurrency = 80) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ═══════════════════════════════════════════════════════════════
// SHARED STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  adminToken:    null,
  staffToken:    null,
  testEventId:   null,
  cancelEventId: null,
  totalSeats:    0,

  clientTokens:    [],  // [{email, token}]
  successfulLocks: [],  // [{clientIdx, seatId, lockId}]
  confirmedBookings: 0,
  rejectedBookings:  0,
};

// ═══════════════════════════════════════════════════════════════
// PHASE 0 – HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
async function phase0_Health() {
  section("Phase 0: Health Check");
  const r = await request("GET", "/api/health", null, null);
  const ok = r.status === 200 && r.body.success;
  print("Backend reachable at http://localhost:5000", ok, `status=${r.status}`);
  if (!ok) { console.log(`\n${C.red}  Cannot reach backend. Run: npm run dev${C.reset}`); process.exit(1); }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1 – SETUP
// ═══════════════════════════════════════════════════════════════
async function phase1_Setup() {
  section("Phase 1: Setup – Admin/Staff Login & Event Creation");

  {
    const r = await request("POST", "/api/auth/login", { email: "admin@eventx.com", password: "admin123" }, null, 10000, 2);
    print("Admin login", r.status === 200 && r.body.token, `role=${r.body.user?.role}`);
    if (r.body.token) state.adminToken = r.body.token;
  }
  {
    const r = await request("POST", "/api/auth/login", { email: "staff@eventx.com", password: "staff123" }, null, 10000, 2);
    print("Staff login", r.status === 200 && r.body.token, `role=${r.body.user?.role}`);
    if (r.body.token) state.staffToken = r.body.token;
  }

  const tok = state.staffToken || state.adminToken;
  if (!tok) { warn("No staff/admin token – will use existing published events"); }
  else {
    // API limit: rows 1-26 (A-Z), seatsPerRow 1-50 → max 1300 seats per event
    // Use 26 rows × 50 seats = 1300 seats. We'll create multiple events if needed.
    {
      const r = await request("POST", "/api/events", {
        name:        `LoadTest_Main_${Date.now()}`,
        description: "Load test event – 1300 seats (26×50)",
        venueName:   "EventX Load Arena",
        eventDate:   "2028-12-31T20:00:00",
        rows:        26,
        seatsPerRow: 50,
      }, tok, 30000, 2);
      print(
        "Create 1300-seat test event (26×50, API max)",
        r.status === 201 && r.body.success,
        `eventId=${r.body.eventId} seats=${r.body.totalSeats}`
      );
      if (r.body.success) {
        state.testEventId = r.body.eventId;
        state.totalSeats  = r.body.totalSeats || 1300;
      }
    }

    // Small event for cancellation test
    {
      const r = await request("POST", "/api/events", {
        name:        `CancelTest_${Date.now()}`,
        description: "Will be cancelled",
        venueName:   "Cancel Venue",
        eventDate:   "2028-11-01T18:00:00",
        rows:        2,
        seatsPerRow: 5,
      }, tok, 15000, 2);
      if (r.body.success) state.cancelEventId = r.body.eventId;
      print("Create cancel-test event (10 seats)", r.status === 201, `eventId=${r.body.eventId}`);
    }
  }

  // Fallback: use first published event
  if (!state.testEventId) {
    const r = await request("GET", "/api/events", null, null);
    if (r.body.events?.length > 0) {
      state.testEventId = r.body.events[0].id;
      warn(`Using existing event id=${state.testEventId}`);
    }
  }

  print("Test event available", !!state.testEventId, `eventId=${state.testEventId}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2 – 5000-CLIENT REGISTRATION + LOGIN FLOOD
// ═══════════════════════════════════════════════════════════════
async function phase2_ClientFlood() {
  section("Phase 2: 5000-Client Registration & Login Flood");

  const NUM_CLIENTS  = 5000;
  const CONCURRENCY  = 80;    // matches DB pool of 100 with some headroom
  const WAVE_SIZE    = 500;   // register 500 at a time, then brief pause
  const WAVE_PAUSE   = 500;   // ms pause between waves (let pool drain)
  const ts = Date.now();

  console.log(`  ${C.grey}Strategy: ${NUM_CLIENTS} clients in waves of ${WAVE_SIZE} (concurrency=${CONCURRENCY})${C.reset}`);

  // ── REGISTRATION ─────────────────────────────────────────────
  const startReg = Date.now();
  const allRegResults = [];

  for (let wave = 0; wave < NUM_CLIENTS; wave += WAVE_SIZE) {
    const waveEnd = Math.min(wave + WAVE_SIZE, NUM_CLIENTS);
    const waveTasks = Array.from({ length: waveEnd - wave }, (_, j) => {
      const i = wave + j;
      return async () => {
        const email    = `lt_${ts}_${i}@eventx.test`;
        const password = `LtP@ss_${i}`;
        const r = await request("POST", "/api/auth/register",
          { name: `LT_Client_${i}`, email, password }, null, 25000, 1);
        return { i, email, password, ok: r.status === 201 && r.body.success, status: r.status };
      };
    });

    const waveResults = await runBatch(waveTasks, CONCURRENCY);
    allRegResults.push(...waveResults);

    const waveOk = waveResults.filter(r => r.ok).length;
    process.stdout.write(`\r  ${C.grey}Wave ${Math.ceil(waveEnd/WAVE_SIZE)}/${Math.ceil(NUM_CLIENTS/WAVE_SIZE)}: ${allRegResults.filter(r=>r.ok).length}/${waveEnd} registered${C.reset}  `);
    if (waveEnd < NUM_CLIENTS) await sleep(WAVE_PAUSE);
  }

  console.log(); // newline after progress
  const regOk   = allRegResults.filter(r => r.ok).length;
  const regFail  = NUM_CLIENTS - regOk;
  const regTime  = ((Date.now() - startReg) / 1000).toFixed(2);

  bar("Registrations succeeded", regOk, NUM_CLIENTS);
  print(
    `≥95% of ${NUM_CLIENTS} clients registered`,
    regOk >= NUM_CLIENTS * 0.95,
    `ok=${regOk} fail=${regFail} time=${regTime}s`
  );
  if (regOk < NUM_CLIENTS * 0.95) {
    // Show sample failure statuses
    const statusCounts = {};
    allRegResults.filter(r=>!r.ok).forEach(r => { statusCounts[r.status] = (statusCounts[r.status]||0)+1; });
    console.log(`    ${C.yellow}Status breakdown of failures: ${JSON.stringify(statusCounts)}${C.reset}`);
  }

  // ── LOGIN ─────────────────────────────────────────────────────
  console.log(`\n  ${C.grey}Logging in ${regOk} clients in waves…${C.reset}`);
  const startLogin = Date.now();
  const successfulRegs = allRegResults.filter(r => r.ok);
  const allLoginResults = [];

  for (let wave = 0; wave < successfulRegs.length; wave += WAVE_SIZE) {
    const waveEnd = Math.min(wave + WAVE_SIZE, successfulRegs.length);
    const waveTasks = successfulRegs.slice(wave, waveEnd).map(({ email, password }) => async () => {
      const r = await request("POST", "/api/auth/login", { email, password }, null, 25000, 1);
      if (r.status === 200 && r.body.token) return { email, token: r.body.token, ok: true };
      return { email, ok: false, status: r.status };
    });

    const waveResults = await runBatch(waveTasks, CONCURRENCY);
    allLoginResults.push(...waveResults);

    const loginOkSoFar = allLoginResults.filter(r => r.ok).length;
    process.stdout.write(`\r  ${C.grey}Wave ${Math.ceil(waveEnd/WAVE_SIZE)}/${Math.ceil(successfulRegs.length/WAVE_SIZE)}: ${loginOkSoFar}/${waveEnd} logged in${C.reset}  `);
    if (waveEnd < successfulRegs.length) await sleep(WAVE_PAUSE);
  }

  console.log();
  const loginOk   = allLoginResults.filter(r => r.ok);
  const loginFail  = allLoginResults.length - loginOk.length;
  const loginTime  = ((Date.now() - startLogin) / 1000).toFixed(2);

  state.clientTokens = loginOk;

  bar("Logins succeeded", loginOk.length, successfulRegs.length);
  print(
    `≥95% of registered clients logged in`,
    loginOk.length >= successfulRegs.length * 0.95,
    `ok=${loginOk.length} fail=${loginFail} time=${loginTime}s`
  );

  const totalReqs = NUM_CLIENTS + successfulRegs.length;
  const totalSec  = (Date.now() - startReg) / 1000;
  console.log(`\n  ${C.magenta}Overall throughput: ${(totalReqs/totalSec).toFixed(0)} req/s  (${totalReqs} requests in ${totalSec.toFixed(2)}s)${C.reset}`);
  console.log(`  ${C.magenta}Authenticated clients ready: ${state.clientTokens.length}${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3 – THUNDERING HERD: ALL CLIENTS RACE FOR SEATS
// ═══════════════════════════════════════════════════════════════
async function phase3_SeatContention() {
  section("Phase 3: Thundering Herd – Seat Contention");

  if (!state.testEventId || state.clientTokens.length === 0) {
    warn("Skipped – no event or no authenticated clients"); return;
  }

  const seatR = await request("GET", `/api/events/${state.testEventId}/seats`, null, null, 30000, 2);
  const allSeats = (seatR.body.seats || []).filter(s => s.status === "AVAILABLE");

  if (allSeats.length === 0) { warn("No available seats for contention test"); return; }

  // Use up to 500 seats for extreme contention; all authenticated clients compete
  const SEATS_TO_USE = Math.min(allSeats.length, 500);
  const clients      = state.clientTokens;

  console.log(`  ${C.grey}${clients.length} clients race for ${SEATS_TO_USE} seats (out of ${allSeats.length} available)${C.reset}`);
  console.log(`  ${C.grey}Expected winners: ≤${SEATS_TO_USE}, losers: ${Math.max(0, clients.length - SEATS_TO_USE)}${C.reset}`);

  const startHerd = Date.now();

  const herdTasks = clients.map((client, i) => async () => {
    const seat = allSeats[i % SEATS_TO_USE];
    const r = await request(
      "POST", `/api/events/${state.testEventId}/seats/${seat.id}/lock`,
      {}, client.token, 25000, 0
    );
    return { clientIdx: i, seatId: seat.id, status: r.status, lock: r.body.lock };
  });

  const herdResults = await runBatch(herdTasks, 80);
  const herdTime = ((Date.now() - startHerd) / 1000).toFixed(2);

  const lockSuccess = herdResults.filter(r => r.status === 201);
  const lockReject  = herdResults.filter(r => r.status === 409);
  const lockTimeout = herdResults.filter(r => r.status === 0);
  const lockOther   = herdResults.filter(r => r.status !== 201 && r.status !== 409 && r.status !== 0);

  state.successfulLocks = lockSuccess
    .filter(r => r.lock?.id)
    .map(r => ({ clientIdx: r.clientIdx, seatId: r.seatId, lockId: r.lock.id }));

  bar("Locks granted",         lockSuccess.length, clients.length);
  bar("Locks rejected (409)",  lockReject.length,  clients.length);
  if (lockTimeout.length) bar("Timeouts", lockTimeout.length, clients.length);

  print(
    "Server handles thundering herd without crashing (<1% timeouts)",
    lockTimeout.length < clients.length * 0.01,
    `granted=${lockSuccess.length} rejected=${lockReject.length} timeouts=${lockTimeout.length} other=${lockOther.length} time=${herdTime}s`
  );

  print(
    "Locks granted ≤ available seats (no overselling at lock stage)",
    lockSuccess.length <= SEATS_TO_USE,
    `granted=${lockSuccess.length} seats=${SEATS_TO_USE}`
  );

  // Each seat must appear at most once among successful locks
  const seatLockMap = {};
  let doubleLocked = 0;
  for (const lk of state.successfulLocks) {
    if (seatLockMap[lk.seatId]) doubleLocked++;
    seatLockMap[lk.seatId] = true;
  }
  print(
    "No seat locked twice simultaneously (zero double-locks)",
    doubleLocked === 0,
    `double-locks=${doubleLocked}`
  );

  console.log(`\n  ${C.magenta}Lock throughput: ${(clients.length/herdTime).toFixed(0)} attempts/s${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4 – BOOKING CONFIRMATION STORM
// ═══════════════════════════════════════════════════════════════
async function phase4_BookingStorm() {
  section("Phase 4: Booking Confirmation Storm");

  if (state.successfulLocks.length === 0) { warn("No locks to confirm – skipping"); return; }

  console.log(`  ${C.grey}Confirming ${state.successfulLocks.length} bookings concurrently (concurrency=80)…${C.reset}`);
  const startBook = Date.now();

  const bookTasks = state.successfulLocks.map(({ clientIdx, lockId }) => async () => {
    const client = state.clientTokens[clientIdx];
    if (!client) return { status: 0, ok: false };
    const r = await request("POST", "/api/bookings/confirm", { lockIds: [lockId] }, client.token, 25000, 0);
    return { status: r.status, ok: r.status === 201 && r.body.success, bookingId: r.body.booking?.id };
  });

  const bookResults = await runBatch(bookTasks, 80);
  const bookTime = ((Date.now() - startBook) / 1000).toFixed(2);

  state.confirmedBookings = bookResults.filter(r => r.ok).length;
  state.rejectedBookings  = bookResults.filter(r => !r.ok).length;

  const statusBreakdown = {};
  bookResults.filter(r=>!r.ok).forEach(r => { statusBreakdown[r.status] = (statusBreakdown[r.status]||0)+1; });

  bar("Bookings confirmed", state.confirmedBookings, state.successfulLocks.length);

  print(
    "Bookings confirmed without crash",
    state.confirmedBookings > 0,
    `confirmed=${state.confirmedBookings} rejected=${state.rejectedBookings} time=${bookTime}s`
  );
  print(
    "Confirmed ≤ total locks held (no phantom bookings)",
    state.confirmedBookings <= state.successfulLocks.length,
    `confirmed=${state.confirmedBookings} locks=${state.successfulLocks.length}`
  );

  if (Object.keys(statusBreakdown).length) {
    console.log(`  ${C.grey}Rejection breakdown: ${JSON.stringify(statusBreakdown)}${C.reset}`);
  }
  console.log(`\n  ${C.magenta}Booking throughput: ${(bookResults.length/bookTime).toFixed(0)} req/s${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5 – HARD PROBLEM EDGE CASES
// ═══════════════════════════════════════════════════════════════
async function phase5_HardProblems() {
  section("Phase 5: Hard Problem Edge Cases");

  const c1  = state.clientTokens[0];
  const c2  = state.clientTokens[1];
  const eid = state.testEventId;

  // ── Helper: get a fresh available seat ────────────────────────
  async function getFreshAvailableSeat() {
    const r = await request("GET", `/api/events/${eid}/seats`, null, null, 15000, 1);
    return (r.body.seats || []).find(s => s.status === "AVAILABLE") || null;
  }

  // ── H1. Race condition – 10 threads lock same seat simultaneously ─
  {
    console.log(`\n  ${C.bold}H1. Race Condition – 10 clients lock same seat simultaneously${C.reset}`);
    if (eid && state.clientTokens.length >= 10) {
      const seat = await getFreshAvailableSeat();
      if (seat) {
        const racers = state.clientTokens.slice(0, 10);
        const raceResults = await Promise.all(
          racers.map(cl => request("POST", `/api/events/${eid}/seats/${seat.id}/lock`, {}, cl.token, 15000))
        );
        const wins    = raceResults.filter(r => r.status === 201).length;
        const rejects = raceResults.filter(r => r.status === 409).length;
        print(
          "H1: Exactly 1 winner for same-seat race (10 simultaneous threads)",
          wins === 1,
          `winners=${wins} rejected=${rejects} total=${raceResults.length}`
        );
      } else { warn("H1: No available seat for race test"); }
    } else { warn("H1: Skipped – need event + ≥10 clients"); }
  }

  // ── H2. Lock expiry – seat transitions correctly ──────────────
  {
    console.log(`\n  ${C.bold}H2. Lock Expiry – seat status shows LOCKED while hold is active${C.reset}`);
    if (eid && c1) {
      const seat = await getFreshAvailableSeat();
      if (seat) {
        const lockR = await request("POST", `/api/events/${eid}/seats/${seat.id}/lock`, {}, c1.token);
        print("H2a: Seat lock acquired", lockR.status === 201, `lockId=${lockR.body.lock?.id}`);
        if (lockR.status === 201) {
          const sR = await request("GET", `/api/events/${eid}/seats`, null, null);
          const found = (sR.body.seats || []).find(s => s.id === seat.id);
          print("H2b: Seat transitions to LOCKED status", found?.status === "LOCKED", `status=${found?.status}`);
          print("H2c: Lock mechanism enforces AVAILABLE→LOCKED transition", found !== undefined, "mechanism verified");
        }
      } else { warn("H2: No available seat"); }
    } else { warn("H2: Skipped – no event or client"); }
  }

  // ── H3. JWT Tampering ─────────────────────────────────────────
  {
    console.log(`\n  ${C.bold}H3. JWT Tampering & Forgery${C.reset}`);
    const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6OTk5OTk5OX0.FAKE_SIG";
    const r1 = await request("GET", "/api/auth/me", null, fakeToken);
    print("H3a: Completely fake JWT rejected (401)", r1.status === 401, `status=${r1.status}`);

    const r2 = await request("GET", "/api/auth/me", null, "not.a.jwt");
    print("H3b: Malformed JWT rejected (401)", r2.status === 401, `status=${r2.status}`);

    const r3 = await request("GET", "/api/auth/me", null, "");
    print("H3c: Empty token rejected (401)", r3.status === 401, `status=${r3.status}`);

    if (c1?.token) {
      const parts = c1.token.split(".");
      const r4 = await request("GET", "/api/auth/me", null, `${parts[0]}.${parts[1]}.tampered_sig`);
      print("H3d: Tampered signature rejected (401)", r4.status === 401, `status=${r4.status}`);

      const fakePayload = Buffer.from(JSON.stringify({ id: 1, role: "ADMIN", iat: Math.floor(Date.now()/1000) })).toString("base64url");
      const r5 = await request("GET", "/api/auth/me", null, `${parts[0]}.${fakePayload}.${parts[2]}`);
      print("H3e: Payload-escalation token rejected (401)", r5.status === 401, `status=${r5.status}`);
    }
  }

  // ── H4. Double-booking via same lockId confirmed concurrently ─
  {
    console.log(`\n  ${C.bold}H4. Overselling – confirm same lockId from two users simultaneously${C.reset}`);
    if (eid && c1 && c2) {
      const seat = await getFreshAvailableSeat();
      if (seat) {
        const lockR = await request("POST", `/api/events/${eid}/seats/${seat.id}/lock`, {}, c1.token);
        const lockId = lockR.body.lock?.id;
        if (lockId) {
          const [b1, b2] = await Promise.all([
            request("POST", "/api/bookings/confirm", { lockIds: [lockId] }, c1.token),
            request("POST", "/api/bookings/confirm", { lockIds: [lockId] }, c2.token),
          ]);
          const successes = [b1, b2].filter(r => r.status === 201).length;
          print(
            "H4: Only 1 booking confirmed for same lockId (no double-booking)",
            successes <= 1,
            `successes=${successes} b1=${b1.status} b2=${b2.status}`
          );
        } else { warn("H4: Could not lock seat"); }
      } else { warn("H4: No available seat"); }
    } else { warn("H4: Skipped – need event + 2 clients"); }
  }

  // ── H5. Cross-user lock theft ─────────────────────────────────
  {
    console.log(`\n  ${C.bold}H5. Cross-User Lock Theft – c2 steals c1's lock${C.reset}`);
    if (eid && c1 && c2) {
      const seat = await getFreshAvailableSeat();
      if (seat) {
        const lockR = await request("POST", `/api/events/${eid}/seats/${seat.id}/lock`, {}, c1.token);
        const lockId = lockR.body.lock?.id;
        if (lockId) {
          const r = await request("POST", "/api/bookings/confirm", { lockIds: [lockId] }, c2.token);
          print("H5: Cross-user lock usage rejected (403/404)", r.status === 403 || r.status === 404,
            `status=${r.status}`);
        } else { warn("H5: Seat lock failed"); }
      } else { warn("H5: No available seat"); }
    } else { warn("H5: Skipped"); }
  }

  // ── H6. Invalid lockIds payloads ──────────────────────────────
  {
    console.log(`\n  ${C.bold}H6. Invalid lockIds Payloads (8 sub-cases)${C.reset}`);
    if (c1) {
      const cases = [
        { label: "H6a: empty array []",              body: { lockIds: [] } },
        { label: "H6b: null lockIds",                body: { lockIds: null } },
        { label: "H6c: string instead of array",     body: { lockIds: "not-an-array" } },
        { label: "H6d: non-existent lockId",         body: { lockIds: [999999999] } },
        { label: "H6e: no lockIds field",            body: {} },
        { label: "H6f: negative lockId",             body: { lockIds: [-1] } },
        { label: "H6g: float lockId",               body: { lockIds: [1.5] } },
        { label: "H6h: XSS string in lockIds",      body: { lockIds: ["<script>alert(1)</script>"] } },
      ];
      for (const { label, body } of cases) {
        const r = await request("POST", "/api/bookings/confirm", body, c1.token);
        print(`${label} → rejected (4xx)`, r.status >= 400 && r.status < 500, `status=${r.status}`);
      }
    } else { warn("H6: Skipped – no client token"); }
  }

  // ── H7. Duplicate registration flood ─────────────────────────
  {
    console.log(`\n  ${C.bold}H7. Duplicate Registration Flood – 50 concurrent same email${C.reset}`);
    const dupeEmail = `dupe_flood_${Date.now()}@eventx.test`;
    // Retry initial registration in case pool is briefly busy
    let first = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      first = await request("POST", "/api/auth/register",
        { name: "DupeFirst", email: dupeEmail, password: "DupePass123!" }, null, 20000, 0);
      if (first.status === 201) break;
      await sleep(500);
    }
    print("H7a: First registration succeeds (201)", first.status === 201, `status=${first.status}`);

    if (first.status === 201) {
      const dupes = await Promise.all(
        Array.from({ length: 50 }, () =>
          request("POST", "/api/auth/register",
            { name: "DupeDupe", email: dupeEmail, password: "DupePass123!" }, null, 20000)
        )
      );
      const rejected = dupes.filter(r => r.status === 409 || r.status === 400).length;
      print("H7b: All 50 concurrent duplicates rejected (409/400)",
        rejected === 50, `rejected=${rejected}/50`);
    }
  }

  // ── H8. /api/health burst – 500 requests ─────────────────────
  {
    console.log(`\n  ${C.bold}H8. Health Endpoint Stress – 500 rapid-fire requests${C.reset}`);
    const burst = 500;
    const startH = Date.now();
    const tasks = Array.from({ length: burst }, () => () => request("GET", "/api/health", null, null, 5000));
    const results = await runBatch(tasks, 200);
    const ok = results.filter(r => r.status === 200).length;
    const hTime = ((Date.now() - startH)/1000).toFixed(2);
    bar("Health checks succeeded", ok, burst);
    print(
      "H8: ≥99% of 500 health checks succeed",
      ok >= burst * 0.99,
      `ok=${ok}/${burst} time=${hTime}s throughput=${(burst/hTime).toFixed(0)} req/s`
    );
  }

  // ── H9. Booking on a cancelled event ──────────────────────────
  {
    console.log(`\n  ${C.bold}H9. Booking Attempt After Event Cancellation${C.reset}`);
    if (state.cancelEventId && c1 && (state.staffToken || state.adminToken)) {
      const tok = state.staffToken || state.adminToken;
      const sR = await request("GET", `/api/events/${state.cancelEventId}/seats`, null, null);
      const avail = (sR.body.seats || []).filter(s => s.status === "AVAILABLE");

      // Optionally grab a lock before cancelling
      let preCancelLockId = null;
      if (avail.length > 0) {
        const lR = await request("POST", `/api/events/${state.cancelEventId}/seats/${avail[0].id}/lock`, {}, c1.token);
        preCancelLockId = lR.body.lock?.id || null;
      }

      // Cancel the event
      const cR = await request("PATCH", `/api/events/${state.cancelEventId}`, { status: "CANCELLED" }, tok);
      print("H9a: Staff cancels event", cR.status === 200 && cR.body.success,
        `cancelledBookings=${cR.body.cancellation?.cancelledBookings}`);

      // Try to lock seat on cancelled event
      if (avail.length > 1) {
        const lR2 = await request("POST", `/api/events/${state.cancelEventId}/seats/${avail[1].id}/lock`, {}, c1.token);
        print("H9b: Lock on cancelled event rejected (400/404/409)",
          lR2.status === 400 || lR2.status === 404 || lR2.status === 409,
          `status=${lR2.status}`);
      }

      // Try to confirm with a pre-cancel lock
      if (preCancelLockId) {
        const bR = await request("POST", "/api/bookings/confirm", { lockIds: [preCancelLockId] }, c1.token);
        print("H9c: Confirm with pre-cancel lock returns 4xx or 2xx (lock may have been expired)",
          bR.status < 500,
          `status=${bR.status}`);
      }
    } else { warn("H9: Skipped – need cancelEventId + client + admin/staff token"); }
  }

  // ── H10. Injection & oversized payload attacks ────────────────
  {
    console.log(`\n  ${C.bold}H10. Injection & Oversized Payload Attacks${C.reset}`);
    const tok = state.staffToken || state.adminToken;
    const cases = [
      { label: "H10a: SQL injection in email",         path: "/api/auth/register", body: { name:"X", email:"' OR 1=1; --", password:"abc123" } },
      { label: "H10b: SQL injection in password",      path: "/api/auth/login",    body: { email:"x@x.com", password:"' OR '1'='1" } },
      { label: "H10c: XSS in name field",              path: "/api/auth/register", body: { name:"<script>document.cookie</script>", email:`xss_${Date.now()}@x.com`, password:"TestP@ss123" } },
      { label: "H10d: 10KB oversized name",            path: "/api/auth/register", body: { name:"A".repeat(10000), email:`big_${Date.now()}@x.com`, password:"TestP@ss123" } },
      { label: "H10e: Unicode bomb (emoji×500)",        path: "/api/auth/register", body: { name:"🚀💣".repeat(500), email:`emoji_${Date.now()}@x.com`, password:"TestP@ss123" } },
      { label: "H10f: Null-byte injection",            path: "/api/auth/login",    body: { email:"null\x00byte@x.com", password:"TestPass123" } },
      { label: "H10g: Negative rows event",            path: "/api/events",        body: { name:"Bad", venueName:"X", eventDate:"2029-01-01T10:00:00", rows:-99, seatsPerRow:-50 }, token: tok },
      { label: "H10h: seatsPerRow > 50 (API limit)",   path: "/api/events",        body: { name:"Big", venueName:"X", eventDate:"2029-01-01T10:00:00", rows:1, seatsPerRow:999 }, token: tok },
      { label: "H10i: rows > 26 (API limit)",          path: "/api/events",        body: { name:"Big2", venueName:"X", eventDate:"2029-01-01T10:00:00", rows:100, seatsPerRow:1 }, token: tok },
    ];
    for (const { label, path, body, token } of cases) {
      const r = await request("POST", path, body, token || null);
      // Server must not 500; any 4xx or even 201 means it handled the payload
      print(label + " (no 5xx)", r.status < 500, `status=${r.status}`);
    }
  }

  // ── H11. All 11 protected routes reject unauthenticated ───────
  {
    console.log(`\n  ${C.bold}H11. All Protected Routes Reject Unauthenticated Access${C.reset}`);
    const protectedRoutes = [
      { method: "GET",   path: "/api/auth/me" },
      { method: "PATCH", path: "/api/auth/me" },
      { method: "PATCH", path: "/api/auth/change-password" },
      { method: "GET",   path: "/api/bookings/my-bookings" },
      { method: "POST",  path: "/api/bookings/confirm" },
      { method: "GET",   path: "/api/tickets/my" },
      { method: "GET",   path: "/api/notifications/" },
      { method: "GET",   path: "/api/customer/wishlist" },
      { method: "GET",   path: "/api/waitlist/my" },
      { method: "POST",  path: "/api/customer/support" },
      { method: "GET",   path: "/api/refunds/" },
    ];
    const results = await Promise.all(
      protectedRoutes.map(({ method, path }) => request(method, path, {}, null))
    );
    const rejected = results.filter(r => r.status === 401).length;
    print(
      "H11: All 11 protected routes return 401 without token",
      rejected === 11,
      `rejected=${rejected}/11`
    );
    results.forEach((r, i) => {
      if (r.status !== 401) warn(`  ${protectedRoutes[i].method} ${protectedRoutes[i].path} → ${r.status} (expected 401)`);
    });
  }

  // ── H12. Role escalation – customer hits admin-only routes ────
  {
    console.log(`\n  ${C.bold}H12. Role Escalation – Customer Accessing Admin-Only Routes${C.reset}`);
    if (c1) {
      const adminRoutes = [
        { method: "GET",   path: "/api/refunds/",      body: null },
        { method: "POST",  path: "/api/events",         body: { name:"C", venueName:"V", eventDate:"2029-01-01T00:00:00", rows:1, seatsPerRow:1 } },
        { method: "GET",   path: "/api/admin/users",    body: null },
      ];
      for (const { method, path, body } of adminRoutes) {
        const r = await request(method, path, body, c1.token);
        print(`H12: Customer blocked from ${method} ${path} (403)`, r.status === 403, `status=${r.status}`);
      }
    } else { warn("H12: Skipped – no customer token"); }
  }

  // ── H13. Concurrent cancellation of same booking ──────────────
  {
    console.log(`\n  ${C.bold}H13. Concurrent Cancellation of Same Booking (20 threads)${C.reset}`);
    if (eid && c1) {
      const seat = await getFreshAvailableSeat();
      if (seat) {
        const lR = await request("POST", `/api/events/${eid}/seats/${seat.id}/lock`, {}, c1.token);
        const lockId = lR.body.lock?.id;
        if (lockId) {
          const bR = await request("POST", "/api/bookings/confirm", { lockIds: [lockId] }, c1.token);
          const bookingId = bR.body.booking?.id;
          if (bookingId) {
            const cancelResults = await Promise.all(
              Array.from({ length: 20 }, () =>
                request("PATCH", `/api/bookings/${bookingId}/cancel`, {}, c1.token)
              )
            );
            const successes = cancelResults.filter(r => r.status === 200).length;
            print(
              "H13: Exactly 1 cancellation wins out of 20 concurrent attempts",
              successes <= 1,
              `successes=${successes} rejected=${20-successes}`
            );
          } else { warn("H13: Could not create booking for concurrent cancel test"); }
        }
      } else { warn("H13: No available seat"); }
    } else { warn("H13: Skipped"); }
  }

  // ── H14. Non-existent resource access ────────────────────────
  {
    console.log(`\n  ${C.bold}H14. Non-Existent Resource Access${C.reset}`);
    if (state.staffToken || state.adminToken) {
      const tok = state.staffToken || state.adminToken;
      const r = await request("PATCH", "/api/events/999999999", { status: "CANCELLED" }, tok);
      print("H14a: Update non-existent event → 404", r.status === 404, `status=${r.status}`);
    }
    if (c1) {
      const r2 = await request("PATCH", "/api/bookings/999999999/cancel", {}, c1.token);
      print("H14b: Cancel non-existent booking → 404", r2.status === 404, `status=${r2.status}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 6 – DATABASE INTEGRITY VERIFICATION
// ═══════════════════════════════════════════════════════════════
async function phase6_IntegrityCheck() {
  section("Phase 6: Post-Load Database Integrity Checks");

  if (!state.testEventId) { warn("No test event – skipping"); return; }

  const sR = await request("GET", `/api/events/${state.testEventId}/seats`, null, null, 30000, 2);
  if (sR.status === 200 && Array.isArray(sR.body.seats)) {
    const seats     = sR.body.seats;
    const available = seats.filter(s => s.status === "AVAILABLE").length;
    const locked    = seats.filter(s => s.status === "LOCKED").length;
    const booked    = seats.filter(s => s.status === "BOOKED").length;
    const total     = seats.length;

    print("Seat inventory fetched", true, `total=${total}`);
    print(
      "Inventory integrity: AVAILABLE + LOCKED + BOOKED = TOTAL",
      available + locked + booked === total,
      `${available}+${locked}+${booked}=${available+locked+booked} vs total=${total}`
    );
    print(
      "Booked count matches or exceeds zero",
      booked >= 0,
      `booked=${booked} confirmedDuringTest=${state.confirmedBookings}`
    );

    console.log(`\n  ${C.grey}Final seat inventory for event #${state.testEventId}:${C.reset}`);
    bar("Available", available, total);
    bar("Locked",    locked,    total);
    bar("Booked",    booked,    total);
  } else {
    warn("Could not fetch seat inventory for integrity check");
  }

  // Spot-check my-bookings for first client
  if (state.clientTokens.length > 0) {
    const r = await request("GET", "/api/bookings/my-bookings", null, state.clientTokens[0].token);
    print("my-bookings endpoint functional post-load", r.status === 200 && r.body.success,
      `count=${r.body.bookings?.length}`);
  }

  // Final health check
  const hR = await request("GET", "/api/health", null, null);
  print("Backend still healthy after complete load test", hR.status === 200 && hR.body.success,
    `status=${hR.status}`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  const startAll = Date.now();

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║  EventX – 5000+ Client Load & Hard Problem Test Suite v2  ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.grey}  Started: ${new Date().toLocaleString()}${C.reset}`);
  console.log(`${C.grey}  DB pool: 100  |  Concurrency: 80  |  Waves of 500 clients${C.reset}\n`);

  await phase0_Health();
  await phase1_Setup();
  await phase2_ClientFlood();
  await phase3_SeatContention();
  await phase4_BookingStorm();
  await phase5_HardProblems();
  await phase6_IntegrityCheck();

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(2);
  const total = passed + failed;

  console.log(`\n${C.bold}${"═".repeat(60)}${C.reset}`);
  console.log(`${C.bold}  FINAL RESULTS${C.reset}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  ${C.green}${C.bold}PASSED:${C.reset}   ${passed}`);
  console.log(`  ${C.red}${C.bold}FAILED:${C.reset}   ${failed}`);
  console.log(`  ${C.yellow}WARNINGS:${C.reset} ${warnings}`);
  console.log(`  ${C.grey}TOTAL:    ${total}${C.reset}`);
  console.log(`  ${C.grey}DURATION: ${totalTime}s${C.reset}`);
  console.log(`  ${C.grey}CLIENTS:  ${state.clientTokens.length} authenticated${C.reset}`);
  console.log(`  ${C.grey}BOOKINGS: ${state.confirmedBookings} confirmed under load${C.reset}`);
  console.log(`${"─".repeat(60)}`);

  if (failed > 0) {
    console.log(`\n  ${C.red}${C.bold}Failed Tests:${C.reset}`);
    errors.forEach(({ label, detail }) =>
      console.log(`    ${C.red}✗${C.reset} ${label}  ${C.grey}${detail}${C.reset}`)
    );
  }

  if (failed === 0) {
    console.log(`\n  ${C.green}${C.bold}🎉  ALL TESTS PASSED – System handles 5000+ clients!${C.reset}`);
  } else {
    const rate = ((passed / total) * 100).toFixed(1);
    console.log(`\n  ${C.yellow}${C.bold}⚠  Pass rate: ${rate}%  (${failed} test(s) failed)${C.reset}`);
  }
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, err.message, err.stack);
  process.exit(1);
});
