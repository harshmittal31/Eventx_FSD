const pool = require("../config/db");

const getUserId = (req) => Number(req.user?.userId ?? req.user?.id);
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

const getWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const [rows] = await pool.execute(
      `SELECT w.id AS wishlist_id, w.event_id, w.created_at,
              e.name, e.description, e.venue_name, e.event_date, e.status, e.total_seats
       FROM customer_wishlist w JOIN events e ON e.id = w.event_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`, [userId]);
    res.json({ success: true, wishlist: rows });
  } catch (error) {
    console.error("Get wishlist error:", error);
    res.status(500).json({ success: false, message: "Unable to load wishlist. Ensure the customer feature migration has been run." });
  }
};

const addWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const eventId = Number(req.params.eventId);
    if (!validId(eventId)) return res.status(400).json({ success: false, message: "Valid event ID is required." });
    const [events] = await pool.execute("SELECT id, status FROM events WHERE id = ?", [eventId]);
    if (!events.length) return res.status(404).json({ success: false, message: "Event not found." });
    await pool.execute(
      "INSERT INTO customer_wishlist (user_id, event_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at",
      [userId, eventId]);
    res.status(201).json({ success: true, message: "Event saved to wishlist." });
  } catch (error) {
    console.error("Add wishlist error:", error);
    res.status(500).json({ success: false, message: "Unable to save event to wishlist." });
  }
};

const removeWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const eventId = Number(req.params.eventId);
    if (!validId(eventId)) return res.status(400).json({ success: false, message: "Valid event ID is required." });
    await pool.execute("DELETE FROM customer_wishlist WHERE user_id = ? AND event_id = ?", [userId, eventId]);
    res.json({ success: true, message: "Event removed from wishlist." });
  } catch (error) {
    console.error("Remove wishlist error:", error);
    res.status(500).json({ success: false, message: "Unable to remove event from wishlist." });
  }
};

const getReviews = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!validId(eventId)) return res.status(400).json({ success: false, message: "Valid event ID is required." });
    const [rows] = await pool.execute(
      `SELECT r.id, r.event_id, r.user_id, r.rating, r.review, r.created_at, u.name AS customer_name
       FROM event_reviews r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.is_visible = 1 ORDER BY r.created_at DESC LIMIT 100`, [eventId]);
    const [summary] = await pool.execute(
      "SELECT COUNT(*) AS review_count, COALESCE(AVG(rating), 0) AS average_rating FROM event_reviews WHERE event_id = ? AND is_visible = 1", [eventId]);
    res.json({ success: true, reviews: rows, summary: summary[0] });
  } catch (error) {
    console.error("Get reviews error:", error);
    res.status(500).json({ success: false, message: "Unable to load reviews. Ensure the customer feature migration has been run." });
  }
};

const submitReview = async (req, res) => {
  try {
    const userId = getUserId(req);
    const eventId = Number(req.params.eventId);
    const rating = Number(req.body.rating);
    const review = String(req.body.comment || req.body.review || "").trim();
    if (!validId(eventId)) return res.status(400).json({ success: false, message: "Valid event ID is required." });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    if (review.length > 2000) return res.status(400).json({ success: false, message: "Review must be 2000 characters or fewer." });

    const [events] = await pool.execute("SELECT event_date, status FROM events WHERE id = ?", [eventId]);
    if (!events.length) return res.status(404).json({ success: false, message: "Event not found." });
    if (new Date(events[0].event_date).getTime() > Date.now()) {
      return res.status(400).json({ success: false, message: "Reviews can be submitted after the event date." });
    }
    const [bookings] = await pool.execute(
      "SELECT id FROM bookings WHERE user_id = ? AND event_id = ? AND status IN ('CONFIRMED','COMPLETED') LIMIT 1",
      [userId, eventId]);
    if (!bookings.length) return res.status(403).json({ success: false, message: "Only customers with a confirmed booking can review this event." });

    await pool.execute(
      `INSERT INTO event_reviews (event_id, user_id, booking_id, rating, review)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), is_visible = 1, updated_at = CURRENT_TIMESTAMP`,
      [eventId, userId, bookings[0].id, rating, review || null]);
    res.status(201).json({ success: true, message: "Your review has been saved." });
  } catch (error) {
    console.error("Submit review error:", error);
    res.status(500).json({ success: false, message: "Unable to save review. Ensure the customer feature migration has been run." });
  }
};

const createSupportRequest = async (req, res) => {
  try {
    const userId = getUserId(req);
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();
    const bookingId = req.body.bookingId == null || req.body.bookingId === "" ? null : Number(req.body.bookingId);
    if (subject.length < 3 || subject.length > 160) return res.status(400).json({ success: false, message: "Subject must be 3–160 characters." });
    if (message.length < 10 || message.length > 4000) return res.status(400).json({ success: false, message: "Message must be 10–4000 characters." });
    if (bookingId !== null) {
      if (!validId(bookingId)) return res.status(400).json({ success: false, message: "Invalid booking ID." });
      const [owned] = await pool.execute("SELECT id FROM bookings WHERE id = ? AND user_id = ?", [bookingId, userId]);
      if (!owned.length) return res.status(404).json({ success: false, message: "Booking not found for this account." });
    }
    const [result] = await pool.execute(
      "INSERT INTO customer_support_requests (user_id, booking_id, subject, message) VALUES (?, ?, ?, ?)",
      [userId, bookingId, subject, message]);
    res.status(201).json({ success: true, message: "Support request submitted.", requestId: result.insertId });
  } catch (error) {
    console.error("Create support request error:", error);
    res.status(500).json({ success: false, message: "Unable to submit support request. Ensure the customer feature migration has been run." });
  }
};

const getMySupportRequests = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, booking_id, subject, message, status, admin_response, created_at, updated_at
       FROM customer_support_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [getUserId(req)]);
    res.json({ success: true, requests: rows });
  } catch (error) {
    console.error("Get support requests error:", error);
    res.status(500).json({ success: false, message: "Unable to load support requests." });
  }
};

module.exports = { getWishlist, addWishlist, removeWishlist, getReviews, submitReview, createSupportRequest, getMySupportRequests };
