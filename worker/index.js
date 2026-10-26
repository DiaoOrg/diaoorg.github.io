// GitHub sends the official email. Acceptance activates org and team membership.
const ORG = "DiaoOrg";
const TEAM_ID = 20310971; // github.com/orgs/DiaoOrg/teams/diaomember
const GITHUB = `https://api.github.com/orgs/${ORG}`;
const MAX_BODY = 4096;
const SUCCESS = "Invitation sent by GitHub. Check your inbox and spam folder. Accept it to join DiaoOrg and DiaoMember.";

function githubFailure(body) {
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const text = [body.message, ...errors.map(error => typeof error === "string" ? error : error.message)].filter(Boolean).join(" ");
  if (/(?:daily|24.?hour).*(?:limit|maximum)|(?:limit|maximum).*(?:daily|24.?hour)|(?:invite|invitation).*(?:limit|maximum)|(?:limit|maximum).*(?:invite|invitation)/i.test(text)) return "ORG_INVITATION_LIMIT";
  if (/secondary rate limit|abuse detection|endpoint.*spammed/i.test(text)) return "GITHUB_RATE_LIMIT";
  if (/invitations?.*(?:disabled|restricted)|(?:disabled|restricted).*invitations?/i.test(text)) return "INVITATIONS_DISABLED";
  if (errors.some(error => error.field === "team_ids") || /team.*(?:invalid|not found|does not exist)/i.test(text)) return "TEAM_CONFIGURATION_ERROR";
  if (/already (?:a |an )?member|already.*part of.*org/i.test(text)) return "ALREADY_MEMBER";
  if (/already.*invit|invit.*already|invitation.*exists/i.test(text)) return "INVITATION_EXISTS";
  if (/flagged|suspended/i.test(text)) return "ACCOUNT_RESTRICTED";
  if (errors.some(error => error.field === "email") || /email.*(?:invalid|verified|blank|missing)/i.test(text)) return "EMAIL_REJECTED";
  return "GITHUB_VALIDATION_FAILED";
}

function rejectionLog(response, body, category, token) {
  const redact = (value) => String(value ?? "").replaceAll(token, "[credential]")
    .replace(/[^\s<>@"']+@[^\s<>@"']+/gu, "[email]")
    .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[credential]").slice(0, 500);
  // Sanitized operational diagnostics only; never record submitted emails or tokens.
  console.warn(JSON.stringify({ event: "github_invitation_rejected", status: response.status, category,
    githubRequestId: response.headers.get("X-GitHub-Request-Id"), retryAfter: response.headers.get("Retry-After"), message: redact(body.message),
    errors: (Array.isArray(body.errors) ? body.errors : []).slice(0, 5).map(error => typeof error === "string"
      ? { message: redact(error) }
      : Object.fromEntries(["resource", "field", "code", "message"].filter(key => error[key]).map(key => [key, redact(error[key])]))),
  }));
}

class InputError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY) {
    throw new InputError(413, "Request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError(400, "Enter your GitHub email.");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new InputError(413, "Request is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw new InputError(400, "Invalid request."); }
}

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const origin = request.headers.get("Origin");
  const allowed = Boolean(env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN);
  const reply = (status, message, extra = {}) => new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin",
      ...(allowed ? { "Access-Control-Allow-Origin": origin } : {}),
      ...(status === 429 && extra.code !== "ORG_INVITATION_LIMIT" ? { "Retry-After": "60" } : {}),
    },
  });
  if (!allowed) return reply(403, "This origin is not allowed.");
  const path = new URL(request.url).pathname;
  if (!["/api/config", "/api/invite"].includes(path)) return reply(404, "Not found.");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    } });
  }
  if (request.method !== (path === "/api/config" ? "GET" : "POST")) return reply(405, "Method not allowed.");
  if (!env.GITHUB_ORG_TOKEN || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY ||
      !env.IP_LIMITER || !env.EMAIL_LIMITER) {
    return reply(503, "Online invitations are not open yet. Please contact DiaoOrg on GitHub.");
  }
  if (path === "/api/config") return reply(200, "Ready.", { siteKey: env.TURNSTILE_SITE_KEY });
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply(415, "Send a JSON request.");
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return reply(403, "Could not verify the request source.");
    if (!(await env.IP_LIMITER.limit({ key: await hash(ip) })).success) {
      return reply(429, "Too many requests. Wait a minute before trying again.");
    }
    const body = await readBody(request);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(email)) {
      return reply(400, "Enter a valid email verified on your GitHub account.");
    }
    if (typeof body.turnstileToken !== "string" || !body.turnstileToken || body.turnstileToken.length > 2048) {
      return reply(400, "Complete the verification and try again.");
    }

    const verification = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: body.turnstileToken, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!verification.ok) return reply(502, "Verification is unavailable. Please try again later.");
    const verified = await verification.json();
    if (!verified.success || verified.action !== "onboarding" ||
        verified.hostname !== new URL(env.ALLOWED_ORIGIN).hostname) {
      return reply(400, "Verification expired or failed. Please verify again.");
    }
    if (!(await env.EMAIL_LIMITER.limit({ key: await hash(email.toLowerCase()) })).success) {
      return reply(429, "Please check your inbox. Wait a minute before requesting another invitation.");
    }

    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_ORG_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "DiaoOrg-onboarding",
      "Content-Type": "application/json",
    };
    const githubFetch = (url, options = {}) => fetchImpl(url, {
      ...options, headers, signal: AbortSignal.timeout(8000),
    });
    const invitation = await githubFetch(`${GITHUB}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role: "direct_member", team_ids: [TEAM_ID] }),
    });
    if (invitation.status === 201) return reply(201, SUCCESS);
    const failure = await invitation.json().catch(() => ({}));
    const category = githubFailure(failure);
    const reference = invitation.headers.get("X-GitHub-Request-Id");
    rejectionLog(invitation, failure, category, env.GITHUB_ORG_TOKEN);
    if (category === "ORG_INVITATION_LIMIT") {
      return reply(429, "GitHub's organization invitation limit has been reached. New organizations can usually send 50 invitations per 24 hours. Please try again later.", { code: category, reference });
    }
    if (category === "GITHUB_RATE_LIMIT") return reply(429, "GitHub is temporarily limiting invitations. Please try again later.", { code: category, reference });
    if (category === "INVITATIONS_DISABLED" || category === "TEAM_CONFIGURATION_ERROR") {
      return reply(503, "GitHub is preventing organization invitations. Please contact DiaoOrg so an administrator can resolve this.", { code: category, reference });
    }
    if (invitation.status === 422) {
      if (category === "ALREADY_MEMBER") return reply(409, "You are already a DiaoOrg member. Contact an administrator if you need access to DiaoMember.", { code: category, reference });
      if (category === "ACCOUNT_RESTRICTED") return reply(422, "GitHub has restricted this account from accepting organization invitations. Please check your GitHub account status or contact GitHub Support.", { code: category, reference });
      if (category === "EMAIL_REJECTED") return reply(422, "GitHub rejected this email address. Check that it is added and verified in your GitHub account settings.", { code: category, reference });
      // Only report a pending invitation when its requested team is confirmed.
      for (let page = 1; page <= 10; page++) {
        const pending = await githubFetch(`${GITHUB}/invitations?per_page=100&page=${page}`);
        if (!pending.ok) return reply(502, "Could not check pending invitations. Please contact DiaoOrg on GitHub.");
        const invitations = await pending.json();
        const match = invitations.find(item => item.email?.toLowerCase() === email.toLowerCase());
        if (match) {
          const teams = await githubFetch(`${GITHUB}/invitations/${match.id}/teams?per_page=100`);
          if (teams.ok && (await teams.json()).some(team => team.id === TEAM_ID)) {
            return reply(200, "An invitation to DiaoOrg and DiaoMember is already pending. Check your GitHub notifications, inbox and spam folder.");
          }
          break;
        }
        if (invitations.length < 100) break;
      }
      if (category === "INVITATION_EXISTS") return reply(409, "A GitHub invitation already exists. Sign in to GitHub and check your pending organization invitations, or contact DiaoOrg for help.", { code: category, reference });
      return reply(409, "GitHub rejected this invitation request. Please contact DiaoOrg so an administrator can check the specific reason.", { code: category, reference });
    }
    if (invitation.status === 429 || (invitation.status === 403 &&
        (invitation.headers.get("Retry-After") || invitation.headers.get("X-RateLimit-Remaining") === "0"))) {
      return reply(429, "GitHub is limiting invitations. Please try again later.");
    }
    if ([401, 403, 404].includes(invitation.status)) {
      return reply(503, "Invitations are temporarily unavailable. Please contact DiaoOrg on GitHub.");
    }
    return reply(502, "GitHub could not send the invitation. Please try again later.");
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, error.message);
    // Never log emails, verification responses or GitHub credentials.
    return reply(502, "The invitation service could not complete your request. Check your inbox before trying again.");
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
