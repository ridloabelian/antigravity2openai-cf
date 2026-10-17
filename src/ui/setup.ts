import { clearTokenState, getTokenState } from "../kv";
import {
  exchangeCodeAndSave,
  generateAuthUrl,
  getValidAccessToken,
} from "../oauth";
import { AntigravityTokenState, Env } from "../types";

const ADMIN_COOKIE_NAME = "ag_admin_token";

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Extract a cookie value by name from the `Cookie` header.
 */
function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const part of cookies) {
    const [k, ...vParts] = part.trim().split("=");
    if (k === name) {
      return decodeURIComponent(vParts.join("="));
    }
  }
  return null;
}

/**
 * Check if the incoming request is authorized to access `/setup`.
 * Supports:
 * 1. If `env.ADMIN_PASSWORD` is not set/empty, allows access (with a warning banner in UI).
 * 2. HTTP Basic Auth (`Authorization: Basic base64(user:ADMIN_PASSWORD)`)
 * 3. Bearer Token (`Authorization: Bearer <ADMIN_PASSWORD>`)
 * 4. Custom header (`X-Admin-Password: <ADMIN_PASSWORD>`)
 * 5. Cookie (`ag_admin_token=<ADMIN_PASSWORD>`)
 * 6. Query parameter (`?password=<ADMIN_PASSWORD>` or `?key=<ADMIN_PASSWORD>`)
 */
function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const adminPassword = env.ADMIN_PASSWORD?.trim();
  if (!adminPassword) {
    return true;
  }

  // 1. Check query parameter
  const url = new URL(request.url);
  const queryKey =
    url.searchParams.get("password") ?? url.searchParams.get("key");
  if (queryKey && timingSafeEqual(queryKey, adminPassword)) {
    return true;
  }

  // 2. Check X-Admin-Password header
  const headerPass = request.headers.get("X-Admin-Password");
  if (headerPass && timingSafeEqual(headerPass.trim(), adminPassword)) {
    return true;
  }

  // 3. Check Authorization header (Basic or Bearer)
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (timingSafeEqual(token, adminPassword)) {
        return true;
      }
    } else if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = atob(authHeader.slice(6).trim());
        const colonIdx = decoded.indexOf(":");
        const pass =
          colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
        if (timingSafeEqual(pass, adminPassword)) {
          return true;
        }
      } catch {
        // Ignore invalid base64
      }
    }
  }

  // 4. Check Cookie
  const cookieToken = getCookie(request, ADMIN_COOKIE_NAME);
  if (cookieToken && timingSafeEqual(cookieToken, adminPassword)) {
    return true;
  }

  return false;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the Admin Login HTML page when `ADMIN_PASSWORD` is configured and user is not authenticated.
 */
function renderLoginPage(errorMsg?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Login — Antigravity2OpenAI Setup</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: radial-gradient(circle at top, #1e1b4b 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .login-card {
      background: rgba(17, 24, 39, 0.9);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 2.25rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #a5b4fc;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 0.3rem 0.65rem;
      border-radius: 999px;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.45rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    p {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: #d1d5db;
      margin-bottom: 0.45rem;
    }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem 0.9rem;
      background: #0b0f19;
      border: 1px solid #374151;
      border-radius: 10px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 1.1rem;
    }
    input[type="password"]:focus {
      border-color: var(--primary);
    }
    button {
      width: 100%;
      padding: 0.8rem 1rem;
      background: var(--primary);
      color: white;
      font-weight: 600;
      font-size: 0.95rem;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover {
      background: var(--primary-hover);
    }
    .error {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      padding: 0.7rem 0.9rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="badge">Cloudflare Worker Edge Proxy</div>
    <h1>Antigravity2OpenAI Setup</h1>
    <p>Enter your <code>ADMIN_PASSWORD</code> secret to access the OAuth configuration dashboard.</p>
    ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ""}
    <form method="POST" action="/setup/login">
      <label for="password">Admin Password</label>
      <input type="password" id="password" name="password" placeholder="Enter ADMIN_PASSWORD..." required autofocus />
      <button type="submit">Unlock Dashboard</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Render the main interactive OAuth Setup Dashboard HTML.
 */
function renderSetupDashboard(
  request: Request,
  env: Env,
  state: AntigravityTokenState | null,
  flashMessage?: { type: "success" | "error"; text: string }
): string {
  const url = new URL(request.url);
  const workerOrigin = `${url.protocol}//${url.host}`;
  const baseUrlV1 = `${workerOrigin}/v1`;
  const oauthUrl = generateAuthUrl(env);
  const isConnected = Boolean(state?.refresh_token);
  const expiresAtMs = state?.access_token_expires_at ?? 0;
  const adminPasswordConfigured = Boolean(env.ADMIN_PASSWORD?.trim());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Antigravity2OpenAI — Cloudflare Worker OAuth Dashboard</title>
  <style>
    :root {
      --bg: #070b14;
      --card: #111827;
      --card-alt: #0d1322;
      --border: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1.25rem 4rem;
      line-height: 1.5;
    }
    .container {
      max-width: 920px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .brand-icon {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.2rem;
      color: white;
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
    }
    .brand-text h1 {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-text span {
      font-size: 0.82rem;
      color: var(--muted);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.9rem;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .status-connected {
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
    }
    .status-disconnected {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }
    .alert {
      padding: 0.9rem 1.1rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .alert-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #6ee7b7;
    }
    .alert-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    .alert-warning {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #fcd34d;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }
    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
    }
    .card {
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.6rem;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    }
    .card h2 {
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card p.subtitle {
      color: var(--muted);
      font-size: 0.84rem;
      margin-bottom: 1.25rem;
    }
    .step-box {
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.1rem;
      margin-bottom: 1rem;
    }
    .step-header {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #a5b4fc;
      margin-bottom: 0.4rem;
    }
    .step-desc {
      font-size: 0.84rem;
      color: var(--muted);
      margin-bottom: 0.85rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.7rem 1.1rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
      width: 100%;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    .btn-oauth {
      background: #ffffff;
      color: #0f172a;
      width: 100%;
    }
    .btn-oauth:hover {
      background: #e2e8f0;
    }
    .btn-outline {
      background: transparent;
      border: 1px solid #334155;
      color: #cbd5e1;
      font-size: 0.82rem;
      padding: 0.5rem 0.85rem;
    }
    .btn-outline:hover {
      background: #1e293b;
      color: white;
    }
    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      font-size: 0.82rem;
      padding: 0.5rem 0.85rem;
    }
    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 0.35rem;
    }
    textarea, input[type="text"] {
      width: 100%;
      background: #070b14;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 0.7rem 0.85rem;
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.83rem;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 0.85rem;
    }
    textarea {
      resize: vertical;
      min-height: 78px;
    }
    textarea:focus, input[type="text"]:focus {
      border-color: var(--primary);
    }
    .stat-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.65rem 0.85rem;
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.85rem;
    }
    .stat-label {
      color: var(--muted);
      font-weight: 500;
    }
    .stat-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.83rem;
      color: #e2e8f0;
      font-weight: 600;
      text-align: right;
      word-break: break-all;
      max-width: 65%;
    }
    .copy-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #070b14;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 0.55rem 0.75rem;
      margin-top: 0.35rem;
      margin-bottom: 1rem;
    }
    .copy-box code {
      flex: 1;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      color: #a5b4fc;
      overflow-x: auto;
      white-space: nowrap;
    }
    .actions-row {
      display: flex;
      gap: 0.65rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
    pre.code-snippet {
      background: #070b14;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.9rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #cbd5e1;
      overflow-x: auto;
      line-height: 1.55;
    }
    #toast {
      display: none;
      margin-top: 0.75rem;
      padding: 0.7rem 0.9rem;
      border-radius: 10px;
      font-size: 0.84rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">AG</div>
        <div class="brand-text">
          <h1>antigravity2openai-cf</h1>
          <span>Serverless Google Antigravity OAuth Proxy on Cloudflare Workers</span>
        </div>
      </div>
      <div class="status-pill ${isConnected ? "status-connected" : "status-disconnected"}" id="header-status">
        <span class="dot"></span>
        <span>${isConnected ? "Connected to Antigravity" : "Disconnected"}</span>
      </div>
    </header>

    ${
      !adminPasswordConfigured
        ? `<div class="alert alert-warning">
            <span><strong>Security Notice:</strong> <code>ADMIN_PASSWORD</code> secret is not set. Anyone with this link can view this page. Run <code>npx wrangler secret put ADMIN_PASSWORD</code> to lock it.</span>
          </div>`
        : ""
    }

    ${
      flashMessage
        ? `<div class="alert ${flashMessage.type === "success" ? "alert-success" : "alert-error"}">
            <span>${escapeHtml(flashMessage.text)}</span>
          </div>`
        : ""
    }

    <div class="grid">
      <!-- Left Column: Interactive OAuth Flow -->
      <div class="card">
        <h2>OAuth Code Exchange Setup</h2>
        <p class="subtitle">Connect your Google account in 2 steps without running a local server.</p>

        <div class="step-box">
          <div class="step-header">Step 1 — Authorize with Google</div>
          <div class="step-desc">
            Click the button below to open Google OAuth login in a new tab. After signing in, your browser will redirect to <code>http://localhost:8085/?code=...</code> (which will show "This site can’t be reached" — <strong>that is normal!</strong>).
          </div>
          <a href="${escapeHtml(oauthUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-oauth">
            1. Open Google OAuth Login ↗
          </a>
        </div>

        <div class="step-box" style="margin-bottom: 0;">
          <div class="step-header">Step 2 — Paste Callback URL or Code</div>
          <div class="step-desc">
            Copy the entire URL from your browser's address bar (<code>http://localhost:8085/?code=4/0A...</code>) or just the <code>code</code> / <code>refresh_token</code> and paste it below:
          </div>
          <form id="connect-form" method="POST" action="/setup/connect">
            <label for="codeOrUrl">2. Paste Full Redirect URL or Auth Code here</label>
            <textarea
              id="codeOrUrl"
              name="codeOrUrl"
              placeholder="http://localhost:8085/?state=...&code=4/0AeanS0...&scope=..."
              required
            ></textarea>

            <label for="projectId">Google Cloud Project ID (Optional — auto-discovered if blank)</label>
            <input
              type="text"
              id="projectId"
              name="projectId"
              placeholder="Leave blank for auto-discovery (e.g. rising-fact-p41fc)"
              value="${escapeHtml(state?.project_id ?? "")}"
            />

            <button type="submit" class="btn btn-primary" id="submit-btn">
              Save &amp; Connect
            </button>
          </form>
          <div id="toast"></div>
        </div>
      </div>

      <!-- Right Column: Connection Status & Endpoint Info -->
      <div class="card">
        <h2>Connection Status &amp; Endpoint</h2>
        <p class="subtitle">Live token telemetry stored in Cloudflare KV (<code>ANTIGRAVITY_KV</code>).</p>

        <div class="stat-list">
          <div class="stat-row">
            <span class="stat-label">Auth Status</span>
            <span class="stat-value" style="color: ${isConnected ? "#34d399" : "#f87171"};">
              ${isConnected ? "● Connected (Active)" : "○ Disconnected"}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Google Account</span>
            <span class="stat-value">${escapeHtml(state?.user_email || "Not linked")}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Antigravity Project ID</span>
            <span class="stat-value">${escapeHtml(state?.project_id || env.DEFAULT_PROJECT_ID || "Not discovered")}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Access Token Expires In</span>
            <span class="stat-value" id="expiry-countdown" data-expires="${expiresAtMs}">
              ${isConnected ? "Calculating..." : "N/A"}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Last Refreshed</span>
            <span class="stat-value">${escapeHtml(state?.updated_at ? new Date(state.updated_at).toLocaleString() : "Never")}</span>
          </div>
        </div>

        <label>OpenAI Base URL (Copy to Cursor / Cline / OpenCode)</label>
        <div class="copy-box">
          <code id="base-url-code">${escapeHtml(baseUrlV1)}</code>
          <button type="button" class="btn btn-outline" onclick="copyBaseUrl()">Copy URL</button>
        </div>

        <div class="actions-row">
          <form method="POST" action="/setup/refresh" style="display:inline;">
            <button type="submit" class="btn btn-outline">↻ Force Refresh Token</button>
          </form>
          <a href="/v1/models" target="_blank" class="btn btn-outline">View /v1/models ↗</a>
          ${
            isConnected
              ? `<form method="POST" action="/setup/disconnect" style="display:inline;" onsubmit="return confirm('Disconnect and clear stored OAuth tokens from KV?');">
                  <button type="submit" class="btn btn-danger">Disconnect</button>
                </form>`
              : ""
          }
        </div>
      </div>
    </div>

    <!-- Bottom Card: Quick Test & Client Configuration -->
    <div class="card">
      <h2>Quick Test &amp; Client Configuration</h2>
      <p class="subtitle">Use any OpenAI-compatible SDK or AI coding assistant with your Worker URL and <code>API_KEY</code>.</p>
      <pre class="code-snippet">curl ${escapeHtml(baseUrlV1)}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [{"role": "user", "content": "Hello from Cloudflare Workers!"}],
    "stream": true
  }'</pre>
    </div>
  </div>

  <script>
    function copyBaseUrl() {
      const text = document.getElementById("base-url-code").innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert("Copied Base URL: " + text);
      });
    }

    // Live countdown for access_token expiration
    const countdownEl = document.getElementById("expiry-countdown");
    const expiresAt = Number(countdownEl?.getAttribute("data-expires") || 0);

    function updateCountdown() {
      if (!expiresAt) return;
      const now = Date.now();
      const diffSec = Math.floor((expiresAt - now) / 1000);
      if (diffSec <= 0) {
        countdownEl.textContent = "Expired (Will auto-refresh on next API request)";
        countdownEl.style.color = "#fcd34d";
        return;
      }
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      countdownEl.textContent = mins + "m " + secs + "s (Auto-refreshes < 5m)";
      countdownEl.style.color = mins < 5 ? "#fcd34d" : "#34d399";
    }

    if (expiresAt > 0) {
      updateCountdown();
      setInterval(updateCountdown, 1000);
    }

    // Progressive enhancement for AJAX form submission
    const form = document.getElementById("connect-form");
    const submitBtn = document.getElementById("submit-btn");
    const toast = document.getElementById("toast");

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeOrUrl = document.getElementById("codeOrUrl").value.trim();
      const projectId = document.getElementById("projectId").value.trim();
      if (!codeOrUrl) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "Exchanging OAuth Code...";
      toast.style.display = "none";

      try {
        const res = await fetch("/setup/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ codeOrUrl, projectId })
        });
        const data = await res.json();
        toast.style.display = "block";
        if (res.ok && data.success) {
          toast.className = "alert alert-success";
          toast.textContent = "Connected! Account: " + (data.state?.user_email || "Linked") + " | Project: " + (data.state?.project_id || "Ready") + ". Reloading...";
          setTimeout(() => window.location.reload(), 1000);
        } else {
          toast.className = "alert alert-error";
          toast.textContent = data.error || "Failed to exchange OAuth code.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Save & Connect";
        }
      } catch (err) {
        toast.style.display = "block";
        toast.className = "alert alert-error";
        toast.textContent = "Network error: " + err.message;
        submitBtn.disabled = false;
        submitBtn.textContent = "Save & Connect";
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Main router handler for `/setup` and `/setup/*` endpoints.
 */
export async function handleSetupRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/setup";

  // Handle POST /setup/login before checking admin auth
  if (path === "/setup/login" && request.method === "POST") {
    const adminPassword = env.ADMIN_PASSWORD?.trim();
    if (!adminPassword) {
      return Response.redirect(`${url.origin}/setup`, 302);
    }

    let submittedPassword = "";
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as {
        password?: string;
      };
      submittedPassword = body.password ?? "";
    } else {
      const formData = await request.formData().catch(() => null);
      submittedPassword = String(formData?.get("password") ?? "");
    }

    if (timingSafeEqual(submittedPassword.trim(), adminPassword)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/setup",
          "Set-Cookie": `${ADMIN_COOKIE_NAME}=${encodeURIComponent(
            adminPassword
          )}; Path=/setup; HttpOnly; SameSite=Lax; Max-Age=604800`,
        },
      });
    }

    return new Response(renderLoginPage("Invalid ADMIN_PASSWORD."), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Verify admin authorization for all other /setup routes
  if (!isAuthorizedAdmin(request, env)) {
    const acceptsJson = (request.headers.get("Accept") || "").includes(
      "application/json"
    );
    if (acceptsJson) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized. Provide valid ADMIN_PASSWORD.",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response(renderLoginPage(), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // GET /setup -> Render Setup Dashboard
  if (path === "/setup" && request.method === "GET") {
    const state = await getTokenState(env);
    const html = renderSetupDashboard(request, env, state);

    // If user authenticated via ?password= or ?key= query param, set cookie so subsequent form posts work seamlessly
    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    };
    const queryKey =
      url.searchParams.get("password") ?? url.searchParams.get("key");
    if (queryKey && env.ADMIN_PASSWORD) {
      headers["Set-Cookie"] = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(
        env.ADMIN_PASSWORD.trim()
      )}; Path=/setup; HttpOnly; SameSite=Lax; Max-Age=604800`;
    }

    return new Response(html, { status: 200, headers });
  }

  // POST /setup/connect -> Exchange OAuth code/URL and save to KV
  if (path === "/setup/connect" && request.method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const acceptsJson = (request.headers.get("Accept") || "").includes(
      "application/json"
    );

    let codeOrUrl = "";
    let projectId = "";

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as {
        codeOrUrl?: string;
        code?: string;
        url?: string;
        projectId?: string;
      };
      codeOrUrl = body.codeOrUrl || body.code || body.url || "";
      projectId = body.projectId || "";
    } else {
      const formData = await request.formData().catch(() => null);
      codeOrUrl = String(
        formData?.get("codeOrUrl") ?? formData?.get("code") ?? ""
      );
      projectId = String(formData?.get("projectId") ?? "");
    }

    try {
      const savedState = await exchangeCodeAndSave(
        env,
        codeOrUrl,
        projectId || undefined
      );

      if (acceptsJson || contentType.includes("application/json")) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Successfully connected Google Antigravity OAuth!",
            state: {
              project_id: savedState.project_id,
              user_email: savedState.user_email,
              access_token_expires_at: savedState.access_token_expires_at,
              updated_at: savedState.updated_at,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const html = renderSetupDashboard(request, env, savedState, {
        type: "success",
        text: `Connected Google account (${savedState.user_email || "Authenticated"}) with project "${savedState.project_id}"!`,
      });
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error during OAuth exchange";

      if (acceptsJson || contentType.includes("application/json")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: message,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const currentState = await getTokenState(env);
      const html = renderSetupDashboard(request, env, currentState, {
        type: "error",
        text: message,
      });
      return new Response(html, {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // POST /setup/refresh -> Force refresh the access token now
  if (path === "/setup/refresh" && request.method === "POST") {
    try {
      await getValidAccessToken(env, true);
      const state = await getTokenState(env);
      const html = renderSetupDashboard(request, env, state, {
        type: "success",
        text: "Access token refreshed and saved to Cloudflare KV!",
      });
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (err) {
      const currentState = await getTokenState(env);
      const message =
        err instanceof Error ? err.message : "Failed to refresh token";
      const html = renderSetupDashboard(request, env, currentState, {
        type: "error",
        text: message,
      });
      return new Response(html, {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // POST /setup/disconnect -> Clear stored tokens from KV
  if (path === "/setup/disconnect" && request.method === "POST") {
    await clearTokenState(env);
    const html = renderSetupDashboard(request, env, null, {
      type: "success",
      text: "Disconnected and cleared OAuth credentials from Cloudflare KV.",
    });
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
