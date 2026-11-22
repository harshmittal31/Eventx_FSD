const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const {
    initiateTransfer,
    acceptTransfer,
    rejectTransfer
} = require("../controllers/ticketTransferController");

const router = express.Router();

router.post("/", authenticate, initiateTransfer);
router.post("/:transferId/accept", authenticate, acceptTransfer);
router.post("/:transferId/reject", authenticate, rejectTransfer);

module.exports = router;
