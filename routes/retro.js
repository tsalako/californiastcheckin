// routes/retro.js
const express = require("express");
const router = express.Router();
const { prisma } = require("../utils/db");
const {
  addRetroAnonymousVisit,
  addRetroVisitForUser,
} = require("../services/checkins");

// GET form
router.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  res.render("retro", { users });
});

// POST handler
router.post("/", async (req, res) => {
  try {
    const { mode, email, name, date, count, note } = req.body;
    const occurredAt = new Date(`${date}T23:59:59.999`);

    if (mode === "user" && email) {
      await addRetroVisitForUser({ email, name, occurredAt, note });
    } else if (mode === "anonymous") {
      for (let i = 0; i < count; i++) {
        await addRetroAnonymousVisit({ occurredAt, note });
      }
    } else {
      res.render("retro", {
        message: "Failed to add. Check form values.",
        type: "error",
      });
      return;
    }

    res.render("retro", { message: "Added successfully.", type: "success" });
  } catch (e) {
    console.error(e);
    res.render("retro", { message: "Failed to add.", type: "error" });
  }
});

module.exports = router;
