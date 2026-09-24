# Skeepto — An open-source spreadsheet built to last

*Pitch copy — for a project site, a GitHub "About" page, or a release announcement.*

---

## A clear vision: a spreadsheet with no browser ↔ engine compromise

**Skeepto** is a spreadsheet environment designed as **serious software**, not a demo: calculation and the business model live in a **C++ engine compiled to WebAssembly**, while **React** drives the interface, the panels, and collaboration. The browser paints fast and cleanly with **Canvas 2D** and documented rendering pipelines — not a pile of stacked hacks.

**Why this matters for quality open source:** the complexity of a spreadsheet (formulas, merges, freeze panes, formatting, collaboration) is isolated behind clean boundaries. Contributors can read the **JsonView → paint** flow, understand **freeze panes**, or work on the UI without breaking everything.

---

## What sets this project apart

| Promise | In practice |
|---------|-------------|
| **Performance where it counts** | Native engine (C++20) ported to **Wasm**: the browser doesn't redo the spreadsheet's work. |
| **Modern UI** | **React 18**, a current web experience, extensible. |
| **Controlled rendering** | Canvas grid: **serialized repaints**, grid lines and merges consistent with an Excel-like model. |
| **Explicit architecture** | Engine and UI stay separate so contributors can onboard without guessing. |
| **Shared Undo/Redo with rebase** | Several people edit the same workbook. On Undo or Redo, the WASM engine rebases the action: it recomputes the row and column from the edits the others have made since (`tRebasePlan` / `UndoRebaseLog`). Excel and Google Sheets do not rebase an undo against other users' changes inside the engine. |
| **Self-hostable, no Docker required** | Runs natively: **Node.js (Fastify)**, **MongoDB**, and **nginx** as a reverse proxy. |

---

## "Quality" open source is not just public code

A good open project also means:

1. **Transparency** — explaining how the view (`JsonView`) is produced, consumed, and painted.
2. **Maintainability** — consistent canvas `save`/`restore`, paint queues for async operations, no hidden debug modes in production.
3. **Respect for the contributor** — file-level anchor points (`SkSpInterface`, `SkSpGridCanvas`, `SkSpCellCanvas`).
4. **Product honesty** — the prerequisites (Node, build, MongoDB) are documented; no "one command and it's magic" promise when the real deployment is richer.

Skeepto aims for that level of rigor: **code and documentation carrying the same message**.

---

## Who is this project for?

- **Developers** who want to understand or extend a **real spreadsheet engine** in the browser.
- **Teams** looking for a **self-hostable** base with a clear engine/UI separation.
- **Anyone curious about the Wasm + React ecosystem** applied to a demanding domain (grid, scroll, selection, formats).

---

## How the pieces fit together

- **Engine** — C++20 spreadsheet core (formulas, formats, conditional formatting, merges) compiled to WebAssembly for the browser.
- **UI** — React 18 driving a Canvas 2D grid fed by `JsonView` snapshots.
- **Excel import/export** — the `SkExcel` converter runs as **WebAssembly on the server**, executed through an in-process **`child_process` pool** for isolation and guaranteed memory reclamation (no native binary to install).
- **Collaboration** — several people edit the same workbook. Undo and Redo are shared. Before an undo or a redo runs, the WASM engine rebases it: the stored position is moved according to the inserts, deletes, and other structural edits the other users have applied in between. That rebase (`UndoRebaseLog`, `tRebasePlan`) lives in the engine. Excel and Google Sheets do not do this.
- **Server** — a native **Node.js (Fastify)** service, **MongoDB** for storage, and **nginx** for HTTP/HTTPS and WebSocket proxying, managed by **systemd**.

---

## Call to action (adjustable)

- **Try it** — follow the README: build, server, account initialization.
- **Import Excel** — [`docs/Import-Excel.md`](./Import-Excel.md).
- **Contribute** — targeted issues, rendering fixes, guide improvements, internationalization, tests.
- **Share** — if the project helps you, a star on the repo and usage feedback make a real difference for a small open-source core.

---

## Tagline (social, signature)

> **Skeepto** — the spreadsheet that hands calculation to **WebAssembly** and clarity to the **docs**: C++ engine, React UI, production-ready Canvas grid.

---

## Short description (GitHub description)

> Professional spreadsheet: **C++ / WebAssembly** engine, **React** UI, documented **Canvas** rendering — shared Undo/Redo with rebase, and self-hosting.

---

*This document is intentionally pitch-oriented. The code in this repository is under the **MIT license** (see `LICENSE`). Installation and configuration details are in the README.*
