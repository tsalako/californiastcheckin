const express = require("express");
const router = express.Router();
const { addCompanionsOncePerDay } = require("../services/checkins");

router.post("/companions", async (req, res) => {
  try {
    const { primaryUserId, count } = req.body;
    await addCompanionsOncePerDay({
      primaryUserId,
      count: Math.max(1, Number(count) || 1),
    });
    return res.status(200).json({
      status: "ok",
      message: "Friends added — have fun!",
      userId: primaryUserId,
    });
  } catch (e) {
    if (e && e.code === "COMPANIONS_ALREADY_TODAY") {
      return res.status(409).json({
        status: "already_added",
        message: "You already added companions for today.",
        userId: req.body.primaryUserId,
      });
    }
    console.error(e);
    return res.status(500).json({
      status: "error",
      message: "Failed to add companions.",
      userId: req.body.primaryUserId,
    });
  }
});

module.exports = router;
