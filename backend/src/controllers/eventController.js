const pool = require("../config/db");
const venueConfig = require("../config/venueConfig.json");

const createEvent = async (req, res) => {
    let connection;

    try {
        const {
            name,
            description,
            venueName,
            eventDate,
            rows = venueConfig.defaultLayout.rows,
            seatsPerRow = venueConfig.defaultLayout.seatsPerRow
        } = req.body;

        // 1. Validate required fields
        if (!name || !venueName || !eventDate) {
            return res.status(400).json({
                success: false,
                message: "Name, venueName and eventDate are required"
            });
        }

        // 2. Validate numeric layout values
        const validRows =
            Number.isInteger(rows) && rows > 0 && rows <= 26;

        const validSeatsPerRow =
            Number.isInteger(seatsPerRow) &&
            seatsPerRow > 0 &&
            seatsPerRow <= 50;

        if (!validRows || !validSeatsPerRow) {
            return res.status(400).json({
                success: false,
                message:
                    "Rows must be 1-26 and seatsPerRow must be 1-50"
            });
        }

        // 3. Validate the venue configuration
        if (
            !venueConfig.sections ||
            venueConfig.sections.length === 0
        ) {
            return res.status(500).json({
                success: false,
                message: "Venue configuration is missing sections"
            });
        }

        const totalSeats = rows * seatsPerRow;

        // 4. Generate the actual layout for this event
        const rowLabels = Array.from(
            { length: rows },
            (_, index) => String.fromCharCode(65 + index)
        );

        const sections = venueConfig.sections.map(section => ({
            ...section,
            rows: section.rows.filter(row =>
                rowLabels.includes(row)
            )
        })).filter(section => section.rows.length > 0);

        // The configured layout may define only A-J. When an organizer
        // creates more rows, assign any additional rows to the final
        // configured section so every generated row has a section and price.
        const alreadyAssignedRows = new Set(
            sections.flatMap(section => section.rows)
        );
        const unassignedRows = rowLabels.filter(
            row => !alreadyAssignedRows.has(row)
        );

        if (unassignedRows.length > 0) {
            const fallbackConfig = venueConfig.sections[venueConfig.sections.length - 1];
            let fallbackSection = sections.find(
                section => section.name === fallbackConfig.name
            );

            if (!fallbackSection) {
                fallbackSection = { ...fallbackConfig, rows: [] };
                sections.push(fallbackSection);
            }

            fallbackSection.rows.push(...unassignedRows);
        }

        // Ensure every row belongs to exactly one section
        const assignedRows = sections.flatMap(
            section => section.rows
        );

        if (
            assignedRows.length !== rows ||
            new Set(assignedRows).size !== rows
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Venue configuration must assign every row exactly once"
            });
        }

        const venueLayout = {
            rows,
            seatsPerRow,
            sections
        };

        // 5. Generate seats using the JSON configuration
        const seatValues = [];

        for (const rowLabel of rowLabels) {
            const section = sections.find(item =>
                item.rows.includes(rowLabel)
            );

            for (
                let seatIndex = 1;
                seatIndex <= seatsPerRow;
                seatIndex++
            ) {
                seatValues.push([
                    null, // Event ID is assigned after event insertion
                    `${rowLabel}${seatIndex}`,
                    section.name,
                    rowLabel,
                    String(seatIndex),
                    section.price
                ]);
            }
        }

        // 6. Start transaction
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 7. Create event
        const [eventResult] = await connection.execute(
            `INSERT INTO events
                (name, description, venue_name, event_date,
                 total_seats, venue_layout_json, status)
             VALUES (?, ?, ?, ?, ?, ?, 'PUBLISHED')`,
            [
                name,
                description || null,
                venueName,
                eventDate,
                totalSeats,
                JSON.stringify(venueLayout)
            ]
        );

        const eventId = eventResult.insertId;

        // 8. Assign event ID to every generated seat
        const finalSeatValues = seatValues.map(seat => [
            eventId,
            ...seat.slice(1)
        ]);

        // 9. Insert all seats
        await connection.query(
            `INSERT INTO seats
                (event_id, seat_number, section,
                 row_label, seat_label, price)
             VALUES ?`,
            [finalSeatValues]
        );

        // 10. Commit event and seats together
        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "Event and venue seats created successfully",
            eventId,
            totalSeats,
            layout: venueLayout
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Create event error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create event"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};



// STAFF/ADMIN: list all events, including draft, cancelled and completed ones.
const getManageableEvents = async (req, res) => {
    try {
        const [events] = await pool.query(
            `SELECT id, name, description, venue_name, event_date,
                    total_seats, status, created_at
             FROM events
             ORDER BY event_date DESC, id DESC`
        );
        return res.json({ success: true, count: events.length, events });
    } catch (error) {
        console.error("Manage events list error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch events for management" });
    }
};

// STAFF/ADMIN: update event details or its lifecycle status. Seats/layout are deliberately not changed.
const updateEvent = async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
        const eventId = Number(req.params.eventId);
        if (!Number.isSafeInteger(eventId) || eventId < 1) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }

        const allowedStatuses = ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"];
        const { name, description, venueName, eventDate, status } = req.body;
        const updates = [];
        const values = [];

        if (name !== undefined) {
            if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
                return res.status(400).json({ success: false, message: "Event name is required and must be at most 200 characters" });
            }
            updates.push("name = ?"); values.push(name.trim());
        }
        if (description !== undefined) {
            if (description !== null && typeof description !== "string") {
                return res.status(400).json({ success: false, message: "Description must be text" });
            }
            updates.push("description = ?"); values.push(description === null ? null : (description.trim() || null));
        }
        if (venueName !== undefined) {
            if (typeof venueName !== "string" || !venueName.trim() || venueName.trim().length > 200) {
                return res.status(400).json({ success: false, message: "Venue name is required and must be at most 200 characters" });
            }
            updates.push("venue_name = ?"); values.push(venueName.trim());
        }
        if (eventDate !== undefined) {
            if (typeof eventDate !== "string" || !eventDate.trim() || Number.isNaN(new Date(eventDate).getTime())) {
                return res.status(400).json({ success: false, message: "A valid event date/time is required" });
            }
            updates.push("event_date = ?"); values.push(eventDate);
        }
        if (status !== undefined) {
            const normalizedStatus = String(status).toUpperCase();
            if (!allowedStatuses.includes(normalizedStatus)) {
                return res.status(400).json({ success: false, message: "Status must be DRAFT, PUBLISHED, CANCELLED, or COMPLETED" });
            }
            updates.push("status = ?"); values.push(normalizedStatus);
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: "Provide at least one field to update" });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        const [beforeRows] = await connection.query(
            "SELECT id, name, status FROM events WHERE id = ? FOR UPDATE",
            [eventId]
        );
        if (!beforeRows.length) {
            await connection.rollback();
            transactionStarted = false;
            return res.status(404).json({ success: false, message: "Event not found" });
        }

        const previousEvent = beforeRows[0];
        const requestedStatus = status === undefined ? null : String(status).toUpperCase();
        const becomingCancelled = requestedStatus === "CANCELLED" && previousEvent.status !== "CANCELLED";
        values.push(eventId);
        await connection.execute(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`, values);

        let cancelledBookings = 0;
        let ticketsCancelled = 0;
        let seatsReleased = 0;
        let locksReleased = 0;
        let notificationsCreated = 0;
        let refundRequestsCreated = 0;

        // Process cancellation atomically. This also safely repairs any prior
        // partial rollout: repeated cancellation is idempotent due to unique keys.
        if (requestedStatus === "CANCELLED") {
            const [bookings] = await connection.query(
                `SELECT id, user_id, event_id, booking_reference, total_amount, status
                 FROM bookings
                 WHERE event_id = ? AND status = 'CONFIRMED'
                 ORDER BY id ASC
                 FOR UPDATE`,
                [eventId]
            );

            for (const booking of bookings) {
                const [ticketUpdate] = await connection.query(
                    `UPDATE tickets t
                     INNER JOIN booking_seats bs ON bs.id = t.booking_seat_id
                     SET t.status = 'CANCELLED'
                     WHERE bs.booking_id = ? AND t.status <> 'CANCELLED'`,
                    [booking.id]
                );
                ticketsCancelled += ticketUpdate.affectedRows;

                const [bookingUpdate] = await connection.query(
                    `UPDATE bookings SET status = 'CANCELLED'
                     WHERE id = ? AND status = 'CONFIRMED'`,
                    [booking.id]
                );
                cancelledBookings += bookingUpdate.affectedRows;

                const title = "Event cancelled";
                const message = `The event "${previousEvent.name}" has been cancelled by the organizer. Booking ${booking.booking_reference || `#${booking.id}`} remains in your history. Your refund request is recorded as PENDING REVIEW. No money has been transferred automatically.`;
                const [noticeResult] = await connection.query(
                    `INSERT IGNORE INTO event_notifications
                     (user_id, event_id, booking_id, type, title, message)
                     VALUES (?, ?, ?, 'EVENT_CANCELLED', ?, ?)`,
                    [booking.user_id, eventId, booking.id, title, message]
                );
                notificationsCreated += noticeResult.affectedRows;

                // One refund request per booking; UNIQUE(booking_id) prevents duplicates.
                const [refundResult] = await connection.query(
                    `INSERT IGNORE INTO refund_requests
                     (booking_id, user_id, event_id, amount, reason, status)
                     VALUES (?, ?, ?, ?, 'EVENT_CANCELLED', 'PENDING_REVIEW')`,
                    [booking.id, booking.user_id, eventId, booking.total_amount || 0]
                );
                refundRequestsCreated += refundResult.affectedRows;
            }

            // Cancel any remaining tickets associated with this event's bookings,
            // including tickets that are no longer VALID (USED/other states included).
            const [allTicketUpdate] = await connection.query(
                `UPDATE tickets t
                 INNER JOIN booking_seats bs ON bs.id = t.booking_seat_id
                 INNER JOIN bookings b ON b.id = bs.booking_id
                 SET t.status = 'CANCELLED'
                 WHERE b.event_id = ? AND t.status <> 'CANCELLED'`,
                [eventId]
            );
            ticketsCancelled += allTicketUpdate.affectedRows;

            // Seat rows and booking/ticket history are preserved. Only the seat
            // availability state is reset; cancelled events cannot be booked because
            // seat-lock/booking endpoints must validate the parent event status.
            const [seatUpdate] = await connection.query(
                `UPDATE seats SET status = 'AVAILABLE'
                 WHERE event_id = ? AND status IN ('BOOKED', 'HELD')`,
                [eventId]
            );
            seatsReleased = seatUpdate.affectedRows;

            // EXPIRED is an existing supported terminal lock status in this project.
            const [lockUpdate] = await connection.query(
                `UPDATE seat_locks sl
                 INNER JOIN seats s ON s.id = sl.seat_id
                 SET sl.status = 'EXPIRED'
                 WHERE s.event_id = ? AND sl.status = 'ACTIVE'`,
                [eventId]
            );
            locksReleased = lockUpdate.affectedRows;
        }

        const [eventRows] = await connection.query(
            `SELECT id, name, description, venue_name, event_date,
                    total_seats, status, created_at
             FROM events WHERE id = ?`,
            [eventId]
        );

        await connection.commit();
        transactionStarted = false;

        return res.json({
            success: true,
            message: requestedStatus === "CANCELLED"
                ? "Event cancelled. Confirmed bookings and tickets were cancelled, seats and active locks were released, notifications and refund requests were recorded."
                : "Event updated successfully",
            event: eventRows[0],
            cancellation: requestedStatus === "CANCELLED" ? {
                wasAlreadyCancelled: !becomingCancelled,
                cancelledBookings,
                ticketsCancelled,
                seatsReleased,
                locksReleased,
                notificationsCreated,
                refundRequestsCreated,
                refundStatus: "PENDING_REVIEW",
                refundNote: "This records refund requests only; actual payment refunds require payment-provider integration."
            } : null
        });
    } catch (error) {
        if (connection && transactionStarted) {
            try { await connection.rollback(); } catch (_) {}
        }
        console.error("Update event/cancellation error:", error);
        if (error.code === "ER_NO_SUCH_TABLE") {
            return res.status(500).json({ success: false, message: "Run the event notification/refund SQL migration before cancelling events." });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to update event or process cancellation. No partial changes were committed."
        });
    } finally {
        if (connection) connection.release();
    }
};

const getMyEventNotifications = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
        const [notifications] = await pool.query(
            `SELECT n.id, n.event_id, n.booking_id, n.type, n.title, n.message, n.is_read, n.created_at,
                    r.status AS refund_status, r.amount AS refund_amount
             FROM event_notifications n
             LEFT JOIN refund_requests r ON r.booking_id = n.booking_id
             WHERE n.user_id = ?
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT 30`,
            [userId]
        );
        return res.json({ success: true, count: notifications.length, notifications });
    } catch (error) {
        console.error("Get event notifications error:", error);
        return res.status(500).json({ success: false, message: "Unable to load event notifications" });
    }
};

const getEvents = async (req, res) => {
    try {
        const [events] = await pool.query(
            `SELECT
                id,
                name,
                description,
                venue_name,
                event_date,
                total_seats,
                status,
                created_at
             FROM events
             WHERE status = 'PUBLISHED'
             ORDER BY event_date ASC`
        );

        res.json({
            success: true,
            count: events.length,
            events
        });

    } catch (error) {
        console.error("Get events error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};


const getEventSeats = async (req, res) => {
    try {
        const { eventId } = req.params;

        const [seats] = await pool.query(
            `SELECT
                id,
                seat_number,
                section,
                row_label,
                seat_label,
                price,
                status
             FROM seats
             WHERE event_id = ?
             ORDER BY row_label, CAST(seat_label AS UNSIGNED)`,
            [eventId]
        );

        res.json({
            success: true,
            eventId: Number(eventId),
            count: seats.length,
            seats
        });

    } catch (error) {
        console.error("Get seats error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch seats"
        });
    }
};
module.exports = {
    createEvent,
    getEvents,
    getEventSeats,
    getManageableEvents,
    updateEvent,
    getMyEventNotifications
};