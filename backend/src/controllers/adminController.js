const pool = require("../config/db");

const ALLOWED_ROLES = ["CUSTOMER", "STAFF", "ADMIN"];

// ── GET /api/admin/users ──────────────────────────────────────────
// Admin: List all users (with optional search/filter)
const getAllUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let where = "WHERE 1=1";

    if (role && ALLOWED_ROLES.includes(role.toUpperCase())) {
      where += " AND role = ?";
      params.push(role.toUpperCase());
    }

    if (search && search.trim().length > 0) {
      where += " AND (name LIKE ? OR email LIKE ?)";
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, role, created_at
       FROM users
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params
    );

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      users: rows,
    });
  } catch (error) {
    console.error("Admin getAllUsers error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch users." });
  }
};

// ── GET /api/admin/users/:userId ──────────────────────────────────
// Admin: View a single user's details
const getUserById = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const [rows] = await pool.execute(
      "SELECT id, name, email, role, created_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.json({ success: true, user: rows[0] });
  } catch (error) {
    console.error("Admin getUserById error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch user." });
  }
};

// ── PATCH /api/admin/users/:userId/role ──────────────────────────
// Admin: Change a user's role
const changeUserRole = async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const requestingAdminId = Number(req.user.userId);
    const { role } = req.body;

    // Validate
    if (!Number.isSafeInteger(targetUserId) || targetUserId < 1) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    if (!role || !ALLOWED_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${ALLOWED_ROLES.join(", ")}.`,
      });
    }

    // Prevent admin from changing their own role (safety guard)
    if (targetUserId === requestingAdminId) {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own role.",
      });
    }

    // Check target user exists
    const [rows] = await pool.execute(
      "SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1",
      [targetUserId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const user = rows[0];
    const oldRole = user.role;
    const newRole = role.toUpperCase();

    if (oldRole === newRole) {
      return res.status(400).json({
        success: false,
        message: `User already has the role '${newRole}'.`,
      });
    }

    // Update role
    await pool.execute("UPDATE users SET role = ? WHERE id = ?", [newRole, targetUserId]);

    console.log(
      `[Admin Action] Admin #${requestingAdminId} changed user #${targetUserId} (${user.email}) role: ${oldRole} → ${newRole}`
    );

    return res.json({
      success: true,
      message: `Role updated successfully. ${user.name} (${user.email}) is now '${newRole}'.`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        oldRole,
        newRole,
      },
    });
  } catch (error) {
    console.error("Admin changeUserRole error:", error);
    return res.status(500).json({ success: false, message: "Unable to update role." });
  }
};

module.exports = { getAllUsers, getUserById, changeUserRole };
