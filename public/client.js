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
export const _fetch = async (path, payload = '') => {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (payload && !(payload instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(payload);
  }
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: headers,
    body: payload
  });
  if (res.status === 200) {
    // Server authentication succeeded
    return res.json();
  } else {
    // Server authentication failed
    const result = await res.json();
    throw result.error;
  }
};

// TODO (1): Register a credential using a fingerprint
// 1. Create `registerCredential() function
// 2. Feature detection
// 3. Is User Verifying Platform Authenticator available?
// 4. Obtain the challenge and other options from server endpoint: `/auth/registerRequest`
// 5. Create a credential
// 6. Register the credential to the server endpoint: `/auth/registerResponse`

// TODO(3): Authenticate the user with a fingerprint
// 1. Create `authetnicate()` function
// 2. Feature detection and User Verifying Platform Authenticator check
// 3. Obtain the challenge and other options from server
// 4. Locally verify the user and get a credential
// 5. Assert the credential on the server
