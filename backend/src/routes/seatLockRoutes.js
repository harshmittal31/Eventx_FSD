const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const { lockSeat } = require("../controllers/seatLockController");

const router = express.Router();

// Seat locking is a customer checkout action, not a staff/admin action.
router.post(
  "/events/:eventId/seats/:seatId/lock",
  authenticate,
  authorizeRoles("CUSTOMER"),
  lockSeat
);

module.exports = router;
