/*
 * @license
 * Copyright 2019 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License
 */
import express from 'express';
const router = express.Router();
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node'

const adapter = new JSONFile('.data/db.json');
const db = new Low(adapter);
await db.read();

db.data ||= { users: [], credentials: [] };

router.use(express.json());

const RP_NAME = 'WebAuthn Codelab';
const TIMEOUT = 30 * 1000 * 60;

const Users = {
  findById: (user_id) => {
    const user = db.data.users.find(user => user.id === user_id);
    return user;
  },

  findByUsername: (username) => {
    const user = db.data.users.find(user => user.username === username);
    return user;
  },

  update: async (user) => {
    let found = false;
    db.data.users = db.data.users.map(_user => {
      if (_user.id === user.id) {
        found = true;
        return user;
      } else {
        return _user;
      }
    });
    if (!found) {
      db.data.users.push(user);
    }
    return db.write();
  }
}

const csrfCheck = (req, res, next) => {
  if (req.header('X-Requested-With') != 'XMLHttpRequest') {
    res.status(400).json({ error: 'invalid access.' });
    return;
  }
  next();
};

/**
 * Checks CSRF protection using custom header `X-Requested-With`
 * If the session doesn't contain `signed-in`, consider the user is not authenticated.
 **/
const sessionCheck = (req, res, next) => {
  if (!req.session['signed-in']) {
    res.status(401).json({ error: 'not signed in.' });
    return;
  }
  next();
};

const getOrigin = (userAgent) => {
  let origin = process.env.ORIGIN;

  const appRe = /^[a-zA-z0-9_.]+/;
  const match = userAgent.match(appRe);
  if (match) {
    // Check if UserAgent comes from a supported Android app.
    if (process.env.ANDROID_PACKAGENAME && process.env.ANDROID_SHA256HASH) {
      const package_names = process.env.ANDROID_PACKAGENAME.split(",").map(name => name.trim());
      const hashes = process.env.ANDROID_SHA256HASH.split(",").map(hash => hash.trim());
      const appName = match[0];
      for (let i = 0; i < package_names.length; i++) {
        if (appName === package_names[i]) {
          // We recognize this app, so use the corresponding hash.
          const octArray = hashes[i].split(':').map((h) =>
            parseInt(h, 16),
          );
          const androidHash = isoBase64URL.fromBuffer(octArray);
          origin = `android:apk-key-hash:${androidHash}`;
          break;
        }
      }
    }
  }

  return origin;
}

/**
 * Check username, create a new account if it doesn't exist.
 * Set a `username` in the session.
 **/
router.post('/username', (req, res) => {
  const username = req.body.username;
  // Only check username, no need to check password as this is a mock
  if (!username || !/[a-zA-Z0-9-_]+/.test(username)) {
    return res.status(400).send({ error: 'Bad request' });
  } else {
    // See if account already exists
    let user = Users.findByUsername(username);
    // If user entry is not created yet, create one
    if (!user) {
      user = {
        username: username,
        id: isoBase64URL.fromBuffer(crypto.randomBytes(32)),
        credentials: [],
      };
      Users.update(user);
    }
    // Set username in the session
    req.session.username = username;
    console.log(req.session);
    // If sign-in succeeded, redirect to `/home`.
    return res.json(user);
  }
});

/**
 * Verifies user credential and let the user sign-in.
 * No preceding registration required.
 * This only checks if `username` is not empty string and ignores the password.
 **/
router.post('/password', (req, res) => {
  if (!req.body.password) {
    return res.status(401).json({ error: 'Enter at least one random letter.' });
  }
  const user = Users.findByUsername(req.session.username);

  if (!user) {
    return res.status(401).json({ error: 'Enter username first.' });
  }

  req.session['signed-in'] = 'yes';
  return res.json(user);
});

router.get('/signout', (req, res) => {
  // Remove the session
  req.session.destroy()
  // Redirect to `/`
  return res.redirect(307, '/');
});

/**
 * Returns a credential id
 * (This server only stores one key per username.)
 * Response format:
 * ```{
 *   username: String,
 *   credentials: [Credential]
 * }```

 Credential
 ```
 {
   credId: String,
   publicKey: String,
   aaguid: ??,
   prevCounter: Int
 };
 ```
 **/
router.post('/getKeys', csrfCheck, sessionCheck, (req, res) => {
  const user = Users.findByUsername(req.session.username);
  return res.json(user || {});
});

/**
 * Removes a credential id attached to the user
 * Responds with empty JSON `{}`
 **/
router.post('/removeKey', csrfCheck, sessionCheck, (req, res) => {
  const credId = req.query.credId;
  const username = req.session.username;
  const user = Users.findByUsername(username);

  const newCreds = user.credentials.filter((cred) => {
    // Leave credential ids that do not match
    return cred.credId !== credId;
  });

  user.credentials = newCreds;
  Users.update(user);

  return res.json({});
});

/**
 * Respond with required information to call navigator.credential.create()
 * Input is passed via `req.body` with similar format as output
 * Output format:
 * ```{
     rp: {
       id: String,
       name: String
     },
     user: {
       displayName: String,
       id: String,
       name: String
     },
     publicKeyCredParams: [{  // @herrjemand
       type: 'public-key', alg: -7
     }],
     timeout: Number,
     challenge: String,
     excludeCredentials: [{
       id: String,
       type: 'public-key',
       transports: [('ble'|'nfc'|'usb'|'internal'), ...]
     }, ...],
     authenticatorSelection: {
       authenticatorAttachment: ('platform'|'cross-platform'),
       requireResidentKey: Boolean,
       userVerification: ('required'|'preferred'|'discouraged')
     },
     attestation: ('none'|'indirect'|'direct')
 * }```
 **/
router.post('/registerRequest', csrfCheck, sessionCheck, async (req, res) => {
  const username = req.session.username;
  const user = Users.findByUsername(username);
  try {
    const excludeCredentials = [];
    if (user.credentials.length > 0) {
      for (let cred of user.credentials) {
        excludeCredentials.push({
          id: isoBase64URL.toBuffer(cred.credId),
          type: 'public-key',
          transports: [
            "usb",
            "nfc",
            "ble",
            "smart-card",
            "internal",
            "hybrid",
          ],
        });
      }
    }
    const pubKeyCredParams = [];
    // const params = [-7, -35, -36, -257, -258, -259, -37, -38, -39, -8];
    const params = [-7, -257];
    for (let param of params) {
      pubKeyCredParams.push({ type: 'public-key', alg: param });
    }
    const as = {}; // authenticatorSelection
    const aa = req.body.authenticatorSelection.authenticatorAttachment;
    const rr = req.body.authenticatorSelection.requireResidentKey;
    const uv = req.body.authenticatorSelection.userVerification;
    const cp = req.body.attestation; // attestationConveyancePreference
    let asFlag = false;
    let authenticatorSelection;
    let attestation = 'none';

    if (aa && (aa == 'platform' || aa == 'cross-platform')) {
      asFlag = true;
      as.authenticatorAttachment = aa;
    }
    if (rr && typeof rr == 'boolean') {
      asFlag = true;
      as.requireResidentKey = rr;
    }
    if (uv && (uv == 'required' || uv == 'preferred' || uv == 'discouraged')) {
      asFlag = true;
      as.userVerification = uv;
    }
    if (asFlag) {
      authenticatorSelection = as;
    }
    if (cp && (cp == 'none' || cp == 'indirect' || cp == 'direct')) {
      attestation = cp;
    }
    console.log(process.env.HOSTNAME);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: process.env.HOSTNAME,
      userID: user.id,
      userName: user.username,
      timeout: TIMEOUT,
      // Prompt users for additional information about the authenticator.
      attestationType: attestation,
      // Prevent users from re-registering existing authenticators
      excludeCredentials,
      authenticatorSelection,
    });

    req.session.challenge = options.challenge;

    // Temporary hack until SimpleWebAuthn supports `pubKeyCredParams`
    options.pubKeyCredParams = [];
    for (let param of params) {
      options.pubKeyCredParams.push({ type: 'public-key', alg: param });
    }

    return res.json(options);
  } catch (e) {
    return res.status(400).send({ error: e });
  }
});

/**
 * Register user credential.
 * Input format:
 * ```{
     id: String,
     type: 'public-key',
     rawId: String,
     response: {
       clientDataJSON: String,
       attestationObject: String,
       signature: String,
       userHandle: String
     }
 * }```
 **/
router.post('/registerResponse', csrfCheck, sessionCheck, async (req, res) => {
  const username = req.session.username;
  const expectedChallenge = req.session.challenge;
  const expectedOrigin = getOrigin(req.get('User-Agent'));
  const expectedRPID = process.env.HOSTNAME;
  const credId = req.body.id;
  const type = req.body.type;

  try {
    const { body } = req;

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
    });

    const { verified, registrationInfo } = verification;

    if (!verified) {
      throw new Error('User verification failed.');
    }

    const { credentialPublicKey, credentialID, counter } = registrationInfo;
    const base64PublicKey = isoBase64URL.fromBuffer(credentialPublicKey);
    const base64CredentialID = isoBase64URL.fromBuffer(credentialID);

    const user = Users.findByUsername(username);

    const existingCred = user.credentials.find(
      (cred) => cred.credID === base64CredentialID,
    );

    if (!existingCred) {
      /**
       * Add the returned device to the user's list of devices
       */
      user.credentials.push({
        publicKey: base64PublicKey,
        credId: base64CredentialID,
        prevCounter: counter,
      });
    }

    Users.update(user);

    delete req.session.challenge;

    // Respond with user info
    return res.json(user);
  } catch (e) {
    console.error(e);
    delete req.session.challenge;
    return res.status(400).send({ error: e.message });
  }
});

/**
 * Respond with required information to call navigator.credential.get()
 * Input is passed via `req.body` with similar format as output
 * Output format:
 * ```{
     challenge: String,
     userVerification: ('required'|'preferred'|'discouraged'),
     allowCredentials: [{
       id: String,
       type: 'public-key',
       transports: [('ble'|'nfc'|'usb'|'internal'), ...]
     }, ...]
 * }```
 **/
router.post('/signinRequest', csrfCheck, async (req, res) => {
  try {
    const user = Users.findByUsername(req.session.username);

    if (!user) {
      // Send empty response if user is not registered yet.
      res.json({ error: 'User not found.' });
      return;
    }

    const credId = req.query.credId;

    const userVerification = req.body.userVerification || 'required';

    const allowCredentials = [];
    for (let cred of user.credentials) {
      // `credId` is specified and matches
      if (credId && cred.credId == credId) {
        allowCredentials.push({
          id: isoBase64URL.toBuffer(cred.credId),
          type: 'public-key',
          transports: [
            "usb",
            "nfc",
            "ble",
            "smart-card",
            "hybrid",
            "internal"
          ],
        });
      }
    }

    const options = await generateAuthenticationOptions({
      timeout: TIMEOUT,
      rpID: process.env.HOSTNAME,
      allowCredentials,
      /**
       * This optional value controls whether or not the authenticator needs be able to uniquely
       * identify the user interacting with it (via built-in PIN pad, fingerprint scanner, etc...)
       */
      userVerification,
    });
    req.session.challenge = options.challenge;

    return res.json(options);
  } catch (e) {
    return res.status(400).json({ error: e });
  }
});

/**
 * Authenticate the user.
 * Input format:
 * ```{
     id: String,
     type: 'public-key',
     rawId: String,
     response: {
       clientDataJSON: String,
       authenticatorData: String,
       signature: String,
       userHandle: String
     }
 * }```
 **/
router.post('/signinResponse', csrfCheck, async (req, res) => {
  const { body } = req;
  const expectedChallenge = req.session.challenge;
  const expectedOrigin = getOrigin(req.get('User-Agent'));
  const expectedRPID = process.env.HOSTNAME;

  try {
    // Query the user
    const user = Users.findByUsername(req.session.username);

    let credential = user.credentials.find((cred) => cred.credId === req.body.id);
    if (!credential) {
      throw new Error('Authenticating credential not found.');
    }

    const authenticator = {};
    authenticator.credentialPublicKey = isoBase64URL.toBuffer(credential.publicKey);
    authenticator.credentialID = isoBase64URL.toBuffer(credential.credId);
    authenticator.counter = credential.prevCounter;

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      authenticator,
    });

    const { verified, authenticationInfo } = verification;

    if (!verified) {
      throw new Error('User verification failed.');
    }

    Users.update(user);

    delete req.session.challenge;
    req.session['signed-in'] = 'yes';

    return res.json(user);
  } catch (e) {
    console.error(e);
    delete req.session.challenge;

    return res.status(400).json({ error: e.message });
  }
});

export { router as auth };
