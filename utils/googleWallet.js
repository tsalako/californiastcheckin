// utils/googleWallet.js
const { GoogleAuth, OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { formatInTimeZone } = require('date-fns-tz');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const isProduction = ENVIRONMENT === 'production';
const ENV_SUFFIX = isProduction ? '' : '_staging';
const classSuffix = `csd${ENV_SUFFIX}`;
const postpend = process.env.GOOGLE_WALLET_POSTPEND || ENV_SUFFIX;
const classId = `${issuerId}.${classSuffix}`;

const audience = process.env.GOOGLE_CLIENT_ID;
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

const authClient = new OAuth2Client();
const walletClient = new GoogleAuth({
  credentials,
  scopes: 'https://www.googleapis.com/auth/wallet_object.issuer'
});

const storage = new Storage({ credentials });
const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const metaDir = 'meta';
const visitThrottleEnabled = isProduction;

function getObjectInfo(email) {
  const objectSuffix = email.replace(/[^\w-]/g, '_').replace(/\./g, '_');
  const objectId = `${issuerId}.${classSuffix}.${objectSuffix}${postpend}`;
  return {
    objectSuffix,
    objectId,
    metaFile: `${metaDir}/${objectSuffix}.json`
  };
}

async function readJsonFromGCS(filename) {
  const file = storage.bucket(BUCKET_NAME).file(filename);
  const contents = await file.download();
  return JSON.parse(contents.toString());
}

async function writeJsonToGCS(filename, data) {
  const file = storage.bucket(BUCKET_NAME).file(filename);
  await file.save(JSON.stringify(data), {
    contentType: 'application/json',
    resumable: false
  });
}

function areSameDayPST(ms1, ms2) {
  const date1 = new Date(ms1);
  const date2 = new Date(ms2);
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  return formatter.format(date1) === formatter.format(date2);
}

async function hasGooglePass(email) {
  const { objectId } = getObjectInfo(email);
  try {
    await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: 'GET'
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404) return false;
    throw err;
  }
}

async function createGooglePass(email, name) {
  const { objectId, metaFile } = getObjectInfo(email);
  let metadata = {};
  try {
    metadata = await readJsonFromGCS(metaFile);
  } catch (e) {
    metadata = {};
  }

  const now = new Date();
  const nowMillis = now.getTime();
  const nowFormatted = formatInTimeZone(now, 'America/Los_Angeles', 'iii PP p');

  const visitTimestamps = Array.isArray(metadata.visitTimestamps) ? metadata.visitTimestamps : [];
  visitTimestamps.push(nowMillis);
  metadata.visitTimestamps = visitTimestamps;

  await writeJsonToGCS(metaFile, metadata);

  const loyaltyObject = {
    accountName: name,
    loyaltyPoints: { label: 'Visits', balance: { int: visitTimestamps.length } },
    secondaryLoyaltyPoints: { label: 'Last Visit', balance: { string: nowFormatted } },
    id: objectId,
    classId,
    state: 'ACTIVE',
    smartTapRedemptionValue: email,
    // textModulesData: [{ id: 'og_status', header: 'OG Status', body: '👑' }],
    infoModuleData: {
      labelValueRows: [{ columns: [{ label: 'LastVisitTimestamp', value: nowMillis.toString() }] }]
    },
    passConstraints: { nfcConstraint: ['BLOCK_PAYMENT'] }
  };

  const claims = {
    iss: credentials.client_email,
    aud: 'google',
    typ: 'savetowallet',
    payload: { loyaltyObjects: [loyaltyObject] }
  };

  const token = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

async function updatePassObject(email, name) {
  const { objectId, metaFile } = getObjectInfo(email);
  let metadata = await readJsonFromGCS(metaFile);

  const now = new Date();
  const nowMillis = now.getTime();
  const nowFormatted = formatInTimeZone(now, 'America/Los_Angeles', 'iii PP p');

  const visitTimestamps = Array.isArray(metadata.visitTimestamps) ? metadata.visitTimestamps : [];
  const lastTimestamp = visitTimestamps[visitTimestamps.length - 1] || 0;

  if (visitThrottleEnabled && !isNaN(lastTimestamp) && areSameDayPST(nowMillis, lastTimestamp)) {
    console.log(`${name} attempted to check in more than once.`);
    throw new Error("You've already checked in today.");
  }

  visitTimestamps.push(nowMillis);
  metadata.visitTimestamps = visitTimestamps;
  await writeJsonToGCS(metaFile, metadata);

  const patchBody = {
    loyaltyPoints: { balance: { int: visitTimestamps.length } },
    secondaryLoyaltyPoints: { balance: { string: nowFormatted } },
    infoModuleData: {
      labelValueRows: [
        { columns: [{ label: "LastVisitTimestamp", value: nowMillis.toString() }] }
      ]
    }
  };

  await walletClient.request({
    url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
    method: 'PATCH',
    data: patchBody
  });
}

async function createPassClass() {
  const loyaltyClass = {
    programName: "California St Dreaming",
    programLogo: {
      sourceUri: {
        uri: "https://i.pinimg.com/1200x/bd/b2/b1/bdb2b1d97a2d15377aea72591ad572be.jpg"
      },
      contentDescription: { defaultValue: { language: "en-US", value: "dreamy cloud" } }
    },
    accountNameLabel: "Dreamer Name",
    rewardsTierLabel: "Level",
    rewardsTier: "Snoozer",
    id: classId,
    issuerName: "CSD Pass",
    reviewStatus: "UNDER_REVIEW",
    redemptionIssuers: [issuerId],
    countryCode: "US",
    heroImage: {
      sourceUri: {
        uri: "https://miro.medium.com/v2/resize:fit:1340/format:webp/1*0-TueDWgLOWDsa9U1pBsbw.jpeg"
      },
      contentDescription: { defaultValue: { language: "en-US", value: "HERO_IMAGE_DESCRIPTION" } }
    },
    enableSmartTap: true,
    hexBackgroundColor: "#050505",
    multipleDevicesAndHoldersAllowedStatus: "MULTIPLE_HOLDERS",
    viewUnlockRequirement: "UNLOCK_NOT_REQUIRED"
  };

  try {
    await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`,
      method: 'GET'
    });
    console.log("Class already exists");
  } catch (err) {
    if (err.response?.status === 404) {
      await walletClient.request({
        url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass`,
        method: 'POST',
        data: loyaltyClass
      });
    } else {
      throw err;
    }
  }
}

module.exports = {
  hasGooglePass,
  createGooglePass,
  updatePassObject,
  createPassClass
};
