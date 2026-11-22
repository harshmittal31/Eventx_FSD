const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const {
  confirmBooking,
  cancelBooking,
  getMyBookings
} = require("../controllers/bookingController");

const router = express.Router();

// Customers can only access and manage their own bookings.
router.get("/my-bookings", authenticate, authorizeRoles("CUSTOMER"), getMyBookings);
router.post("/confirm", authenticate, authorizeRoles("CUSTOMER"), confirmBooking);
router.patch("/:bookingId/cancel", authenticate, authorizeRoles("CUSTOMER"), cancelBooking);

module.exports = router;
