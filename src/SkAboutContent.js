import React from 'react';

/**
 * Shared About copy — public page (full) or in-app modal (compact).
 */
function SkAboutContent({ compact = false }) {
  return (
    <article className="SkAbout-content">
      <p className="SkAbout-meta">Last updated: May 2026</p>

      <section>
        <h2>At a glance</h2>
        <p>
          <strong>Skeepto</strong> is a <strong>C++20 spreadsheet engine</strong> built to
          be <strong>embedded in your applications</strong>. It combines a native calculation core
          (compiled to <strong>WebAssembly</strong> for the web) with a modern{' '}
          <strong>React UI</strong> to deliver a true spreadsheet experience — formulas,
          conditional formatting, undo/redo, real-time collaboration — while staying{' '}
          <strong>under your control</strong>: no dependency on Excel or Google Sheets, no
          per-user licensing costs, and a roadmap driven by your team. It also{' '}
          <strong>converts Excel files</strong> (<code>.xlsx</code>) into its native JSON{' '}
          <code>.sker</code> format for storage, exchange, and collaboration (Excel{' '}
          <strong>macros are not converted</strong>).
        </p>
      </section>

      {!compact && (
        <>
          <section>
            <h2>Why Skeepto instead of Excel or Google Sheets?</h2>
            <div className="SkAbout-tableWrap">
              <table className="SkAbout-table">
                <thead>
                  <tr>
                    <th>Criteria</th>
                    <th>Excel / Google Sheets</th>
                    <th>Skeepto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Integration</strong></td>
                    <td>External app or limited API</td>
                    <td>Library/component embedded in your code (C++, Web, iOS)</td>
                  </tr>
                  <tr>
                    <td><strong>Evolution</strong></td>
                    <td>Vendor dependency</td>
                    <td>Extend formulas, functions, formats, and cell types</td>
                  </tr>
                  <tr>
                    <td><strong>Cost</strong></td>
                    <td>Licenses, subscriptions, per-user quotas</td>
                    <td>No per-user fees once integrated</td>
                  </tr>
                  <tr>
                    <td><strong>Data</strong></td>
                    <td>Third-party hosting or local files</td>
                    <td>Self-hosted: MongoDB, RocksDB, JSON, your stack</td>
                  </tr>
                  <tr>
                    <td><strong>Platforms</strong></td>
                    <td>Desktop / Web / Mobile depending on product</td>
                    <td><strong>Same engine</strong>: Unix, Windows, macOS, WASM, iOS</td>
                  </tr>
                  <tr>
                    <td><strong>Collaboration</strong></td>
                    <td>Local undo, frequent conflicts</td>
                    <td><strong>Shared Undo/Redo</strong> with rebase, live cursors</td>
                  </tr>
                  <tr>
                    <td><strong>Performance</strong></td>
                    <td>Variable, often heavy</td>
                    <td>C++/WASM engine, targeted recalc, shared formulas</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Skeepto is not meant to replace Excel on an accountant&apos;s desktop; it targets{' '}
              <strong>line-of-business applications</strong> where an embedded spreadsheet must behave
              like Excel or Google Sheets while being owned and extended by your developers.
            </p>
          </section>

          <section>
            <h2>What Skeepto brings to your product</h2>

            <h3>Professional calculation engine</h3>
            <ul>
              <li>
                <strong>Dedicated formula parser (Lemon)</strong>: A1 and R1C1 references, common
                functions, and an extensible library.
              </li>
              <li>
                <strong>Add custom functions</strong> to the formula engine for business-specific
                calculations.
              </li>
              <li>
                <strong>Native dimensional units</strong>: length, mass, time, and currencies (€, $,
                kg, m, s, …) stored in cells and propagated through formulas — with dimensional
                analysis on <code>+</code>, <code>-</code>, <code>*</code>, and <code>/</code>.
              </li>
              <li>
                <strong>Smart recalculation</strong>: only affected cells are recomputed, shared
                formulas for memory efficiency, O(1) insertions.
              </li>
              <li>Named ranges, merged cells, fine-grained borders, custom attributes.</li>
            </ul>

            <h3>Native units — a world first</h3>
            <p>
              Skeepto is, to our knowledge, the <strong>only spreadsheet in the world</strong>{' '}
              that treats <strong>physical and monetary units as first-class values</strong> inside
              the calculation engine — not just as display formatting.
            </p>
            <ul>
              <li>
                Assign units to cells: <strong>length</strong> (mm, m, km…), <strong>mass</strong>{' '}
                (g, kg…), <strong>time</strong> (s, h, d…), and <strong>money</strong> (€, $, £…).
              </li>
              <li>
                Formulas <strong>propagate units</strong>: adding two meters stays in meters;
                multiplying meters gives m²; mixing incompatible families (e.g. kg + m) is flagged.
              </li>
              <li>
                Compound units are supported (e.g. <strong>m/s</strong>) and persist in the native{' '}
                <code>.sker</code> format.
              </li>
              <li>
                Ideal for engineering, finance, and scientific models where unit correctness matters
                as much as the numeric result.
              </li>
            </ul>

            <h3>Advanced formatting</h3>
            <ul>
              <li>Rich conditional formatting: ColorScales, IconSets, DataBars, formula rules.</li>
              <li>CSS-like styles: colors, fonts, borders, alignment.</li>
              <li>
                <strong>Custom cell classes you can extend</strong>: built-in charts (line, pie) — or
                your own React object classes for gauges, dashboards, and domain-specific
                visualizations.
              </li>
            </ul>

            <h3>Real-time collaboration</h3>
            <ul>
              <li>Live multi-user cursors.</li>
              <li>Instant sync over WebSocket.</li>
              <li>Collaborative Undo/Redo with rebase — a real differentiator vs. local-only undo.</li>
              <li>Per-workbook isolation: dedicated instance per workbook.</li>
            </ul>

            <h3>File versioning</h3>
            <p>
              Every <code>.sker</code> workbook on the virtual disk can be{' '}
              <strong>versioned</strong>: save labeled snapshots of the full JSON content, browse
              revision history, and restore an earlier state when needed.
            </p>
            <ul>
              <li>
                <strong>Manual snapshots</strong> with a label and optional comment (e.g. before a
                major change or at sign-off).
              </li>
              <li>
                <strong>Revision history</strong> per file: author, date, size — stored in MongoDB
                (configurable retention, default up to 50 versions per file).
              </li>
              <li>
                <strong>One-click restore</strong> of any saved version back to the live workbook.
              </li>
              <li>
                Full workbook JSON is preserved in each snapshot — formulas, formatting, units, and
                custom cell classes included.
              </li>
            </ul>

            <h3>Cross-platform and scalability</h3>
            <ul>
              <li>Single C++ codebase: Unix/Linux, Windows, macOS, browser (WASM), iOS.</li>
              <li>Server-side WASM pool with auto-scaling and load balancing.</li>
              <li>Persistence: MongoDB (GridFS), RocksDB, JSON — or your storage via the API.</li>
              <li>
                <strong>File versioning</strong> for <code>.sker</code> workbooks: labeled snapshots,
                history, and restore (see above).
              </li>
              <li>
                Excel interchange: import <code>.xlsx</code> and convert to the native JSON{' '}
                <code>.sker</code> format; export back to <code>.xlsx</code> when needed.{' '}
                <strong>Excel macros (VBA) are not imported or converted.</strong>
              </li>
            </ul>
          </section>

          <section>
            <h2>For developers: a spreadsheet you can evolve</h2>
            <ol className="SkAbout-orderedList">
              <li>Modular architecture: container, workbooks, sheets, cells, ranges, formulas.</li>
              <li>Consistent API: <code>tApi</code>, direct sheet access, <code>window.SkUISpreadSheet</code>.</li>
              <li>Extensible formulas and business functions via the Lemon grammar.</li>
              <li>Custom cell types and object classes (see below).</li>
              <li>Extensible formatting and conditional rules.</li>
              <li>Open persistence: MongoDB/RocksDB included, or plug in your own stack.</li>
              <li>Clear stack: React client, Node.js + Fastify + WebSocket server, WASM pool, MongoDB.</li>
            </ol>

            <h3>Add your own formula functions</h3>
            <p>
              The Lemon formula parser is designed to be extended: you can register{' '}
              <strong>custom functions</strong> for domain-specific calculations (pricing rules,
              internal APIs, business logic) without forking the engine. New functions behave like
              built-ins in formulas — usable from any cell, recalculated with the dependency graph,
              and persisted in <code>.sker</code> JSON like standard formulas.
            </p>

            <h3>Add your own cell and object classes</h3>
            <p>
              Cells are not limited to text and numbers. Skeepto supports a{' '}
              <strong>pluggable cell-class system</strong> on the React side: each class renders and
              interacts inside the grid like a native control. Built-in examples include:
            </p>
            <ul>
              <li>
                <strong>Charts</strong>: line and pie charts embedded in cells (
                <code>SkCellClassLineChart</code>, <code>SkCellClassPieChart</code>).
              </li>
            </ul>
            <p>
              You can add <strong>your own classes</strong> — gauges, maps, mini-dashboards, or any
              React component — by extending the cell-class registry. The engine stores the object
              metadata in the workbook; your UI layer handles rendering and user interaction.
            </p>

            <h3>Web integration example</h3>
            <pre className="SkAbout-code"><code>{`import SkSpreadSheet from './spreadsheet/SkSpreadSheet';

window.SkUISpreadSheet.value("A1", "=SUM(B1:B10)");
window.SkUISpreadSheet.format(
  "A1:A10",
  "background-color:yellow;"
);`}</code></pre>
          </section>

          <section>
            <h2>Typical use cases</h2>
            <ul>
              <li>Line-of-business apps: budgets, reporting, dashboards with formulas and live updates.</li>
              <li>Collaborative tools: planning, project tracking, shared data entry.</li>
              <li>Data entry or configuration grids in desktop, web, or mobile apps.</li>
              <li>Controlled environments: no internet, sensitive data — runs on your infrastructure.</li>
              <li>Differentiated products: the spreadsheet is part of the app, with your rules and UX.</li>
            </ul>
          </section>

          <section>
            <h2>Competitive advantages at a glance</h2>
            <div className="SkAbout-tableWrap">
              <table className="SkAbout-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Skeepto</th>
                    <th>Third-party solutions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Performance</td>
                    <td>C++/WASM engine, targeted recalc</td>
                    <td>Variable</td>
                  </tr>
                  <tr>
                    <td>Memory</td>
                    <td>Shared formulas, SparseArray</td>
                    <td>Often higher footprint</td>
                  </tr>
                  <tr>
                    <td>Collaboration</td>
                    <td>Real-time + shared undo</td>
                    <td>Limited, local undo</td>
                  </tr>
                  <tr>
                    <td>Cross-platform</td>
                    <td>Native (single codebase)</td>
                    <td>Multiple adaptations</td>
                  </tr>
                  <tr>
                    <td>Native units in formulas</td>
                    <td>
                      Length, mass, time, money — dimensional analysis in{' '}
                      <code>+ − × ÷</code> (world first)
                    </td>
                    <td>Display only (no engine-level units)</td>
                  </tr>
                  <tr>
                    <td>Extensibility</td>
                    <td>
                      Custom formula functions; pluggable cell classes (charts, your own objects)
                    </td>
                    <td>Limited, closed ecosystem</td>
                  </tr>
                  <tr>
                    <td>File versioning</td>
                    <td>
                      Labeled <code>.sker</code> snapshots, revision history, restore
                    </td>
                    <td>Limited or external (SharePoint, etc.)</td>
                  </tr>
                  <tr>
                    <td>Self-hosting</td>
                    <td>Yes</td>
                    <td>Rare</td>
                  </tr>
                  <tr>
                    <td>Excel interchange</td>
                    <td>
                      Import <code>.xlsx</code> → JSON <code>.sker</code>; export{' '}
                      <code>.xlsx</code> (no VBA/macros)
                    </td>
                    <td>Partial</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {compact && (
        <section>
          <h2>Highlights</h2>
          <ul>
            <li>C++/WASM calculation engine with React UI and real-time collaboration.</li>
            <li>Native dimensional units in formulas (length, mass, time, money).</li>
            <li>Custom formula functions and pluggable cell classes (charts, your React components).</li>
            <li>Excel import/export (<code>.xlsx</code> ↔ <code>.sker</code>, no VBA).</li>
            <li>Self-hosted stack: Node.js, WebSocket, MongoDB, WASM pool.</li>
          </ul>
        </section>
      )}

      <section>
        <h2>In summary</h2>
        <p>
          <strong>Skeepto</strong> positions your application as a{' '}
          <strong>competitor to Excel and Google Sheets</strong> in the embedded spreadsheet
          space: formulas, formatting, undo, real-time collaboration, native{' '}
          <strong>unit-aware calculations</strong>, and a stack you control (C++, React, Node,
          MongoDB) — without vendor lock-in or recurring per-user costs.
        </p>
        {!compact && (
          <p>
            For developers, it is a <strong>spreadsheet engine you can extend</strong> (new
            functions, formats, cell types, persistence, platforms) at your product&apos;s pace.
          </p>
        )}
      </section>

      <section className="SkAbout-partners">
        <p>
          <strong>Today</strong>, I am looking for one or more partners to help finish the
          project and release it as <strong>open source</strong>.
        </p>
      </section>

      <p className="SkAbout-copyright">Copyright Stéphane ALLEZ 2026 — MIT licence</p>
    </article>
  );
}

export default SkAboutContent;
