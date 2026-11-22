const crypto = require("crypto");
const QRCode = require("qrcode");

const db = require("../config/db");

// ======================================================
// HMAC SECRET
// ======================================================

const HMAC_SECRET = process.env.TICKET_HMAC_SECRET;

if (!HMAC_SECRET) {
    console.warn(
        "WARNING: TICKET_HMAC_SECRET is not set in .env"
    );
}


// ======================================================
// CREATE TICKET
// POST /api/tickets
// ======================================================

const createTicket = async (req, res) => {

    let connection;

    try {

        // --------------------------------------------------
        // 1. Authentication
        // --------------------------------------------------

        const userId = req.user.userId;

        const { bookingSeatId } = req.body;


        // --------------------------------------------------
        // 2. Validate input
        // --------------------------------------------------

        if (!bookingSeatId) {

            return res.status(400).json({
                success: false,
                message: "bookingSeatId is required"
            });

        }


        if (!Number.isInteger(Number(bookingSeatId))) {

            return res.status(400).json({
                success: false,
                message: "bookingSeatId must be a valid integer"
            });

        }


        if (!HMAC_SECRET) {

            return res.status(500).json({
                success: false,
                message: "Ticket security configuration is missing"
            });

        }


        // --------------------------------------------------
        // 3. Get database connection
        // --------------------------------------------------

        connection = await db.getConnection();


        // --------------------------------------------------
        // 4. Start transaction
        // --------------------------------------------------

        await connection.beginTransaction();


        // --------------------------------------------------
        // 5. Find booking seat
        //    Also verify ownership
        // --------------------------------------------------

        const [rows] = await connection.execute(

            `
            SELECT

                bs.id AS booking_seat_id,
                bs.seat_id,
                bs.price,

                b.id AS booking_id,
                b.user_id,
                b.event_id,
                b.booking_reference,
                b.status AS booking_status,

                s.seat_number,
                s.row_label,
                s.seat_label,
                s.section

            FROM booking_seats bs

            JOIN bookings b
                ON bs.booking_id = b.id

            JOIN seats s
                ON bs.seat_id = s.id

            WHERE bs.id = ?
              AND b.user_id = ?

            FOR UPDATE
            `,

            [bookingSeatId, userId]

        );


        // --------------------------------------------------
        // 6. Booking seat not found
        // --------------------------------------------------

        if (rows.length === 0) {

            await connection.rollback();

            return res.status(404).json({

                success: false,

                message:
                    "Booking seat not found or does not belong to you"

            });

        }


        const bookingSeat = rows[0];


        // --------------------------------------------------
        // 7. Booking must be confirmed
        // --------------------------------------------------

        if (bookingSeat.booking_status !== "CONFIRMED") {

            await connection.rollback();

            return res.status(409).json({

                success: false,

                message:
                    "Ticket can only be created for a confirmed booking"

            });

        }


        // --------------------------------------------------
        // 8. Check existing ticket
        // --------------------------------------------------

        const [existingTicket] = await connection.execute(

            `
            SELECT

                id,
                ticket_code,
                status,
                issued_at

            FROM tickets

            WHERE booking_seat_id = ?

            FOR UPDATE
            `,

            [bookingSeatId]

        );


        if (existingTicket.length > 0) {

            await connection.rollback();

            return res.status(409).json({

                success: false,

                message:
                    "Ticket already exists for this booking seat",

                ticket: existingTicket[0]

            });

        }


        // --------------------------------------------------
        // 9. Generate unique ticket code
        // --------------------------------------------------

        const randomPart = crypto
            .randomBytes(6)
            .toString("hex")
            .toUpperCase();

        const ticketCode = `EVX-${randomPart}`;


        // --------------------------------------------------
        // 10. Generate QR nonce
        // --------------------------------------------------

        const qrNonce = crypto
            .randomBytes(32)
            .toString("hex");


        // --------------------------------------------------
        // 11. Insert ticket
        // --------------------------------------------------

        const [ticketResult] = await connection.execute(

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


        const ticketId = ticketResult.insertId;


        // --------------------------------------------------
        // 12. Create HMAC payload
        //
        // eventId|seatId|ticketId|nonce
        // --------------------------------------------------

        const payload =
            `${bookingSeat.event_id}|` +
            `${bookingSeat.seat_id}|` +
            `${ticketId}|` +
            `${qrNonce}`;


        // --------------------------------------------------
        // 13. Generate HMAC-SHA256 signature
        // --------------------------------------------------

        const signature = crypto
            .createHmac(
                "sha256",
                HMAC_SECRET
            )
            .update(payload)
            .digest("hex");


        // --------------------------------------------------
        // 14. Final QR data
        //
        // payload.signature
        // --------------------------------------------------

        const qrData =
            `${payload}.${signature}`;


        // --------------------------------------------------
        // 15. Generate QR image
        // --------------------------------------------------

        const qrCode =
            await QRCode.toDataURL(qrData);


        // --------------------------------------------------
        // 16. Commit transaction
        // --------------------------------------------------

        await connection.commit();


        // --------------------------------------------------
        // 17. Return ticket
        // --------------------------------------------------

        return res.status(201).json({

            success: true,

            message:
                "Ticket created successfully",

            ticket: {

                id: ticketId,

                booking_seat_id:
                    bookingSeat.booking_seat_id,

                ticket_code:
                    ticketCode,

                event_id:
                    bookingSeat.event_id,

                booking_id:
                    bookingSeat.booking_id,

                booking_reference:
                    bookingSeat.booking_reference,

                seat_id:
                    bookingSeat.seat_id,

                seat_number:
                    bookingSeat.seat_number,

                row_label:
                    bookingSeat.row_label,

                seat_label:
                    bookingSeat.seat_label,

                section:
                    bookingSeat.section,

                price:
                    bookingSeat.price,

                status:
                    "VALID",

                issued_at:
                    new Date(),

                // QR image
                qr_code:
                    qrCode,

                // Raw QR data used to generate QR
                qr_data:
                    qrData

            }

        });


    } catch (error) {

        // --------------------------------------------------
        // Rollback if transaction was started
        // --------------------------------------------------

        if (connection) {

            try {

                await connection.rollback();

            } catch (rollbackError) {

                console.error(
                    "Rollback error:",
                    rollbackError
                );

            }

        }


        console.error(
            "Create ticket error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Failed to create ticket",

            error:
                error.message

        });


    } finally {

        if (connection) {

            connection.release();

        }

    }

};


// ======================================================
// GET MY TICKETS
// GET /api/tickets/my
// ======================================================

const getMyTickets = async (req, res) => {

    try {

        const userId =
            req.user.userId;


        // --------------------------------------------------
        // Get user's tickets
        // --------------------------------------------------

        const [tickets] = await db.execute(

            `
            SELECT

                t.id,

                t.booking_seat_id,

                t.ticket_code,

                t.qr_nonce,

                t.status,

                t.issued_at,

                t.used_at,

                b.id AS booking_id,

                b.booking_reference,

                b.event_id,

                bs.seat_id,

                bs.price,

                s.seat_number,

                s.section,

                s.row_label,

                s.seat_label

            FROM tickets t

            JOIN booking_seats bs
                ON t.booking_seat_id = bs.id

            JOIN bookings b
                ON bs.booking_id = b.id

            JOIN seats s
                ON bs.seat_id = s.id

            WHERE b.user_id = ?

            ORDER BY t.issued_at DESC
            `,

            [userId]

        );


        // --------------------------------------------------
        // Generate QR code for every ticket
        // --------------------------------------------------

        const ticketsWithQR =
            await Promise.all(

                tickets.map(
                    async (ticket) => {

                        const payload =
                            `${ticket.event_id}|` +
                            `${ticket.seat_id}|` +
                            `${ticket.id}|` +
                            `${ticket.qr_nonce}`;


                        const signature =
                            crypto
                                .createHmac(
                                    "sha256",
                                    HMAC_SECRET
                                )
                                .update(payload)
                                .digest("hex");


                        const qrData =
                            `${payload}.${signature}`;


                        const qrCode =
                            await QRCode.toDataURL(
                                qrData
                            );


                        return {

                            id:
                                ticket.id,

                            booking_seat_id:
                                ticket.booking_seat_id,

                            ticket_code:
                                ticket.ticket_code,

                            status:
                                ticket.status,

                            qr_nonce:
                                ticket.qr_nonce,

                            issued_at:
                                ticket.issued_at,

                            used_at:
                                ticket.used_at,

                            booking_id:
                                ticket.booking_id,

                            booking_reference:
                                ticket.booking_reference,

                            event_id:
                                ticket.event_id,

                            seat_id:
                                ticket.seat_id,

                            seat_number:
                                ticket.seat_number,

                            section:
                                ticket.section,

                            row_label:
                                ticket.row_label,

                            seat_label:
                                ticket.seat_label,

                            price:
                                ticket.price,

                            // QR image
                            qr_code:
                                qrCode,

                            // Raw QR data
                            qr_data:
                                qrData

                        };

                    }
                )

            );


        // --------------------------------------------------
        // Return tickets
        // --------------------------------------------------

        return res.status(200).json({

            success: true,

            count:
                ticketsWithQR.length,

            tickets:
                ticketsWithQR

        });


    } catch (error) {

        console.error(
            "Get tickets error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Failed to fetch tickets",

            error:
                error.message

        });

    }

};


// ======================================================
// VERIFY TICKET
// POST /api/tickets/verify
// ======================================================

const verifyTicket = async (req, res) => {

    let connection;

    try {

        // --------------------------------------------------
        // 1. Get QR data
        // --------------------------------------------------

        const { qrData } =
            req.body;


        // --------------------------------------------------
        // 2. Validate QR data
        // --------------------------------------------------

        if (
            !qrData ||
            typeof qrData !== "string"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "qrData is required"

            });

        }


        if (!HMAC_SECRET) {

            return res.status(500).json({

                success: false,

                message:
                    "Ticket security configuration is missing"

            });

        }


        // --------------------------------------------------
        // 3. Separate payload and signature
        //
        // eventId|seatId|ticketId|nonce.signature
        // --------------------------------------------------

        const separatorIndex =
            qrData.lastIndexOf(".");


        if (separatorIndex === -1) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid QR code format"

            });

        }


        const payload =
            qrData.substring(
                0,
                separatorIndex
            );


        const receivedSignature =
            qrData.substring(
                separatorIndex + 1
            );

        // Validate HMAC signature format
        if (!/^[a-f0-9]{64}$/i.test(receivedSignature)) {
            return res.status(401).json({
                success: false,
                message: "Invalid or tampered QR code"
            });
        }
        


        // --------------------------------------------------
        // 4. Generate expected HMAC
        // --------------------------------------------------

        const expectedSignature =
            crypto
                .createHmac(
                    "sha256",
                    HMAC_SECRET
                )
                .update(payload)
                .digest("hex");


        // --------------------------------------------------
        // 5. Compare signatures safely
        // --------------------------------------------------

        let receivedBuffer;
        let expectedBuffer;

        try {

            receivedBuffer =
                Buffer.from(
                    receivedSignature,
                    "hex"
                );

            expectedBuffer =
                Buffer.from(
                    expectedSignature,
                    "hex"
                );

        } catch (error) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid or tampered QR code"

            });

        }


        if (
            receivedBuffer.length !==
                expectedBuffer.length ||

            !crypto.timingSafeEqual(
                receivedBuffer,
                expectedBuffer
            )
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid or tampered QR code"

            });

        }


        // --------------------------------------------------
        // 6. Extract payload
        // --------------------------------------------------

        const parts =
            payload.split("|");


        if (parts.length !== 4) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid QR payload"

            });

        }


        const [
            eventId,
            seatId,
            ticketId,
            qrNonce
        ] = parts;


        // --------------------------------------------------
        // 7. Get DB connection
        // --------------------------------------------------

        connection =
            await db.getConnection();


        // --------------------------------------------------
        // 8. Start transaction
        // --------------------------------------------------

        await connection.beginTransaction();


        // --------------------------------------------------
        // 9. Find ticket and lock row
        // --------------------------------------------------

        const [tickets] =
            await connection.execute(

                `
                SELECT

                    t.id,

                    t.booking_seat_id,

                    t.ticket_code,

                    t.qr_nonce,

                    t.status,

                    t.issued_at,

                    t.used_at,

                    b.id AS booking_id,

                    b.booking_reference,

                    b.event_id,

                    bs.seat_id,

                    bs.price,

                    s.seat_number,

                    s.section,

                    s.row_label,

                    s.seat_label

                FROM tickets t

                JOIN booking_seats bs
                    ON t.booking_seat_id = bs.id

                JOIN bookings b
                    ON bs.booking_id = b.id

                JOIN seats s
                    ON bs.seat_id = s.id

                WHERE t.id = ?

                FOR UPDATE
                `,

                [ticketId]

            );


        // --------------------------------------------------
        // 10. Ticket not found
        // --------------------------------------------------

        if (tickets.length === 0) {

            await connection.rollback();

            return res.status(404).json({

                success: false,

                message:
                    "Ticket not found"

            });

        }


        const ticket =
            tickets[0];


        // --------------------------------------------------
        // 11. Validate QR against DB
        // --------------------------------------------------

        if (

            String(ticket.event_id) !==
                String(eventId)

            ||

            String(ticket.seat_id) !==
                String(seatId)

            ||

            String(ticket.id) !==
                String(ticketId)

            ||

            ticket.qr_nonce !==
                qrNonce

        ) {

            await connection.rollback();

            return res.status(401).json({

                success: false,

                message:
                    "QR data does not match ticket"

            });

        }


        // --------------------------------------------------
        // 12. Check ticket status

        if (ticket.status === "USED") {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Ticket has already been used",
                ticket: {
                    id: ticket.id,
                    ticket_code: ticket.ticket_code,
                    used_at: ticket.used_at
                }
            });
        }

        if (ticket.status === "CANCELLED") {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Ticket has been cancelled"
            });
        }

        if (ticket.status !== "VALID") {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "Ticket is not valid for entry"
            });
        }


        // --------------------------------------------------
        // 13. Mark ticket as USED
        // --------------------------------------------------

        await connection.execute(

            `
            UPDATE tickets

            SET

                status = 'USED',

                used_at = CURRENT_TIMESTAMP

            WHERE id = ?
            `,

            [ticket.id]

        );


        // --------------------------------------------------
        // 14. Commit transaction
        // --------------------------------------------------

        await connection.commit();


        // --------------------------------------------------
        // 15. Success response
        // --------------------------------------------------

        return res.status(200).json({

            success: true,

            message:
                "Ticket verified successfully",

            ticket: {

                id:
                    ticket.id,

                ticket_code:
                    ticket.ticket_code,

                booking_id:
                    ticket.booking_id,

                booking_reference:
                    ticket.booking_reference,

                event_id:
                    ticket.event_id,

                seat_id:
                    ticket.seat_id,

                seat_number:
                    ticket.seat_number,

                section:
                    ticket.section,

                row_label:
                    ticket.row_label,

                seat_label:
                    ticket.seat_label,

                price:
                    ticket.price,

                status:
                    "USED",

                used_at:
                    new Date()

            }

        });


    } catch (error) {

        if (connection) {

            try {

                await connection.rollback();

            } catch (rollbackError) {

                console.error(
                    "Rollback error:",
                    rollbackError
                );

            }

        }


        console.error(
            "Verify ticket error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Failed to verify ticket",

            error:
                error.message

        });


    } finally {

        if (connection) {

            connection.release();

        }

    }

};


// ======================================================
// EXPORT
// ======================================================

module.exports = {

    createTicket,
    getMyTickets,
    verifyTicket

};