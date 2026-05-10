const fetch = require("node-fetch");
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("node:crypto");
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

const dashboardRoute = require("./routes/dashboard");
const raffleRoutes = require("./routes/raffle");
const retroRoutes = require("./routes/retro");
const checkinRoutes = require("./routes/checkin");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.GCP_PROJECT_ID;
const googleAuthClient = new OAuth2Client(googleClientId);
const identityCookieName = "californiastcheckin.identity";
const identityMaxAgeSeconds = 60 * 60 * 24 * 366;

function getCookieValue(req, name) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getIdentitySecret() {
  return process.env.SESSION_SECRET || process.env.JWT_SECRET || process.env.PASS_SECRET || "dev-secret-change-me";
}

function signIdentityPayload(payload) {
  return crypto.createHmac("sha256", getIdentitySecret()).update(payload).digest("base64url");
}

function serializeIdentity(identity) {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${signIdentityPayload(payload)}`;
}

function parseIdentityCookie(req) {
  const rawCookie = getCookieValue(req, identityCookieName);
  if (!rawCookie) return null;

  const [payload, signature] = decodeURIComponent(rawCookie).split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signIdentityPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!identity.email) return null;
  return identity;
}

function setIdentityCookie(req, res, identity) {
  res.cookie(identityCookieName, serializeIdentity({
    email: identity.email,
    name: identity.name || identity.email,
    iat: Date.now(),
  }), {
    httpOnly: true,
    maxAge: identityMaxAgeSeconds * 1000,
    sameSite: "lax",
    secure: req.secure || req.get("x-forwarded-proto") === "https",
  });
}

async function verifyGoogleCredential(credential) {
  const ticket = await googleAuthClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, name: payload.name || payload.email };
}


app.set("view engine", "ejs");
app.set("trust proxy", 1);
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/auth/session", (req, res) => {
  try {
    res.json({ identity: parseIdentityCookie(req) });
  } catch (err) {
    console.error("auth/session error:", err);
    res.json({ identity: null });
  }
});

app.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "Missing Google credential" });
    }

    const identity = await verifyGoogleCredential(credential);
    setIdentityCookie(req, res, identity);
    res.json({ ok: true, identity });
  } catch (err) {
    console.error("auth/google error:", err);
    res.status(401).json({ error: "Could not verify Google sign-in" });
  }
});

app.post("/auth/manual", (req, res) => {
  const { email, name } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  const identity = { email, name: name || email };
  setIdentityCookie(req, res, identity);
  res.json({ ok: true, identity });
});

app.use(dashboardRoute);
app.use("/raffle", raffleRoutes);
app.use("/retro", retroRoutes);
app.use("/checkin", checkinRoutes);

function envFlag(name) {
  return process.env[name] === "true";
}

function isAutoCheckInAuthorized(req) {
  const autoToken = process.env.CHECKIN_AUTO_TOKEN;
  if (!autoToken) return true;

  const suppliedToken = req.query.checkin || req.query.autoToken;
  return suppliedToken === autoToken;
}

app.get("/", (req, res) => {
  const autoCheckInAuthorized = isAutoCheckInAuthorized(req);

  res.render("index", {
    googleClientId: process.env.GCP_PROJECT_ID,
    autoCheckInAuthorized,
    autoPassCreation:
      autoCheckInAuthorized && envFlag("AUTO_PASS_CREATION"),
    autoVisitRecording:
      autoCheckInAuthorized && envFlag("AUTO_VISIT_RECORDING"),
    autoClickCreationLinks:
      autoCheckInAuthorized && envFlag("AUTO_CLICK_CREATION_LINKS"),
    autoClickRecordingLinks:
      autoCheckInAuthorized && envFlag("AUTO_CLICK_RECORDING_LINKS"),
    closeAfterWalletRedirect:
      autoCheckInAuthorized && envFlag("CLOSE_AFTER_WALLET_REDIRECT"),
    udpateAppleWallet: envFlag("UPDATE_APPLE_WALLET"),
  });
});

app.get("/healthz", (req, res) => {
  res.send("success");
});

// Ping /healthz every 14 minutes to prevent sleeping
setInterval(() => {
  // const pstHour = new Date().toLocaleString("en-US", {
  //   timeZone: "America/Los_Angeles",
  // });
  // const hour = new Date(pstHour).getHours();
  // if (hour >= 1 && hour < 9) {
  //   console.log("[healthz] Skipped ping (quiet hours)");
  //   return;
  // }

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
      const { url } = await createApplePass(email, name, (isUpdate = false));
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
      const { url, hasRegisteredDevice, userId } = await createApplePass(
        email,
        name,
        (isUpdate = true)
      );
      res.json({ url, hasRegisteredDevice, userId });
    } else {
      const userId = await updatePassObject(email, name);
      res.status(200).json({ message: "Visit recorded", userId });
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
