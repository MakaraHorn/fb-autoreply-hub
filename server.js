/**
 * Facebook Page Comment Auto-Reply Bot — with Web Dashboard
 * -----------------------------------------------------------
 * - Listens for new Page comments via Facebook Webhook and replies
 *   automatically based on keyword rules.
 * - Supports MULTIPLE connected Pages, each with its own token and
 *   its own independent keyword set.
 * - Serves a password-protected web dashboard (public/) to manage
 *   everything without touching GitHub or Railway.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const store = require("./lib/store");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const {
  PORT = 3000,
  ADMIN_PASSWORD = "changeme",
  FB_APP_ID = "",
  FB_APP_SECRET = "",
  GOOGLE_CLIENT_ID = "",
  GOOGLE_CLIENT_SECRET = "",
} = process.env;

const GRAPH_VERSION = "v20.0";

// ---------------------------------------------------------------
// Session-based auth, now backing multiple dashboard users:
// - The bot owner logs in with ADMIN_PASSWORD and sees every Page
//   (isSuperAdmin = true, userId = SUPER_ADMIN_ID).
// - Everyone else signs up with email/password, or logs in with
//   Facebook/Google, and only ever sees Pages they personally connected.
// Each session can also hold short-lived OAuth state used only
// during a "Login with Facebook/Google" flow.
// ---------------------------------------------------------------

const sessions = new Map(); // token -> { userId, isSuperAdmin, oauthState, pendingPages }

function setSessionCookie(res, token) {
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  const session = token ? sessions.get(token) : null;
  if (session && session.userId) {
    req.sessionToken = token;
    req.userId = session.userId;
    req.isSuperAdmin = Boolean(session.isSuperAdmin);
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
}

// Used by OAuth login routes, which must work even before the person is
// authenticated (that's the whole point — logging in via Facebook/Google
// IS the authentication step). Creates a blank session/cookie if needed
// so we have somewhere to stash OAuth state across the redirect.
function ensureSession(req, res, next) {
  let token = req.cookies.session;
  if (!token || !sessions.has(token)) {
    token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, {});
    setSessionCookie(res, token);
  }
  req.sessionToken = token;
  next();
}

app.get("/api/me", requireAuth, (req, res) => {
  if (req.isSuperAdmin) {
    return res.json({ userId: req.userId, name: "Super Admin", email: null, isSuperAdmin: true });
  }
  const user = store.getUserById(req.userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  res.json({ userId: user.userId, name: user.name, email: user.email, isSuperAdmin: false });
});

// ---- Super Admin login (bot owner, sees every connected Page) ----
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { userId: store.SUPER_ADMIN_ID, isSuperAdmin: true });
    setSessionCookie(res, token);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "ពាក្យសម្ងាត់មិនត្រឹមត្រូវ" });
});

// ---- Email/Password signup & login (business owners) ----
app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "សូមបំពេញ Email និង Password (យ៉ាងតិច 6 តួអក្សរ)" });
  }
  if (store.findUserByEmail(email)) {
    return res.status(400).json({ error: "Email នេះមានគណនីរួចហើយ សូម Login ជំនួសវិញ" });
  }
  const user = store.createUser({ name, email, passwordHash: store.hashPassword(password) });
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId: user.userId, isSuperAdmin: false });
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? store.findUserByEmail(email) : null;
  if (!user || !store.verifyPassword(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Email ឬ Password មិនត្រឹមត្រូវ" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId: user.userId, isSuperAdmin: false });
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies.session;
  if (token) sessions.delete(token);
  res.clearCookie("session");
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Dashboard API — Pages
// ---------------------------------------------------------------

app.get("/api/pages", requireAuth, async (req, res) => {
  const pages = store.loadPagesForUser(req.userId, req.isSuperAdmin);

  const results = await Promise.all(
    pages.map(async (p) => {
      let tokenValid = true;
      let tokenError = null;
      try {
        await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
          params: { fields: "id", access_token: p.pageAccessToken },
        });
      } catch (err) {
        tokenValid = false;
        tokenError = err.response?.data?.error?.message || "Token invalid or expired";
      }
      const masked = p.pageAccessToken
        ? `${"•".repeat(Math.max(p.pageAccessToken.length - 6, 0))}${p.pageAccessToken.slice(-6)}`
        : "";
      return {
        pageId: p.pageId,
        pageName: p.pageName,
        tokenMasked: masked,
        defaultReplyEnabled: Boolean(p.defaultReplyEnabled),
        tokenValid,
        tokenError,
      };
    })
  );

  res.json(results);
});

app.patch("/api/pages/:pageId", requireAuth, (req, res) => {
  const owned = store.getPageForUser(req.params.pageId, req.userId, req.isSuperAdmin);
  if (!owned) return res.status(404).json({ error: "Page not found" });
  const { defaultReplyEnabled } = req.body || {};
  const update = {};
  if (typeof defaultReplyEnabled === "boolean") update.defaultReplyEnabled = defaultReplyEnabled;
  const updated = store.updatePage(req.params.pageId, update);
  res.json({ ok: true, page: updated });
});

app.delete("/api/pages/:pageId", requireAuth, (req, res) => {
  const owned = store.getPageForUser(req.params.pageId, req.userId, req.isSuperAdmin);
  if (!owned) return res.status(404).json({ error: "Page not found" });
  store.removePage(req.params.pageId);
  res.json({ ok: true });
});

// Add or update a page manually by pasting its access token (fallback
// for when "Login with Facebook" isn't configured).
app.post("/api/pages/manual", requireAuth, async (req, res) => {
  const { pageAccessToken } = req.body || {};
  if (!pageAccessToken || !pageAccessToken.trim()) {
    return res.status(400).json({ error: "សូមបំពេញ Token" });
  }
  try {
    const resp = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
      params: { fields: "id,name", access_token: pageAccessToken.trim() },
    });
    const page = {
      pageId: resp.data.id,
      pageName: resp.data.name,
      pageAccessToken: pageAccessToken.trim(),
      ownerUserId: req.userId,
    };
    store.upsertPage(page);
    await subscribePageToWebhook(page.pageId, page.pageAccessToken);
    res.json({ ok: true, page });
  } catch (err) {
    res.status(400).json({
      error: err.response?.data?.error?.message || "Token មិនត្រឹមត្រូវ ឬផុតកំណត់",
    });
  }
});

// ---------------------------------------------------------------
// Dashboard API — Overview / Keywords / Activity / Settings
// ---------------------------------------------------------------

app.get("/api/status", requireAuth, async (req, res) => {
  const pages = store.loadPagesForUser(req.userId, req.isSuperAdmin);
  const logs = store.getLogs();
  const visiblePageIds = new Set(pages.map((p) => p.pageId));
  const visibleLogs = req.isSuperAdmin ? logs : logs.filter((l) => visiblePageIds.has(l.pageId));

  res.json({
    pageCount: pages.length,
    pages: pages.map((p) => ({ pageId: p.pageId, pageName: p.pageName })),
    recentActivityCount: visibleLogs.length,
    lastActivity: visibleLogs[0] || null,
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/keywords", requireAuth, (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: "ត្រូវការ pageId" });
  const owned = store.getPageForUser(pageId, req.userId, req.isSuperAdmin);
  if (!owned) return res.status(404).json({ error: "Page not found" });
  res.json(store.getKeywordsForPage(pageId));
});

app.post("/api/keywords", requireAuth, (req, res) => {
  const { pageId, key, value } = req.body || {};
  if (!pageId || !key || !value) {
    return res.status(400).json({ error: "ត្រូវការ pageId, key និង value" });
  }
  const owned = store.getPageForUser(pageId, req.userId, req.isSuperAdmin);
  if (!owned) return res.status(404).json({ error: "Page not found" });
  const keywords = store.getKeywordsForPage(pageId);
  keywords[key] = value;
  store.saveKeywordsForPage(pageId, keywords);
  res.json({ ok: true, keywords });
});

app.delete("/api/keywords/:pageId/:key", requireAuth, (req, res) => {
  const { pageId, key } = req.params;
  const owned = store.getPageForUser(pageId, req.userId, req.isSuperAdmin);
  if (!owned) return res.status(404).json({ error: "Page not found" });
  const keywords = store.getKeywordsForPage(pageId);
  delete keywords[decodeURIComponent(key)];
  store.saveKeywordsForPage(pageId, keywords);
  res.json({ ok: true, keywords });
});

app.get("/api/logs", requireAuth, (req, res) => {
  const logs = store.getLogs();
  if (req.isSuperAdmin) return res.json(logs);
  const pages = store.loadPagesForUser(req.userId, false);
  const visiblePageIds = new Set(pages.map((p) => p.pageId));
  res.json(logs.filter((l) => visiblePageIds.has(l.pageId)));
});

app.get("/api/settings", requireAuth, (req, res) => {
  const { verifyToken } = store.loadConfig();
  res.json({
    verifyToken,
    fbLoginEnabled: Boolean(FB_APP_ID && FB_APP_SECRET),
    googleLoginEnabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
});

app.post("/api/settings", requireAuth, (req, res) => {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "មានតែ Super Admin ទើបអាចប្តូរ Verify Token (ព្រោះប្រើរួមគ្នាសម្រាប់អ្នកប្រើទាំងអស់)" });
  }
  const { verifyToken } = req.body || {};
  const update = {};
  if (verifyToken) update.verifyToken = verifyToken.trim();
  const saved = store.saveConfig(update);
  res.json({ ok: true, saved: { verifyToken: saved.verifyToken } });
});

// ---------------------------------------------------------------
// "Login with Facebook" — lets the admin connect Pages by logging
// in directly, instead of copy-pasting a token from the Graph API
// Explorer. Produces a Page token derived from a long-lived user
// token, which is far more stable than one copied from the Explorer.
// Selecting a page here ADDS it to the connected list — it never
// wipes out other already-connected pages.
// ---------------------------------------------------------------

function getRedirectUri(req, provider) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}/auth/${provider}/callback`;
}

function renderMessagePage(title, message, isError = false, showAddAnother = false) {
  const addAnotherLink = showAddAnother
    ? `<a href="/auth/facebook/login" style="background:#E4A63A;color:#1F2B54;margin-right:8px;">ភ្ជាប់ Page ផ្សេងទៀត</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="km"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body{font-family:'Noto Sans Khmer',sans-serif;background:#F7F5F1;color:#21232B;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border:1px solid #E4E0D8;border-radius:16px;padding:36px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(31,43,84,0.08);}
  h1{font-size:18px;color:${isError ? "#C1442E" : "#2F3E75"};margin:0 0 12px;}
  p{font-size:14px;color:#6B6F76;line-height:1.6;margin:0 0 20px;}
  a{display:inline-block;padding:10px 24px;background:#2F3E75;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>${addAnotherLink}<a href="/">ត្រឡប់ទៅ Dashboard</a></div></body></html>`;
}

function renderPagePicker(pages, connectedIds) {
  const items = pages
    .map((p) => {
      const already = connectedIds.includes(p.id);
      return `
    <a class="page-item ${already ? "connected" : ""}" href="${already ? "#" : `/auth/facebook/select-page?pageId=${encodeURIComponent(p.id)}`}">
      <span class="page-name">${p.name}</span>
      <span class="page-go">${already ? "✅ ភ្ជាប់រួច" : "ភ្ជាប់ →"}</span>
    </a>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="km"><head><meta charset="UTF-8"><title>ជ្រើសរើស Page</title>
<style>
  body{font-family:'Noto Sans Khmer',sans-serif;background:#F7F5F1;color:#21232B;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border:1px solid #E4E0D8;border-radius:16px;padding:36px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(31,43,84,0.08);}
  h1{font-size:18px;color:#2F3E75;margin:0 0 6px;}
  p{font-size:13px;color:#6B6F76;margin:0 0 20px;}
  .page-item{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid #E4E0D8;border-radius:10px;margin-bottom:10px;text-decoration:none;color:#21232B;font-size:14px;}
  .page-item:hover{border-color:#2F3E75;background:#F7F5F1;}
  .page-item.connected{opacity:0.55;cursor:default;}
  .page-go{color:#2F3E75;font-weight:600;font-size:13px;}
  .footer-link{display:block;text-align:center;margin-top:16px;color:#2F3E75;font-size:13px;text-decoration:none;}
</style></head>
<body><div class="card">
  <h1>ជ្រើសរើស Page</h1>
  <p>ចុចដើម្បីភ្ជាប់ Page នីមួយៗ។ អាចភ្ជាប់បានច្រើន Page ក្នុងពេលតែមួយ។</p>
  ${items}
  <a class="footer-link" href="/">✓ រួចរាល់ ត្រឡប់ទៅ Dashboard</a>
</div></body></html>`;
}

app.get("/auth/facebook/login", ensureSession, (req, res) => {
  if (!FB_APP_ID || !FB_APP_SECRET) {
    return res
      .status(400)
      .send(renderMessagePage("មិនទាន់កំណត់រចនាសម្ព័ន្ធ", "FB_APP_ID និង FB_APP_SECRET មិនទាន់ត្រូវបានកំណត់ក្នុង Server។", true));
  }

  const state = crypto.randomBytes(16).toString("hex");
  sessions.set(req.sessionToken, { ...sessions.get(req.sessionToken), oauthState: state });

  const redirectUri = getRedirectUri(req, "facebook");
  const scope = [
    "email",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_engagement",
    "pages_manage_metadata",
  ].join(",");

  const authUrl =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&auth_type=rerequest`;

  res.redirect(authUrl);
});

app.get("/auth/facebook/callback", ensureSession, async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const session = sessions.get(req.sessionToken) || {};

  if (error) {
    return res.send(
      renderMessagePage("ការចូលត្រូវបានលុបចោល", error_description || "អ្នកបានបដិសេធការចូល ឬបានកើតកំហុសនៅ Facebook។", true)
    );
  }

  if (!state || state !== session.oauthState) {
    return res.status(400).send(renderMessagePage("សំណើមិនត្រឹមត្រូវ", "សូមព្យាយាមចូលម្តងទៀតពី Dashboard។", true));
  }

  try {
    const redirectUri = getRedirectUri(req, "facebook");

    const shortLived = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
      params: { client_id: FB_APP_ID, client_secret: FB_APP_SECRET, redirect_uri: redirectUri, code },
    });

    const longLived = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortLived.data.access_token,
      },
    });

    const userLongLivedToken = longLived.data.access_token;

    // Identify the person: if they're not already logged in (e.g. via
    // email/password), match or create a user account by their Facebook ID.
    // If they ARE already logged in, we just link this Facebook identity
    // to their existing account (no new user created).
    let userId = session.userId;
    if (!userId) {
      const profile = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
        params: { fields: "id,name,email", access_token: userLongLivedToken },
      });
      let user = store.findUserByProvider("facebook", profile.data.id);
      if (!user) {
        user = store.createUser({
          name: profile.data.name,
          email: profile.data.email || null,
          facebookUserId: profile.data.id,
        });
      }
      userId = user.userId;
    }

    sessions.set(req.sessionToken, { ...session, userId, isSuperAdmin: false, oauthState: null });

    const pagesResp = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
      params: { access_token: userLongLivedToken, fields: "id,name,access_token" },
    });

    const pages = pagesResp.data.data || [];

    if (pages.length === 0) {
      return res.send(
        renderMessagePage(
          "រកមិនឃើញ Page",
          "គណនីនេះមិនមែនជា Admin របស់ Page ណាមួយទេ។ សូមប្រាកដថាអ្នក Login ដោយគណនីដែលជា Admin របស់ Page ចង់ភ្ជាប់។",
          true
        )
      );
    }

    if (pages.length === 1) {
      const p = pages[0];
      store.upsertPage({ pageId: p.id, pageName: p.name, pageAccessToken: p.access_token, ownerUserId: userId });
      await subscribePageToWebhook(p.id, p.access_token);
      return res.redirect("/?fb=success");
    }

    sessions.set(req.sessionToken, { ...sessions.get(req.sessionToken), pendingPages: pages, oauthState: null });
    const connectedIds = store
      .loadPagesForUser(userId, false)
      .map((p) => p.pageId);
    return res.send(renderPagePicker(pages, connectedIds));
  } catch (err) {
    console.error("❌ Facebook OAuth error:", err.response?.data || err.message);
    return res.send(
      renderMessagePage(
        "ការតភ្ជាប់បរាជ័យ",
        err.response?.data?.error?.message || "កើតបញ្ហាមិនស្គាល់ក្នុងការតភ្ជាប់ជាមួយ Facebook។",
        true
      )
    );
  }
});

app.get("/auth/facebook/select-page", ensureSession, async (req, res) => {
  const session = sessions.get(req.sessionToken) || {};
  const pending = session.pendingPages || [];
  const chosen = pending.find((p) => p.id === req.query.pageId);

  if (!chosen || !session.userId) {
    return res.status(400).send(renderMessagePage("Page មិនត្រឹមត្រូវ", "សូមចាប់ផ្តើមការតភ្ជាប់ម្តងទៀត។", true));
  }

  store.upsertPage({ pageId: chosen.id, pageName: chosen.name, pageAccessToken: chosen.access_token, ownerUserId: session.userId });
  await subscribePageToWebhook(chosen.id, chosen.access_token);

  const connectedIds = store.loadPagesForUser(session.userId, false).map((p) => p.pageId);
  const remaining = pending.filter((p) => !connectedIds.includes(p.id));

  if (remaining.length > 0) {
    return res.send(renderPagePicker(pending, connectedIds));
  }

  sessions.set(req.sessionToken, { ...session, pendingPages: null });
  res.redirect("/?fb=success");
});

// ---------------------------------------------------------------
// "Login with Google" — an alternate way to sign in (no Pages are
// connected through this; Google doesn't manage Facebook Pages).
// After signing in this way, use "Login with Facebook" to connect Pages.
// ---------------------------------------------------------------

app.get("/auth/google/login", ensureSession, (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res
      .status(400)
      .send(renderMessagePage("មិនទាន់កំណត់រចនាសម្ព័ន្ធ", "GOOGLE_CLIENT_ID និង GOOGLE_CLIENT_SECRET មិនទាន់ត្រូវបានកំណត់ក្នុង Server។", true));
  }

  const state = crypto.randomBytes(16).toString("hex");
  sessions.set(req.sessionToken, { ...sessions.get(req.sessionToken), oauthState: state });

  const redirectUri = getRedirectUri(req, "google");
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent("openid email profile")}`;

  res.redirect(authUrl);
});

app.get("/auth/google/callback", ensureSession, async (req, res) => {
  const { code, state, error } = req.query;
  const session = sessions.get(req.sessionToken) || {};

  if (error) {
    return res.send(renderMessagePage("ការចូលត្រូវបានលុបចោល", "អ្នកបានបដិសេធការចូល ឬបានកើតកំហុសនៅ Google។", true));
  }
  if (!state || state !== session.oauthState) {
    return res.status(400).send(renderMessagePage("សំណើមិនត្រឹមត្រូវ", "សូមព្យាយាមចូលម្តងទៀតពី Dashboard។", true));
  }

  try {
    const redirectUri = getRedirectUri(req, "google");
    const tokenResp = await axios.post("https://oauth2.googleapis.com/token", null, {
      params: {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      },
    });

    const profile = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenResp.data.access_token}` },
    });

    let user = store.findUserByProvider("google", profile.data.sub);
    if (!user) {
      user = store.createUser({
        name: profile.data.name,
        email: profile.data.email || null,
        googleUserId: profile.data.sub,
      });
    }

    sessions.set(req.sessionToken, { ...session, userId: user.userId, isSuperAdmin: false, oauthState: null });
    res.redirect("/?login=success");
  } catch (err) {
    console.error("❌ Google OAuth error:", err.response?.data || err.message);
    res.send(renderMessagePage("ការតភ្ជាប់បរាជ័យ", "កើតបញ្ហាមិនស្គាល់ក្នុងការតភ្ជាប់ជាមួយ Google។", true));
  }
});

// ---------------------------------------------------------------
// Facebook Webhook
// ---------------------------------------------------------------

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const { verifyToken } = store.loadConfig();

  if (mode === "subscribe" && token === verifyToken) {
    console.log("✅ Webhook verified successfully.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // acknowledge immediately

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      // entry.id is the Page ID that this notification belongs to —
      // this is how we pick the right token & keyword set for a multi-page setup.
      const page = store.getPage(entry.id);

      for (const change of entry.changes || []) {
        if (change.field !== "feed") continue;

        const value = change.value;
        if (value.item !== "comment" || value.verb !== "add") continue;

        const commentId = value.comment_id;
        const commentText = (value.message || "").trim();
        const commenterId = value.from?.id;
        if (!commentId || !commentText) continue;

        if (!page) {
          console.log(`⚠️  Comment on unrecognized Page [${entry.id}], skipping (not connected in Dashboard)`);
          continue;
        }

        // Never reply to a comment written by the Page itself — this includes
        // the bot's own previous replies. Without this check, when "default
        // reply" is enabled, the bot's reply would itself trigger a new
        // comment.add event, and the bot would reply to that too, forever.
        if (commenterId && commenterId === page.pageId) {
          console.log(`⏭️  Comment [${commentId}] was posted by the Page itself, skipping (avoids self-reply loop)`);
          continue;
        }

        if (store.hasReplied(commentId)) {
          console.log(`⏭️  Already handled comment [${commentId}], skipping duplicate delivery`);
          continue;
        }

        // Mark as handled IMMEDIATELY (before the slow network reply call below).
        // This closes the race window where Facebook re-delivers the same event
        // a split-second later, arriving while we're still awaiting the first
        // reply — without this, both deliveries would see "not yet replied"
        // and the bot would answer the same comment twice.
        store.markReplied(commentId);

        console.log(`💬 [${page.pageName}] New comment [${commentId}]: ${commentText}`);

        const { key, reply } = matchKeyword(commentText, page.pageId);

        if (reply) {
          const sent = await replyToComment(commentId, reply, page.pageAccessToken);
          store.pushLog({
            pageId: page.pageId,
            pageName: page.pageName,
            commentText,
            matchedKeyword: key,
            replyText: reply,
            status: sent ? "sent" : "failed",
          });
        } else {
          store.pushLog({
            pageId: page.pageId,
            pageName: page.pageName,
            commentText,
            matchedKeyword: null,
            replyText: null,
            status: "skipped",
          });
        }
      }
    }
  } catch (err) {
    console.error("❌ Error handling webhook event:", err.message);
  }
});

function matchKeyword(commentText, pageId) {
  const keywords = store.getKeywordsForPage(pageId);
  const page = store.getPage(pageId);
  const lowerText = commentText.toLowerCase();

  for (const key of Object.keys(keywords)) {
    if (key === "_comment" || key === "default") continue;
    if (lowerText.includes(key.toLowerCase())) {
      return { key, reply: keywords[key] };
    }
  }

  if (page?.defaultReplyEnabled && keywords.default) {
    return { key: "default", reply: keywords.default };
  }
  return { key: null, reply: null };
}

// Subscribes a Page to our app's webhook for the "feed" field, so
// Facebook actually delivers comment events for it. Without this step
// (easy to miss when adding a token manually) the Page's comments never
// reach the webhook even if everything else is configured correctly.
async function subscribePageToWebhook(pageId, pageAccessToken) {
  try {
    await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps`, null, {
      params: { subscribed_fields: "feed", access_token: pageAccessToken },
    });
    console.log(`✅ Subscribed Page [${pageId}] to webhook feed events`);
    return true;
  } catch (err) {
    console.error(`⚠️ Could not auto-subscribe Page [${pageId}] to webhook:`, err.response?.data || err.message);
    return false;
  }
}

async function replyToComment(commentId, message, pageAccessToken) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/comments`;
  try {
    await axios.post(url, null, { params: { message, access_token: pageAccessToken } });
    console.log(`✅ Replied to comment ${commentId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to reply to comment ${commentId}:`, err.response?.data || err.message);
    return false;
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`🖥️  Dashboard available at http://localhost:${PORT}`);
});
