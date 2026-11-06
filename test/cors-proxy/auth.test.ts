import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import nock from "nock";
import {
  AuthError,
  mintSessionToken,
  resetJwksCache,
  verifyAccessJwt,
  verifySessionToken,
  type AccessEnv,
  type SessionEnv,
} from "../../workers/cors-proxy/auth.ts";
import { handleActivities } from "../../workers/cors-proxy/routes.ts";
import type { GarminApi } from "../../src/garmin/index.ts";

const TEAM_DOMAIN = "test-team.cloudflareaccess.com";
const AUD = "test-aud";
const ALLOWED_EMAIL = "owner@example.com";
const SESSION_SECRET = "s".repeat(40);

const env: AccessEnv & SessionEnv = {
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ALLOWED_EMAIL,
  SESSION_SIGNING_SECRET: SESSION_SECRET,
};

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64json = (o: object) => base64Url(new TextEncoder().encode(JSON.stringify(o)));

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function publicJwk(publicKey: CryptoKey, kid: string) {
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as { kty: string; n: string; e: string };
  return { kid, kty: jwk.kty, n: jwk.n, e: jwk.e };
}

async function signJwt(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const headerB64 = b64json({ alg: "RS256", kid, typ: "JWT" });
  const payloadB64 = b64json(claims);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  return `${headerB64}.${payloadB64}.${base64Url(new Uint8Array(signature))}`;
}

function mockJwks(jwks: object) {
  nock(`https://${TEAM_DOMAIN}`).get("/cdn-cgi/access/certs").reply(200, jwks);
}

beforeEach(() => {
  resetJwksCache();
  nock.disableNetConnect();
});

afterEach(() => {
  assert.strictEqual(nock.isDone(), true);
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("verifyAccessJwt", () => {
  it("verifies a valid JWT and mints a session token for the verified email", async () => {
    const { publicKey, privateKey } = await generateRsaKeyPair();
    mockJwks({ keys: [await publicJwk(publicKey, "kid-a")] });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await signJwt(privateKey, "kid-a", { email: ALLOWED_EMAIL, aud: AUD, exp });

    const email = await verifyAccessJwt(jwt, env);
    assert.strictEqual(email, ALLOWED_EMAIL);

    const { token, expires_at } = await mintSessionToken(email, env);
    const payload = await verifySessionToken(token, env);
    assert.strictEqual(payload.sub, ALLOWED_EMAIL);
    assert.ok(new Date(expires_at).getTime() > Date.now());
  });

  it("rejects a JWT signed by a key other than the one published in the JWKS (forged signature)", async () => {
    const real = await generateRsaKeyPair();
    const attacker = await generateRsaKeyPair();
    // JWKS only publishes the real key under "kid-a", but the JWT is signed with the attacker's key.
    mockJwks({ keys: [await publicJwk(real.publicKey, "kid-a")] });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await signJwt(attacker.privateKey, "kid-a", { email: ALLOWED_EMAIL, aud: AUD, exp });

    await assert.rejects(verifyAccessJwt(jwt, env), (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /Invalid JWT signature/);
      return true;
    });
  });

  it("rejects a correctly-signed JWT with the wrong aud", async () => {
    const { publicKey, privateKey } = await generateRsaKeyPair();
    mockJwks({ keys: [await publicJwk(publicKey, "kid-a")] });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await signJwt(privateKey, "kid-a", { email: ALLOWED_EMAIL, aud: "some-other-app", exp });

    await assert.rejects(verifyAccessJwt(jwt, env), (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /aud mismatch/);
      return true;
    });
  });

  it("rejects a correctly-signed JWT for an email other than the one allowed owner", async () => {
    const { publicKey, privateKey } = await generateRsaKeyPair();
    mockJwks({ keys: [await publicJwk(publicKey, "kid-a")] });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await signJwt(privateKey, "kid-a", { email: "someone-else@example.com", aud: AUD, exp });

    await assert.rejects(verifyAccessJwt(jwt, env), (err) => {
      assert.ok(err instanceof AuthError);
      assert.match(err.message, /Email not allowed/);
      return true;
    });
  });
});

describe("expired session token on a data route", () => {
  it("rejects an expired session token on /api/garmin/activities with 401, before any Garmin call", async () => {
    // No nock interceptor is registered for Garmin here; if the session check didn't short-circuit
    // before any GarminApi call, nock.disableNetConnect() would make this test fail with a network error.
    const longPast = Date.now() - 2 * 3600 * 1000;
    const { token } = await mintSessionToken(ALLOWED_EMAIL, env, () => longPast);

    const request = new Request("https://w/api/garmin/activities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleActivities(request, env, null as unknown as GarminApi, new URL(request.url));
    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /expired/i);
  });
});
