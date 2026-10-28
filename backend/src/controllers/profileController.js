const bcrypt = require("bcrypt");
const pool = require("../config/db");

const getCurrentUserId = (req) => Number(req.user && req.user.userId);

const getMyProfile = async (req, res) => {
  try {
    const userId = getCurrentUserId(req);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    const [rows] = await pool.execute(
      "SELECT id, name, email, role, created_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }
    return res.json({ success: true, user: rows[0] });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ success: false, message: "Unable to load profile." });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const userId = getCurrentUserId(req);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    // Fetch current profile so we can keep existing values if not provided
    const [current] = await pool.execute(
      "SELECT id, name, email, role, created_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!current.length) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const name  = typeof req.body.name  === "string" ? req.body.name.trim()                    : current[0].name;
    const email = typeof req.body.email === "string" && req.body.email.trim().length > 0
                  ? req.body.email.trim().toLowerCase()
                  : current[0].email;

    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ success: false, message: "Name must be between 2 and 100 characters." });
    }
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    const [duplicates] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
      [email, userId]
    );
    if (duplicates.length) {
      return res.status(409).json({ success: false, message: "That email address is already in use." });
    }

    await pool.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", [name, email, userId]);
    const [rows] = await pool.execute(
      "SELECT id, name, email, role, created_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    return res.json({ success: true, message: "Profile updated successfully.", user: rows[0] });
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "That email address is already in use." });
    }
    console.error("Update profile error:", error);
    return res.status(500).json({ success: false, message: "Unable to update profile." });
  }
};

const changeMyPassword = async (req, res) => {
  try {
    const userId = getCurrentUserId(req);
    const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new passwords are required." });
    }
    if (newPassword.length < 8 || newPassword.length > 72) {
      return res.status(400).json({ success: false, message: "New password must be between 8 and 72 characters." });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: "New password must be different from the current password." });
    }

    const [rows] = await pool.execute(
      "SELECT password_hash FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }
    const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
    return res.json({
      success: true,
      message: "Password changed successfully. Sign out of other sessions if applicable."
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Unable to change password." });
  }
};

module.exports = { getMyProfile, updateMyProfile, changeMyPassword };
