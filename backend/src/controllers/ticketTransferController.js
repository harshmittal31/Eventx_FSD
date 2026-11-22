const crypto = require("crypto");
const pool = require("../config/db");

const isPositiveId = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0;

const rollback = async (connection, started) => {
    if (started) {
        await connection.rollback();
    }
};

const initiateTransfer = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        const senderId = Number(req.user.userId);
        const { ticketId, recipientEmail } = req.body || {};
        const email = typeof recipientEmail === "string"
            ? recipientEmail.trim().toLowerCase()
            : "";

        if (!isPositiveId(ticketId)) {
            return res.status(400).json({
                success: false,
                message: "ticketId must be a positive integer"
            });
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "A valid recipientEmail is required"
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [tickets] = await connection.query(
            `SELECT t.id, t.status AS ticket_status, b.user_id,
                    b.status AS booking_status
             FROM tickets t
             JOIN booking_seats bs ON bs.id = t.booking_seat_id
             JOIN bookings b ON b.id = bs.booking_id
             WHERE t.id = ?
             FOR UPDATE`,
            [ticketId]
        );

        if (tickets.length === 0 || Number(tickets[0].user_id) !== senderId) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(404).json({
                success: false,
                message: "Ticket not found or does not belong to you"
            });
        }

        const ticket = tickets[0];
        if (ticket.booking_status !== "CONFIRMED" || ticket.ticket_status !== "VALID") {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: "Only a valid ticket from a confirmed booking can be transferred"
            });
        }

        const [recipients] = await connection.execute(
            "SELECT id FROM users WHERE email = ?",
            [email]
        );

        if (recipients.length === 0) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(404).json({
                success: false,
                message: "The recipient must have an account"
            });
        }

        const recipientId = Number(recipients[0].id);
        if (recipientId === senderId) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(400).json({
                success: false,
                message: "A ticket cannot be transferred to yourself"
            });
        }

        const [ticketUpdate] = await connection.execute(
            "UPDATE tickets SET status = 'PENDING_TRANSFER' WHERE id = ? AND status = 'VALID'",
            [ticketId]
        );
        if (ticketUpdate.affectedRows !== 1) {
            throw new Error("Ticket status changed while initiating transfer");
        }

        const [transferResult] = await connection.execute(
            `INSERT INTO ticket_transfers
                (ticket_id, sender_user_id, recipient_user_id, status)
             VALUES (?, ?, ?, 'PENDING')`,
            [ticketId, senderId, recipientId]
        );

        await connection.commit();
        transactionStarted = false;

        return res.status(201).json({
            success: true,
            message: "Ticket transfer initiated",
            transfer: {
                id: transferResult.insertId,
                ticketId: Number(ticketId),
                senderId,
                recipientId,
                status: "PENDING"
            }
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Ticket transfer rollback error:", rollbackError);
            }
        }
        console.error("Ticket transfer initiation error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to initiate ticket transfer"
        });
    } finally {
        if (connection) connection.release();
    }
};

const acceptTransfer = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        const transferId = Number(req.params.transferId);
        const recipientId = Number(req.user.userId);
        if (!isPositiveId(transferId)) {
            return res.status(400).json({
                success: false,
                message: "transferId must be a positive integer"
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [transfers] = await connection.query(
            `SELECT id, ticket_id, sender_user_id, recipient_user_id, status
             FROM ticket_transfers
             WHERE id = ?
             FOR UPDATE`,
            [transferId]
        );
        if (transfers.length === 0) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(404).json({
                success: false,
                message: "Ticket transfer not found"
            });
        }

        const transfer = transfers[0];
        if (Number(transfer.recipient_user_id) !== recipientId) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(403).json({
                success: false,
                message: "Only the intended recipient can accept this transfer"
            });
        }
        if (transfer.status !== "PENDING") {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: "This ticket transfer is no longer pending"
            });
        }

        const [tickets] = await connection.query(
            `SELECT t.id, t.booking_seat_id, t.status AS ticket_status,
                    bs.booking_id, bs.price, b.user_id AS owner_id,
                    b.event_id, b.status AS booking_status
             FROM tickets t
             JOIN booking_seats bs ON bs.id = t.booking_seat_id
             JOIN bookings b ON b.id = bs.booking_id
             WHERE t.id = ?
             FOR UPDATE`,
            [transfer.ticket_id]
        );
        if (
            tickets.length === 0 ||
            Number(tickets[0].owner_id) !== Number(transfer.sender_user_id) ||
            tickets[0].ticket_status !== "PENDING_TRANSFER" ||
            tickets[0].booking_status !== "CONFIRMED"
        ) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: "The ticket is no longer available for transfer"
            });
        }

        const bookingSeat = tickets[0];
        const bookingReference = `EVT-${Date.now()}-${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        const [bookingResult] = await connection.execute(
            `INSERT INTO bookings
                (user_id, event_id, booking_reference, total_amount, status)
             VALUES (?, ?, ?, ?, 'CONFIRMED')`,
            [
                recipientId,
                bookingSeat.event_id,
                bookingReference,
                bookingSeat.price
            ]
        );

        const [seatUpdate] = await connection.execute(
            "UPDATE booking_seats SET booking_id = ? WHERE id = ? AND booking_id = ?",
            [bookingResult.insertId, bookingSeat.booking_seat_id, bookingSeat.booking_id]
        );
        if (seatUpdate.affectedRows !== 1) {
            throw new Error("Ticket ownership could not be reassigned");
        }

        const [ticketUpdate] = await connection.execute(
            "UPDATE tickets SET status = 'VALID' WHERE id = ? AND status = 'PENDING_TRANSFER'",
            [transfer.ticket_id]
        );
        if (ticketUpdate.affectedRows !== 1) {
            throw new Error("Ticket status could not be restored after transfer");
        }

        const [transferUpdate] = await connection.execute(
            `UPDATE ticket_transfers
             SET status = 'COMPLETED', resolved_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'PENDING'`,
            [transferId]
        );
        if (transferUpdate.affectedRows !== 1) {
            throw new Error("Transfer status could not be completed");
        }

        await connection.commit();
        transactionStarted = false;

        return res.status(200).json({
            success: true,
            message: "Ticket transfer accepted",
            transfer: {
                id: transferId,
                ticketId: Number(transfer.ticket_id),
                bookingId: bookingResult.insertId,
                recipientId,
                status: "COMPLETED"
            }
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Ticket transfer rollback error:", rollbackError);
            }
        }
        console.error("Ticket transfer acceptance error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to accept ticket transfer"
        });
    } finally {
        if (connection) connection.release();
    }
};

const rejectTransfer = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        const transferId = Number(req.params.transferId);
        const userId = Number(req.user.userId);
        if (!isPositiveId(transferId)) {
            return res.status(400).json({
                success: false,
                message: "transferId must be a positive integer"
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [transfers] = await connection.query(
            `SELECT id, ticket_id, sender_user_id, recipient_user_id, status
             FROM ticket_transfers
             WHERE id = ?
             FOR UPDATE`,
            [transferId]
        );
        if (transfers.length === 0) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(404).json({
                success: false,
                message: "Ticket transfer not found"
            });
        }

        const transfer = transfers[0];
        if (
            userId !== Number(transfer.sender_user_id) &&
            userId !== Number(transfer.recipient_user_id)
        ) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(403).json({
                success: false,
                message: "Only the sender or recipient can reject this transfer"
            });
        }
        if (transfer.status !== "PENDING") {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: "This ticket transfer is no longer pending"
            });
        }

        const [ticketUpdate] = await connection.execute(
            `UPDATE tickets
             SET status = 'VALID'
             WHERE id = ? AND status = 'PENDING_TRANSFER'`,
            [transfer.ticket_id]
        );
        if (ticketUpdate.affectedRows !== 1) {
            await rollback(connection, transactionStarted);
            transactionStarted = false;
            return res.status(409).json({
                success: false,
                message: "The ticket is no longer available for rejection"
            });
        }

        const [transferUpdate] = await connection.execute(
            `UPDATE ticket_transfers
             SET status = 'REJECTED', resolved_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'PENDING'`,
            [transferId]
        );
        if (transferUpdate.affectedRows !== 1) {
            throw new Error("Transfer status could not be rejected");
        }

        await connection.commit();
        transactionStarted = false;

        return res.status(200).json({
            success: true,
            message: "Ticket transfer rejected",
            transfer: {
                id: transferId,
                ticketId: Number(transfer.ticket_id),
                status: "REJECTED"
            }
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Ticket transfer rollback error:", rollbackError);
            }
        }
        console.error("Ticket transfer rejection error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to reject ticket transfer"
        });
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    initiateTransfer,
    acceptTransfer,
    rejectTransfer
};
