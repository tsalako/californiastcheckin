const { Storage } = require("@google-cloud/storage");
const path = require("path");
const { PKPass } = require("passkit-generator");
const { formatInTimeZone } = require("date-fns-tz");
const crypto = require("crypto");
const apn = require("apn");

const { getLevelDetails } = require("./levelConfig.js");
const {
  getOrCreateUserByEmail,
  attachWalletIds,
} = require("../services/users");
const {
  visitsCount,
  alreadyCheckedInToday,
  recordVisit,
} = require("../services/checkins");
const {
  upsertAppleDevice,
  unregisterAppleDevice,
  getUserDevices,
} = require("../services/devices");

const { isProd } = require("../utils/env");
const { prisma } = require("../utils/db");

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const storage = new Storage({ credentials });

const certDir = "apple";
const passOutputDir = "apple/passes";

function generateAuthToken() {
  return crypto.randomBytes(16).toString("hex"); // 32-char token
}

function getObjectInfo(email) {
  const serialNumber = email.replace(/[^\w-]/g, "_").replace(/\./g, "_");
  return getObjectInfoFromSN(serialNumber);
}

function getObjectInfoFromSN(serialNumber) {
  return {
    serialNumber,
    passFile: `${passOutputDir}/${serialNumber}.pkpass`,
  };
}

async function readJsonFromGCS(filename) {
  const file = storage.bucket(BUCKET_NAME).file(filename);
  const contents = await file.download();
  return JSON.parse(contents.toString());
}

let cachedCerts = null;
async function getCertFiles() {
  if (cachedCerts) return cachedCerts;
  const certFile = storage.bucket(BUCKET_NAME).file(`${certDir}/cert.pem`);
  const keyFile = storage.bucket(BUCKET_NAME).file(`${certDir}/key.pem`);
  const wwdrFile = storage.bucket(BUCKET_NAME).file(`${certDir}/AppleWWDR.pem`);
  const authKeyFile = storage.bucket(BUCKET_NAME).file(`${certDir}/AuthKey.p8`);

  const [cert, key, wwdr, authKey] = await Promise.all([
    certFile.download(),
    keyFile.download(),
    wwdrFile.download(),
    authKeyFile.download(),
  ]);

  cachedCerts = {
    cert: cert.toString(),
    key: key.toString(),
    wwdr: wwdr.toString(),
    authKey: authKey.toString(),
  };
  return cachedCerts;
}

async function hasApplePass(email) {
  const { passFile } = getObjectInfo(email);
  const [exists] = await storage.bucket(BUCKET_NAME).file(passFile).exists();
  return exists;
}

async function createApplePass(email, name, isUpdate) {
  console.log(`createApplePass - isUpdate: ${isUpdate}`);

  const { serialNumber, passFile } = getObjectInfo(email);

  console.time("certs");
  const { cert, key, wwdr } = await getCertFiles();
  console.timeEnd("certs");

  let user = await getOrCreateUserByEmail(email, name);
  var userId = user.id;

  if (isProd() && (await alreadyCheckedInToday(userId))) {
    console.log(`${name} attempted to check in more than once.`);
    throw new Error("You've already checked in today.");
  }

  console.time("record visit");
  const visit = await recordVisit({ userId: userId });
  console.timeEnd("record visit");

  const nowFormatted = formatInTimeZone(
    visit.occurredAt,
    "America/Los_Angeles",
    "iii PP p"
  );

  if (!isUpdate) {
    console.time("attach wallet ids");
    user = await attachWalletIds(userId, {
      serialNumber: serialNumber,
      authenticationToken: generateAuthToken(),
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER,
      teamIdentifier: process.env.APPLE_TEAM_ID,
    });
    console.timeEnd("attach wallet ids");
  }

  const metadata = {
    name: user.name,
    email: user.email,
    createTime: user.createdAt,
    serialNumber: user.serialNumber,
    authenticationToken: user.authenticationToken,
    passTypeIdentifier: user.passTypeIdentifier,
    teamIdentifier: user.teamIdentifier,
  };

  // TODO: get images from GCS instead of locally.
  console.time("generate pass");
  const pass = await PKPass.from(
    {
      model: path.resolve(process.env.APPLE_TEMPLATE_PATH),
      certificates: {
        wwdr: wwdr,
        signerCert: cert,
        signerKey: key,
        signerKeyPassphrase: process.env.APPLE_CERT_PASSWORD,
      },
    },
    metadata
  );
  console.timeEnd("generate pass");

  console.time("get visits");
  const countNow = await visitsCount(userId);
  const level = getLevelDetails(countNow);
  console.timeEnd("get visits");

  pass.auxiliaryFields.push(
    {
      key: "visits",
      label: "Visits",
      value: countNow,
    },
    { key: "lastvisit", label: "Last Visit", value: nowFormatted }
  );
  pass.backFields.push(
    { key: "name_back", label: "Dreamer Name", value: name },
    { key: "level_back", label: "Level", value: level.name },
    {
      key: "visits_back",
      label: "Visits",
      value: countNow,
    },
    { key: "lastvisit_back", label: "Last Visit", value: nowFormatted }
  );

  console.time("getAsStream");
  const streamBuffer = pass.getAsStream();
  console.timeEnd("getAsStream");

  const file = storage.bucket(BUCKET_NAME).file(passFile);
  const uploadStream = file.createWriteStream({
    metadata: { contentType: "application/vnd.apple.pkpass" },
    resumable: false,
  });

  console.time("write pass to GCS");
  await new Promise((resolve, reject) => {
    streamBuffer.pipe(uploadStream).on("error", reject).on("finish", resolve);
  });
  console.timeEnd("write pass to GCS");

  console.time("getSignedUrl");
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: 'attachment; filename="pass.pkpass"',
  });
  console.timeEnd("getSignedUrl");

  console.time("getUserDevices");
  const devices = await getUserDevices(userId);
  const hasRegisteredDevice = devices && devices.length > 0;
  console.timeEnd("getUserDevices");

  return { url, hasRegisteredDevice, userId };
}

async function registerDevice(
  serialNumber,
  deviceLibraryIdentifier,
  pushToken
) {
  console.log(
    "registerDevice. serialNumber " +
      serialNumber +
      ", deviceLibraryIdentifier " +
      deviceLibraryIdentifier +
      ", pushToken" +
      pushToken
  );
  const user = await prisma.user.findFirst({ where: { serialNumber } });
  if (!user) {
    return false;
  }

  const existing = await prisma.device.findFirst({
    where: { deviceLibraryIdentifier: deviceLibraryIdentifier },
  });

  // Upsert/refresh push token
  await upsertAppleDevice(user.id, deviceLibraryIdentifier, pushToken);

  // Newly registered if it didn't exist before
  console.log("existing? " + existing);
  return !existing;
}

// DB-backed: return serials for this device that have changed since timestamp
async function getUpdatedSerialNumbers(deviceLibraryIdentifier, updatedSince) {
  console.log("getUpdatedSerialNumbers");
  // Find the device and its user
  const device = await prisma.device.findFirst({
    where: { deviceLibraryIdentifier: deviceLibraryIdentifier },
    include: { user: true },
  });

  if (!device || !device.user) {
    throw new Error("nothing found");
  }

  const user = device.user;

  // Parse "passesUpdatedSince" as ms epoch (Apple sends milliseconds since epoch)
  const since = new Date(
    Number.isFinite(parseInt(updatedSince, 10)) ? parseInt(updatedSince, 10) : 0
  );

  // Compute most recent "update" moment that should bump the pass:
  // - user's updatedAt (e.g., when tokens/ids change)
  // - latest visit for this user
  const latestVisit = await prisma.visit.findFirst({
    where: { userId: user.id },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });

  const candidates = [
    user.updatedAt || user.createdAt || new Date(0),
    latestVisit?.occurredAt || new Date(0),
  ].map((d) => new Date(d).getTime());

  const lastUpdateTs = Math.max(...candidates);
  const lastUpdate = new Date(lastUpdateTs);

  if (lastUpdate <= since) {
    // Nothing changed for this device since the provided timestamp
    throw new Error("nothing found");
  }

  const serial = user.serialNumber;
  const updateString = String(lastUpdate.getTime());
  console.log(`Serials=${serial}, LastUpdate=${updateString}`);
  return {
    serialNumbers: [serial],
    // Apple accepts string; we’ll return epoch ms as string for monotonicity
    lastUpdated: updateString,
  };
}

async function unregisterDevice(serialNumber, deviceLibraryIdentifier) {
  console.log("unregisterDevice");
  const user = await prisma.user.findFirst({ where: { serialNumber } });
  if (!user) return;
  await unregisterAppleDevice(deviceLibraryIdentifier);
}

// DB-backed auth + read pkpass from GCS (you still store pass files in GCS)
async function getUpdatedPass(serialNumber, authHeader) {
  console.log("getUpdatedPass");
  // Lookup user by serial and verify ApplePass auth header
  const user = await prisma.user.findFirst({
    where: { serialNumber },
  });
  if (!user) throw new Error("No user for serial");

  const expected = `ApplePass ${user.authenticationToken}`;
  if (authHeader !== expected) {
    throw new Error("No authentication.");
  }

  // Your pass files are generated into GCS; keep serving the latest file
  const { passFile } = getObjectInfoFromSN(user.serialNumber);

  const [pass] = await storage
    .bucket(BUCKET_NAME)
    .file(passFile)
    .download()
    .catch(() => [null]);

  if (!pass) throw new Error("No updated pass found.");
  return pass;
}

// DB-backed: push to all registered Apple devices for a user by email
async function sendPushUpdateByEmail(email) {
  console.log("sendPushUpdateByEmail");
  // Resolve user and all their devices
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("No user for email");

  const devices = await getUserDevices(user.id);
  if (!devices || devices.length === 0)
    throw new Error("No registered devices");

  // Build APNs provider once
  const { authKey } = await getCertFiles();
  const provider = new apn.Provider({
    token: {
      key: authKey,
      keyId: process.env.APPLE_KEY_ID,
      teamId: process.env.APPLE_TEAM_ID,
    },
    production: true,
  });

  const note = new apn.Notification();
  note.pushType = "background";
  note.topic = process.env.APPLE_PASS_TYPE_IDENTIFIER;
  note.expiry = Math.floor(Date.now() / 1000) + 3600;

  const results = [];
  for (const d of devices) {
    if (!d.pushToken) continue;
    const result = await provider.send(note, d.pushToken);
    results.push(result);
  }

  provider.shutdown();
  return results;
}

module.exports = {
  hasApplePass,
  createApplePass,
  registerDevice,
  getUpdatedSerialNumbers,
  unregisterDevice,
  getUpdatedPass,
  sendPushUpdateByEmail,
};
