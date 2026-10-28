const crypto = require("crypto");
const pool = require("../config/db");

const LOCK_DURATION_MINUTES = 5;

const lockSeat = async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { eventId, seatId } = req.params;
        const userId = req.user.userId;

        // Basic validation
        if (!Number.isInteger(Number(eventId)) ||
            !Number.isInteger(Number(seatId))) {
            return res.status(400).json({
                success: false,
                message: "Invalid event or seat ID"
            });
        }

        await connection.beginTransaction();

        /*
         * IMPORTANT:
         * Lock the actual seat row.
         * This prevents two simultaneous requests
         * from claiming the same seat.
         */
        const [seats] = await connection.execute(
            `SELECT
                id,
                event_id,
                seat_number,
                section,
                price,
                status
             FROM seats
             WHERE id = ?
               AND event_id = ?
             FOR UPDATE`,
            [seatId, eventId]
        );

        if (seats.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Seat not found for this event"
            });
        }

        const seat = seats[0];

        // If already booked, it can never be locked again
        if (seat.status === "BOOKED") {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Seat is already booked"
            });
        }

        /*
         * If the seat is currently HELD, check whether
         * the existing lock has expired.
         */
        if (seat.status === "HELD") {

            const [activeLocks] = await connection.execute(
                `SELECT id, user_id, expires_at
                 FROM seat_locks
                 WHERE seat_id = ?
                   AND status = 'ACTIVE'
                 ORDER BY created_at DESC
                 LIMIT 1
                 FOR UPDATE`,
                [seatId]
            );

            if (activeLocks.length > 0) {
                const existingLock = activeLocks[0];

                const expiresAt = new Date(existingLock.expires_at);
                const now = new Date();

                // Existing lock is still valid
                if (expiresAt > now) {
                    await connection.rollback();

                    return res.status(409).json({
                        success: false,
                        message: "Seat is temporarily locked"
                    });
                }

                // Existing lock has expired
                await connection.execute(
                    `UPDATE seat_locks
                     SET status = 'EXPIRED'
                     WHERE id = ?
                       AND status = 'ACTIVE'`,
                    [existingLock.id]
                );

                await connection.execute(
                    `UPDATE seats
                     SET status = 'AVAILABLE'
                     WHERE id = ?
                       AND status = 'HELD'`,
                    [seatId]
                );
            }
        }

        // Re-check after possible expiry handling
        const [currentSeat] = await connection.execute(
            `SELECT status
             FROM seats
             WHERE id = ?
             FOR UPDATE`,
            [seatId]
        );

        if (currentSeat[0].status !== "AVAILABLE") {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Seat is not available"
            });
        }

        // Generate unique lock ID
        const lockId = crypto.randomUUID();

        // Create expiry time
        const expiresAt = new Date(
            Date.now() + 5 * 60 * 1000
        );
        // Create lock
        await connection.execute(
            `INSERT INTO seat_locks
            (id, seat_id, user_id, expires_at, status)
            VALUES (?, ?, ?, ?, 'ACTIVE')`,
            [lockId, seatId, userId, expiresAt]
        );

        // Mark seat as held
        await connection.execute(
            `UPDATE seats
             SET status = 'HELD'
             WHERE id = ?
               AND status = 'AVAILABLE'`,
            [seatId]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: "Seat locked successfully",
            lock: {
                id: lockId,
                seatId: Number(seatId),
                eventId: Number(eventId),
                expiresAt
            }
        });

    } catch (error) {

        await connection.rollback();

        console.error("Seat lock error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to lock seat"
        });

    } finally {
        connection.release();
    }
};

module.exports = {
    lockSeat
};