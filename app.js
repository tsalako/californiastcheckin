/*
 * Copyright 2022 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const express = require('express');
const bodyParser = require('body-parser');
const { GoogleAuth, OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { formatInTimeZone } = require('date-fns-tz');

const issuerId = '3388000000022959009';

const classSuffix = 'csd_staging';

const postpend = "_staging"

const classId = `${issuerId}.${classSuffix}${postpend}`;

const audience = '65103160055-ugejq1km2u3koba5977k35qjcgsc4nbi.apps.googleusercontent.com';

const baseUrl = 'https://walletobjects.googleapis.com/walletobjects/v1';

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

const walletClient = new GoogleAuth({
  credentials: credentials,
  scopes: 'https://www.googleapis.com/auth/wallet_object.issuer'
});

const authClient = new OAuth2Client();

async function hasPass(req, res) {
    const { email, idToken } = req.query;

  if (!email || !idToken) return res.status(400).send('Missing credentials');

  // Verify ID token
  try {
    const ticket = await authClient.verifyIdToken({
      idToken,
      audience: audience,
    });

    const payload = ticket.getPayload();
    if (payload.email !== email) return res.status(403).send('Email mismatch');
  } catch (err) {
    console.error('Invalid token:', err);
    return res.status(401).send('Invalid token');
  }

  // Check if pass exists
  const objectSuffix = `${email.replace(/[^\w.-]/g, '_')}`;
  let objectId = `${issuerId}.${classSuffix}.${objectSuffix}${postpend}`;
  console.log(`suffix ${objectSuffix}`)
  try {
    const response = await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: 'GET',
    });
    return res.status(200).json({ exists: true });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(200).json({ exists: false });
    }
    console.error('Check pass error:', err);
    res.status(500).send('Error checking pass');
  }
}

async function recordVisit(req, res) {
 const { email, idToken } = req.body;

  if (!email || !idToken) return res.status(400).send('Missing input');

  try {
    const ticket = await authClient.verifyIdToken({
      idToken,
      audience: audience,
    });

    const payload = ticket.getPayload();
    if (payload.email !== email) return res.status(403).send('Email mismatch');
  } catch (err) {
    console.error('Invalid token:', err);
    return res.status(401).send('Invalid token');
  }

  const objectSuffix = `${email.replace(/[^\w.-]/g, '_')}`;
  let objectId = `${issuerId}.${classSuffix}.${objectSuffix}${postpend}`;
  console.log(`suffix ${objectSuffix}`)

  try {
    const getResponse = await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: 'GET',
    });

    const lastVisitRow = getResponse.data.infoModuleData?.labelValueRows?.find(
      row => row.columns?.[0]?.label === "LastVisitTimestamp"
    );

    const now = new Date()
    const nowMillis = now.getTime();
    const cooldownMs = 5 * 60 * 1000;

    const lastVisitTime = parseInt(lastVisitRow?.columns?.[0]?.value || '0', 10);
    if (nowMillis - lastVisitTime < cooldownMs) {
      const remainingSeconds = Math.ceil((cooldownMs - (nowMillis - lastVisitTime)) / 1000);
      return res.status(429).json({
        message: `⏱ Please wait ${remainingSeconds} more seconds before recording again.`,
        remainingSeconds
      });
    }

    const currentPoints = getResponse.data.loyaltyPoints?.balance?.int || 0;

    const patchBody = {
      loyaltyPoints: { balance: { int: currentPoints + 1 } },
      secondaryLoyaltyPoints: {
        balance: { string: formatInTimeZone(now, 'America/Los_Angeles', 'iii PP p') }
      },
      infoModuleData: {
        labelValueRows: [
          {
            columns: [
              {
                label: "LastVisitTimestamp",
                value: nowMillis.toString()
              }
            ]
          }
        ]
      }
    };


    await walletClient.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: 'PATCH',
      data: patchBody,
    });

    res.status(200).send('Visit recorded');
  } catch (err) {
    console.error('Record visit error:', err);
    res.status(500).send('Failed to record visit');
  }
}

async function createPassClass(res) {
  let loyaltyClass = {
  "programName": "California St Dreaming",
  "programLogo": {
    'sourceUri': {
      'uri': 'https://i.pinimg.com/1200x/bd/b2/b1/bdb2b1d97a2d15377aea72591ad572be.jpg'
    },
    'contentDescription': {
      'defaultValue': {
        'language': 'en-US',
        'value': 'dreamy cloud'
      }
    }
  },
  "accountNameLabel": "Dreamer Name",
  "rewardsTierLabel": "Level",
  "rewardsTier": "Snoozer",

  //// DO FIRST
  // "classTemplateInfo": {
  //   object (ClassTemplateInfo)
  // },

  "id": `${classId}`,
  "issuerName": "Tofe Salako",

  /// DO SECOND? Should this be a the pass level. Maybe "patch" this.
  // "messages": [
  //   {
  //     object (Message)
  //   }
  // ],

  // "homepageUri": {
  //   object (Uri)
  // },

  "reviewStatus": "UNDER_REVIEW",

  // "imageModulesData": [
  //   {
  //     object (ImageModuleData)
  //   }
  // ],
  // "textModulesData": [
  //   {
  //     object (TextModuleData)
  //   }
  // ],

  "redemptionIssuers": [`${issuerId}`],
  "countryCode": "US",
  "heroImage": {
    'sourceUri': {
      'uri': 'https://miro.medium.com/v2/resize:fit:1340/format:webp/1*0-TueDWgLOWDsa9U1pBsbw.jpeg'
    },
    'contentDescription': {
      'defaultValue': {
        'language': 'en-US',
        'value': 'HERO_IMAGE_DESCRIPTION'
      }
    }
  },
  "enableSmartTap": true,
  "hexBackgroundColor": "#050505",
  // MAYBE RESTRICT TO `ONE_USER_ALL_DEVICES` depending on iOS restrictions
  "multipleDevicesAndHoldersAllowedStatus": "MULTIPLE_HOLDERS",
  // USE TO DO WORK ONCE THE PASS IS ADDED (INCREMENT BY 1 maybe)
  // "callbackOptions": {
  //   object (CallbackOptions)
  // },
  "viewUnlockRequirement": "UNLOCK_NOT_REQUIRED",
  // DONT NEED NOW, BUT WILL BE USEFUL WHEN THEY REACH A GOAL
  // "notifyPreference": enum (NotificationSettingsForUpdates),
};

let response;
try {
  // Check if the class exists already
  response = await walletClient.request({
    url: `${baseUrl}/loyaltyClass/${classId}`,
    method: 'GET'
  });


  console.log('Class already exists');
  console.log(response);
} catch (err) {
  if (err.response && err.response.status === 404) {
    // Class does not exist
    // Create it now
     response = await walletClient.request({
      url: `${baseUrl}/loyaltyClass`,
      method: 'POST',
      data: loyaltyClass
    });

    console.log('Class insert response');
    console.log(response);
  } else {
    // Something else went wrong
    console.log(err);
    res.send('Something went wrong...check the console logs!');
  }
}
}

async function createPassObject(req, res, classId) {
  const { name, email, idToken } = req.body;

  try {
    const ticket = await authClient.verifyIdToken({
      idToken,
      audience: audience
    });

    const payload = ticket.getPayload();
    const verifiedEmail = payload.email;

    if (verifiedEmail !== email) {
      return res.status(401).send('Email mismatch. Possible forgery attempt.');
    }
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).send('Invalid ID token');
  }


const objectSuffix = `${email.replace(/[^\w.-]/g, '_')}`;
let objectId = `${issuerId}.${classSuffix}.${objectSuffix}${postpend}`;
console.log(`suffix ${objectSuffix}`)

let loyaltyObject = {
  "accountName": `${name}`,
  "loyaltyPoints": {
    "label": "Visits",
    "balance": {
      "int": 0,
    },
  },
  "secondaryLoyaltyPoints": {
    "label": "Last Visit",
        "balance": {
          "string": 'N/A',
        },
      },
  'id': `${objectId}`,
  'classId': classId,
  "state": "ACTIVE",
  "smartTapRedemptionValue": `${email}`,
  "textModulesData": [
    {
      'id': 'og_status',
      'header': 'OG Status',
      'body': '👑'
    }
  ],
  "infoModuleData": {
    "labelValueRows": [
      {
        "columns" : [
          {
            "label": "LastVisitTimestamp",
            "value": "N/A",
          }
        ]
      }
    ]
  },
  "passConstraints": {
    "nfcConstraint": ["BLOCK_PAYMENT"]
  },
};

const claims = {
  iss: credentials.client_email,
  aud: 'google',
  origins: [],
  typ: 'savetowallet',
  payload: {
    loyaltyObjects: [
      loyaltyObject
    ]
  }
};

const token = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

res.send(`<a href='${saveUrl}'><img src='wallet-button.png'></a>`);
console.log('adding to screen');
}

const app = express();

app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static('public'));
app.get('/hasPass', async (req, res) => {
  await hasPass(req, res);
});
app.post('/', async (req, res) => {
  await createPassClass(res);
  await createPassObject(req, res, classId);
});
app.post('/recordVisit', async (req, res) => {
  await recordVisit(req, res);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});