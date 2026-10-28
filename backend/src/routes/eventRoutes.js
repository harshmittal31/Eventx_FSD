const express = require("express");

const {
    createEvent,
    getEvents,
    getEventSeats,
    getManageableEvents,
    updateEvent
} = require("../controllers/eventController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");

const router = express.Router();

const staffOrAdmin = [
    authenticate,
    authorizeRoles("STAFF", "ADMIN")
];

// Public: list published events for customers
router.get("/", getEvents);

// Staff/Admin: list manageable events
router.get("/manage", ...staffOrAdmin, getManageableEvents);

// Customer-facing event seats
router.get("/:eventId/seats", getEventSeats);

// Staff/Admin: create event
router.post("/", ...staffOrAdmin, createEvent);

// Staff/Admin: update event or cancel it
router.patch("/:eventId", ...staffOrAdmin, updateEvent);

module.exports = router;