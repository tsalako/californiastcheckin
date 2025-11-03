const express = require("express");
const router = express.Router();
const {
  createRaffle,
  getRaffle,
  drawWinner,
  listRaffles,
  getLastQuarterBounds,
} = require("../services/raffle");

router.get("/", async (req, res) => {
  const raffles = await listRaffles();
  res.render("raffle", {
    raffles,
    raffle: null,
    participants: [],
    winners: [],
    suggestedName: getLastQuarterBounds().name,
  });
});

router.post("/create", async (req, res) => {
  try {
    const { rangeType, winnersTarget, name } = req.body;
    const raffle = await createRaffle({
      rangeType,
      winnersTarget,
      nameOverride: name,
    });
    const full = await getRaffle(raffle.id);
    res.render("raffle", {
      raffles: await listRaffles(),
      raffle: full,
      participants: full.participants.sort((a, b) => b.remaining - a.remaining),
      winners: full.winners,
      suggestedName: "",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to create raffle");
  }
});

router.get("/:id", async (req, res) => {
  const raffle = await getRaffle(req.params.id);
  if (!raffle) return res.status(404).send("Raffle not found");
  res.render("raffle", {
    raffles: await listRaffles(),
    raffle,
    participants: raffle.participants.sort((a, b) => b.remaining - a.remaining),
    winners: raffle.winners,
    suggestedName: "",
  });
});

router.post("/:id/draw", async (req, res) => {
  try {
    await drawWinner(req.params.id);
    const raffle = await getRaffle(req.params.id);
    res.render("raffle", {
      raffles: await listRaffles(),
      raffle,
      participants: raffle.participants.sort(
        (a, b) => b.remaining - a.remaining
      ),
      winners: raffle.winners,
      suggestedName: "",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to draw winner");
  }
});

module.exports = router;
