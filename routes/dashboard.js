const express = require("express");
const { Storage } = require("@google-cloud/storage");
const router = express.Router();

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const storage = new Storage({ credentials });
const bucketName = process.env.GCS_BUCKET_NAME;

const isProduction = process.env.NODE_ENV === "production";
const excluded = new Set([
  "vic_anibarro_gmail_com",
  "mitchell_celicious_gmail_com",
  "tsalako12_gmail_com",
  "testtacocat_gmail_com",
]);
const ENV_SUFFIX = isProduction ? "" : "_staging";

async function readJsonFile(filename) {
  const file = storage.bucket(bucketName).file(filename);
  const [contents] = await file.download();
  return JSON.parse(contents.toString());
}

function isWithinDateRange(dateStr, startDate, endDate) {
  const date = new Date(dateStr);
  return (
    (!startDate || date >= new Date(startDate)) &&
    (!endDate || date <= new Date(endDate))
  );
}

router.get("/dashboard", async (req, res) => {
  let { start, end } = req.query;

  if (!start && !end) {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    start = monthStart.toLocaleDateString("en-CA");
    end = today.toLocaleDateString("en-CA");
  }

  const updates = await readJsonFile(`updates${ENV_SUFFIX}.json`).catch(
    () => []
  );

  const [metaFiles] = await storage
    .bucket(bucketName)
    .getFiles({ prefix: "meta/" });
  const userStats = [];
  const visitsPerDay = {};
  const passesPerDay = {};

  await Promise.all(
    metaFiles
      .filter((file) => file.name.endsWith(".json") && file.name !== "meta/")
      .map(async (file) => {
        try {
          const [contents] = await file.download();
          const meta = JSON.parse(contents.toString());
          const nameKey = file.name.split("/").pop().split(".")[0];
          const name = meta.name || nameKey;
          const visits = (meta.visitTimestamps || []).length;

          if (isProduction && excluded.has(nameKey)) return;

          userStats.push({ name, visits });

          (meta.visitTimestamps || []).forEach((ts) => {
            const day = new Date(ts).toLocaleDateString("en-CA");
            if (isWithinDateRange(day, start, end)) {
              visitsPerDay[day] = (visitsPerDay[day] || 0) + 1;
            }
          });

          const created = meta.createTime || (meta.visitTimestamps || [])[0];
          if (created) {
            const day = new Date(created).toLocaleDateString("en-CA");
            if (isWithinDateRange(day, start, end)) {
              passesPerDay[day] = (passesPerDay[day] || 0) + 1;
            }
          }
        } catch (err) {
          console.warn("Error processing meta file:", file.name, err);
        }
      })
  );

  userStats.sort((a, b) => b.visits - a.visits);
  updates.sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));

  res.render("dashboard", {
    leaderboard: userStats.map((u, i) => ({ ...u, rank: i + 1 })),
    visitsPerDay,
    passesPerDay,
    updateLog: updates.map((u) => ({
      name: u.name || u.serialNumber,
      updateTime: u.updateTime,
      isUpdate: u.isUpdate,
      hasDevices: !!(u.devices && u.devices.length),
    })),
    start,
    end,
  });
});

module.exports = router;
