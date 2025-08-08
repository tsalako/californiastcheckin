const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { eachDayOfInterval, format } = require("date-fns");
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

const PST = "America/Los_Angeles";

function formatPSTDateTimeString(timestamp) {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function parseDateAsPST(dateStr) {
  // Parse date parts as numeric
  const [year, month, day] = dateStr.split("-").map(Number);

  // Construct PST-native calendar date (no time shifting)
  return new Date(year, month - 1, day, 0, 0, 0);
}

function getPSTCalendarParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: parseInt(map.year),
    month: parseInt(map.month),
    day: parseInt(map.day),
  };
}

function getDefaultRange(range) {
  const now = new Date();
  const { year, month, day } = getPSTCalendarParts(now);
  let start;

  switch (range) {
    case "today":
      start = new Date(Date.UTC(year, month - 1, day));
      return [formatDate(start), formatDate(start)];
    case "yesterday":
      const y = new Date(Date.UTC(year, month - 1, day - 1));
      return [formatDate(y), formatDate(y)];
    case "thisWeek":
      const today = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = today.getUTCDay(); // 0 = Sunday
      start = new Date(Date.UTC(year, month - 1, day - dayOfWeek));
      break;
    case "thisMonth":
      start = new Date(Date.UTC(year, month - 1, 1));
      break;
    case "thisQuarter":
      const quarterMonth = Math.floor((month - 1) / 3) * 3;
      start = new Date(Date.UTC(year, quarterMonth, 1));
      break;
    case "thisYear":
      start = new Date(Date.UTC(year, 0, 1));
      break;
    default:
      return [null, null];
  }

  return [
    formatDate(start),
    formatDate(new Date(Date.UTC(year, month - 1, day))),
  ];
}

function formatDate(date) {
  return date.toISOString().split("T")[0]; // yyyy-mm-dd
}

function isWithinDateRange(dateStr, startDate, endDate) {
  const date = new Date(dateStr);
  return (
    (!startDate || date >= new Date(startDate)) &&
    (!endDate || date <= new Date(endDate))
  );
}

function getChartLabelsForRange(startStr, endStr) {
  const start = parseDateAsPST(startStr);
  const end = parseDateAsPST(endStr);

  return eachDayOfInterval({ start, end }).map((date) =>
    format(date, "yyyy-MM-dd")
  );
}

async function readJsonFile(filename) {
  const file = storage.bucket(bucketName).file(filename);
  const [contents] = await file.download();
  return JSON.parse(contents.toString());
}

router.get("/dashboard", async (req, res) => {
  let { start, end, level, range } = req.query;

  if (!start && !end && range) {
    [start, end] = getDefaultRange(range);
  } else if (!start && !end) {
    [start, end] = getDefaultRange("thisMonth"); // Fallback default
  }

  const updates = await readJsonFile(`updates${ENV_SUFFIX}.json`).catch(
    () => []
  );

  const [metaFiles] = await storage
    .bucket(bucketName)
    .getFiles({ prefix: "meta/" });
  const userStats = [];
  let visitsPerDay = {};
  let passesPerDay = {};

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
            const day = new Date(ts).toLocaleDateString("en-CA", {
              timeZone: "America/Los_Angeles",
            });
            if (isWithinDateRange(day, start, end)) {
              visitsPerDay[day] = (visitsPerDay[day] || 0) + 1;
            }
          });

          const created = meta.createTime || (meta.visitTimestamps || [])[0];
          if (created) {
            const day = new Date(created).toLocaleDateString("en-CA", {
              timeZone: "America/Los_Angeles",
            });
            if (isWithinDateRange(day, start, end)) {
              passesPerDay[day] = (passesPerDay[day] || 0) + 1;
            }
          }
        } catch (err) {
          console.warn("Error processing meta file:", file.name, err);
        }
      })
  );

  const labels = getChartLabelsForRange(start, end);

  visitsPerDay = Object.fromEntries(
    labels.map(date => [date, visitsPerDay[date] || 0])
  );

  passesPerDay = Object.fromEntries(
    labels.map(date => [date, passesPerDay[date] || 0])
  );

  userStats.sort((a, b) => b.visits - a.visits);
  updates.sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));

  res.render("dashboard", {
    leaderboard: userStats.map((u, i) => ({ ...u, rank: i + 1 })),
    visitsPerDay,
    passesPerDay,
    updateLog: updates.map((u) => ({
      name: u.name || u.serialNumber,
      updateTime: formatPSTDateTimeString(u.updateTime),
      isUpdate: u.isUpdate,
      hasDevices: !!(u.devices && u.devices.length),
    })),
    start,
    end,
  });
});

module.exports = router;
