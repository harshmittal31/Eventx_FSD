const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const {
    getRefundRequests,
    updateRefundStatus
} = require("../controllers/refundController");

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles("ADMIN")];

// Refund requests and decisions are restricted to ADMIN, never STAFF/CUSTOMER.
router.get("/", ...adminOnly, getRefundRequests);
router.patch("/:refundId/status", ...adminOnly, updateRefundStatus);

module.exports = router;
