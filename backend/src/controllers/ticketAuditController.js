const db = require("../config/db");

const getVerificationHistory = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const [rows] = await db.execute(
      `SELECT id, staff_user_id, ticket_id, ticket_code, event_id, result,
              http_status, message, created_at
       FROM ticket_verification_logs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );

    const [[stats]] = await db.execute(
      `SELECT COUNT(*) AS totalScans,
              SUM(result = 'ACCEPTED') AS acceptedEntries,
              SUM(result = 'REJECTED') AS rejectedScans
       FROM ticket_verification_logs`
    );

    return res.json({
      success: true,
      history: rows,
      stats: {
        totalScans: Number(stats.totalScans || 0),
        acceptedEntries: Number(stats.acceptedEntries || 0),
        rejectedScans: Number(stats.rejectedScans || 0),
      },
    });
  } catch (error) {
    console.error("Get ticket verification history error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load ticket verification history",
    });
  }
};

module.exports = { getVerificationHistory };
