# Web spreadsheet architecture: Excel Online, Google Sheets and Skeepto

> Reference document comparing the general (client / server) architecture of three
> web spreadsheets, detailing Skeepto's **WASM** specificity, then the advantages and
> disadvantages of each approach, and finally the arguments that justify Skeepto's
> architectural choice.

---

## 1. Overview

All three spreadsheets answer the same need — editing a workbook in a browser —
but make **three radically different architectural trade-offs** around a single
question:

> **Where does the calculation engine live, and where does the workbook data live?**

| | Where the engine lives | Where the full workbook lives | Grid rendering |
|---|---|---|---|
| **Excel Online** | Server | Server | Canvas |
| **Google Sheets** | Client (JavaScript) | Client (+ server authority) | Canvas |
| **Skeepto** | **WASM, client AND server (same C++ code)** | Client (WASM memory) + server (WASM pool) | Canvas |

The rest of the document develops this fundamental difference and its consequences.

---

## 2. Excel Online — the thin client, everything on the server

### Architecture

```
Browser (thin client)                            Server (Office Online Server)   
+-----------------------------+                  +------------------------------+
| iframe internal.aspx        |                  | Excel calculation engine     |
| - grid canvas               |   -- HTTP -->    | FULL workbook model          |
| - ONLY the visible window   |     viewport     | Formula recalculation        |
| iframe shared.aspx (UI)     |   <-- JSON --    | Storage (WOPI: OneDrive,     |
| WopiAuth.aspx (storage)     |                  | SharePoint)                  |
| Web Workers (GridWorker)    |                  |                              |
+-----------------------------+                  +------------------------------+
```

- The **engine and the model** live on the server. The browser only receives what
  it needs to display (the visible window + a margin), as JSON.
- **Data windowing**: scrolling triggers a server round-trip to fetch the next
  range. The browser's memory footprint stays ~constant regardless of sheet size.
- **Isolation** via iframes + Web Workers: each context has its own JS heap and its
  own memory budget (resilience, separate budgets).
- **Canvas** rendering: display cost independent of the number of cells.

### Advantages

- **Memory scalability**: opens huge workbooks without saturating the browser.
- **Full fidelity** with Excel Desktop (same Microsoft engine).
- Lightweight client: fast startup, little code downloaded.

### Disadvantages

- **Network latency on every interaction**: any non-trivial action requires a
  server round-trip. Feels "less direct" than Google Sheets.
- **Strong server dependency**: offline use is nearly impossible, and the
  infrastructure is heavy to operate (Office Online Server).
- Proprietary architecture, not freely self-hostable.

---

## 3. Google Sheets — the heavy client, calculation in the browser

### Architecture

```
Browser (heavy client)                           Server (Google)                 
+-----------------------------+                  +------------------------------+
| Massive JS application      |                  | Authoritative model          |
| (Closure Compiler, ~60 MB   |    mutations     | Conflict resolution          |
| of compiled code)           |    -- OT -->     | Persistence                  |
| Calculation engine IN JS    |    <-- OT --     | Broadcast to other clients   |
| Client working model        |                  |                              |
| Canvas + tiling             |                  |                              |
+-----------------------------+                  +------------------------------+
```

- The **calculation engine runs in the browser**, in JavaScript. Hence a memory
  footprint dominated by **the application code** (a heap snapshot shows mostly
  `(compiled code)` and `Function`, not the data).
- **Operational Transformation (OT) collaboration**: the workbook is not sent,
  only **mutations** (deltas). The server remains the authority and resolves
  conflicts.
- **Data windowing** for large sheets (on-demand loading).
- **Canvas** rendering with tiling (rasterized, cached tiles).

### Advantages

- **Maximum responsiveness**: calculation is local, no round-trip per keystroke.
- **Excellent real-time collaboration** (mature OT).
- Works well even on average connections (little traffic after load).

### Disadvantages

- **Large initial download** and significant code memory footprint.
- All business logic is in **JavaScript** → hard to reuse server-side (headless,
  batch) without rewriting.
- Proprietary, not self-hostable.

---

## 4. Skeepto — the unified WASM engine, client AND server

### Architecture

```
Browser (client)                                 Server (Node.js)                
+-----------------------------+                  +------------------------------+
| React + Canvas              |                  | WASM instance pool           |
| +-----------------------+   |   PostMessage    | (SAME C++ engine)            |
| | C++ ENGINE -> WASM    |   |   -- / WS -->    | - headless calculation       |
| | FULL workbook in      |   |                  | - XLSX / PDF conversion      |
| | linear memory         |   |   <-- JSON --    | - AI / MCP                   |
| | JsonView(viewport)    |   |    GetMessage    | - persistence                |
| +-----------------------+   |                  | |                            |
| Canvas paints the viewport  |                  | v                            |
+-----------------------------+                  | MongoDB + GridFS             |
                                                 | (Directory + Spreadsheet)    |
                                                 +------------------------------+
```

### The WASM specificity

The core of Skeepto is a **spreadsheet engine written in C++**, compiled to
**WebAssembly (WASM)** via Emscripten. This **same binary** runs:

1. **In the browser** — the full workbook is loaded into the **WASM linear
   memory**. The canvas does not read cells one by one: it paints from a snapshot
   of the **visible window** produced by
   `JsonView(row, col, viewHeight, viewWidth, …)`. This is **display
   virtualization**: only the visible area is painted.

2. **In Node.js** — a **WASM instance pool** on the server runs the same engine
   for headless calculation, XLSX conversion, PDF export, AI/MCP and persistence.
   No logic is rewritten in JavaScript.

### Persistence and collaboration

- **Persistence**: MongoDB. File metadata in the `Directory` collection, `.sker`
  workbook content in the `Spreadsheet` collection (inline when small, **GridFS**
  above ~15 MB). Large non-`.sker` files also go through GridFS.
- **Two save regimes**:
  - regular editing (Do/Undo/Redo) → **debounced** persistence (~3 s idle,
    `SK_PERSIST_DEBOUNCE_MS`);
  - explicit save / last user leaving → **immediate and blocking** persistence
    (WriteJson + Mongo/GridFS write is awaited before the response).
- **Collaboration**: relayed `PostMessage` / `GetMessage` messages (mutations),
  close in spirit to Google Sheets' OT.

### Advantages

- **One engine, two runtimes**: the C++/WASM code runs identically on client and
  server → zero behavioral divergence, full reuse.
- **Maximum responsiveness** during regular editing (local WASM calculation, like
  Google Sheets) **while also** having server-side computation (like Excel Online).
- **A real spreadsheet engine** (not a grid widget or a JS clone).
- **Self-hostable** end to end (Node + MongoDB).
- **Native AI / MCP** integrated into the server engine.
- **Canvas + virtualization** rendering already on par with the big players.

### Disadvantages

- **Memory footprint proportional to the largest workbook** on the browser side:
  the full workbook lives in WASM linear memory. That memory is **grow-only** (not
  returned to the OS), **but this is not a leak**: the space freed by
  `DeleteWorkBook` is **reused** for subsequent workbooks. WASM memory therefore
  behaves like a **reusable pool** — the session ceiling is set by the **largest
  workbook opened**, not by the *sum* of workbooks. Opening ten 20 MB workbooks in
  a row does not consume 200 MB, but ~20 MB. → The limit only concerns very large
  *individual* workbooks (see § 6, roadmap).
- **No *data* windowing** today: rendering is virtualized, but the data source is
  the full in-memory model (client and/or server).
- **Contribution barrier**: the core is in C++/Emscripten, less accessible than a
  100% JavaScript project (to be mitigated with prebuilt WASM artifacts and a clear
  separation between JS UI and C++ engine).

---

## 5. Summary comparison table

| Criterion | Excel Online | Google Sheets | **Skeepto** |
|---|---|---|---|
| Calculation engine | Server | Client (JS) | **WASM, client + server (C++)** |
| Full workbook in browser RAM | No (windowing) | No (windowing) | **Yes (WASM memory)** |
| Editing responsiveness | Medium (network) | High (local) | **High (local WASM)** |
| Server-side headless compute | Yes | No (JS to rewrite) | **Yes (same engine)** |
| Grid rendering | Canvas | Canvas (tiling) | **Canvas** |
| Display virtualization | Yes | Yes | **Yes** |
| Data windowing | Yes | Yes | **No (for now)** |
| Real-time collaboration | Yes | Yes (OT) | **Yes (PostMessage/GetMessage)** |
| Self-hostable | No | No | **Yes** |
| AI assistant | Advanced (Copilot) | Advanced (Gemini) | Present |
| **MCP / open, programmable & self-hostable AI** | No (proprietary, cloud) | No (proprietary, cloud) | **Yes (native)** |
| Large-file scalability in browser | Excellent | Good | **Limited (bounded by RAM)** |
| License / openness | Proprietary | Proprietary | **Open source** |

---

## 6. Validity domain and Skeepto roadmap

Skeepto's architecture is **coherent and deliberate**: it is the "desktop application
ported into the browser" model. It is optimal as long as workbooks fit comfortably
in a tab's RAM.

Its only real boundary is **memory**: the largest opened workbook must fit in a
tab's WASM linear memory. That memory is *grow-only* but **reused** from one
workbook to the next (a pool, not a leak) — so the ceiling is the **largest
individual workbook**, not the sum. This limit is not an inconsistency: it is the
**accepted price of local responsiveness**. Excel Online scales on large files
precisely because it **sacrifices** local calculation.

**Possible evolution, without a rewrite** — a **hybrid mode**:

- small/medium workbooks → **client** WASM engine (current behavior, zero latency);
- very large workbooks → **server viewport** mode: the heavy part stays in the
  server WASM pool (already present), the client keeps only a window cache.

This mode is realistic because **the painting layer is already driven by a JSON
viewport** (`JsonView`): it "just" requires changing the *source* of that viewport
(synchronous client WASM → asynchronous server), with an overscan buffer, a
version-invalidated hit/miss cache, and *stale-while-revalidate* to hide latency.
The existing client is reused rather than rewritten.

---

## 7. Arguments: why Skeepto's architecture is defensible

### 7.1 The hook: "one engine, two runtimes"

The central differentiator: **a single C++ engine compiled to WASM, running
identically in the browser and on the server.** Direct consequences:

- **zero divergence** in behavior between client and server calculation;
- **no rewriting** of business logic in JavaScript (unlike Google Sheets, whose JS
  engine is not reusable server-side);
- **instant local** calculation (like Google Sheets) **and** **server-side
  headless** calculation for conversion / PDF / AI (like Excel Online) — the best
  of both.

### 7.2 The right level of ambition

Skeepto is a **real spreadsheet engine**, not a grid component (Handsontable, AG Grid)
nor a JavaScript clone. It compares with ONLYOFFICE / Collabora, while remaining
**lighter** and **understandable**.

### 7.3 Sovereignty: self-hostable end to end

A full open-source stack (React + WASM + Node + MongoDB/GridFS). A direct answer to
the need "I want Google Sheets, but on my own machines, under my control" — a real
gap in the open-source market.

### 7.4 Open AI via native MCP — the key point

**This is probably Skeepto's strongest differentiator, and it is often misunderstood.
The question is not "who has the best AI". On that front, Copilot (Excel) and
Gemini (Google Sheets) are excellent, often ahead.** The real question is: **who
owns that AI, and can you wire it to your own tools?**

- **Excel / Google: closed, cloud AI.** Copilot and Gemini are **proprietary**,
  **hosted in the vendor's cloud**, and **not pilotable** by third-party agents
  through an open protocol. You are subject to their model, their pricing, their
  data policy. You can neither self-host it, nor extend it, nor plug your own
  business tools into it.

- **Skeepto: open AI via native MCP.** The integration is wired into the **server
  engine itself** and exposed over **MCP (Model Context Protocol)** — an **open**
  standard. Decisive consequences:
  - **Any agent** (Claude, a local LLM, your own orchestrator) can drive the
    spreadsheet: read, write, calculate, format, convert.
  - **Self-hostable end to end**: the engine, the MCP exposure and, if you wish,
    the model itself run **on your own machine**. No data leaves for a third-party
    cloud.
  - **Extensible**: you add your own MCP tools without depending on a vendor.
  - **Data sovereignty**: a deal-breaker criterion for the public sector,
    healthcare, and finance — precisely the audiences that neither Copilot nor
    Gemini can serve without sending data to the cloud.

In short: Excel and Google offer a **powerful but captive AI**; Skeepto offers an
**open, programmable and sovereign AI**. For an open-source project, this is
**the decisive argument** — not the race for model capability, but the **freedom
of architecture** around AI.

### 7.5 Rendering already on par with the big players

Canvas + display virtualization + font cache: on the *rendering* side, Skeepto already
plays in the same category as Excel Online and Google Sheets.

### 7.6 Bounded, predictable memory (reusable pool)

WASM memory behaves like a **pool reused** from one workbook to the next: opening
several workbooks in succession does not *accumulate* their memory, the freed space
is reused. The session footprint is therefore **bounded by the largest opened
workbook** — a **single, stable, predictable** peak, not growth that drifts over
time. This is an advantage over models that would isolate each workbook in a
separate heap prone to accumulation.

### 7.7 An acknowledged, documented limit

The memory footprint on very large *individual* workbooks is a **known,
explained boundary with a roadmap** (hybrid mode, § 6). An acknowledged limit
reassures; a hidden one drives people away. This honesty is part of the argument.

### In one sentence

> **Skeepto is a real spreadsheet engine written once in C++, running both in the
> browser (local responsiveness) and on the server (headless calculation,
> conversion), fully self-hostable and driven by an open AI via MCP — where Excel
> Online sacrifices responsiveness for the all-server model, where Google Sheets
> locks its logic into non-reusable JavaScript, and where the AI of both (Copilot,
> Gemini) stays captive in the vendor's cloud. With Skeepto, the engine AND the AI run
> on your own machine.**

---

*Internal Skeepto document — architecture comparison. To be adapted for a public
`README` / `ARCHITECTURE.md`.*
