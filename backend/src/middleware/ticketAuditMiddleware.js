const crypto = require("crypto");
const db = require("../config/db");

// Audit every response from the staff-only verification endpoint.
// The raw QR payload is never stored; only its SHA-256 fingerprint is retained.
const auditTicketVerification = (req, res, next) => {
  const originalJson = res.json.bind(res);
  let handled = false;

  res.json = (body) => {
    if (handled) return originalJson(body);
    handled = true;

    const responseBody = body && typeof body === "object" ? body : {};
    const ticket = responseBody.ticket || responseBody.data?.ticket || null;
    const qrData = typeof req.body?.qrData === "string" ? req.body.qrData : null;
    const message = String(responseBody.message || "Verification failed").slice(0, 500);
    const httpStatus = res.statusCode || 200;
    const success = httpStatus >= 200 && httpStatus < 300 && responseBody.success === true;

    return db.execute(
      `INSERT INTO ticket_verification_logs
        (staff_user_id, ticket_id, ticket_code, event_id, result, http_status, message, qr_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.userId ?? null,
        ticket?.id ?? ticket?.ticketId ?? null,
        ticket?.ticket_code ?? ticket?.ticketCode ?? null,
        ticket?.event_id ?? ticket?.eventId ?? null,
        success ? "ACCEPTED" : "REJECTED",
        httpStatus,
        message,
        qrData ? crypto.createHash("sha256").update(qrData).digest("hex") : null,
      ]
    )
      .catch((error) => {
        console.error("Ticket verification audit insert failed:", error.message);
      })
      .then(() => originalJson(body));
  };

  next();
};

module.exports = auditTicketVerification;
