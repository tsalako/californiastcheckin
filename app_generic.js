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
const { GoogleAuth } = require('google-auth-library');
const jwt = require('jsonwebtoken');

// TODO: Define Issuer ID
const issuerId = '3388000000022959009';

// TODO: Define Class ID
const classId = `${issuerId}.codelab_class_2`;

const baseUrl = 'https://walletobjects.googleapis.com/walletobjects/v1';

const credentials = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);

const httpClient = new GoogleAuth({
  credentials: credentials,
  scopes: 'https://www.googleapis.com/auth/wallet_object.issuer'
});

/**
 * Creates a sample pass class based on the template defined below.
 * 
 * This class contains multiple editable fields that showcase how to 
 * customize your class.
 * 
 * @param res A representation of the HTTP result in Express.
 */
async function createPassClass(res) {
  let genericClass = {
  'id': `${classId}`,
   'classTemplateInfo': {
    'cardTemplateOverride': {
      'cardRowTemplateInfos': [
        {
          'twoItems': {
            'startItem': {
              'firstValue': {
                'fields': [
                  {
                    'fieldPath': 'object.textModulesData["visits"]'
                  }
                ]
              }
            },
            'endItem': {
              'firstValue': {
                'fields': [
                  {
                    'fieldPath': 'object.textModulesData["last_visit"]'
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
};

let response;
try {
  // Check if the class exists already
  response = await httpClient.request({
    url: `${baseUrl}/genericClass/${classId}`,
    method: 'GET'
  });

  console.log('Class already exists');
  console.log(response);
} catch (err) {
  if (err.response && err.response.status === 404) {
    // Class does not exist
    // Create it now
    response = await httpClient.request({
      url: `${baseUrl}/genericClass`,
      method: 'POST',
      data: genericClass
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

/**
 * Creates a sample pass object based on a given class.
 * 
 * @param req A representation of the HTTP request in Express.
 * @param res A representation of the HTTP result in Express.
 * @param classId The identifier of the parent class used to create the object.
 */
async function createPassObject(req, res, classId) {
  // TODO: Create a new Generic pass for the user
let objectSuffix = `${req.body.email.replace(/[^\w.-]/g, '_')}`;
let objectId = `${issuerId}.${objectSuffix}`;

let genericObject = {
  'id': `${objectId}`,
  'classId': classId,
  'logo': {
    'sourceUri': {
      'uri': 'https://i.pinimg.com/1200x/bd/b2/b1/bdb2b1d97a2d15377aea72591ad572be.jpg'
    },
    'contentDescription': {
      'defaultValue': {
        'language': 'en-US',
        'value': 'LOGO_IMAGE_DESCRIPTION'
      }
    }
  },
  'cardTitle': {
    'defaultValue': {
      'language': 'en-US',
      'value': 'California St. Dreamer'
    }
  },
  'subheader': {
    'defaultValue': {
      'language': 'en-US',
      'value': 'Snoozer'
    }
  },
  'header': {
    'defaultValue': {
      'language': 'en-US',
      'value': 'Alexander Hamilton'
    }
  },
  'textModulesData': [
    {
      'id': 'visits',
      'header': 'Visits',
      'body': '15'
    },
    {
      'id': 'last_visit',
      'header': 'Last Visit',
      'body': 'July 28, 2025'
    }
  ],
  'barcode': null,
  'hexBackgroundColor': '#050505',
  'heroImage': {
    'sourceUri': {
      'uri': 'https://miro.medium.com/v2/resize:fit:1340/format:webp/1*0-TueDWgLOWDsa9U1pBsbw.jpeg'
    },
    'contentDescription': {
      'defaultValue': {
        'language': 'en-US',
        'value': 'HERO_IMAGE_DESCRIPTION'
      }
    }
  }
};

// TODO: Create the signed JWT and link
const claims = {
  iss: credentials.client_email,
  aud: 'google',
  origins: [],
  typ: 'savetowallet',
  payload: {
    genericObjects: [
      genericObject
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
app.listen(3000);