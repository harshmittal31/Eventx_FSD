const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const { getAllUsers, getUserById, changeUserRole } = require("../controllers/adminController");

const router = express.Router();

// Only ADMIN can access these routes
const adminOnly = [authenticate, authorizeRoles("ADMIN")];

// GET  /api/admin/users              → List all users (with search/filter/pagination)
// GET  /api/admin/users/:userId      → View a single user
// PATCH /api/admin/users/:userId/role → Change a user's role

router.get("/users", ...adminOnly, getAllUsers);
router.get("/users/:userId", ...adminOnly, getUserById);
router.patch("/users/:userId/role", ...adminOnly, changeUserRole);

module.exports = router;
