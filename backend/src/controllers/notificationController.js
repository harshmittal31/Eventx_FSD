const pool = require("../config/db");

function getUserId(req) {
  return req.user?.userId ?? req.user?.id;
}

// Return only the signed-in customer's notifications.
async function getMyNotifications(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "User identity missing from token." });
  }

  try {
    const [notifications] = await pool.query(
      `SELECT
         n.id,
         n.user_id,
         n.event_id,
         n.booking_id,
         n.type,
         n.title,
         n.message,
         n.is_read,
         n.created_at,
         rr.status AS refund_status
       FROM event_notifications n
       LEFT JOIN refund_requests rr ON rr.booking_id = n.booking_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC`,
      [userId]
    );

    return res.json({
      success: true,
      notifications: notifications.map((item) => ({
        ...item,
        is_read: Number(item.is_read) === 1
      }))
    });
  } catch (error) {
    console.error("Get customer notifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load event notifications."
    });
  }
}

async function markMyNotificationsRead(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "User identity missing from token." });
  }

  try {
    const [result] = await pool.query(
      "UPDATE event_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    return res.json({
      success: true,
      message: "Notifications marked as read.",
      updatedCount: result.affectedRows
    });
  } catch (error) {
    console.error("Mark customer notifications read error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update notification read status."
    });
  }
}

async function markOneNotificationRead(req, res) {
  const userId = getUserId(req);
  const notificationId = Number(req.params.notificationId);
  if (!userId) {
    return res.status(401).json({ success: false, message: "User identity missing from token." });
  }
  if (!Number.isSafeInteger(notificationId) || notificationId < 1) {
    return res.status(400).json({ success: false, message: "Invalid notification ID." });
  }

  try {
    const [result] = await pool.query(
      "UPDATE event_notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      [notificationId, userId]
    );
    if (!result.affectedRows) {
      const [rows] = await pool.query(
        "SELECT id FROM event_notifications WHERE id = ? AND user_id = ? LIMIT 1",
        [notificationId, userId]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Notification not found." });
      }
    }
    return res.json({ success: true, message: "Notification marked as read." });
  } catch (error) {
    console.error("Mark one customer notification read error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update notification read status."
    });
  }
}

module.exports = {
  getMyNotifications,
  markMyNotificationsRead,
  markOneNotificationRead
};
