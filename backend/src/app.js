const express = require("express");
const cors = require("cors");

const eventRoutes = require("./routes/eventRoutes");
const authRoutes = require("./routes/authRoutes");
const seatLockRoutes = require("./routes/seatLockRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const ticketTransferRoutes = require("./routes/ticketTransferRoutes");
const waitlistRoutes =require("./routes/waitlistRoutes");
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

app.use("/api/events", eventRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", seatLockRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/tickets/transfer", ticketTransferRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/api/customer", customerFeatureRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

module.exports = app;