// Add to app.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const {
  hasGooglePass,
  createGooglePass,
  updatePassObject,
  createPassClass
} = require('./utils/googleWallet');

const {
  hasApplePass,
  createApplePass
} = require('./utils/appleWallet');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index', {
    googleClientId: process.env.GCP_PROJECT_ID
  });
});

app.get('/hasPass', async (req, res) => {
  const { email, idToken, platform } = req.query;
  try {
    const exists = platform === 'apple'
      ? await hasApplePass(email)
      : await hasGooglePass(email, idToken);
    res.json({ exists });
  } catch (err) {
    console.error('hasPass error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/create-pass', async (req, res) => {
  const { email, name, idToken, platform } = req.body;
  try {
    if (platform === 'apple') {
      const {pkpass, url } = await createApplePass(email, name, false);
      res.json({ url });
    } else {
      await createPassClass();
      const button = await createGooglePass(email, name, idToken);
      res.json({ button });
    }
  } catch (err) {
    console.error('create-pass error:', err);
    res.status(500).json({ error: 'Failed to create pass' });
  }
});

app.post('/record-visit', async (req, res) => {
  const { email, idToken, platform, name } = req.body;
  try {
    if (platform === 'apple') {
      const { updatedPkpass, url } = await createApplePass(email, name, true);
      res.json({ url });
    } else {
      try {
        await updatePassObject(email);
        res.status(200).json({ message: 'Visit recorded' });
      } catch (err) {
        if (err.statusCode === 429) {
          res.status(429).json({ message: err.message, remainingSeconds: err.remainingSeconds });
        } else {
          console.error('Update error:', err);
          res.status(500).json({ message: 'Failed to record visit' });
        }
      }
    }
  } catch (err) {
    console.error('record-visit error:', err);
    const code = err.statusCode || 500;
    res.status(code).json({ message: err.message || 'Visit failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});