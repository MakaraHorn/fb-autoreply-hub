const loginScreen = document.getElementById("login-screen");
const appEl = document.getElementById("app");

let selectedKeywordPageId = null;

const ICON_EMPTY_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';
const ICON_EMPTY_PAGES = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const BADGE_ICONS = {
  sent: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
  failed: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  skipped: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>',
};
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>';

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) throw { unauthorized: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { apiError: true, message: data.error || "Request failed" };
  return data;
}

// ---------------- Auth: tab switching ----------------

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`.auth-form[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

// ---------------- Auth: email login/signup ----------------
// Note: there's just ONE login form for everyone. If the email+password
// entered match the Super Admin's credentials, the server recognizes that
// automatically — no separate admin screen to find.

document.getElementById("email-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("email-login-error");
  errEl.textContent = "";
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    showApp();
  } catch (err) {
    errEl.textContent = err.message || "Email ឬ Password មិនត្រឹមត្រូវ";
  }
});

document.getElementById("email-signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("email-signup-error");
  errEl.textContent = "";
  const name = document.getElementById("signup-name").value;
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-password").value;
  try {
    await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });
    showApp();
  } catch (err) {
    errEl.textContent = err.message || "មិនអាចបង្កើតគណនីបានទេ";
  }
});

// ---------------- Auth: social login ----------------

document.getElementById("social-login-fb").addEventListener("click", () => {
  window.location.href = "/auth/facebook/login";
});
document.getElementById("social-login-google").addEventListener("click", () => {
  window.location.href = "/auth/google/login";
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  appEl.classList.add("hidden");
  loginScreen.classList.remove("hidden");
});

function showApp() {
  loginScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  refreshAll();
}

async function loadCurrentUserInfo() {
  try {
    const me = await api("/api/me");
    const el = document.getElementById("current-user-info");
    if (me.isSuperAdmin) {
      el.innerHTML = `<div class="user-avatar">${ICON_SHIELD}</div><div><span class="user-badge">${ICON_SHIELD} Super Admin</span></div>`;
    } else {
      el.innerHTML = `<div class="user-avatar">${initials(me.name)}</div><div><div class="user-name">${escapeHtml(me.name || "")}</div>${
        me.email ? `<div class="user-email">${escapeHtml(me.email)}</div>` : ""
      }</div>`;
    }
  } catch (err) {
    // ignore
  }
}

function refreshAll() {
  loadCurrentUserInfo();
  loadOverview();
  loadKeywordPageOptions();
  loadActivity();
  loadSettingsPages();
  loadVerifyToken();
  loadFbLoginState();
}

(async function initialCheck() {
  try {
    await api("/api/status");
    showApp();
  } catch (err) {
    loginScreen.classList.remove("hidden");
  }
})();

// ---------------- Navigation ----------------

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

// ---------------- Overview ----------------

async function loadOverview() {
  try {
    const data = await api("/api/status");
    document.getElementById("status-dot").classList.add("online");
    document.getElementById("stat-server").textContent = "កំពុងដំណើរការ";
    document.getElementById("stat-page-count").textContent = data.pageCount;
    document.getElementById("stat-count").textContent = data.recentActivityCount;

    const pagesListEl = document.getElementById("overview-pages-list");
    if (data.pages.length === 0) {
      pagesListEl.innerHTML = `<div class="empty-state">${ICON_EMPTY_PAGES}<span>មិនទាន់មាន Page ណាមួយត្រូវបានភ្ជាប់ទេ — ចូល Tab "ការកំណត់"</span></div>`;
    } else {
      pagesListEl.innerHTML = data.pages
        .map((p) => `<div class="page-chip"><span class="page-chip-dot"></span>${escapeHtml(p.pageName)}</div>`)
        .join("");
    }

    const lastActivityEl = document.getElementById("overview-last-activity");
    lastActivityEl.innerHTML = data.lastActivity
      ? renderActivityItem(data.lastActivity)
      : `<div class="empty-state">${ICON_EMPTY_INBOX}<span>មិនទាន់មាន Comment ណាមួយត្រូវបានដំណើរការទេ</span></div>`;
  } catch (err) {
    // session may have expired mid-session; ignore
  }
}

// ---------------- Keywords (per page) ----------------

async function loadKeywordPageOptions() {
  const pages = await api("/api/pages");
  const select = document.getElementById("keyword-page-select");
  const content = document.getElementById("keywords-content");
  const emptyState = document.getElementById("keywords-empty-state");

  if (pages.length === 0) {
    content.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `<div class="empty-state">${ICON_EMPTY_PAGES}<span>សូមភ្ជាប់ Page យ៉ាងហោចណាស់មួយជាមុនសិន (ចូល Tab "ការកំណត់")</span></div>`;
    select.innerHTML = "";
    return;
  }

  content.classList.remove("hidden");
  emptyState.classList.add("hidden");

  select.innerHTML = pages.map((p) => `<option value="${p.pageId}">${escapeHtml(p.pageName)}</option>`).join("");

  if (!selectedKeywordPageId || !pages.find((p) => p.pageId === selectedKeywordPageId)) {
    selectedKeywordPageId = pages[0].pageId;
  }
  select.value = selectedKeywordPageId;
  loadKeywords(selectedKeywordPageId);
}

document.getElementById("keyword-page-select").addEventListener("change", (e) => {
  selectedKeywordPageId = e.target.value;
  loadKeywords(selectedKeywordPageId);
});

document.getElementById("keyword-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = document.getElementById("kw-key").value.trim();
  const value = document.getElementById("kw-value").value.trim();
  if (!key || !value || !selectedKeywordPageId) return;

  await api("/api/keywords", {
    method: "POST",
    body: JSON.stringify({ pageId: selectedKeywordPageId, key, value }),
  });

  document.getElementById("kw-key").value = "";
  document.getElementById("kw-value").value = "";
  loadKeywords(selectedKeywordPageId);
});

async function loadKeywords(pageId) {
  const keywords = await api(`/api/keywords?pageId=${encodeURIComponent(pageId)}`);
  const listEl = document.getElementById("keyword-list");
  listEl.innerHTML = "";

  Object.entries(keywords).forEach(([key, value]) => {
    if (key === "_comment") return;
    const item = document.createElement("div");
    item.className = "keyword-item";
    item.innerHTML = `
      <span class="keyword-key ${key === "default" ? "default" : ""}">${escapeHtml(key)}</span>
      <span class="keyword-value">${escapeHtml(value)}</span>
      ${key !== "default" ? `<button class="keyword-delete" data-key="${escapeHtml(key)}">${TRASH_ICON}</button>` : ""}
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll(".keyword-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/keywords/${encodeURIComponent(selectedKeywordPageId)}/${encodeURIComponent(btn.dataset.key)}`, {
        method: "DELETE",
      });
      loadKeywords(selectedKeywordPageId);
    });
  });
}

// ---------------- Activity ----------------

function renderActivityItem(entry) {
  const time = new Date(entry.time).toLocaleTimeString("km-KH", { hour: "2-digit", minute: "2-digit" });
  const badgeLabel = { sent: "បានឆ្លើយ", failed: "បរាជ័យ", skipped: "រំលង" }[entry.status] || entry.status;
  return `
    <div class="activity-item">
      <span class="activity-time">${time}</span>
      <div>
        <div class="activity-comment">
          ${entry.pageName ? `<span class="page-tag">${escapeHtml(entry.pageName)}</span>` : ""}
          ${escapeHtml(entry.commentText)}
        </div>
        <div class="activity-meta">
          <span class="badge ${entry.status}">${BADGE_ICONS[entry.status] || ""} ${badgeLabel}</span>
          ${entry.matchedKeyword ? `<span>ពាក្យគន្លឹះ: ${escapeHtml(entry.matchedKeyword)}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

async function loadActivity() {
  const logs = await api("/api/logs");
  const feedEl = document.getElementById("activity-feed");
  feedEl.innerHTML = logs.length
    ? logs.map(renderActivityItem).join("")
    : `<div class="empty-state">${ICON_EMPTY_INBOX}<span>មិនទាន់មាន Comment ណាមួយត្រូវបានដំណើរការទេ</span></div>`;
}

// ---------------- Settings: connected pages management ----------------

async function loadSettingsPages() {
  const pages = await api("/api/pages");
  const listEl = document.getElementById("pages-list");

  if (pages.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${ICON_EMPTY_PAGES}<span>មិនទាន់មាន Page ណាមួយត្រូវបានភ្ជាប់ទេ</span></div>`;
    return;
  }

  listEl.innerHTML = pages
    .map(
      (p) => `
    <div class="page-manage-item" data-page-id="${p.pageId}">
      <div class="page-manage-avatar">${initials(p.pageName)}</div>
      <div class="page-manage-info">
        <div class="page-manage-name">
          ${escapeHtml(p.pageName)}
          ${p.tokenValid ? `<span class="badge sent">${BADGE_ICONS.sent} Token ត្រឹមត្រូវ</span>` : `<span class="badge failed">${BADGE_ICONS.failed} Token មានបញ្ហា</span>`}
        </div>
        <div class="hint" style="margin:0;">Token: <code class="hint-code">${p.tokenMasked}</code></div>
      </div>
      <label class="toggle-row">
        <input type="checkbox" class="default-reply-toggle" data-page-id="${p.pageId}" ${p.defaultReplyEnabled ? "checked" : ""} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="toggle-label">ឆ្លើយតបលំនាំដើម</span>
      </label>
      <button class="page-remove-btn" data-page-id="${p.pageId}">${TRASH_ICON} លុប</button>
    </div>
  `
    )
    .join("");

  listEl.querySelectorAll(".default-reply-toggle").forEach((toggle) => {
    toggle.addEventListener("change", async (e) => {
      await api(`/api/pages/${encodeURIComponent(e.target.dataset.pageId)}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultReplyEnabled: e.target.checked }),
      });
    });
  });

  listEl.querySelectorAll(".page-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("តើអ្នកប្រាកដថាចង់លុប Page នេះចេញពី Bot មែនទេ?")) return;
      await api(`/api/pages/${encodeURIComponent(btn.dataset.pageId)}`, { method: "DELETE" });
      refreshAll();
    });
  });
}

document.getElementById("manual-page-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tokenInput = document.getElementById("manual-page-token");
  const token = tokenInput.value.trim();
  if (!token) return;
  const msg = document.getElementById("manual-page-msg");
  msg.textContent = "";
  msg.classList.remove("success", "error-text");

  try {
    const data = await api("/api/pages/manual", { method: "POST", body: JSON.stringify({ pageAccessToken: token }) });
    tokenInput.value = "";
    msg.textContent = `✅ បន្ថែម Page "${data.page.pageName}" ជោគជ័យ`;
    msg.classList.add("success");
    refreshAll();
  } catch (err) {
    msg.textContent = "❌ " + (err.message || "កំហុសមិនស្គាល់");
    msg.classList.add("error-text");
  }
});

// ---------------- Settings: verify token + Facebook login ----------------

async function loadVerifyToken() {
  const data = await api("/api/settings");
  document.getElementById("verify-token-display").textContent = data.verifyToken || "មិនទាន់កំណត់";
}

async function loadFbLoginState() {
  const data = await api("/api/settings");
  const loginBtn = document.getElementById("fb-login-btn");
  const loginMsg = document.getElementById("fb-login-msg");
  if (!data.fbLoginEnabled) {
    loginBtn.disabled = true;
    loginMsg.textContent = "⚠️ មិនទាន់កំណត់ FB_APP_ID / FB_APP_SECRET ក្នុង Server (មើល README)";
  } else {
    loginBtn.disabled = false;
    loginMsg.textContent = "";
  }
}

document.getElementById("fb-login-btn").addEventListener("click", () => {
  window.location.href = "/auth/facebook/login";
});

// Handle redirect back from the Facebook OAuth flow
(function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("fb") === "success") {
    window.history.replaceState({}, "", window.location.pathname);
    const showMsg = () => {
      const msg = document.getElementById("fb-login-msg");
      if (msg) {
        msg.textContent = "✅ ភ្ជាប់ Page ជោគជ័យ!";
        msg.classList.add("success");
      }
    };
    if (!appEl.classList.contains("hidden")) showMsg();
    else document.addEventListener("DOMContentLoaded", showMsg);
  }
})();

// Auto-refresh overview + activity every 8s while app is visible
setInterval(() => {
  if (!appEl.classList.contains("hidden")) {
    loadOverview();
    loadActivity();
  }
}, 8000);
