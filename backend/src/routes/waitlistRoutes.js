const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const { joinWaitlist, getMyWaitlist, leaveWaitlist, promoteWaitlist } = require("../controllers/waitlistController");

const router = express.Router();
const customerOnly = [authenticate, authorizeRoles("CUSTOMER")];
const staffOrAdmin = [authenticate, authorizeRoles("STAFF", "ADMIN")];

router.post("/:eventId", ...customerOnly, joinWaitlist);
router.get("/my", ...customerOnly, getMyWaitlist);
router.delete("/:eventId", ...customerOnly, leaveWaitlist);
router.post("/:eventId/promote", ...staffOrAdmin, promoteWaitlist);

module.exports = router;
