const crypto = require("crypto");
const pool = require("../config/db");


// ======================================================
// GENERATE TICKET CODE
// ======================================================

function generateTicketCode() {
    return (
        "EVX-" +
        crypto
            .randomBytes(12)
            .toString("hex")
            .toUpperCase()
    );
}


// ======================================================
// GENERATE QR NONCE
// ======================================================

function generateQrNonce() {
    return crypto
        .randomBytes(16)
        .toString("hex");
}


// ======================================================
// CREATE TICKET INSIDE EXISTING TRANSACTION
// ======================================================
//
// IMPORTANT:
// This is NOT an Express controller.
//
// It is an internal helper used by confirmBooking().
//
// We pass the SAME database connection so ticket creation
// remains part of the booking transaction.
//
// ======================================================

const createTicketForBooking = async (
    connection,
    bookingSeatId,
    userId
) => {

    // --------------------------------------------------
    // 1. Get booking seat + ownership information
    // --------------------------------------------------

    const [bookingSeatRows] =
        await connection.query(
            `
            SELECT
                bs.id AS booking_seat_id,
                bs.booking_id,
                bs.seat_id,
                bs.price,

                b.user_id,
                b.event_id,
                b.status AS booking_status

            FROM booking_seats bs

            JOIN bookings b
                ON bs.booking_id = b.id

            WHERE bs.id = ?

            FOR UPDATE
            `,
            [bookingSeatId]
        );


    // --------------------------------------------------
    // Booking seat not found
    // --------------------------------------------------

    if (bookingSeatRows.length === 0) {

        throw new Error(
            "Booking seat not found"
        );

    }


    const bookingSeat =
        bookingSeatRows[0];


    // --------------------------------------------------
    // Verify booking ownership
    // --------------------------------------------------

    if (
        Number(bookingSeat.user_id) !==
        Number(userId)
    ) {

        throw new Error(
            "You do not own this booking"
        );

    }


    // --------------------------------------------------
    // Verify booking status
    // --------------------------------------------------

    if (
        bookingSeat.booking_status !==
        "CONFIRMED"
    ) {

        throw new Error(
            "Booking must be confirmed before ticket creation"
        );

    }


    // --------------------------------------------------
    // 2. Check if ticket already exists
    // --------------------------------------------------

    const [existingTicketRows] =
        await connection.query(
            `
            SELECT
                id,
                ticket_code,
                status
            FROM tickets
            WHERE booking_seat_id = ?
            FOR UPDATE
            `,
            [bookingSeatId]
        );


    if (existingTicketRows.length > 0) {

        throw new Error(
            "Ticket already exists for this booking seat"
        );

    }


    // --------------------------------------------------
    // 3. Generate ticket information
    // --------------------------------------------------

    const ticketCode =
        generateTicketCode();

    const qrNonce =
        generateQrNonce();


    // --------------------------------------------------
    // 4. Insert ticket
    // --------------------------------------------------

    const [ticketResult] =
        await connection.query(
            `
            INSERT INTO tickets
            (
                booking_seat_id,
                ticket_code,
                qr_nonce,
                status
            )
            VALUES (?, ?, ?, 'VALID')
            `,
            [
                bookingSeatId,
                ticketCode,
                qrNonce
            ]
        );


    // --------------------------------------------------
    // 5. Return ticket information
    // --------------------------------------------------

    return {

        ticketId:
            ticketResult.insertId,

        ticketCode,

        qrNonce,

        bookingSeatId,

        bookingId:
            bookingSeat.booking_id,

        eventId:
            bookingSeat.event_id,

        seatId:
            bookingSeat.seat_id

    };

};



// ======================================================
// CONFIRM BOOKING
// POST /api/bookings/confirm
// ======================================================

// ======================================================
// CONFIRM BOOKING - MULTI-SEAT SUPPORT
// POST /api/bookings/confirm
//
// Supports:
//   { "lockId": 123 }                   // Existing single-seat API
//   { "lockIds": [123, 124, 125] }      // Multi-seat API
// ======================================================

const confirmBooking = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        // ==================================================
        // 1. AUTHENTICATION
        // ==================================================

        if (!req.user || !req.user.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const userId = req.user.userId;

        // ==================================================
        // 2. READ LOCK IDS
        // ==================================================

        const { lockId, lockIds } = req.body || {};

        let requestedLockIds;

        if (Array.isArray(lockIds)) {
            requestedLockIds = lockIds;
        } else if (
            lockId !== undefined &&
            lockId !== null
        ) {
            // Backward compatibility with the old API.
            requestedLockIds = [lockId];
        } else {
            return res.status(400).json({
                success: false,
                message: "lockId or lockIds is required"
            });
        }

        if (
            requestedLockIds.length === 0 ||
            requestedLockIds.some(
                id =>
                    id === null ||
                    id === undefined ||
                    !["string", "number"].includes(typeof id) ||
                    String(id).trim() === ""
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Provide valid seat lock IDs"
            });
        }

        // Normalize IDs so numeric 1 and string "1"
        // are treated as the same lock ID.
        const normalizedIds = requestedLockIds.map(
            id => String(id).trim()
        );

        if (
            new Set(normalizedIds).size !==
            normalizedIds.length
        ) {
            return res.status(400).json({
                success: false,
                message: "Duplicate seat lock IDs are not allowed"
            });
        }

        // Avoid accidentally submitting an enormous request.
        // Adjust this limit if your application allows more seats.
        const MAX_SEATS_PER_BOOKING = 20;

        if (
            requestedLockIds.length >
            MAX_SEATS_PER_BOOKING
        ) {
            return res.status(400).json({
                success: false,
                message:
                    `A maximum of ${MAX_SEATS_PER_BOOKING} seats can be booked at once`
            });
        }

        // Consistent lock acquisition order helps reduce deadlocks.
        const orderedLockIds = [...requestedLockIds].sort(
            (a, b) =>
                String(a).localeCompare(String(b), undefined, {
                    numeric: true
                })
        );

        // ==================================================
        // 3. GET DATABASE CONNECTION AND START TRANSACTION
        // ==================================================

        connection = await pool.getConnection();

        await connection.beginTransaction();
        transactionStarted = true;

        // ==================================================
        // 4. LOCK AND VALIDATE EVERY SEAT LOCK
        // ==================================================

        const locks = [];

        for (const currentLockId of orderedLockIds) {
            const [lockRows] = await connection.query(
                `
                SELECT
                    id,
                    user_id,
                    seat_id,
                    status,
                    expires_at,
                    expires_at > NOW() AS is_valid
                FROM seat_locks
                WHERE id = ?
                FOR UPDATE
                `,
                [currentLockId]
            );

            if (lockRows.length === 0) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: `Seat lock ${currentLockId} was not found`
                });
            }

            const lock = lockRows[0];

            // ----------------------------------------------
            // Verify lock ownership
            // ----------------------------------------------

            if (
                Number(lock.user_id) !== Number(userId)
            ) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(403).json({
                    success: false,
                    message:
                        "You do not own one or more of these seat locks"
                });
            }

            // ----------------------------------------------
            // Verify active status
            // ----------------------------------------------

            if (lock.status !== "ACTIVE") {
                await connection.rollback();
                transactionStarted = false;

                return res.status(409).json({
                    success: false,
                    message:
                        `Seat lock ${currentLockId} is no longer active`
                });
            }

            locks.push(lock);
        }

        // ==================================================
        // 5. HANDLE EXPIRED LOCKS
        // ==================================================

        const expiredLocks = locks.filter(
            lock => Number(lock.is_valid) !== 1
        );

        if (expiredLocks.length > 0) {
            for (const lock of expiredLocks) {
                await connection.query(
                    `
                    UPDATE seat_locks
                    SET status = 'EXPIRED'
                    WHERE id = ?
                    AND status = 'ACTIVE'
                    `,
                    [lock.id]
                );

                // Release only a seat still held by this lock.
                // Do not release a seat already booked.
                await connection.query(
                    `
                    UPDATE seats
                    SET status = 'AVAILABLE'
                    WHERE id = ?
                    AND status = 'HELD'
                    `,
                    [lock.seat_id]
                );
            }

            await connection.commit();
            transactionStarted = false;

            return res.status(409).json({
                success: false,
                message:
                    "One or more seat locks have expired. Please select the seats again.",
                expiredLockIds: expiredLocks.map(
                    lock => lock.id
                )
            });
        }

        // ==================================================
        // 6. LOCK AND VALIDATE ALL SEATS
        // ==================================================

        const seats = [];

        for (const lock of locks) {
            const [seatRows] = await connection.query(
                `
                SELECT
                    id,
                    event_id,
                    seat_number,
                    section,
                    price,
                    status
                FROM seats
                WHERE id = ?
                FOR UPDATE
                `,
                [lock.seat_id]
            );

            if (seatRows.length === 0) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message:
                        `Seat associated with lock ${lock.id} was not found`
                });
            }

            const seat = seatRows[0];

            if (seat.status !== "HELD") {
                await connection.rollback();
                transactionStarted = false;

                return res.status(409).json({
                    success: false,
                    message:
                        `Seat ${seat.seat_number} is not held and cannot be booked`
                });
            }

            seats.push({
                ...seat,
                lockId: lock.id
            });
        }

        // ==================================================
        // 7. VALIDATE EVENT CONSISTENCY
        // ==================================================

        const eventIds = new Set(
            seats.map(seat => String(seat.event_id))
        );

        if (eventIds.size !== 1) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message:
                    "All seats in one booking must belong to the same event"
            });
        }

        // Prevent the same physical seat from being submitted twice.
        const seatIds = seats.map(
            seat => String(seat.id)
        );

        if (new Set(seatIds).size !== seatIds.length) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: "Duplicate seats are not allowed"
            });
        }

        // ==================================================
        // 8. CALCULATE TOTAL PRICE
        // ==================================================

        const totalAmount = seats.reduce(
            (total, seat) => {
                const price = Number(seat.price);

                if (
                    !Number.isFinite(price) ||
                    price < 0
                ) {
                    throw new Error(
                        `Invalid price for seat ${seat.seat_number}`
                    );
                }

                return total + price;
            },
            0
        );

        // ==================================================
        // 9. GENERATE BOOKING REFERENCE
        // ==================================================

        const bookingReference =
            "EVT-" +
            Date.now() +
            "-" +
            crypto
                .randomBytes(4)
                .toString("hex")
                .toUpperCase();

        // ==================================================
        // 10. CREATE ONE BOOKING FOR ALL SELECTED SEATS
        // ==================================================

        const eventId = seats[0].event_id;

        const [bookingResult] = await connection.query(
            `
            INSERT INTO bookings
            (
                user_id,
                event_id,
                booking_reference,
                total_amount,
                status
            )
            VALUES (?, ?, ?, ?, 'CONFIRMED')
            `,
            [
                userId,
                eventId,
                bookingReference,
                totalAmount
            ]
        );

        const bookingId = bookingResult.insertId;

        // ==================================================
        // 11. CREATE BOOKING-SEAT ROWS AND TICKETS
        // ==================================================

        const tickets = [];
        const bookedSeats = [];

        for (const seat of seats) {
            // ----------------------------------------------
            // Create a booking_seats row
            // ----------------------------------------------

            const [bookingSeatResult] =
                await connection.query(
                    `
                    INSERT INTO booking_seats
                    (
                        booking_id,
                        seat_id,
                        price
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                        bookingId,
                        seat.id,
                        seat.price
                    ]
                );

            const bookingSeatId =
                bookingSeatResult.insertId;

            // ----------------------------------------------
            // Use the EXISTING ticket helper.
            // Do not bypass its validation or QR nonce logic.
            // ----------------------------------------------

            const ticket = await createTicketForBooking(
                connection,
                bookingSeatId,
                userId
            );

            tickets.push({
                ticketId: ticket.ticketId,
                ticketCode: ticket.ticketCode,
                status: "VALID",
                bookingSeatId,
                seatId: seat.id,
                seatNumber: seat.seat_number
            });

            // ----------------------------------------------
            // Update seat status to BOOKED
            // ----------------------------------------------

            const [seatUpdateResult] =
                await connection.query(
                    `
                    UPDATE seats
                    SET status = 'BOOKED'
                    WHERE id = ?
                    AND status = 'HELD'
                    `,
                    [seat.id]
                );

            if (
                seatUpdateResult.affectedRows !== 1
            ) {
                throw new Error(
                    `Failed to mark seat ${seat.seat_number} as BOOKED`
                );
            }

            // ----------------------------------------------
            // Consume the corresponding seat lock
            // ----------------------------------------------

            const [lockUpdateResult] =
                await connection.query(
                    `
                    UPDATE seat_locks
                    SET status = 'CONSUMED'
                    WHERE id = ?
                    AND user_id = ?
                    AND status = 'ACTIVE'
                    AND expires_at > NOW()
                    `,
                    [
                        seat.lockId,
                        userId
                    ]
                );

            if (
                lockUpdateResult.affectedRows !== 1
            ) {
                throw new Error(
                    `Failed to consume seat lock ${seat.lockId}`
                );
            }

            bookedSeats.push({
                seatId: seat.id,
                seatNumber: seat.seat_number,
                section: seat.section,
                price: Number(seat.price)
            });
        }

        // ==================================================
        // 12. COMMIT THE COMPLETE BOOKING
        // ==================================================

        await connection.commit();
        transactionStarted = false;

        // ==================================================
        // 13. RETURN SUCCESS RESPONSE
        // ==================================================

        // Preserve the existing single-seat response fields.
        // Add seats[] and tickets[] for multi-seat clients.

        const firstSeat = bookedSeats[0];
        const firstTicket = tickets[0];

        return res.status(201).json({
            success: true,

            message: "Booking confirmed successfully",

            booking: {
                id: bookingId,
                bookingReference,
                userId,
                eventId,

                // Existing single-seat compatibility fields.
                seatId: firstSeat.seatId,
                seatNumber: firstSeat.seatNumber,
                section: firstSeat.section,

                // Multi-seat fields.
                seatCount: bookedSeats.length,
                seats: bookedSeats,

                totalAmount,
                status: "CONFIRMED"
            },

            // Preserve the old ticket field for existing clients.
            ticket: {
                ticketId: firstTicket.ticketId,
                ticketCode: firstTicket.ticketCode,
                status: firstTicket.status
            },

            // One ticket for each booked seat.
            tickets
        });

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
                transactionStarted = false;
            } catch (rollbackError) {
                console.error(
                    "Booking rollback error:",
                    rollbackError
                );
            }
        }

        console.error(
            "Booking confirmation error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Booking confirmation failed",
            error: error.message
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// ======================================================
// CANCEL BOOKING
// PATCH /api/bookings/:bookingId/cancel
// ======================================================

const cancelBooking = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        // ============================================
        // 1. AUTHENTICATION + BOOKING ID
        // ============================================

        if (!req.user || !req.user.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const userId = req.user.userId;
        const { bookingId } = req.params;

        if (
            !bookingId ||
            !Number.isInteger(Number(bookingId)) ||
            Number(bookingId) <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "bookingId must be a valid integer"
            });
        }

        // ============================================
        // 2. DATABASE CONNECTION + TRANSACTION
        // ============================================

        connection = await pool.getConnection();

        await connection.beginTransaction();
        transactionStarted = true;

        // ============================================
        // 3. LOCK BOOKING + VERIFY OWNERSHIP
        // ============================================

        const [bookingRows] = await connection.query(
            `
            SELECT
                id,
                user_id,
                event_id,
                booking_reference,
                total_amount,
                status
            FROM bookings
            WHERE id = ?
              AND user_id = ?
            FOR UPDATE
            `,
            [bookingId, userId]
        );

        if (bookingRows.length === 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookingRows[0];

        // ============================================
        // 4. VALIDATE BOOKING STATUS
        // ============================================

        if (booking.status !== "CONFIRMED") {
            await connection.rollback();
            transactionStarted = false;

            return res.status(409).json({
                success: false,
                message:
                    `Booking cannot be cancelled because its status is ${booking.status}`
            });
        }

        // ============================================
        // 5. FETCH ALL SEATS IN THE BOOKING
        // ============================================

        const [bookingSeatRows] = await connection.query(
            `
            SELECT
                bs.id AS booking_seat_id,
                bs.seat_id,
                bs.price,
                s.seat_number,
                s.section,
                s.status AS seat_status
            FROM booking_seats bs
            JOIN seats s
                ON s.id = bs.seat_id
            WHERE bs.booking_id = ?
            ORDER BY s.id ASC
            FOR UPDATE
            `,
            [bookingId]
        );

        if (bookingSeatRows.length === 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: "No seats found for this booking"
            });
        }

        // Validate every seat before changing anything.
        const invalidSeat = bookingSeatRows.find(
            seat => seat.seat_status !== "BOOKED"
        );

        if (invalidSeat) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(409).json({
                success: false,
                message:
                    `Seat ${invalidSeat.seat_number} is not in BOOKED status. Cancellation was not applied.`
            });
        }

        // ============================================
        // 6. CANCEL ALL VALID TICKETS
        // ============================================

        for (const bookingSeat of bookingSeatRows) {
            await connection.query(
                `
                UPDATE tickets
                SET status = 'CANCELLED'
                WHERE booking_seat_id = ?
                  AND status = 'VALID'
                `,
                [bookingSeat.booking_seat_id]
            );
        }

        // ============================================
        // 7. RELEASE ALL SEATS
        // ============================================

        const releasedSeats = [];

        for (const bookingSeat of bookingSeatRows) {
            const [seatUpdateResult] =
                await connection.query(
                    `
                    UPDATE seats
                    SET status = 'AVAILABLE'
                    WHERE id = ?
                      AND status = 'BOOKED'
                    `,
                    [bookingSeat.seat_id]
                );

            if (seatUpdateResult.affectedRows !== 1) {
                throw new Error(
                    `Failed to release seat ${bookingSeat.seat_number}`
                );
            }

            releasedSeats.push({
                seatId: bookingSeat.seat_id,
                seatNumber: bookingSeat.seat_number,
                section: bookingSeat.section,
                status: "AVAILABLE"
            });
        }

        // ============================================
        // 8. CANCEL THE BOOKING
        // ============================================

        const [bookingUpdateResult] =
            await connection.query(
                `
                UPDATE bookings
                SET status = 'CANCELLED'
                WHERE id = ?
                  AND user_id = ?
                  AND status = 'CONFIRMED'
                `,
                [bookingId, userId]
            );

        if (bookingUpdateResult.affectedRows !== 1) {
            throw new Error(
                "Booking status could not be updated to CANCELLED"
            );
        }

        // ============================================
        // 9. FIND WAITLIST ENTRIES
        // ============================================
        // Preserve the original behaviour of notifying
        // the earliest waiting users. For a multi-seat
        // cancellation, consider up to one entry per seat.
        // ============================================

        const [waitlistRows] = await connection.query(
            `
            SELECT
                id,
                event_id,
                user_id,
                status,
                position
            FROM waitlist
            WHERE event_id = ?
              AND status = 'WAITING'
            ORDER BY position ASC, id ASC
            LIMIT ?
            FOR UPDATE
            `,
            [booking.event_id, releasedSeats.length]
        );

        const promotedWaitlist = [];

        // ============================================
        // 10. MARK WAITLIST ENTRIES AS NOTIFIED
        // ============================================

        for (const waitlistEntry of waitlistRows) {
            const [waitlistUpdateResult] =
                await connection.query(
                    `
                    UPDATE waitlist
                    SET
                        status = 'NOTIFIED',
                        notified_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                      AND status = 'WAITING'
                    `,
                    [waitlistEntry.id]
                );

            if (waitlistUpdateResult.affectedRows === 1) {
                promotedWaitlist.push({
                    id: waitlistEntry.id,
                    userId: waitlistEntry.user_id,
                    eventId: waitlistEntry.event_id,
                    position: waitlistEntry.position,
                    status: "NOTIFIED"
                });
            }
        }

        // ============================================
        // 11. COMMIT TRANSACTION
        // ============================================

        await connection.commit();
        transactionStarted = false;

        // ============================================
        // 12. RESPONSE
        // ============================================
        // Keep original response properties for
        // backward compatibility and add array fields.
        // ============================================

        return res.status(200).json({
            success: true,
            message: "Booking cancelled successfully",

            booking: {
                id: booking.id,
                bookingReference: booking.booking_reference,
                status: "CANCELLED"
            },

            // Original single-seat response fields.
            releasedSeat: releasedSeats[0],
            waitlistPromotion: promotedWaitlist[0] || null,

            // Multi-seat response fields.
            releasedSeats,
            waitlistPromotions: promotedWaitlist
        });

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
                transactionStarted = false;
            } catch (rollbackError) {
                console.error(
                    "Booking cancellation rollback error:",
                    rollbackError
                );
            }
        }

        console.error("Booking cancellation error:", error);

        return res.status(500).json({
            success: false,
            message: "Booking cancellation failed",
            error: error.message
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// ======================================================
// GET MY BOOKINGS
// Fetch all bookings belonging to the logged-in user
// ======================================================

const getMyBookings = async (req, res) => {
    try {
        // 1. Verify authentication
        if (!req.user || !req.user.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const userId = req.user.userId;

        // 2. Fetch all bookings belonging to this user
        const [bookingRows] = await pool.query(
            `
            SELECT
                b.id AS booking_id,
                b.user_id,
                b.event_id,
                b.booking_reference,
                b.total_amount,
                b.status,
                e.name AS event_name,
                e.event_date,
                e.venue_name,
                e.status AS event_status,
                rr.status AS refund_status
            FROM bookings b
            JOIN events e ON e.id = b.event_id
            LEFT JOIN refund_requests rr ON rr.booking_id = b.id
            WHERE b.user_id = ?
            ORDER BY b.id DESC
            `,
            [userId]
        );

        // 3. If user has no bookings
        if (bookingRows.length === 0) {
            return res.status(200).json({
                success: true,
                count: 0,
                bookings: []
            });
        }

        // 4. Collect booking IDs
        const bookingIds = bookingRows.map(
            (booking) => booking.booking_id
        );

        const placeholders = bookingIds
            .map(() => "?")
            .join(",");

        // 5. Fetch seats belonging to these bookings
        const [seatRows] = await pool.query(
            `
            SELECT
                bs.id AS booking_seat_id,
                bs.booking_id,
                bs.seat_id,
                bs.price AS booked_price,
                s.seat_number,
                s.section,
                s.status AS seat_status
            FROM booking_seats bs
            JOIN seats s
                ON s.id = bs.seat_id
            WHERE bs.booking_id IN (${placeholders})
            ORDER BY bs.booking_id DESC, s.id ASC
            `,
            bookingIds
        );

        // 6. Fetch tickets belonging to these bookings
        const [ticketRows] = await pool.query(
            `
            SELECT
                t.id AS ticket_id,
                t.booking_seat_id,
                t.ticket_code,
                t.status AS ticket_status,
                bs.booking_id,
                s.seat_number
            FROM tickets t
            JOIN booking_seats bs
                ON bs.id = t.booking_seat_id
            JOIN seats s
                ON s.id = bs.seat_id
            WHERE bs.booking_id IN (${placeholders})
            ORDER BY bs.booking_id DESC, t.id ASC
            `,
            bookingIds
        );

        // 7. Group seats by booking ID
        const seatsByBooking = {};

        for (const row of seatRows) {
            const bookingId = row.booking_id;

            if (!seatsByBooking[bookingId]) {
                seatsByBooking[bookingId] = [];
            }

            seatsByBooking[bookingId].push({
                bookingSeatId: row.booking_seat_id,
                seatId: row.seat_id,
                seatNumber: row.seat_number,
                section: row.section,
                price: Number(row.booked_price),
                seatStatus: row.seat_status
            });
        }

        // 8. Group tickets by booking ID
        const ticketsByBooking = {};

        for (const row of ticketRows) {
            const bookingId = row.booking_id;

            if (!ticketsByBooking[bookingId]) {
                ticketsByBooking[bookingId] = [];
            }

            ticketsByBooking[bookingId].push({
                ticketId: row.ticket_id,
                bookingSeatId: row.booking_seat_id,
                seatNumber: row.seat_number,
                ticketCode: row.ticket_code,
                status: row.ticket_status
            });
        }

        // 9. Build final booking response
        const bookings = bookingRows.map((booking) => {
            const seats =
                seatsByBooking[booking.booking_id] || [];

            const tickets =
                ticketsByBooking[booking.booking_id] || [];

            return {
                id: booking.booking_id,
                userId: booking.user_id,
                eventId: booking.event_id,

                bookingReference:
                    booking.booking_reference,

                totalAmount:
                    Number(booking.total_amount),

                status: booking.status,
                eventName: booking.event_name,
                eventDate: booking.event_date,
                venueName: booking.venue_name,
                eventStatus: booking.event_status,
                refundStatus: booking.refund_status || (String(booking.event_status).toUpperCase() === "CANCELLED" ? "PENDING_REVIEW" : null),

                seatCount: seats.length,

                seats,
                tickets
            };
        });

        // 10. Send response
        return res.status(200).json({
            success: true,
            count: bookings.length,
            bookings
        });

    } catch (error) {
        console.error(
            "Get my bookings error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to fetch booking history"
        });
    }
};


// ======================================================
// EXPORT
// ======================================================

module.exports = {
    confirmBooking,
    cancelBooking,
    getMyBookings
};