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
const { format } = require('date-fns');

const issuerId = '3388000000022959009';

const classSuffix = 'code_loyalty';

const postpend = ""

const classId = `${issuerId}.${classSuffix}${postpend}`;

const baseUrl = 'https://walletobjects.googleapis.com/walletobjects/v1';

const credentials = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);

const walletClient = new GoogleAuth({
  credentials: credentials,
  scopes: 'https://www.googleapis.com/auth/wallet_object.issuer'
});

const authClient = new OAuth2Client();

async function recordVisit(req) {
  const { email } = req.body;
  console.log(`recording visit for ${email}`);

  let objectSuffix = `${email.replace(/[^\w.-]/g, '_')}`;
  let objectId = `${issuerId}.${objectSuffix}${postpend}`;

  let response;

    // Check if the object exists
    try {
      response = await walletClient.request({
        url: `${baseUrl}/loyaltyObject/${objectId}`,
        method: 'GET'
      });

    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log(`Object ${objectId} not found!`);
        return;
      } else {
        // Something else went wrong...
        console.log(err);
        return;
      }
    }

     // Object exists
    let existingObject = response.data;
    let currentVisits = existingObject['loyaltyPoints']['balance']['int']

    let patchBody = {
      'loyaltyPoints': {
        'balance': {
          'int': currentVisits + 1
        }
      },
      "secondaryLoyaltyPoints": {
        "balance": {
          "string": `${format(new Date(), "iii PP p")}`,
        },
      },
    };

    response = await walletClient.request({
        url: `${baseUrl}/loyaltyObject/${objectId}`,
        method: 'PATCH',
        data: patchBody
      });

    console.log('Object patch response');
    console.log(response);
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
      audience: '65103160055-ugejq1km2u3koba5977k35qjcgsc4nbi.apps.googleusercontent.com' // from Google Cloud Console
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
let objectId = `${issuerId}.${objectSuffix}${postpend}`;
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
app.post('/', async (req, res) => {
  await createPassClass(res);
  await createPassObject(req, res, classId);
});
app.post('/recordVisit', async (req, res) => {
  await recordVisit(req);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});