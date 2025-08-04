const { Storage } = require("@google-cloud/storage");
const tmp = require("tmp-promise");
const fs = require("fs/promises");
const path = require("path");
const { PKPass } = require("passkit-generator");
const { formatInTimeZone } = require("date-fns-tz");
const crypto = require("crypto");
const apn = require("apn");
require("dotenv").config();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const storage = new Storage({ credentials });

const metaDir = "meta";
const certDir = "apple";
const passOutputDir = "apple/passes";

const ENVIRONMENT = process.env.NODE_ENV || "development";
const isProduction = ENVIRONMENT === "production";
const ENV_SUFFIX = isProduction ? "" : "_staging";
const visitThrottleEnabled = isProduction;

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
    metaFile: `${metaDir}/${serialNumber}.json`,
    updatesFile: `${certDir}/updates${ENV_SUFFIX}.json`,
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

function areSameDayPST(ms1, ms2) {
  const date1 = new Date(ms1);
  const date2 = new Date(ms2);

  // Create DateTimeFormat objects for "America/Los_Angeles" (PST/PDT)
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  // Extract the formatted date strings for comparison
  const formattedDate1 = formatter.format(date1);
  const formattedDate2 = formatter.format(date2);

  return formattedDate1 === formattedDate2;
}

async function createApplePass(email, name, isUpdate = false) {
  console.log(`createApplePass - isUpdate: ${isUpdate}`);

  const { serialNumber, passFile, metaFile, updatesFile } =
    getObjectInfo(email);

  console.time("certs and metadata");
  const [{ cert, key, wwdr }, updates, metadata] = await Promise.all([
    getCertFiles(),
    readJsonFromGCS(updatesFile).catch(() => ({})),
    readJsonFromGCS(metaFile).catch(() => ({})),
  ]);
  console.timeEnd("certs and metadata");

  const now = new Date();
  const nowFormatted = formatInTimeZone(now, "America/Los_Angeles", "iii PP p");
  const nowMillis = now.getTime();

  const visitTimestamps = Array.isArray(metadata.visitTimestamps)
    ? metadata.visitTimestamps
    : [];
  const lastTimestamp = visitTimestamps[visitTimestamps.length - 1] || 0;

  if (
    visitThrottleEnabled &&
    !isNaN(lastTimestamp) &&
    areSameDayPST(nowMillis, lastTimestamp)
  ) {
    console.log(`${name} attempted to check in more than once.`);
    throw new Error("You've already checked in today.");
  }
  visitTimestamps.push(nowMillis);

  metadata.visitTimestamps = visitTimestamps;
  if (!isUpdate) {
    metadata.name = name;
    metadata.email = email;
    metadata.serialNumber = serialNumber;
    metadata.authenticationToken = generateAuthToken();
    metadata.passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER;
    metadata.teamIdentifier = process.env.APPLE_TEAM_ID;
  } else if (!metadata.authenticationToken) {
    metadata.name = name;
    metadata.email = email;

    // To help with existing passes that were made before push notifications were created.
    metadata.authenticationToken = generateAuthToken();
    metadata.passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER;
    metadata.teamIdentifier = process.env.APPLE_TEAM_ID;
  }

  if (!updates.updates) updates.updates = [];
  const entry = {};
  entry.serialNumber = serialNumber;
  entry.updateTime = nowMillis;
  entry.isUpdate = isUpdate;
  entry.devices = metadata.devices || []; // may not work depending on when the device is registered.
  updates.updates.push(entry);

  const hasRegisteredDevice = metadata.devices != null;

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

  pass.auxiliaryFields.push(
    {
      key: "visits",
      label: "Visits",
      value: visitTimestamps.length.toString(),
    },
    { key: "lastvisit", label: "Last Visit", value: nowFormatted }
  );
  pass.backFields.push(
    { key: "name_back", label: "Dreamer Name", value: name },
    { key: "level_back", label: "Level", value: "Snoozer" },
    {
      key: "visits_back",
      label: "Visits",
      value: visitTimestamps.length.toString(),
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

  console.time("write pass, metadata, and updates to GCS");
  await Promise.all([
    new Promise((resolve, reject) => {
      streamBuffer.pipe(uploadStream).on("error", reject).on("finish", resolve);
    }),
    storage.bucket(BUCKET_NAME).file(metaFile).save(JSON.stringify(metadata), {
      contentType: "application/json",
      resumable: false,
    }),
    storage
      .bucket(BUCKET_NAME)
      .file(updatesFile)
      .save(JSON.stringify(updates), {
        contentType: "application/json",
        resumable: false,
      }),
  ]);
  console.timeEnd("write pass, metadata, and updates to GCS");

  console.time("getSignedUrl");
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: 'attachment; filename="pass.pkpass"',
  });
  console.timeEnd("getSignedUrl");

  return { url, hasRegisteredDevice };
}

async function hasApplePass(email) {
  const { passFile } = getObjectInfo(email);
  const [exists] = await storage.bucket(BUCKET_NAME).file(passFile).exists();
  return exists;
}

async function registerDevice(
  serialNumber,
  deviceLibraryIdentifier,
  pushToken
) {
  console.log("registerDevice");
  const { metaFile } = getObjectInfoFromSN(serialNumber);

  console.time("metadata");
  const metadata = await readJsonFromGCS(metaFile).catch(() => ({}));
  console.timeEnd("metadata");

  if (!metadata.devices) metadata.devices = [];

  const alreadyRegistered = metadata.devices.some(
    (d) => d.deviceLibraryIdentifier === deviceLibraryIdentifier
  );

  if (alreadyRegistered) {
    return false;
  }
  metadata.devices.push({ deviceLibraryIdentifier, pushToken });

  console.time("write metadata to GCS");
  await storage
    .bucket(BUCKET_NAME)
    .file(metaFile)
    .save(JSON.stringify(metadata), {
      contentType: "application/json",
      resumable: false,
    });
  console.timeEnd("write metadata to GCS");
  return true;
}

async function getUpdatedSerialNumbers(deviceLibraryIdentifier, updatedSince) {
  console.log("getUpdatedSerialNumbers");
  // this is a hack, it should be removed.
  const { updatesFile } = getObjectInfoFromSN("");

  console.time("updates");
  const updates = await readJsonFromGCS(updatesFile).catch(() => ({}));
  console.timeEnd("updates");

  const updateSinceTime = new Date(parseInt(updatedSince, 10) || 0);
    console.time("filter");
  const updatesSince = updates.updates.filter(
    (e) =>
      e.isUpdate &&
      new Date(e.updateTime) > updateSinceTime &&
      e.devices.some(
        (d) => d.deviceLibraryIdentifier === deviceLibraryIdentifier
      )
  );
    console.timeEnd("filter");
  if (updateSince.length == 0) throw new Error("nothing found");

  const serials = updatesSince.map((e) => e.serialNumber);
  const lastUpdate = updatesSince[updatesSince.length - 1].nowMillis.toString();

  return {
    serialNumbers: serials,
    lastUpdated: lastUpdate,
  };
}

async function unregisterDevice(serialNumber, deviceLibraryIdentifier) {
  console.log("unregisterDevice");
  const { metaFile } = getObjectInfoFromSN(serialNumber);

  console.time("metadata");
  const metadata = await readJsonFromGCS(metaFile).catch(() => ({}));
  console.timeEnd("metadata");

  if (!metadata.devices) return;

  metadata.devices = metadata.devices.filter(
    (d) => d.deviceLibraryIdentifier !== deviceLibraryIdentifier
  );

  console.time("write metadata to GCS");
  await storage
    .bucket(BUCKET_NAME)
    .file(metaFile)
    .save(JSON.stringify(metadata), {
      contentType: "application/json",
      resumable: false,
    });
  console.timeEnd("write metadata to GCS");
}

async function getUpdatedPass(serialNumber, authHeader) {
   console.log("getUpdatedPass");
  const { passFile, metaFile } = getObjectInfoFromSN(serialNumber);

  console.time("pass and metadata");
  const [pass, metadata] = await Promise.all([
    storage
      .bucket(BUCKET_NAME)
      .file(passFile)
      .download()
      .catch(() => null),
    readJsonFromGCS(metaFile).catch(() => ({})),
  ]);
  console.timeEnd("pass and metadata");

  if (!pass) throw new Error("No updated pass found.");

  if (
    !metadata ||
    !metadata.authenticationToken ||
    authHeader !== `ApplePass ${metadata.authenticationToken}`
  ) {
    throw new Error("No authentication.");
  }

  return pass;
}

async function sendPushUpdateByEmail(email) {
  console.log("sendPushUpdateByEmail");
  const { metaFile } = getObjectInfo(email);

  console.time("metadata");
  const metadata = await readJsonFromGCS(metaFile).catch(() => ({}));
  console.timeEnd("metadata");
  const devices = metadata.devices;

  if (!devices || devices.length === 0)
    throw new Error("No registered devices");

  const { authKey } = getCertFiles();
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
  for (const { pushToken } of devices) {
    const result = await provider.send(note, pushToken);
    results.push(result);
  }

  provider.shutdown();
  return results;
}

module.exports = {
  createApplePass,
  hasApplePass,
  registerDevice,
  getUpdatedSerialNumbers,
  unregisterDevice,
  getUpdatedPass,
  sendPushUpdateByEmail,
};
