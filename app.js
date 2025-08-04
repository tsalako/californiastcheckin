const fetch = require("node-fetch");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
require("dotenv").config();

const {
  hasGooglePass,
  createGooglePass,
  updatePassObject,
  createPassClass,
} = require("./utils/googleWallet");

const {
  hasApplePass,
  createApplePass,
  registerDevice,
  getUpdatedSerialNumbers,
  unregisterDevice,
  getUpdatedPass,
  sendPushUpdateByEmail,
} = require("./utils/appleWallet");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.render("index", {
    googleClientId: process.env.GCP_PROJECT_ID,
    autoPassCreation: process.env.AUTO_PASS_CREATION === "true",
    autoVisitRecording: process.env.AUTO_VISIT_RECORDING === "true",
    autoClickCreationLinks: process.env.AUTO_CLICK_CREATION_LINKS === "true",
    autoClickRecordingLinks: process.env.AUTO_CLICK_RECORDING_LINKS === "true",
  });
});

app.get("/healthz", (req, res) => {
  res.send("success");
});

// Ping /healthz every 14 minutes to prevent sleeping
setInterval(() => {
  const pstHour = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  });
  const hour = new Date(pstHour).getHours();
  if (hour >= 1 && hour < 9) {
    console.log("[healthz] Skipped ping (quiet hours)");
    return;
  }

  fetch("https://californiastcheckin.onrender.com/healthz")
    .then((res) => console.log(`[healthz] Ping success: ${res.status}`))
    .catch((err) => console.error("[healthz] Ping failed:", err));
}, 14 * 60 * 1000); // 14 minutes

app.get("/hasPass", async (req, res) => {
  const { email, platform } = req.query;
  console.time("hasPass");
  try {
    const exists =
      platform === "apple"
        ? await hasApplePass(email)
        : await hasGooglePass(email);
    res.json({ exists });
  } catch (err) {
    console.error("hasPass error:", err);
    res.status(500).json({ error: "Server error" });
  }
  console.timeEnd("hasPass");
});

app.post("/create-pass", async (req, res) => {
  const { email, name, platform } = req.body;
  console.time("createPass");
  try {
    if (platform === "apple") {
      const { url } = await createApplePass(email, name, false);
      res.json({ url });
    } else {
      await createPassClass();
      const button = await createGooglePass(email, name);
      res.json({ button });
    }
    console.log(`${name} created a pass and checked in.`);
  } catch (err) {
    console.error("create-pass error:", err);
    res.status(500).json({ error: "Failed to create pass" });
  }
  console.timeEnd("createPass");
});

app.post("/record-visit", async (req, res) => {
  const { email, platform, name } = req.body;
  console.time("recordVisit");
  try {
    if (platform === "apple") {
      const { url, hasRegisteredDevice } = await createApplePass(
        email,
        name,
        true
      );
      res.json({ url, hasRegisteredDevice });
    } else {
      await updatePassObject(email, name);
      res.status(200).json({ message: "Visit recorded" });
    }
    console.log(`${name} checked in.`);
  } catch (err) {
    console.error("record-visit error:", err);
    const code = err.statusCode || 500;
    res.status(code).json({ message: err.message || "Failed to record visit" });
  }
  console.timeEnd("recordVisit");
});

// Register device
app.post(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  async (req, res) => {
    console.time("registerDevice");
    const { deviceLibraryIdentifier, serialNumber } = req.params;
    const pushToken = req.body.pushToken;
    const authHeader = req.headers.authorization;
    console.log(`authHeader = ${authHeader}, ${deviceLibraryIdentifier}`);
    const newlyRegistered = await registerDevice(
      serialNumber,
      deviceLibraryIdentifier,
      pushToken
    );
    const status = newlyRegistered ? 201 : 200;
    res.status(status).send();
    console.timeEnd("registerDevice");
  }
);

// Get updates since timestamp (Apple calls this to get serials to update)
app.get(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
  async (req, res) => {
    console.time("updatesSinceTime");
    const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
    const updatedSince = req.query.passesUpdatedSince;

    try {
      const { serialNumbers, lastUpdated } = await getUpdatedSerialNumbers(
        deviceLibraryIdentifier,
        updatedSince
      );
      res.status(200).json({ serialNumbers, lastUpdated });
    } catch (err) {
      if (err.message === "nothing found") {
        res.status(204).send();
      } else {
        console.error("Get updated passes error:", err);
        res.status(500).send("Internal Server Error");
      }
    }
    console.timeEnd("updatesSinceTime");
  }
);

// Unregister
app.delete(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  async (req, res) => {
    console.time("unregisterDevice");
    const { deviceLibraryIdentifier, serialNumber } = req.params;
    await unregisterDevice(serialNumber, deviceLibraryIdentifier);
    res.status(200).send();
    console.timeEnd("unregisterDevice");
  }
);

// Pass update request handler (Apple may call this)
app.get("/v1/passes/:passTypeIdentifier/:serialNumber", async (req, res) => {
  // Return updated pass.json or 304
  console.time("getUpdatedPass");
  const { passTypeIdentifier, serialNumber } = req.params;
  const authHeader = req.headers.authorization;
  try {
    const pass = await getUpdatedPass(serialNumber, authHeader);
    res.set({
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": "attachment; filename=pass.pkpass",
    });
    res.status(200).send(pass);
  } catch (err) {
    console.error("Error in /v1/passes:", err);
    res.status(500).send("Internal Server Error");
  }
  console.timeEnd("getUpdatedPass");
});

// Push Trigger Route
app.get("/push-update", async (req, res) => {
  console.time("pushUpdate");
  try {
    const { email } = req.query;
    await sendPushUpdateByEmail(email);
    res.send("Push sent");
  } catch (err) {
    res.status(500).send(err.message);
  }
  console.timeEnd("pushUpdate");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
