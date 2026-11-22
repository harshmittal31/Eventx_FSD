const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");
const {
  getWishlist, addWishlist, removeWishlist,
  getReviews, submitReview, createSupportRequest, getMySupportRequests
} = require("../controllers/customerFeatureController");

const router = express.Router();
const customerOnly = [authenticate, authorizeRoles("CUSTOMER")];

router.get("/wishlist", ...customerOnly, getWishlist);
router.post("/wishlist/:eventId", ...customerOnly, addWishlist);
router.delete("/wishlist/:eventId", ...customerOnly, removeWishlist);
router.get("/events/:eventId/reviews", getReviews);
router.post("/events/:eventId/reviews", ...customerOnly, submitReview);
router.post("/support", ...customerOnly, createSupportRequest);
router.get("/support/my", ...customerOnly, getMySupportRequests);

module.exports = router;
