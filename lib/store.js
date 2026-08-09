const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEYWORDS_PATH = path.join(__dirname, "..", "keywords.json");
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const REPLIED_PATH = path.join(__dirname, "..", "replied-comments.json");
const USERS_PATH = path.join(__dirname, "..", "users.json");

const SUPER_ADMIN_ID = "super-admin";

// =================================================================
// Config: verifyToken (global) + pages[] (each with its own token)
// =================================================================

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    return {};
  }
}

function writeConfigFile(obj) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), "utf-8");
}

// One-time migration: older versions stored a single page directly on the
// config object (pageAccessToken/pageId/pageName/defaultReplyEnabled).
// If we find that shape and no pages[] yet, convert it into a one-item list.
function migrateLegacyConfig(raw) {
  if (Array.isArray(raw.pages)) return raw;
  if (raw.pageAccessToken) {
    const migrated = {
      verifyToken: raw.verifyToken || "",
      pages: [
        {
          pageId: raw.pageId || "",
          pageName: raw.pageName || "",
          pageAccessToken: raw.pageAccessToken,
          defaultReplyEnabled: Boolean(raw.defaultReplyEnabled),
        },
      ],
    };
    writeConfigFile(migrated);
    return migrated;
  }
  return { verifyToken: raw.verifyToken || "", pages: [] };
}

function loadConfig() {
  const raw = migrateLegacyConfig(readConfigFile());
  return {
    verifyToken: raw.verifyToken || process.env.VERIFY_TOKEN || "",
  };
}

function saveConfig(partial) {
  const raw = migrateLegacyConfig(readConfigFile());
  const updated = { ...raw, ...partial };
  writeConfigFile(updated);
  return loadConfig();
}

// ---------- Pages ----------

function loadPages() {
  const raw = migrateLegacyConfig(readConfigFile());
  let changed = false;
  const pages = (raw.pages || []).map((p) => {
    if (!p.ownerUserId) {
      changed = true;
      return { ...p, ownerUserId: SUPER_ADMIN_ID };
    }
    return p;
  });
  if (changed) {
    raw.pages = pages;
    writeConfigFile(raw);
  }
  return pages;
}

function savePages(pages) {
  const raw = migrateLegacyConfig(readConfigFile());
  raw.pages = pages;
  writeConfigFile(raw);
}

function getPage(pageId) {
  return loadPages().find((p) => p.pageId === pageId) || null;
}

// Add a page, or update it in place if a page with the same pageId
// already exists (never wipes out other connected pages).
// ownerUserId identifies which dashboard user this page belongs to —
// SUPER_ADMIN_ID for the bot owner, or a specific user's userId.
function upsertPage(page) {
  const pages = loadPages();
  const idx = pages.findIndex((p) => p.pageId === page.pageId);
  if (idx >= 0) {
    pages[idx] = { ...pages[idx], ...page };
  } else {
    pages.push({ defaultReplyEnabled: false, ownerUserId: SUPER_ADMIN_ID, ...page });
  }
  savePages(pages);
  return pages;
}

function updatePage(pageId, partial) {
  const pages = loadPages();
  const idx = pages.findIndex((p) => p.pageId === pageId);
  if (idx < 0) return null;
  pages[idx] = { ...pages[idx], ...partial };
  savePages(pages);
  return pages[idx];
}

function removePage(pageId) {
  const pages = loadPages().filter((p) => p.pageId !== pageId);
  savePages(pages);
}

// Pages visible to a given session: the super admin sees everything,
// everyone else sees only pages they personally connected.
function loadPagesForUser(userId, isSuperAdmin) {
  const pages = loadPages();
  if (isSuperAdmin) return pages;
  return pages.filter((p) => p.ownerUserId === userId);
}

function getPageForUser(pageId, userId, isSuperAdmin) {
  const page = getPage(pageId);
  if (!page) return null;
  if (isSuperAdmin || page.ownerUserId === userId) return page;
  return null;
}

// =================================================================
// Keywords: per-page keyword sets, with one-time migration support
// for the older single global keyword set.
// =================================================================

function readKeywordsFile() {
  try {
    return JSON.parse(fs.readFileSync(KEYWORDS_PATH, "utf-8"));
  } catch (err) {
    return {};
  }
}

function writeKeywordsFile(obj) {
  fs.writeFileSync(KEYWORDS_PATH, JSON.stringify(obj, null, 2), "utf-8");
}

const DEFAULT_KEYWORD_SET = {
  default: "សូមអរគុណសម្រាប់មតិយោបល់! យើងខ្ញុំនឹងឆ្លើយតបទៅអ្នកឆាប់ៗនេះ 🙏",
};

function getKeywordsForPage(pageId) {
  const raw = readKeywordsFile();

  // New shape: { pages: { [pageId]: {...} } }
  if (raw.pages) {
    if (raw.pages[pageId]) return raw.pages[pageId];
    // Seed a brand-new page with the legacy global set (if any) so existing
    // keyword work isn't lost, otherwise fall back to a sane default.
    const seed = raw.legacyDefault || DEFAULT_KEYWORD_SET;
    raw.pages[pageId] = { ...seed };
    writeKeywordsFile(raw);
    return raw.pages[pageId];
  }

  // Legacy shape: the whole file was one flat keyword set (no "pages" key).
  // Migrate it into the new shape, keeping it around as a template for any
  // page that doesn't have its own set yet.
  const legacyDefault = Object.keys(raw).length > 0 ? raw : DEFAULT_KEYWORD_SET;
  const migrated = { legacyDefault, pages: { [pageId]: { ...legacyDefault } } };
  writeKeywordsFile(migrated);
  return migrated.pages[pageId];
}

function saveKeywordsForPage(pageId, keywordSet) {
  const raw = readKeywordsFile();
  const normalized = raw.pages ? raw : { legacyDefault: raw, pages: {} };
  normalized.pages[pageId] = keywordSet;
  writeKeywordsFile(normalized);
}

// =================================================================
// In-memory activity log (ring buffer) — now tagged with page info
// =================================================================

const MAX_LOG_ENTRIES = 150;
let activityLog = [];

function pushLog(entry) {
  activityLog.unshift({ time: new Date().toISOString(), ...entry });
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog = activityLog.slice(0, MAX_LOG_ENTRIES);
  }
}

function getLogs() {
  return activityLog;
}

// =================================================================
// Replied-comment tracking (prevents duplicate replies), shared
// across all pages since Facebook comment IDs are globally unique.
// =================================================================

const MAX_REPLIED_IDS = 3000;
let repliedSet = null;

function loadRepliedSet() {
  if (repliedSet) return repliedSet;
  try {
    const raw = JSON.parse(fs.readFileSync(REPLIED_PATH, "utf-8"));
    repliedSet = new Set(Array.isArray(raw) ? raw : []);
  } catch (err) {
    repliedSet = new Set();
  }
  return repliedSet;
}

function hasReplied(commentId) {
  return loadRepliedSet().has(commentId);
}

function markReplied(commentId) {
  const set = loadRepliedSet();
  set.add(commentId);
  if (set.size > MAX_REPLIED_IDS) {
    const excess = set.size - MAX_REPLIED_IDS;
    const it = set.values();
    for (let i = 0; i < excess; i++) set.delete(it.next().value);
  }
  try {
    fs.writeFileSync(REPLIED_PATH, JSON.stringify([...set]), "utf-8");
  } catch (err) {
    console.error("⚠️ Could not persist replied-comments file:", err.message);
  }
}

// =================================================================
// Users: email+password accounts, plus Facebook/Google OAuth identities.
// Passwords are hashed with scrypt (Node's built-in, no extra dependency).
// =================================================================

function readUsersFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
    return Array.isArray(raw.users) ? raw.users : [];
  } catch (err) {
    return [];
  }
}

function writeUsersFile(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2), "utf-8");
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(plain, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch (err) {
    return false;
  }
}

function findUserByEmail(email) {
  const users = readUsersFile();
  return users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase()) || null;
}

function findUserByProvider(provider, providerId) {
  const key = provider === "facebook" ? "facebookUserId" : "googleUserId";
  const users = readUsersFile();
  return users.find((u) => u[key] === providerId) || null;
}

function getUserById(userId) {
  return readUsersFile().find((u) => u.userId === userId) || null;
}

// Creates a new user, or if an OAuth provider identity matches an existing
// account (matched by email), links the provider to that existing account
// instead of creating a duplicate.
function createUser({ name, email, passwordHash, facebookUserId, googleUserId }) {
  const users = readUsersFile();

  if (email) {
    const existing = users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      if (facebookUserId) existing.facebookUserId = facebookUserId;
      if (googleUserId) existing.googleUserId = googleUserId;
      writeUsersFile(users);
      return existing;
    }
  }

  const user = {
    userId: crypto.randomBytes(12).toString("hex"),
    name: name || (email ? email.split("@")[0] : "អ្នកប្រើប្រាស់"),
    email: email || null,
    passwordHash: passwordHash || null,
    facebookUserId: facebookUserId || null,
    googleUserId: googleUserId || null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsersFile(users);
  return user;
}

module.exports = {
  loadConfig,
  saveConfig,
  loadPages,
  savePages,
  getPage,
  upsertPage,
  updatePage,
  removePage,
  loadPagesForUser,
  getPageForUser,
  getKeywordsForPage,
  saveKeywordsForPage,
  pushLog,
  getLogs,
  hasReplied,
  markReplied,
  SUPER_ADMIN_ID,
  // users
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserByProvider,
  createUser,
  getUserById,
};
