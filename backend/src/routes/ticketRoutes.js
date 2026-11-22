const express = require("express");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const auditTicketVerification = require("../middleware/ticketAuditMiddleware");

const {
  createTicket,
  getMyTickets,
  verifyTicket,
} = require("../controllers/ticketController");
const {
  getVerificationHistory,
} = require("../controllers/ticketAuditController");

const router = express.Router();

// Existing ticket creation and customer ticket list.
router.post("/", authenticate, createTicket);
router.get("/my", authenticate, getMyTickets);

// Staff/admin-only verification and database-backed audit history.
router.post(
  "/verify",
  authenticate,
  authorizeRoles("STAFF", "ADMIN"),
  auditTicketVerification,
  verifyTicket
);

router.get(
  "/verification-history",
  authenticate,
  authorizeRoles("STAFF", "ADMIN"),
  getVerificationHistory
);

module.exports = router;
