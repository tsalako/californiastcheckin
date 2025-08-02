const { Storage } = require("@google-cloud/storage");
const tmp = require("tmp-promise");
const fs = require("fs/promises");
const path = require("path");
const { PKPass } = require("passkit-generator");
const { formatInTimeZone } = require("date-fns-tz");
require("dotenv").config();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const storage = new Storage({ credentials });

const metaDir = "meta";
const certDir = "apple";
const passOutputDir = "apple/passes";

const ENVIRONMENT = process.env.NODE_ENV || "development";
const isProduction = ENVIRONMENT === "production";
const visitThrottleEnabled =
  process.env.APPLE_THROTTLE_OVERRIDE === "true" || isProduction;

function getObjectInfo(email) {
  const objectSuffix = email.replace(/[^\w-]/g, "_").replace(/\./g, "_");
  return {
    objectSuffix,
    passFile: `${passOutputDir}/${objectSuffix}.pkpass`,
    metaFile: `${metaDir}/${objectSuffix}.json`,
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

  const [cert, key, wwdr] = await Promise.all([
    certFile.download(),
    keyFile.download(),
    wwdrFile.download(),
  ]);

  cachedCerts = {
    cert: cert.toString(),
    key: key.toString(),
    wwdr: wwdr.toString(),
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

  const { objectSuffix, passFile, metaFile } = getObjectInfo(email);

  console.time("certs and metadata");
  const [{ cert, key, wwdr }, metadata] = await Promise.all([
    getCertFiles(),
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

  if (!isUpdate) metadata.serialNumber = objectSuffix;
  metadata.visitTimestamps = visitTimestamps;

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

  console.time("write pass and metadata to GCS");
  await Promise.all([
    new Promise((resolve, reject) => {
      streamBuffer.pipe(uploadStream).on("error", reject).on("finish", resolve);
    }),
    storage.bucket(BUCKET_NAME).file(metaFile).save(JSON.stringify(metadata), {
      contentType: "application/json",
      resumable: false,
    }),
  ]);
  console.timeEnd("write pass and metadata to GCS");

  console.time("getSignedUrl");
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: 'attachment; filename="pass.pkpass"',
  });
  console.timeEnd("getSignedUrl");

  return url;
}

async function hasApplePass(email) {
  const { passFile } = getObjectInfo(email);
  const [exists] = await storage.bucket(BUCKET_NAME).file(passFile).exists();
  return exists;
}

module.exports = { createApplePass, hasApplePass };
