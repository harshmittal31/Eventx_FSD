const express = require("express");
const cors = require("cors");

const dbTestRoutes = require("./routes/dbTest");
const eventRoutes = require("./routes/eventRoutes");
const authRoutes = require("./routes/authRoutes");
const authenticate = require("./middleware/authMiddleware");
const seatLockRoutes = require("./routes/seatLockRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const waitlistRoutes =require("./routes/waitlistRoutes");
const expireSeatLocks = require("./utils/expireSeatLocks");
const refundRoutes = require("./routes/refundRoutes");
const customerFeatureRoutes = require("./routes/customerFeatureRoutes");
const adminRoutes = require("./routes/adminRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "EventX API is running"
    });
});

app.get("/api/protected-test", authenticate, (req, res) => {
    res.json({
        success: true,
        message: "JWT authentication successful",
        user: req.user
    });
});

app.use("/api", dbTestRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", seatLockRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/api/customer", customerFeatureRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
setInterval(() => {expireSeatLocks();}, 1000);

module.exports = app;