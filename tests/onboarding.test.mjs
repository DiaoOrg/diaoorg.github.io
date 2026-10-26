import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRequest } from "../worker/index.js";

const origin = "https://diaoorg.github.io";
const verified = { success: true, hostname: "diaoorg.github.io", action: "onboarding" };
const validBody = { email: "  Builder@example.com  ", turnstileToken: "challenge-token" };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const allow = { limit: async () => ({ success: true }) };
const environment = (overrides = {}) => ({
  ALLOWED_ORIGIN: origin,
  TURNSTILE_SITE_KEY: "public-site-key",
  TURNSTILE_SECRET_KEY: "private-turnstile-secret",
  GITHUB_ORG_TOKEN: "private-github-token",
  IP_LIMITER: allow,
  EMAIL_LIMITER: allow,
  ...overrides,
});
function request(body = validBody, options = {}) {
  const { headers, path = "/api/invite", ...rest } = options;
  return new Request(`https://onboarding.example${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...rest,
  });
}
function queue(...responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.ok(responses.length, `Unexpected request: ${url}`);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}
const noFetch = () => assert.fail("Must not contact external services");

test("sends an email invitation with the fixed ordinary role and verified team ID", async () => {
  const mock = queue(json(verified), json({ id: 123 }, 201));
  const response = await handleRequest(request({ ...validBody, role: "admin", team_ids: [1], org: "other" }), environment(), mock.fetch);
  assert.equal(response.status, 201);
  assert.match((await response.json()).message, /Invitation sent by GitHub/);
  assert.equal(mock.calls.length, 2);
  const verification = mock.calls[0];
  assert.equal(JSON.parse(verification.options.body).remoteip, "192.0.2.1");
  const invite = mock.calls[1];
  assert.equal(invite.url, "https://api.github.com/orgs/DiaoOrg/invitations");
  assert.deepEqual(JSON.parse(invite.options.body), {
    email: "Builder@example.com", role: "direct_member", team_ids: [20310971],
  });
  assert.equal(invite.options.headers.Authorization, "Bearer private-github-token");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("CORS accepts only the exact configured origin, including preflight", async () => {
  for (const value of ["https://evil.example", `${origin}.evil.example`, "null", ""]) {
    const response = await handleRequest(request(validBody, { headers: { Origin: value } }), environment(), noFetch);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  const response = await handleRequest(request(undefined, { method: "OPTIONS", body: undefined }), environment(), noFetch);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
});

test("configuration exposes only the public site key and fails closed if a binding or secret is missing", async () => {
  const req = () => request(undefined, { path: "/api/config", method: "GET", body: undefined });
  const response = await handleRequest(req(), environment(), noFetch);
  assert.deepEqual(await response.json(), { message: "Ready.", siteKey: "public-site-key" });
  for (const name of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "GITHUB_ORG_TOKEN", "IP_LIMITER", "EMAIL_LIMITER"]) {
    assert.equal((await handleRequest(req(), environment({ [name]: undefined }), noFetch)).status, 503);
  }
});

test("rejects unsupported routes, methods, content type, and missing Cloudflare source IP", async () => {
  for (const [options, status] of [
    [{ path: "/other" }, 404],
    [{ method: "GET", body: undefined }, 405],
    [{ headers: { "Content-Type": "text/plain" } }, 415],
    [{ headers: { "CF-Connecting-IP": "" } }, 403],
  ]) {
    assert.equal((await handleRequest(request(validBody, options), environment(), noFetch)).status, status);
  }
});

test("rejects malformed, missing, invalid or oversized input before verification", async () => {
  for (const body of ["{", "null", "[]", {}, { ...validBody, email: "not-email" },
    { ...validBody, email: "a@b" }, { ...validBody, email: "a\n@b.com" },
    { ...validBody, email: `${"a".repeat(255)}@b.com` },
    { ...validBody, turnstileToken: "" }, { ...validBody, turnstileToken: "a".repeat(2049) }]) {
    assert.equal((await handleRequest(request(body), environment(), noFetch)).status, 400);
  }
  assert.equal((await handleRequest(request("x".repeat(4097)), environment(), noFetch)).status, 413);
});

test("rejects chunked bodies exceeding the byte limit", async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("a".repeat(3000)));
    controller.enqueue(new TextEncoder().encode("b".repeat(2000)));
    controller.close();
  } });
  assert.equal((await handleRequest(request(undefined, { body: stream, duplex: "half" }), environment(), noFetch)).status, 413);
});

test("rejected, replayed, wrong-host and wrong-action challenges never reach GitHub", async () => {
  for (const result of [{ success: false, "error-codes": ["timeout-or-duplicate"] },
    { ...verified, hostname: "evil.example" }, { ...verified, action: "another-form" }]) {
    const mock = queue(json(result));
    assert.equal((await handleRequest(request(), environment(), mock.fetch)).status, 400);
    assert.equal(mock.calls.length, 1);
  }
});

test("IP and email throttles use hashed keys and stop excess invitations", async () => {
  const ipKeys = [];
  const emailKeys = [];
  const env = environment({
    IP_LIMITER: { limit: async ({ key }) => { ipKeys.push(key); return { success: false }; } },
  });
  const limited = await handleRequest(request(), env, noFetch);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.match(ipKeys[0], /^[a-f0-9]{64}$/);
  const mock = queue(json(verified));
  const emailEnv = environment({
    EMAIL_LIMITER: { limit: async ({ key }) => { emailKeys.push(key); return { success: false }; } },
  });
  assert.equal((await handleRequest(request(), emailEnv, mock.fetch)).status, 429);
  assert.match(emailKeys[0], /^[a-f0-9]{64}$/);
  assert.equal(mock.calls.length, 1);
});

test("recognizes a pending invitation only after confirming the correct team", async () => {
  const mock = queue(json(verified), json({}, 422), json([{ id: 123, email: "builder@EXAMPLE.com" }]), json([{ id: 20310971 }]));
  const response = await handleRequest(request(), environment(), mock.fetch);
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /already pending/);
  assert.match(mock.calls[3].url, /invitations\/123\/teams/);
});

test("does not claim success for existing members, unknown emails or pending invitations with another team", async () => {
  for (const tail of [[json([])], [json([{ id: 123, email: "builder@example.com" }]), json([{ id: 1 }])]]) {
    const mock = queue(json(verified), json({}, 422), ...tail);
    const response = await handleRequest(request(), environment(), mock.fetch);
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /contact DiaoOrg/);
  }
});

test("paginates pending invitations", async () => {
  const mock = queue(json(verified), json({}, 422), json(Array.from({ length: 100 }, (_, i) => ({ id: i, email: `other${i}@example.com` }))),
    json([{ id: 456, email: "builder@example.com" }]), json([{ id: 20310971 }]));
  assert.equal((await handleRequest(request(), environment(), mock.fetch)).status, 200);
  assert.match(mock.calls[3].url, /page=2$/);
});

test("GitHub and verification failures never expose upstream details or credentials", async () => {
  for (const [code, headers, expected] of [[401, {}, 503], [403, {}, 503], [404, {}, 503],
    [500, {}, 502], [429, {}, 429], [403, { "X-RateLimit-Remaining": "0" }, 429], [403, { "Retry-After": "120" }, 429]]) {
    const mock = queue(json(verified), json({ message: "private-github-token Builder@example.com" }, code, headers));
    const response = await handleRequest(request(), environment(), mock.fetch);
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /private-|Builder@/);
  }
  for (const failure of [new Error("private-turnstile-secret"), json({}, 503)]) {
    const mock = queue(failure);
    const response = await handleRequest(request(), environment(), mock.fetch);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private-/);
  }
});

test("distinguishes organization invitation limits from invalid emails and configuration failures", async () => {
  for (const [body, expectedStatus, expectedCode] of [
    [{ message: "You have exceeded your daily invitation limit" }, 429, "ORG_INVITATION_LIMIT"],
    [{ message: "Validation Failed", errors: [{ resource: "OrganizationInvitation", field: "data", code: "unprocessable", message: "Over invitation rate limit" }] }, 429, "ORG_INVITATION_LIMIT"],
    [{ message: "Validation Failed", errors: [{ message: "You cannot invite more users because you have reached the invitation limit" }] }, 429, "ORG_INVITATION_LIMIT"],
    [{ message: "You have exceeded a secondary rate limit" }, 429, "GITHUB_RATE_LIMIT"],
    [{ message: "Organization invitations are disabled" }, 503, "INVITATIONS_DISABLED"],
    [{ message: "Validation Failed", errors: [{ field: "team_ids", code: "invalid" }] }, 503, "TEAM_CONFIGURATION_ERROR"],
    [{ message: "User is already a member of this organization" }, 409, "ALREADY_MEMBER"],
    [{ message: "Account has been flagged" }, 422, "ACCOUNT_RESTRICTED"],
    [{ message: "Validation Failed", errors: [{ field: "email", code: "invalid" }] }, 422, "EMAIL_REJECTED"],
  ]) {
    const mock = queue(json(verified), json(body, 422, { "X-GitHub-Request-Id": "test-reference" }));
    const response = await handleRequest(request(), environment(), mock.fetch);
    assert.equal(response.status, expectedStatus);
    const result = await response.json();
    assert.equal(result.code, expectedCode);
    assert.equal(result.reference, "test-reference");
    if (expectedCode === "ORG_INVITATION_LIMIT") assert.equal(response.headers.get("Retry-After"), null);
    assert.equal(mock.calls.length, 2);
  }
});
