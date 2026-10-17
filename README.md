# antigravity2openai-cf

Serverless **OpenAI-compatible API Proxy** (`/v1/chat/completions` & `/v1/models`) powered by **Google Antigravity OAuth** running entirely on **Cloudflare Workers** + **Cloudflare KV**.

No 24/7 VPS or background local daemon required. Authenticate once through the built-in `/setup` Web UI by pasting your Google OAuth redirect URL, and your Cloudflare Worker automatically manages token refreshes on the edge.

---

## Key Features

- **100% Serverless on Cloudflare Edge:** Runs on Cloudflare Workers with zero runtime npm dependencies (pure Web Fetch, Web Crypto, and Web Streams APIs).
- **Interactive `/setup` OAuth Dashboard:** Built-in web UI (inspired by 9Router / OmniRoute) — click **Open Google OAuth Login**, copy-paste the `http://localhost:8085/?code=...` callback URL, and the Worker exchanges & stores your `refresh_token` in Cloudflare KV.
- **Automatic Token Refresh & Project Discovery:** Automatically refreshes expired `access_token`s (< 5 mins remaining), retries on `401 Unauthorized`, and auto-discovers your Antigravity Google Cloud `project_id`.
- **Full OpenAI Compatibility:**
  - `GET /v1/models` — Lists supported Gemini 3.x/4.x, Claude Sonnet/Opus 4.6, and GPT-OSS models.
  - `POST /v1/chat/completions` — Supports both unary (`stream: false`) and SSE streaming (`stream: true`), `reasoning_content` (thinking tokens), multimodal images (`image_url`), and function/tool calling (`tools` / `tool_calls`).

---

## Project Structure

```text
antigravity2openai-cf/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── .dev.vars.example
└── src/
    ├── index.ts                # Worker entry point, CORS, & route dispatcher
    ├── types.ts                # TypeScript interfaces (Env, OpenAI, Antigravity)
    ├── kv.ts                   # Cloudflare KV token state storage helpers
    ├── oauth.ts                # Google OAuth URL generator, code exchange, & auto-refresh
    ├── ui/
    │   └── setup.ts            # Interactive /setup Web Dashboard & /setup/connect handler
    ├── antigravity/
    │   └── client.ts           # Antigravity v1internal client with multi-endpoint failover
    └── converters/
        ├── models.ts           # Model registry & alias mapper (/v1/models)
        ├── request.ts          # OpenAI -> Antigravity request & tool schema converter
        └── response.ts         # Antigravity -> OpenAI unary & SSE stream transformer
```

---

## Quick Start Guide

### Step 1: Clone & Install

```bash
git clone https://github.com/ridloabelian/antigravity2openai-cf.git
cd antigravity2openai-cf
npm install
```

### Step 2: Create Cloudflare KV Namespace & Set Secrets

1. Log in to Cloudflare Wrangler (if you haven't already):
   ```bash
   npx wrangler login
   ```

2. Create the `ANTIGRAVITY_KV` namespace:
   ```bash
   npx wrangler kv namespace create ANTIGRAVITY_KV
   ```
   Copy the `id` from the terminal output and paste it into `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "ANTIGRAVITY_KV"
   id = "YOUR_KV_NAMESPACE_ID_HERE"
   ```

3. Set your `API_KEY` (used by AI clients like Cursor/Cline) and `ADMIN_PASSWORD` (used to protect `/setup`):
   ```bash
   npx wrangler secret put API_KEY
   npx wrangler secret put ADMIN_PASSWORD
   ```

### Step 3: Deploy to Cloudflare Workers

```bash
npm run deploy
# or: npx wrangler deploy
```

Wrangler will output your live Worker URL, for example:
`https://antigravity2openai-cf.<your-subdomain>.workers.dev`

### Step 4: Connect Google OAuth via `/setup`

1. Open `https://antigravity2openai-cf.<your-subdomain>.workers.dev/setup` in your browser.
2. Enter your `ADMIN_PASSWORD` to unlock the dashboard.
3. Click **"1. Open Google OAuth Login"**.
4. Sign in with your Google account and approve access.
5. Your browser will redirect to `http://localhost:8085/?code=4/0A...` and show *"This site can’t be reached"*. **This is completely normal!**
6. Copy the **entire URL** from your browser's address bar, paste it into **"2. Paste Full Redirect URL or Auth Code here"** on the `/setup` page, and click **"Save & Connect"**.
7. The status badge will turn green (**Connected to Antigravity**) and display your linked Google email, discovered `project_id`, and live token countdown.

---

## Step 5: Configure in Cursor / Cline / OpenCode

Use the following settings in any OpenAI-compatible client:

- **Base URL:** `https://antigravity2openai-cf.<your-subdomain>.workers.dev/v1`
- **API Key:** Your `API_KEY` secret value

### Cursor
1. Open **Cursor Settings** → **Models**.
2. Enable **OpenAI API Key** and enter your `API_KEY`.
3. Turn on **Override OpenAI Base URL** and set it to:
   `https://antigravity2openai-cf.<your-subdomain>.workers.dev/v1`
4. Add custom model names such as `gemini-3.8-flash`, `gemini-3.1-pro-high`, or `claude-sonnet-4-6`.

### Cline (VS Code Extension)
1. Open Cline Settings → **API Provider**: select **OpenAI Compatible**.
2. **Base URL**: `https://antigravity2openai-cf.<your-subdomain>.workers.dev/v1`
3. **API Key**: Your `API_KEY`
4. **Model ID**: `claude-sonnet-4-6` or `gemini-3.8-flash`

### OpenCode (`opencode.json`)
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "antigravity-cf": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Antigravity Cloudflare Proxy",
      "options": {
        "baseURL": "https://antigravity2openai-cf.<your-subdomain>.workers.dev/v1",
        "apiKey": "YOUR_API_KEY"
      },
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash"
        },
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6"
        },
        "claude-opus-4-6-thinking": {
          "name": "Claude Opus 4.6 Thinking"
        }
      }
    }
  }
}
```

---

## Available Models (`/v1/models`)

| Model ID | Description |
| :--- | :--- |
| `gemini-3.8-flash` | Google Gemini 3.8 Flash (Antigravity IDE default) |
| `gemini-3.7-flash` | Google Gemini 3.7 Flash |
| `gemini-3-flash` | Alias for `gemini-3.8-flash` |
| `gemini-3.1-pro-preview` | Alias for `gemini-3.8-flash` (or `gemini-4-argon` with `reasoning_effort`) |
| `gemini-3.1-pro-high` | Maps to `gemini-4-argon-high` |
| `gemini-3.1-pro-low` | Maps to `gemini-4-argon-low` |
| `gemini-4-argon` | Google Gemini 4 Argon (CLI route) |
| `claude-sonnet-4-6` | Anthropic Claude Sonnet 4.6 (also aliased as `claude-3-5-sonnet`, `claude-3-7-sonnet`) |
| `claude-opus-4-6-thinking` | Anthropic Claude Opus 4.6 Thinking |
| `gpt-oss-120b-medium` | OpenAI GPT-OSS 120B (Medium) |

---

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars`:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Start the local Cloudflare Worker dev server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:8787/setup` to test the OAuth dashboard locally.
