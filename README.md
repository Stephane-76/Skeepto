# Skeepto

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![WebAssembly](https://img.shields.io/badge/engine-C%2B%2B20%20WASM-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org/)
[![React](https://img.shields.io/badge/UI-React-61DAFB?logo=react&logoColor=black)](https://react.dev/)

A **real spreadsheet engine**, not a React grid widget. The engine is written
once in **C++20**, compiled to **WebAssembly**, and runs in the **browser**
(local editing) and on **Node.js** (headless calc, XLSX/PDF, AI). Same binary,
no JavaScript rewrite.

![Skeepto spreadsheet](./docs/budget-sker.png)

![Virtual disk — Excel workbook ready to convert](./docs/virtual-disk-xlsx.png)

Import a `.xlsx` on the virtual disk, convert it, then open the `.sker`. See
[`docs/Import-Excel.md`](./docs/Import-Excel.md).

## Why Skeepto?

> **One spreadsheet engine, written once in C++, running everywhere.** The exact
> same WebAssembly binary powers the browser (instant, local editing) and the
> Node.js server (headless calculation, XLSX/PDF conversion, AI). No logic is
> ever rewritten in JavaScript.

What makes it different from Excel Online and Google Sheets:

- **Local responsiveness _and_ server-side compute** — Google Sheets keeps its
  engine in the browser (not reusable server-side); Excel Online keeps everything
  on the server (network latency on every action). Skeepto gives you both, from
  a single codebase.
- **Fully self-hostable** — React + WASM + Node.js + MongoDB. Your data and your
  engine run on _your_ infrastructure.
- **Open, programmable AI via native MCP** — Copilot (Excel) and Gemini (Sheets)
  are powerful but **captive**: proprietary, cloud-only, not pilotable by
  third-party agents. Skeepto exposes its engine over the **Model Context
  Protocol**, so any agent can drive the spreadsheet, self-hosted end to end,
  with full data sovereignty.
- **A real spreadsheet engine**, not a grid widget or a JavaScript clone.

## Prerequisites

Before you begin, make sure you have installed:

- **Node.js** (version 18 or higher)
- **npm** (usually bundled with Node.js)
- **MongoDB** (version 5.0 or higher)

> **Note:** The prebuilt WebAssembly engine (`SkReactSpreadSheet.wasm`, `.mjs`)
> is already under `public/`, so you do **not** need a C++ / Emscripten
> toolchain to run the app. The **C++ source will be published soon**; a **Rust**
> port of the engine is also in progress (see [Engine source](#engine-source)).

### Installing MongoDB

#### Option A — Docker (simplest, cross-platform)

```bash
docker run -d --name skeepto-mongo -p 27017:27017 mongo:7
```

#### Option B — macOS (Homebrew)

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

#### Option C — Linux (Ubuntu/Debian, official MongoDB repo)

```bash
# Follow the current instructions for your distribution at:
# https://www.mongodb.com/docs/manual/administration/install-on-linux/
sudo systemctl start mongod
sudo systemctl enable mongod
```

#### Option D — Windows

Download and install MongoDB from
[mongodb.com/try/download/community](https://www.mongodb.com/try/download/community).

Verify that MongoDB is running:

```bash
mongosh --version
```

## Installation & Startup

Copy `.env.example` to `.env` at the project root (or `Node/Server/.env`) and
adjust values if needed.

```bash
cp .env.example .env
```

### 1. Install dependencies

```bash
npm install
cd Node/Server && npm install
cd ../Client && npm install
cd ../..
```

### 2. Build the application

**Do not use `npm start` at the project root.** Build with:

```bash
npm run build
```

This compiles the React application in production mode into `build/` (the
server serves the app from there).

### 3. Start the server

In a first terminal:

```bash
cd Node/Server
npm start
```

The server listens on port **8000** by default.

### 4. Initialize users

In a second terminal:

```bash
cd Node/Client
node SkInitServer.mjs
```

This creates the first users and sample virtual-disk folders.

After initialization you can sign in with:

| Email | Password |
|-------|----------|
| `sallez@toto.fr` | `sallez` |

### 5. Open the application

```
http://localhost:8000
```

Hard-refresh the browser (**Cmd+Shift+R**) so the WASM module is reloaded.

To bring an Excel workbook into Skeepto, upload a `.xlsx` on the virtual disk, run **Convert Excel**, then open the new `.sker`. See [`docs/Import-Excel.md`](./docs/Import-Excel.md).

## Desktop app (Electron)

Skeepto also ships as a **standalone desktop application** built with Electron.
In this mode the app runs entirely offline: it loads the web build in a native
window **without any server, login or collaboration**, and reads/writes local
`.sker` (and `.xlsx`) files through a native File menu and OS dialogs.

> The Electron mode always loads the compiled front-end from `build/`, so you
> must run `npm run build` first. It does **not** need MongoDB or the Node.js
> server — those are only for the collaborative web mode.

### Run the desktop app

```bash
npm run build        # required first: Electron loads the build/ output
npm run electron     # launch the desktop window
```

### Development (hot reload)

Runs the CRA dev server and Electron together (loads `http://localhost:3000`):

```bash
npm run electron:dev
```

### Package installers

Uses `electron-builder`; artifacts are written to `dist-electron/`.

```bash
npm run pack             # unpacked build (quick local test)
npm run dist             # packaged installer for the current platform
npm run dist:mac         # macOS .dmg / .zip
npm run dist:mac:universal   # macOS universal (Intel + Apple Silicon)
```

> The engine runs in the renderer process; WebAssembly Memory64 is enabled by
> default (Chromium ≥ 133), so no extra V8 flag is required.

## Project structure

```
skeepto/
├── Node/
│   ├── Server/          # Fastify server (WASM pool, REST/WS API)
│   │   └── SkServer.mjs
│   ├── Client/          # First-run init (SkInitServer.mjs)
│   └── MetaModel/       # Metamodel used by the server
├── electron/            # Electron desktop app (main + preload)
├── src/                 # React source
├── public/              # Static assets + prebuilt WASM engine
└── build/               # Compiled output (after npm run build)
```

## Configuration

### MongoDB

By default the application connects to MongoDB on `localhost:27017`, database
`skeepto`. Connection settings are read from environment variables.

### Environment variables

Create a `.env` file at the project root or in `Node/Server/`. All variables
are optional and fall back to sensible defaults.

```env
# Server
PORT=8000                 # HTTP port (default: 8000)
BIND_HOST=127.0.0.1       # Bind address (default: 127.0.0.1)

# MongoDB — either provide a full URL...
MONGO_URL=mongodb://localhost:27017/skeepto

# ...or the individual parts:
MONGO_HOST=localhost      # default: localhost
MONGO_PORT=27017          # default: 27017
MONGO_DB=skeepto          # default: skeepto
MONGO_NO_AUTH=1           # set to 1/true for a local instance without auth
# MONGO_USER=...          # when authentication is enabled
# MONGO_PASSWORD=...
# MONGO_AUTH_SOURCE=admin # default: admin
```

> If `MONGO_URL` is set, it takes precedence over the individual `MONGO_*`
> variables.

## Development

After changing the React / front-end code, rebuild and restart:

```bash
npm run build
cd Node/Server && npm start
```

> The C++ engine is compiled with Emscripten; the resulting artifacts are copied
> into `public/`. After a WASM rebuild, copy
> `public/SkReactSpreadSheet.{mjs,wasm,wasm.map}` into `build/` and
> `Node/Server/`, or run `npm run build` again.

## Architecture

Skeepto uses:

- **C++20** — high-performance calculation engine compiled to WebAssembly
- **React** — canvas-based grid with viewport virtualization
- **Node.js** — backend with a pool of WebAssembly instances
- **MongoDB** — persistence (`Directory`, `Spreadsheet`, GridFS for large files)
- **WebSocket** — real-time collaboration

### Engine source

This repository currently ships the engine as a **prebuilt WebAssembly binary**
(`public/SkReactSpreadSheet.{mjs,wasm,wasm.map}`). The **C++ source will be
published soon** so the calculation core can be built and audited like the rest
of the stack.

A **Rust rewrite** of the same engine is also underway, developed with
**Claude**. The goal is a second implementation of the spreadsheet core, still
compiled to WebAssembly, without changing the React UI or the Node.js server
contract.

See [`Node/Server/Model/DATABASE_SCHEMA.md`](./Node/Server/Model/DATABASE_SCHEMA.md)
for the MongoDB schema, and [`docs/Import-Excel.md`](./docs/Import-Excel.md) to
import `.xlsx` files.

### WebAssembly instance pool

The server uses a pool of WebAssembly instances for:

- Workbook isolation (one workbook = one instance)
- Auto-scaling under load
- Continuous health monitoring
- Smart load balancing

## Troubleshooting

### The server won't start

1. Make sure MongoDB is running: `mongosh`
2. Check that port 8000 is not already in use
3. Review the console logs
4. From `Node/Server`, use `npm start` (loads `.env`) rather than `node SkServer.mjs` alone

### The application won't load (`{"message":"Not Found"}`)

1. Make sure you ran `npm run build` at the project root
2. Restart the server after the first build (`build/` is resolved at startup)
3. Hard-refresh the browser (**Cmd+Shift+R**)
4. Check the browser console for errors

### MongoDB errors

1. Verify MongoDB is installed and running
2. Check your `MONGO_*` variables (database name: `skeepto`)
3. Review the MongoDB logs

## Important notes

- **Do not use `npm start` at the project root** — it does not serve the app.
- **Always build before starting the web server** — `npm run build`.
- **Startup order** — MongoDB → Build → Server → Initialization → Browser.

## Contributing

Contributions are welcome. Please follow the existing code conventions and test
your changes before submitting a pull request. Most of the app (UI,
rendering, server, AI integration) is JavaScript and hackable without touching
the engine.

The C++ core is not in this repo yet (it will be). The Rust port is experimental
and not required to run or contribute to the application.

## Discussions

Please use the project's
[GitHub Discussions](https://github.com/Stephane-76/Skeepto/discussions)
for questions, ideas, and feedback. Do not hesitate to post there — it keeps
the conversation public and useful for everyone.

Bugs and pull requests still go through GitHub Issues and PRs.

## License

This project is distributed under the **MIT** license — see the
[`LICENSE`](./LICENSE) file.

Copyright © 2026 Stéphane ALLEZ.

---

**Skeepto** — built with care for the most demanding professional applications.
