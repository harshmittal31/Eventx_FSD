const pool = require("../config/db");

const expireSeatLocks = async () => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        /*
         * Find all ACTIVE locks whose expiry time has passed.
         * FOR UPDATE prevents another transaction from changing
         * these lock rows while we process them.
         */
        const [expiredLocks] = await connection.query(
            `
            SELECT
                id,
                seat_id
            FROM seat_locks
            WHERE status = 'ACTIVE'
              AND expires_at <= NOW()
            FOR UPDATE
            `
        );

        for (const lock of expiredLocks) {

            /*
             * Expire the lock.
             */
            await connection.query(
                `
                UPDATE seat_locks
                SET status = 'EXPIRED'
                WHERE id = ?
                  AND status = 'ACTIVE'
                `,
                [lock.id]
            );

            /*
             * Make the seat AVAILABLE only if there is
             * no other ACTIVE lock for that same seat.
             */
            await connection.query(
                `
                UPDATE seats
                SET status = 'AVAILABLE'
                WHERE id = ?
                  AND status = 'HELD'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM seat_locks
                      WHERE seat_id = ?
                        AND status = 'ACTIVE'
                        AND expires_at > NOW()
                  )
                `,
                [lock.seat_id, lock.seat_id]
            );
        }

        await connection.commit();

        if (expiredLocks.length > 0) {
            console.log(
                `[Seat Expiry] Expired ${expiredLocks.length} seat lock(s)`
            );
        }

    } catch (error) {

        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error(
                "[Seat Expiry] Rollback error:",
                rollbackError
            );
        }

        console.error(
            "[Seat Expiry] Error:",
            error
        );

    } finally {
        connection.release();
    }
};

module.exports = expireSeatLocks;