const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/db-test", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS result");

        res.json({
            success: true,
            message: "MySQL connection successful",
            result: rows[0].result
        });
    } catch (error) {
        console.error("Database error:", error);

        res.status(500).json({
            success: false,
            message: "MySQL connection failed"
        });
    }
});

module.exports = router;