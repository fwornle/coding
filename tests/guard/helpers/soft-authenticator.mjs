/**
 * A software WebAuthn authenticator for tests: ES256, attestation "none",
 * user-present + user-verified. It produces exactly the JSON a browser's
 * startRegistration()/startAuthentication() would, so the daemon's real
 * @simplewebauthn/server verification runs unmodified against it.
 *
 * Note what this does NOT show: that an agent could do the same. Enrolling
 * needs the approver token (host only) and, after the first factor, a proven
 * factor; an assertion needs the private key of an ENROLLED credential.
 */

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => createHash('sha256').update(data).digest();

/** Minimal CBOR: unsigned/negative ints, byte and text strings, maps. */
export function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === 'string') {
    const s = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  if (value && typeof value === 'object') return cbor(new Map(Object.entries(value)));
  throw new Error(`cbor: unsupported ${typeof value}`);
}

export class SoftAuthenticator {
  constructor({ rpId = 'localhost', origin } = {}) {
    this.rpId = rpId;
    this.origin = origin;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.jwk = publicKey.export({ format: 'jwk' });
    this.credId = randomBytes(16);
    this.count = 0;
  }

  #clientData(type, challenge) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  #authData(flags, extra = Buffer.alloc(0)) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.count);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, extra]);
  }

  /** What startRegistration() would return for these options. */
  register(options) {
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]]));
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credId.length);
    const attested = Buffer.concat([Buffer.alloc(16), len, this.credId, cose]);
    const authData = this.#authData(0x01 | 0x04 | 0x40, attested);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(this.#clientData('webauthn.create', options.challenge)),
        attestationObject: b64u(cbor({ fmt: 'none', attStmt: new Map(), authData })),
        transports: ['internal'],
      },
    };
  }

  /** What startAuthentication() would return for these options. */
  assert(options, { userVerified = true } = {}) {
    this.count += 1;
    const clientData = this.#clientData('webauthn.get', options.challenge);
    const authData = this.#authData(0x01 | (userVerified ? 0x04 : 0));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
    };
  }
}
