const express = require("express");
const {
  register,
  login
} = require("../controllers/authController");
const authenticate = require("../middleware/authMiddleware");
const {
  getMyProfile,
  updateMyProfile,
  changeMyPassword
} = require("../controllers/profileController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

// Authenticated account management.
router.get("/me", authenticate, getMyProfile);
router.patch("/me", authenticate, updateMyProfile);
router.patch("/change-password", authenticate, changeMyPassword);

module.exports = router;
