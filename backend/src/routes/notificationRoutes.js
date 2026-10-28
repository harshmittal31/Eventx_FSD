const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const {
  getMyNotifications,
  markMyNotificationsRead,
  markOneNotificationRead
} = require("../controllers/notificationController");

const router = express.Router();
const customerOnly = [authenticate, authorizeRoles("CUSTOMER")];

router.get("/", ...customerOnly, getMyNotifications);
router.patch("/read-all", ...customerOnly, markMyNotificationsRead);
router.patch("/:notificationId/read", ...customerOnly, markOneNotificationRead);

module.exports = router;
