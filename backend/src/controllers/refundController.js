const pool = require("../config/db");

const VALID_STATUSES = new Set([
    "PENDING_REVIEW", "APPROVED", "REJECTED", "PROCESSING", "REFUNDED", "FAILED"
]);

const getRefundRequests = async (req, res) => {
    try {
        const [refunds] = await pool.query(
            `SELECT r.id, r.booking_id, r.user_id, r.event_id, r.amount,
                    r.reason, r.status, r.provider_reference, r.admin_note,
                    r.created_at, r.updated_at, e.name AS event_name,
                    b.booking_reference
             FROM refund_requests r
             LEFT JOIN events e ON e.id = r.event_id
             LEFT JOIN bookings b ON b.id = r.booking_id
             ORDER BY
               CASE r.status WHEN 'PENDING_REVIEW' THEN 0 WHEN 'APPROVED' THEN 1
                 WHEN 'PROCESSING' THEN 2 ELSE 3 END,
               r.created_at DESC, r.id DESC`
        );
        return res.json({ success: true, count: refunds.length, refunds });
    } catch (error) {
        console.error("Get refund requests error:", error);
        return res.status(500).json({ success: false, message: "Unable to load refund requests." });
    }
};

const updateRefundStatus = async (req, res) => {
    const refundId = Number(req.params.refundId);
    const adminId = req.user && req.user.userId;
    const status = String(req.body.status || "").toUpperCase();
    const adminNote = req.body.adminNote == null ? null : String(req.body.adminNote).trim();
    const providerReference = req.body.providerReference == null
        ? null : String(req.body.providerReference).trim();

    if (!Number.isSafeInteger(refundId) || refundId < 1) {
        return res.status(400).json({ success: false, message: "Invalid refund request ID." });
    }
    if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ success: false, message: "Invalid refund status." });
    }
    if (["PROCESSING", "REFUNDED"].includes(status) && !providerReference) {
        return res.status(400).json({ success: false, message: "Provider reference is required for PROCESSING or REFUNDED status." });
    }
    if (status === "REJECTED" && !adminNote) {
        return res.status(400).json({ success: false, message: "An admin note is required when rejecting a refund." });
    }
    if (providerReference && providerReference.length > 200) {
        return res.status(400).json({ success: false, message: "Provider reference must be at most 200 characters." });
    }

    let connection;
    let transactionStarted = false;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [rows] = await connection.query(
            `SELECT id, booking_id, user_id, event_id, status, amount
             FROM refund_requests WHERE id = ? FOR UPDATE`,
            [refundId]
        );
        if (!rows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ success: false, message: "Refund request not found." });
        }

        const refund = rows[0];
        const oldStatus = String(refund.status).toUpperCase();
        const allowedNext = {
            PENDING_REVIEW: ["PENDING_REVIEW", "APPROVED", "REJECTED"],
            APPROVED: ["APPROVED", "PROCESSING", "FAILED"],
            PROCESSING: ["PROCESSING", "REFUNDED", "FAILED"],
            FAILED: ["FAILED", "PROCESSING"],
            REJECTED: ["REJECTED"],
            REFUNDED: ["REFUNDED"]
        };
        if (!(allowedNext[oldStatus] || []).includes(status)) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: `Transition from ${oldStatus} to ${status} is not allowed.`
            });
        }

        await connection.execute(
            `UPDATE refund_requests
             SET status = ?, admin_note = ?, provider_reference = ?
             WHERE id = ?`,
            [
                status,
                adminNote || null,
                providerReference || null,
                refundId
            ]
        );

        if (oldStatus !== status) {
            const title = `Refund update: ${status.replaceAll("_", " ")}`;
            const message = status === "REFUNDED"
                ? `Your refund request for booking #${refund.booking_id} has been marked REFUNDED. Reference: ${providerReference}.`
                : status === "REJECTED"
                    ? `Your refund request for booking #${refund.booking_id} was rejected. ${adminNote}`
                    : `Your refund request for booking #${refund.booking_id} is now ${status.replaceAll("_", " ")}.${adminNote ? ` Note: ${adminNote}` : ""}${providerReference ? ` Reference: ${providerReference}.` : ""} This status update does not itself transfer money.`;
            // The event_notifications table has a unique key for one notification
            // per user/event/booking/type. Update that existing REFUND_UPDATE row
            // when the refund status changes instead of causing ER_DUP_ENTRY.
            await connection.execute(
                `INSERT INTO event_notifications
                 (user_id, event_id, booking_id, type, title, message, is_read)
                 VALUES (?, ?, ?, 'REFUND_UPDATE', ?, ?, 0)
                 ON DUPLICATE KEY UPDATE
                    title = VALUES(title),
                    message = VALUES(message),
                    is_read = 0,
                    created_at = CURRENT_TIMESTAMP`,
                [refund.user_id, refund.event_id, refund.booking_id, title, message]
            );
        }

        const [updatedRows] = await connection.query(
            `SELECT id, booking_id, user_id, event_id, amount, reason, status,
                    provider_reference, admin_note, created_at, updated_at
             FROM refund_requests WHERE id = ?`,
            [refundId]
        );

        await connection.commit();
        transactionStarted = false;
        return res.json({
            success: true,
            message: `Refund request #${refundId} updated to ${status}. Status tracking only; no payment was transferred by this action.`,
            refund: updatedRows[0]
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try { await connection.rollback(); } catch (_) {}
        }
        console.error("Update refund status error:", error);
        return res.status(500).json({ success: false, message: "Unable to update refund request." });
    } finally {
        if (connection) connection.release();
    }
};

module.exports = { getRefundRequests, updateRefundStatus };
