/**
 * Lightweight verification for FIDO MDS JWTs.
 *
 * Currently assumes `"alg": "ES256"` in the JWT header, it's what FIDO MDS uses. If this ever
 * needs to support more JWS algorithms, here's the list of them:
 *
 * https://www.rfc-editor.org/rfc/rfc7518.html#section-3.1
 *
 * (Pulled from https://www.rfc-editor.org/rfc/rfc7515#section-4.1.1)
 */
export declare function verifyJWT(jwt: string, leafCert: Uint8Array): Promise<boolean>;
