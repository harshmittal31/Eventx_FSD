const crypto = require("crypto");
const pool = require("../config/db");


// ======================================================
// 1. JOIN WAITLIST
// POST /api/waitlist/:eventId
// ======================================================

const joinWaitlist = async (req, res) => {

    const connection = await pool.getConnection();

    try {

        const userId = req.user.userId;
        const eventId = parseInt(req.params.eventId);

        // --------------------------------------------------
        // Validate eventId
        // --------------------------------------------------

        if (!eventId || isNaN(eventId)) {

            return res.status(400).json({
                success: false,
                message: "Valid eventId is required"
            });
        }


        // --------------------------------------------------
        // Start transaction
        // --------------------------------------------------

        await connection.beginTransaction();


        // --------------------------------------------------
        // Check event exists
        // --------------------------------------------------

        const [eventRows] = await connection.query(
            `
            SELECT
                id,
                name,
                status,
                event_date
            FROM events
            WHERE id = ?
            FOR UPDATE
            `,
            [eventId]
        );


        if (eventRows.length === 0) {

            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }


        const event = eventRows[0];

        // Waitlist is only for future, published events.
        if (event.status !== "PUBLISHED") {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "Waitlist is available only for published events."
            });
        }

        if (event.event_date && new Date(event.event_date).getTime() <= Date.now()) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "Waitlist is not available for past events."
            });
        }

        // A customer may join the waitlist only when every seat is unavailable.
        // HELD seats are treated as unavailable too.
        const [availabilityRows] = await connection.query(
            `
            SELECT
                COUNT(*) AS total_seats,
                SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available_seats
            FROM seats
            WHERE event_id = ?
            `,
            [eventId]
        );

        const totalSeats = Number(availabilityRows[0]?.total_seats || 0);
        const availableSeats = Number(availabilityRows[0]?.available_seats || 0);

        if (totalSeats === 0) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "This event has no configured seats, so waitlist is unavailable."
            });
        }

        if (availableSeats > 0) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: "Waitlist is available only when the event is sold out.",
                totalSeats,
                availableSeats
            });
        }

        // --------------------------------------------------
        // Check if user is already WAITING
        // --------------------------------------------------

        const [existingRows] = await connection.query(
            `
            SELECT
                id,
                status,
                position
            FROM waitlist
            WHERE event_id = ?
            AND user_id = ?
            AND status IN ('WAITING', 'NOTIFIED')
            FOR UPDATE
            `,
            [eventId, userId]
        );


        if (existingRows.length > 0) {

            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "You are already on the waitlist",
                waitlist: existingRows[0]
            });
        }


        // --------------------------------------------------
        // Get next waitlist position
        // --------------------------------------------------

        const [positionRows] = await connection.query(
            `
            SELECT
                COALESCE(MAX(position), 0) + 1 AS next_position
            FROM waitlist
            WHERE event_id = ?
            AND status = 'WAITING'
            `,
            [eventId]
        );


        const position = positionRows[0].next_position;


        // --------------------------------------------------
        // Insert waitlist entry
        // --------------------------------------------------

        const [result] = await connection.query(
            `
            INSERT INTO waitlist
            (
                event_id,
                user_id,
                status,
                position,
                notified_at
            )
            VALUES (?, ?, 'WAITING', ?, NULL)
            `,
            [
                eventId,
                userId,
                position
            ]
        );


        await connection.commit();


        // --------------------------------------------------
        // Success
        // --------------------------------------------------

        return res.status(201).json({

            success: true,

            message: "Successfully joined the waitlist",

            waitlist: {

                id: result.insertId,

                event_id: eventId,

                user_id: userId,

                status: "WAITING",

                position: position
            }
        });


    } catch (error) {

        await connection.rollback();

        console.error(
            "Join waitlist error:",
            error
        );

        return res.status(500).json({

            success: false,

            message: "Failed to join waitlist",

            error: error.message
        });

    } finally {

        connection.release();
    }
};



// ======================================================
// 2. GET MY WAITLIST
// GET /api/waitlist/my
// ======================================================

const getMyWaitlist = async (req, res) => {

    const connection = await pool.getConnection();

    try {

        const userId = req.user.userId;


        const [rows] = await connection.query(
            `
            SELECT
                w.id,
                w.event_id,
                w.user_id,
                w.status,
                w.position,
                w.created_at,
                w.notified_at,

                e.name AS event_name,
                e.status AS event_status,
                e.venue_name,
                e.event_date

            FROM waitlist w

            JOIN events e
                ON w.event_id = e.id

            WHERE w.user_id = ?

            ORDER BY
                w.created_at DESC
            `,
            [userId]
        );


        return res.status(200).json({

            success: true,

            count: rows.length,

            waitlist: rows
        });


    } catch (error) {

        console.error(
            "Get my waitlist error:",
            error
        );

        return res.status(500).json({

            success: false,

            message: "Failed to fetch waitlist",

            error: error.message
        });

    } finally {

        connection.release();
    }
};



// ======================================================
// 3. PROMOTE WAITLIST
// POST /api/waitlist/:eventId/promote
// ======================================================
//
// Flow:
//
// WAITING user
//      ↓
// Find first user by position
//      ↓
// Find AVAILABLE seat
//      ↓
// Lock seat row
//      ↓
// Create seat lock
//      ↓
// Seat becomes HELD
//      ↓
// Waitlist becomes NOTIFIED
//
// ======================================================

const promoteWaitlist = async (req, res) => {

    const connection = await pool.getConnection();

    try {

        const eventId = parseInt(req.params.eventId);


        // --------------------------------------------------
        // Validate eventId
        // --------------------------------------------------

        if (!eventId || isNaN(eventId)) {

            return res.status(400).json({

                success: false,

                message: "Valid eventId is required"
            });
        }


        // --------------------------------------------------
        // Start transaction
        // --------------------------------------------------

        await connection.beginTransaction();


        // --------------------------------------------------
        // 1. Find FIRST WAITING user
        // --------------------------------------------------

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

            ORDER BY position ASC

            LIMIT 1

            FOR UPDATE
            `,
            [eventId]
        );


        // --------------------------------------------------
        // No waiting users
        // --------------------------------------------------

        if (waitlistRows.length === 0) {

            await connection.rollback();

            return res.status(404).json({

                success: false,

                message: "No users are waiting for this event"
            });
        }


        const waitlistEntry = waitlistRows[0];


        // --------------------------------------------------
        // 2. Find an AVAILABLE seat
        //
        // IMPORTANT:
        // event_id comes from seats table.
        // NOT from seat_locks.
        // --------------------------------------------------

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

            WHERE event_id = ?
            AND status = 'AVAILABLE'

            ORDER BY id ASC

            LIMIT 1

            FOR UPDATE
            `,
            [eventId]
        );


        // --------------------------------------------------
        // No available seat
        // --------------------------------------------------

        if (seatRows.length === 0) {

            await connection.rollback();

            return res.status(409).json({

                success: false,

                message: "No available seat is currently available for promotion"
            });
        }


        const seat = seatRows[0];


        // --------------------------------------------------
        // 3. Double-check seat status
        // --------------------------------------------------

        if (seat.status !== "AVAILABLE") {

            await connection.rollback();

            return res.status(409).json({

                success: false,

                message: "Seat is no longer available"
            });
        }


        // --------------------------------------------------
        // 4. Generate seat lock ID
        // --------------------------------------------------

        const lockId = crypto.randomUUID();


        // --------------------------------------------------
        // 5. Lock expiry = 5 minutes
        // --------------------------------------------------

        const expiresAt = new Date(
            Date.now() + 5 * 60 * 1000
        );


        // --------------------------------------------------
        // 6. Create seat lock
        //
        // seat_locks does NOT contain event_id.
        // --------------------------------------------------

        await connection.query(
            `
            INSERT INTO seat_locks
            (
                id,
                seat_id,
                user_id,
                expires_at,
                status
            )
            VALUES (?, ?, ?, ?, 'ACTIVE')
            `,
            [
                lockId,
                seat.id,
                waitlistEntry.user_id,
                expiresAt
            ]
        );


        // --------------------------------------------------
        // 7. Change seat AVAILABLE → HELD
        // --------------------------------------------------

        await connection.query(
            `
            UPDATE seats

            SET status = 'HELD'

            WHERE id = ?

            AND status = 'AVAILABLE'
            `,
            [seat.id]
        );


        // --------------------------------------------------
        // 8. Change waitlist WAITING → NOTIFIED
        // --------------------------------------------------

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


        // --------------------------------------------------
        // 9. Commit
        // --------------------------------------------------

        await connection.commit();


        // --------------------------------------------------
        // 10. Success response
        // --------------------------------------------------

        return res.status(200).json({

            success: true,

            message: "Waitlist user promoted successfully",

            promotion: {

                waitlistId: waitlistEntry.id,

                userId: waitlistEntry.user_id,

                eventId: eventId,

                position: waitlistEntry.position,

                seat: {

                    id: seat.id,

                    seatNumber: seat.seat_number,

                    section: seat.section,

                    price: seat.price
                },

                lock: {

                    id: lockId,

                    status: "ACTIVE",

                    expiresAt: expiresAt
                }
            }
        });


    } catch (error) {

        await connection.rollback();

        console.error(
            "Waitlist promotion error:",
            error
        );

        return res.status(500).json({

            success: false,

            message: "Waitlist promotion failed",

            error: error.message
        });

    } finally {

        connection.release();
    }
};



// ======================================================
// EXPORTS
// ======================================================


const leaveWaitlist = async (req, res) => {
    const eventId = Number(req.params.eventId);
    const userId = Number(req.user?.userId ?? req.user?.id);
    if (!Number.isSafeInteger(eventId) || eventId < 1) {
        return res.status(400).json({ success: false, message: "Valid event ID is required." });
    }
    try {
        const [result] = await pool.execute(
            "DELETE FROM waitlist WHERE event_id = ? AND user_id = ? AND status IN ('WAITING','NOTIFIED')",
            [eventId, userId]
        );
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "No active waitlist entry was found." });
        return res.json({ success: true, message: "You have left the waitlist." });
    } catch (error) {
        console.error("Leave waitlist error:", error);
        return res.status(500).json({ success: false, message: "Unable to leave waitlist." });
    }
};

module.exports = {

    joinWaitlist,

    getMyWaitlist,

    leaveWaitlist,

    promoteWaitlist

};