const express = require("express");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const router = express.Router();

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

async function readJsonFile(filename) {
  try {
    const file = storage.bucket(bucketName).file(filename);
    const [contents] = await file.download();
    return JSON.parse(contents.toString());
  } catch (err) {
    console.error("Failed to read file:", filename, err);
    return null;
  }
}

router.get("/dashboard", async (req, res) => {
  const updates = (await readJsonFile("apple/updates.json")) || { updates: [] };

  const [metaFiles] = await storage
    .bucket(bucketName)
    .getFiles({ prefix: "meta/" });
  const userStats = [];
  const visitsPerDay = {};
  const passesPerDay = {};

  await Promise.all(
    metaFiles
    .filter(file => file.name.endsWith(".json") && file.name !== "meta/")
    .map(async (file) => {
      try {
        const [contents] = await file.download();
        const meta = JSON.parse(contents.toString());
        const name = meta.name || file.name.split("/").pop().split(".")[0];
        const visits = (meta.visitTimestamps || []).length;

        userStats.push({ name, visits });

        (meta.visitTimestamps || []).forEach((ts) => {
          const day = new Date(ts).toISOString().split("T")[0];
          visitsPerDay[day] = (visitsPerDay[day] || 0) + 1;
        });

        // Use file metadata creation date for pass creation date
        const [metadata] = await file.getMetadata();
        const created = metadata.timeCreated;
        if (created) {
          const day = new Date(created).toISOString().split("T")[0];
          passesPerDay[day] = (passesPerDay[day] || 0) + 1;
        }
      } catch (err) {
        console.warn("Error processing meta file:", file.name, err);
      }
    })
  );

  userStats.sort((a, b) => b.visits - a.visits);
  updates.updates.sort(
    (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
  );

  res.render("dashboard", {
    leaderboard: userStats.map((u, i) => ({ ...u, rank: i + 1 })),
    visitsPerDay,
    passesPerDay,
    updateLog: updates.updates.map((u) => ({
      serialNumber: u.serialNumber,
      updateTime: u.updateTime,
      isUpdate: u.isUpdate,
      hasDevices: !!(u.devices && u.devices.length),
    })),
  });
});

module.exports = router;
