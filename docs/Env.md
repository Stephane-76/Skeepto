# Environment file (`.env`)

Skeepto reads configuration from a **`.env` file**. That file is **gitignored**
and never pushed to GitHub. Only [`.env.example`](../.env.example) is in the
repository (variable names, no secrets).

Copy the example, then edit the copy:

```bash
cp .env.example Node/Server/.env
```

`npm start` in `Node/Server/` loads, in this order:

1. `Node/Server/.env` if it exists
2. otherwise `skeepto/.env` at the project root

Restart the server after any change. Electron desktop mode does **not** use this
file (no login, no mail, no MongoDB).

---

## Minimal local file

Enough to run the web app on your machine (MongoDB without auth). Mail is
optional until you test registration.

```env
PORT=8000
BIND_HOST=127.0.0.1
MONGO_URL=mongodb://localhost:27017/skeepto
MONGO_NO_AUTH=1
```

On **macOS / Windows**, add SMTP if you want verification emails (see [Mail](#mail)).
On a **Linux VPS**, you can omit SMTP and use system `msmtp` + `/etc/msmtprc`.

---

## Server

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8000` | HTTP port |
| `BIND_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only if you intentionally expose the port |
| `STATIC_ROOT` | `skeepto/build/` if present | Folder Fastify serves as the web UI. After `npm run build`, leave unset |
| `SKER_SERVER_URL` | `http://127.0.0.1:8000` | Base URL used by `Node/Client/SkInitServer.mjs` and some AI helpers |
| `SKER_PUBLIC_URL` | — | Public URL of this server (tunnels, reverse proxy). Also accepted as `SK_MCP_PUBLIC_URL` |

---

## MongoDB

If `MONGO_URL` is set, it wins over the individual `MONGO_*` parts.

| Variable | Default | Meaning |
|----------|---------|---------|
| `MONGO_URL` | built from the parts below | Full connection string, e.g. `mongodb://localhost:27017/skeepto` |
| `MONGO_HOST` | `localhost` | Host |
| `MONGO_PORT` | `27017` | Port |
| `MONGO_DB` | `skeepto` | Database name |
| `MONGO_NO_AUTH` | unset | `1` / `true` = no username/password (typical local Docker / Homebrew) |
| `MONGO_USER` | — | User when auth is on |
| `MONGO_PASSWORD` | — | Password |
| `MONGO_AUTH_SOURCE` | `admin` | Auth database |

Use a **dedicated** database (`skeepto`) so data does not mix with another app
on the same MongoDB.

---

## Auth and registration

| Variable | Default | Meaning |
|----------|---------|---------|
| `JWT_SECRET` | built-in dev string | **Change in production.** Signs session tokens |
| `SKER_ADMIN_EMAIL` | `admin@sker.com` | Bootstrap admin (used by `SkInitServer.mjs`) |
| `SKER_ADMIN_PASSWORD` | built-in dev password | Bootstrap admin password. **Change in production** |
| `SKER_DEFAULT_USER_GROUP` | `user` | Group assigned to new accounts |
| `SKER_REGISTRATION_ENABLED` | on | Set `0` or `false` to disable self-registration |
| `SKER_HISTORY_MAX_VERSIONS` | `50` | Max version snapshots kept per file on the virtual disk |

---

## Mail

Used for the **6-digit verification code** after `/register` (and Resend).

**Priority**

1. If `SMTP_HOST` is set → **nodemailer** SMTP
2. Else on **Linux** → system command `msmtp`
3. Else (macOS / Windows) → error: mail is not configured. The account is still
   created; the UI offers Resend once SMTP is set

| Variable | Default | Meaning |
|----------|---------|---------|
| `SMTP_HOST` | — | SMTP server. If set, `msmtp` is not used |
| `SMTP_PORT` | `465` | `465` = implicit TLS, `587` = STARTTLS |
| `SMTP_SECURE` | `true` when port is 465 | `true` / `false`. For port 587 use `false` |
| `SMTP_USER` | — | SMTP login |
| `SMTP_PASS` | — | SMTP password (or app-specific password) |
| `SMTP_FROM` | `SMTP_USER` | From header, e.g. `Skeepto <you@icloud.com>` |

### Example: iCloud

iCloud rejects the account password. Create an
[app-specific password](https://appleid.apple.com) first.

```env
SMTP_HOST=smtp.mail.me.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@icloud.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
SMTP_FROM=Skeepto <you@icloud.com>
```

### Example: classic SMTPS (port 465)

```env
SMTP_HOST=mail.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@example.com
SMTP_PASS=...
SMTP_FROM=Skeepto <noreply@example.com>
```

---

## Excel conversion pool

| Variable | Default | Meaning |
|----------|---------|---------|
| `SKEXCEL_POOL_KIND` | `child` | `child` = isolated Node processes (recommended) |
| `SKEXCEL_WASM_POOL_SIZE` | `1` | Number of converter workers |
| `SKEXCEL_WASM_MAX_JOBS` | `100` | Recycle a worker after this many jobs |
| `SKEXCEL_WASM_HEAVY_BYTES` | 8 MiB | Threshold for a “heavy” workbook |
| `SKEXCEL_WASM_VERBOSE` | off | `1` = extra converter logs |
| `SKEXCEL_LIB_PATH` | `Node/Server/SkExcelLib.cjs` | Override the converter binary path |

---

## Spreadsheet engine (server)

| Variable | Default | Meaning |
|----------|---------|---------|
| `SK_PERSIST_DEBOUNCE_MS` | engine default | Debounce before persisting a workbook |
| `SK_WORKBOOK_UNLOAD_GRACE_MS` | engine default | Grace period before unloading an idle workbook |
| `SK_SPREADSHEET_LANG` | — | Spreadsheet / AI locale hint |

---

## AI (optional)

Leave unset if you do not use the in-app assistant.

| Variable | Default | Meaning |
|----------|---------|---------|
| `SK_AI_PROVIDER` | `cursor` | `cursor` or local llama |
| `CURSOR_API_KEY` / `SK_CURSOR_API_KEY` | — | Cursor API key |
| `CURSOR_MODEL_ID` / `SK_CURSOR_MODEL_ID` | — | Model id |
| `SK_MCP_PUBLIC_URL` | `SKER_PUBLIC_URL` / `SKER_SERVER_URL` | Public URL so an agent can reach MCP |
| `SK_AI_POLL_MS` | `1000` | Poll interval (ms) |
| `SK_AI_REUSE_AGENT` | on | `0` = do not reuse the agent session |
| `SK_AI_IMMEDIATE_PERSIST` | off | `1` = persist tool writes immediately |
| `SK_AI_USER_ID` | `sker-ai` | Identity of the assistant in collab |
| `SK_AI_USER_EMAIL` | `assistant@sker.ai` | |
| `SK_AI_USER_FIRSTNAME` | `Sker` | |
| `SK_AI_USER_LASTNAME` | `Assistant` | |
| `SK_AI_SPREADSHEET_ROOM` | `spreadsheet` | Collab room id |

### Local llama-server

| Variable | Default | Meaning |
|----------|---------|---------|
| `SK_LLAMA_MCP` | off | `1` = enable llama MCP tools |
| `SK_LLAMA_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible endpoint |
| `SK_LLAMA_MODEL` | `Qwen3.5-35B-A3B` | Model name sent to llama-server |
| `SK_LLAMA_MAX_TOKENS` | `384` | |
| `SK_LLAMA_TEMPERATURE` | `0.1` | |
| `SK_LLAMA_MCP_MAX_STEPS` | `16` | |
| `SK_LLAMA_MCP_JSON_RETRIES` | `2` | |
| `SK_LLAMA_MCP_JSON_RETRY_MAX_TOKENS` | — | Override for JSON-retry calls |
| `SK_LLAMA_AFTER_TOOLS_MAX_TOKENS` | — | Override after tool calls |
| `SK_LLAMA_MCP_FULL_TOOLS` | off | `1` = expose the full tool set |

---

## Not in `.env` (build / desktop)

These are **not** server secrets:

| Variable | Where | Meaning |
|----------|--------|---------|
| `PUBLIC_URL` | `npm run build` | CRA asset prefix. The build script forces `.` so Electron and Fastify resolve `/static/…` |
| `ELECTRON_START_URL` | `npm run electron:dev` | Points Electron at `http://localhost:3000` |

---

## Production checklist

- [ ] Set a long random `JWT_SECRET`
- [ ] Change `SKER_ADMIN_EMAIL` / `SKER_ADMIN_PASSWORD`
- [ ] Configure mail (`SMTP_*` or Linux `msmtp`)
- [ ] Point `MONGO_URL` at a dedicated database with auth
- [ ] Bind behind nginx (`BIND_HOST=127.0.0.1`) and terminate TLS there
- [ ] Keep `.env` off git, backups, and screenshots
