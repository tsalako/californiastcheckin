// utils/googleWallet.js
const { GoogleAuth, OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const { formatInTimeZone } = require("date-fns-tz");
const { Storage } = require("@google-cloud/storage");

const { getLevelDetails } = require("./levelConfig.js");
const { getOrCreateUserByEmail } = require("../services/users");
const {
  visitsCount,
  alreadyCheckedInToday,
  recordVisit,
} = require("../services/checkins");
const { isProd } = require("../utils/env");

const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
const ENV_SUFFIX = isProd() ? "" : "_staging";
const classSuffix = `csd${ENV_SUFFIX}`;
const postpend = process.env.GOOGLE_WALLET_POSTPEND || "";
const classId = `${issuerId}.${classSuffix}`;

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

const walletClient = new GoogleAuth({
  credentials,
  scopes: "https://www.googleapis.com/auth/wallet_object.issuer",
});

function getObjectId(email) {
  const objectSuffix = email.replace(/[^\w-]/g, "_").replace(/\./g, "_");
  return `${issuerId}.${classSuffix}.${objectSuffix}${postpend}`;
}

async function hasGooglePass(email) {
  const objectId = getObjectId(email);
  try {
    await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: "GET",
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404) return false;
    throw err;
  }
}

async function createGooglePass(email, name) {
  console.log("createGooglePass");

  const objectId = getObjectId(email);

  console.time("create user");
  const user = await getOrCreateUserByEmail(email, name);
  console.timeEnd("create user");

  console.time("record visit");
  const visit = await recordVisit({ userId: user.id });
  console.timeEnd("record visit");

  console.time("get visit count");
  const countNow = await visitsCount(user.id);
  console.timeEnd("get visit count");

  const level = getLevelDetails(countNow);
  const nowFormatted = formatInTimeZone(
    visit.occurredAt,
    "America/Los_Angeles",
    "iii PP p"
  );

  const loyaltyObject = {
    accountName: name,
    loyaltyPoints: {
      label: "Visits",
      balance: { int: countNow },
    },
    secondaryLoyaltyPoints: {
      label: "Last Visit",
      balance: { string: nowFormatted },
    },
    id: objectId,
    classId,
    state: "ACTIVE",
    smartTapRedemptionValue: email,
    textModulesData: [{ id: "level", header: "Level", body: level.name }],
    passConstraints: { nfcConstraint: ["BLOCK_PAYMENT"] },
  };

  const claims = {
    iss: credentials.client_email,
    aud: "google",
    typ: "savetowallet",
    payload: { loyaltyObjects: [loyaltyObject] },
  };

  console.time("signPass");
  const token = jwt.sign(claims, credentials.private_key, {
    algorithm: "RS256",
  });
  console.timeEnd("signPass");
  return `https://pay.google.com/gp/v/save/${token}`;
}

async function updatePassObject(email, name) {
  console.log("updatePassObject");

  console.time("create user");
  const user = await getOrCreateUserByEmail(email, name);
  console.timeEnd("create user");

  const alreadyCheckedIn = await alreadyCheckedInToday(user.id);
  if (isProd() && alreadyCheckedIn) {
    throw new Error("You've already checked in today.");
  }

  console.time("record visit");
  const visit = await recordVisit({ userId: user.id });
  console.timeEnd("record visit");

  console.time("get visit count");
  const countNow = await visitsCount(user.id);
  console.timeEnd("get visit count");

  const level = getLevelDetails(countNow);
  const nowFormatted = formatInTimeZone(
    visit.occurredAt,
    "America/Los_Angeles",
    "iii PP p"
  );

  const patchBody = {
    loyaltyPoints: { balance: { int: countNow } },
    secondaryLoyaltyPoints: { balance: { string: nowFormatted } },
    textModulesData: [{ id: "level", header: "Level", body: level.name }],
  };

  console.time("patchPass");
  const objectId = getObjectId(email);
  await walletClient.request({
    url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
    method: "PATCH",
    data: patchBody,
  });
  console.timeEnd("patchPass");
  return user.id;
}

async function createPassClass() {
  // TODO: get images from GCS instead of random sites.
  const loyaltyClass = {
    programName: "California St Dreaming",
    programLogo: {
      sourceUri: {
        uri: "https://i.pinimg.com/1200x/bd/b2/b1/bdb2b1d97a2d15377aea72591ad572be.jpg",
      },
      contentDescription: {
        defaultValue: { language: "en-US", value: "dreamy cloud" },
      },
    },
    accountNameLabel: "Dreamer Name",
    // TODO: update class pass
    id: classId,
    issuerName: "CSD Pass",
    reviewStatus: "UNDER_REVIEW",
    redemptionIssuers: [issuerId],
    countryCode: "US",
    heroImage: {
      sourceUri: {
        uri: "https://miro.medium.com/v2/resize:fit:1340/format:webp/1*0-TueDWgLOWDsa9U1pBsbw.jpeg",
      },
      contentDescription: {
        defaultValue: { language: "en-US", value: "HERO_IMAGE_DESCRIPTION" },
      },
    },
    enableSmartTap: true,
    hexBackgroundColor: "#050505",
    multipleDevicesAndHoldersAllowedStatus: "MULTIPLE_HOLDERS",
    viewUnlockRequirement: "UNLOCK_NOT_REQUIRED",
  };

  try {
    await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`,
      method: "GET",
    });
    console.log("Class already exists");
  } catch (err) {
    if (err.response?.status === 404) {
      await walletClient.request({
        url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass`,
        method: "POST",
        data: loyaltyClass,
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
  createPassClass,
};
