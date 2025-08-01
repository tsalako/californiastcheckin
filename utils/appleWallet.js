const { Storage } = require('@google-cloud/storage');
const tmp = require('tmp-promise');
const fs = require('fs/promises');
const path = require('path');
const { PKPass } = require('passkit-generator');
const { formatInTimeZone } = require('date-fns-tz');
require('dotenv').config();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const storage = new Storage({ credentials });

const metaDir = 'meta';
const certDir = 'apple';
const passOutputDir = 'apple/passes';

const ENVIRONMENT = process.env.NODE_ENV || 'development';
const isProduction = ENVIRONMENT === 'production';
const visitThrottleEnabled = isProduction

function getObjectInfo(email) {
  const objectSuffix = email.replace(/[^\w-]/g, '_').replace(/\./g, '_');
  return {
    objectSuffix,
    passFile: `${passOutputDir}/${objectSuffix}.pkpass`,
    metaFile: `${metaDir}/${objectSuffix}.json`
  };
}

async function readJsonFromGCS(filename) {
  const file = storage.bucket(BUCKET_NAME).file(filename);
  const contents = await file.download();
  return JSON.parse(contents.toString());
}

async function getCertFiles() {
  const certFile = storage.bucket(BUCKET_NAME).file(`${certDir}/cert.pem`);
  const keyFile = storage.bucket(BUCKET_NAME).file(`${certDir}/key.pem`);
  const wwdrFile = storage.bucket(BUCKET_NAME).file(`${certDir}/AppleWWDR.pem`);

  const [cert, key, wwdr] = await Promise.all([
    certFile.download(),
    keyFile.download(),
    wwdrFile.download()
  ]);

  return {
    cert: cert.toString(),
    key: key.toString(),
    wwdr: wwdr.toString()
  };
}

function areSameDayPST(ms1, ms2) {
  const date1 = new Date(ms1);
  const date2 = new Date(ms2);

  // Create DateTimeFormat objects for "America/Los_Angeles" (PST/PDT)
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  // Extract the formatted date strings for comparison
  const formattedDate1 = formatter.format(date1);
  const formattedDate2 = formatter.format(date2);

  return formattedDate1 === formattedDate2;
}

async function createApplePass(email, name, isUpdate = false) {
  const { cert, key, wwdr } = await getCertFiles();
  const { objectSuffix, passFile, metaFile } = getObjectInfo(email);

  let metadata;
  try {
    metadata = await readJsonFromGCS(metaFile);
  } catch (e) {
    metadata = {};
  }

  const now = new Date();
  const nowFormatted = formatInTimeZone(now, 'America/Los_Angeles', 'iii PP p');
  const nowMillis = now.getTime();

  const visitField = metadata.auxiliaryFields?.find(f => f.key === 'visits');
  const visitCount = (parseInt(visitField?.value || 0) + 1);

  if (!isUpdate) {
    metadata.serialNumber = objectSuffix;
    // These fields are not actually set through "metadata" they are manually
    // added to the pass after creation.
    metadata.auxiliaryFields = [
            { key: 'visits', label: 'Visits', value: `${visitCount}` },
            { key: 'lastvisit', label: 'Last Visit', value: nowFormatted }
        ];
    metadata.backFields = [
            { key: 'name_back', label: 'Dreamer Name', value: name },
            { key: 'level_back', label: 'Level', value: 'Snoozer' },
            { key: 'visits_back', label: 'Visits', value: `${visitCount}` },
            { key: 'lastvisit_back', label: 'Last Visit', value: nowFormatted },
            { key: 'lastvisittimestamp_back', label: 'LastVisitTimestamp', value: nowMillis.toString() }
        ];
  } else {
  const lastVisitTimestampBackField = metadata.backFields?.find(f => f.key === 'lastvisittimestamp_back');
  const lastVisitTime = parseInt(lastVisitTimestampBackField?.value || '0', 10);
    
  if (visitThrottleEnabled && !isNaN(lastVisitTime) && areSameDayPST(nowMillis, lastVisitTime)) {
     throw new Error("Already checked in today.");
  }

    if (visitField) visitField.value = visitCount;

    const lastVisitField = metadata.auxiliaryFields?.find(f => f.key === 'lastvisit');
    if (lastVisitField) lastVisitField.value = nowFormatted;

    const visitBackField = metadata.backFields?.find(f => f.key === 'visits_back');
    if (visitBackField) visitBackField.value = visitCount;

    const lastVisitBackField = metadata.backFields?.find(f => f.key === 'lastvisit_back');
    if (lastVisitBackField) lastVisitBackField.value = nowFormatted;

    if (lastVisitTimestampBackField) lastVisitTimestampBackField.value = nowMillis.toString();
  }

  const pass = await PKPass.from({
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

    pass.auxiliaryFields.push.apply(pass.auxiliaryFields, metadata.auxiliaryFields);
    pass.backFields.push.apply(pass.backFields, metadata.backFields);

  const streamBuffer = pass.getAsStream();

  const file = storage.bucket(BUCKET_NAME).file(passFile);
  const uploadStream = file.createWriteStream({
    metadata: { contentType: 'application/vnd.apple.pkpass' },
    resumable: false
  });

  await new Promise((resolve, reject) => {
    streamBuffer.pipe(uploadStream)
      .on('error', reject)
      .on('finish', resolve);
  });

  await storage
    .bucket(BUCKET_NAME)
    .file(metaFile)
    .save(JSON.stringify(metadata), {
        contentType: 'application/json',
        resumable: false,
    });

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: 'attachment; filename="pass.pkpass"',
  });

  const [raw] = await file.download();
  const base64 = raw.toString('base64');

  return { pkpass: base64, url };
}

async function hasApplePass(email) {
  const { passFile } = getObjectInfo(email);
  const [exists] = await storage.bucket(BUCKET_NAME).file(passFile).exists();
  return exists;
}

module.exports = { createApplePass, hasApplePass };