//=============================================================================
// SkSpPrintParameters
// Right-panel editor for print layout (tPrintParameters JSON).
// Orientation + FitToPage are per active sheet; every other field is workbook-shared.
//=============================================================================
import React, { Component } from "react";

import SkInput from "../component/SkInput";
import SkButton from "../component/SkButton";
import { getActiveFilePath } from "../SkActiveFile.js";
import { downloadActiveSheetPdf, downloadWorkbookPdf } from "./pdf/SkClientSkerPdfExport.js";
import "./SkSpreadSheet.css";

/** Wait until the global spreadsheet API exists (panel may mount before SkSpInterface init). */
async function waitForSkUISpreadSheet(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const api = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    if (api) {
      if (typeof api.whenEngineReady === "function") {
        await api.whenEngineReady();
      }
      return api;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("SkUISpreadSheet not ready");
}

/** Defaults aligned with tPrintParameters() in SkPrintParameters.cpp */
const PRINT_DEFAULTS = {
  paperSize: 9,
  orientation: 0,
  scale: 100,
  fitToPage: true,
  fitToWidthPages: 1,
  fitToHeightPages: 1,
  pageOrder: 0,
  blackAndWhite: false,
  draft: false,
  usePrinterDefaults: true,
  horizontalDpi: 600,
  verticalDpi: 600,
  copies: 1,
  firstPageNumber: 0,
  marginLeft: 0.7,
  marginRight: 0.7,
  marginTop: 0.75,
  marginBottom: 0.75,
  marginHeader: 0.3,
  marginFooter: 0.3,
  printGridLines: false,
  printHeadings: false,
  horizontalCentered: false,
  verticalCentered: false,
  autoPageBreaks: true,
};

/**
 * Fixed-width sheet name for the busy spinner label so its size does not jump
 * with the sheet name length: first 10 chars (right-padded to 10 when shorter)
 * followed by "..." — always 13 characters. Padding uses non-breaking spaces so
 * HTML does not collapse the trailing padding of short names.
 */
function fixedWidthSheetName(sName) {
  return String(sName ?? "").slice(0, 10).padEnd(10, "\u00A0") + "...";
}

const MARGIN_LABELS = {
  marginLeft: "Left",
  marginRight: "Right",
  marginTop: "Top",
  marginBottom: "Bottom",
  marginHeader: "Header",
  marginFooter: "Footer",
};

/**
 * ECMA-376 / Excel pageSetup @paperSize — codes 1–18 (stable reference set).
 * Other codes (envelopes, etc.): use "Custom OOXML code".
 */
const OOXML_PAPER_CHOICES = [
  { code: 1, label: 'US Letter (8.5" x 11")' },
  { code: 2, label: "Letter small" },
  { code: 3, label: 'Tabloid (11" x 17")' },
  { code: 4, label: 'Ledger (17" x 11")' },
  { code: 5, label: 'US Legal (8.5" x 14")' },
  { code: 6, label: 'Statement (5.5" x 8.5")' },
  { code: 7, label: 'Executive (7.25" x 10.5")' },
  { code: 8, label: "A3 (297 x 420 mm)" },
  { code: 9, label: "A4 (210 x 297 mm)" },
  { code: 10, label: "A4 small" },
  { code: 11, label: "A5 (148 x 210 mm)" },
  { code: 12, label: "B4 (JIS)" },
  { code: 13, label: "B5 (JIS)" },
  { code: 14, label: "Folio" },
  { code: 15, label: "Quarto" },
  { code: 16, label: '10" x 14"' },
  { code: 17, label: '11" x 17"' },
  { code: 18, label: "Note" },
];

const OOXML_PAPER_PRESET_CODES = new Set(OOXML_PAPER_CHOICES.map((o) => o.code));

function unwrapWorkerResult(raw) {
  if (typeof raw !== "string") return raw;
  try {
    const wrap = JSON.parse(raw);
    if (wrap && typeof wrap === "object" && wrap.result !== undefined) {
      return wrap.result;
    }
  } catch {
    /* keep raw string */
  }
  return raw;
}

function sanitizePrintParams(p) {
  const o = { ...p };
  const clampDpi = (key) => {
    const v = Number(o[key]);
    if (!Number.isFinite(v) || v < 72 || v > 9600) {
      o[key] = PRINT_DEFAULTS[key];
    } else {
      o[key] = Math.round(v);
    }
  };
  clampDpi("horizontalDpi");
  clampDpi("verticalDpi");
  const sc = Number(o.scale);
  if (!Number.isFinite(sc) || sc < 10 || sc > 400) {
    o.scale = PRINT_DEFAULTS.scale;
  }
  const cop = Number(o.copies);
  if (!Number.isFinite(cop) || cop < 1 || cop > 999) {
    o.copies = PRINT_DEFAULTS.copies;
  }
  const ps = Number(o.paperSize);
  if (!Number.isFinite(ps) || ps < 1 || ps > 255) {
    o.paperSize = PRINT_DEFAULTS.paperSize;
  } else {
    o.paperSize = Math.round(ps);
  }
  return o;
}

function mergePrintParams(parsed) {
  const base = { ...PRINT_DEFAULTS };
  if (!parsed || typeof parsed !== "object") return base;
  for (const k of Object.keys(PRINT_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(parsed, k)) {
      base[k] = parsed[k];
    }
  }
  return sanitizePrintParams(base);
}

function parseJsonResponse(raw) {
  if (raw == null || raw === "") return {};
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (parsed && parsed.result !== undefined) {
    parsed = parsed.result;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return {};
      }
    }
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

/** Page-shaped preview: same physical sheet, rotated (not two different sizes). */
function PrintOrientationPreview({ orientation }) {
  const portrait = orientation === 0;
  // Letter-like aspect 8.5:11 — one rect, rotation only for landscape
  const pw = 20;
  const ph = 26;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 48"
      width="56"
      height="42"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
    >
      <g transform="translate(32 24)">
        <g transform={portrait ? "rotate(0)" : "rotate(90)"}>
          <rect
            x={-pw / 2}
            y={-ph / 2}
            width={pw}
            height={ph}
            rx="2"
            fill="#f5f5f5"
            stroke="#6b6b6b"
            strokeWidth="1.5"
          />
        </g>
      </g>
    </svg>
  );
}

class SkSpPrintParameters extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.state = {
      params: { ...PRINT_DEFAULTS },
      sheet: "",
      error: "",
      info: "",
      paperSizeCustomUi: false,
      exportBusy: false,
      exportProgress: "",
      pdfScope: "active",
    };
    this.refresh = this.refresh.bind(this);
    this.apply = this.apply.bind(this);
    this.resetDefaults = this.resetDefaults.bind(this);
    this.exportPdf = this.exportPdf.bind(this);
    this._boundOnReloadView = null;
    this._boundOnVisibility = null;
    /** Last workbook sheet tab synced from SpInterface (not the panel stack tab). */
    this._trackedActiveSheet = null;
  }

  currentSheet() {
    if (
      this.m_SpInterface &&
      this.m_SpInterface.m_UIView &&
      this.m_SpInterface.m_UIView.sheet
    ) {
      return this.m_SpInterface.m_UIView.sheet;
    }
    return "";
  }

  componentDidMount() {
    this._trackedActiveSheet = this.currentSheet();
    this.refresh();
    this._boundOnReloadView = () => {
      this.refresh();
    };
    this._boundOnVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        this.refresh();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("sker:reloadView", this._boundOnReloadView);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._boundOnVisibility);
    }
  }

  componentWillUnmount() {
    if (typeof window !== "undefined" && this._boundOnReloadView) {
      window.removeEventListener("sker:reloadView", this._boundOnReloadView);
    }
    if (typeof document !== "undefined" && this._boundOnVisibility) {
      document.removeEventListener("visibilitychange", this._boundOnVisibility);
    }
  }

  componentDidUpdate() {
    const active = this.currentSheet();
    if (active === this._trackedActiveSheet) return;
    this._trackedActiveSheet = active;
    // Active workbook sheet changed — reload orientation / FitToPage for that sheet.
    this.setState({ sheet: active || "" }, () => {
      this.refresh();
    });
  }

  resolveTargetSheet() {
    return (this.currentSheet() || this.state.sheet || "").trim();
  }

  async refresh() {
    const wSheetHint = this.resolveTargetSheet();
    this.setState({
      sheet: wSheetHint,
      error: "",
    });
    try {
      const api = await waitForSkUISpreadSheet();
      let raw = await api.jsonPrintParameters(wSheetHint);
      raw = unwrapWorkerResult(raw);
      const parsed = parseJsonResponse(raw);
      const merged = mergePrintParams(parsed);
      this.setState({
        params: merged,
        paperSizeCustomUi: !OOXML_PAPER_PRESET_CODES.has(merged.paperSize),
      });
    } catch (e) {
      console.error("SkSpPrintParameters::refresh", e);
      this.setState({ error: "Unable to load print parameters" });
    }
  }

  /** Persist form params to the engine. Returns false if apply failed. */
  async persistPrintParameters(params) {
    const wSheet = this.resolveTargetSheet();
    try {
      const api = await waitForSkUISpreadSheet();
      const json = JSON.stringify(params);
      const raw = await api.setJsonPrintParameters(json, wSheet);
      let ok = raw;
      if (typeof raw === "object" && raw !== null && "result" in raw) {
        ok = raw.result;
      }
      if (ok === false || ok === "false") {
        this.setState({ error: "Invalid JSON or unknown sheet" });
        return false;
      }
      return true;
    } catch (e) {
      console.error("SkSpPrintParameters::persistPrintParameters", e);
      this.setState({ error: "Apply failed" });
      return false;
    }
  }

  async apply() {
    const wSheet = this.resolveTargetSheet();
    this.setState({ error: "", info: "" });
    const ok = await this.persistPrintParameters(this.state.params);
    if (!ok) return;
    this.setState({ info: "Print settings applied.", sheet: wSheet });
    await this.refresh();
  }

  resetDefaults() {
    this.setState({
      params: { ...PRINT_DEFAULTS },
      error: "",
      info: "",
      paperSizeCustomUi: false,
    });
  }

  async exportPdf() {
    if (this.state.exportBusy) return;
    if (this.m_SpInterface == null) {
      this.setState({ error: "Spreadsheet not ready" });
      return;
    }
    const wSheet = this.resolveTargetSheet();
    const wWorkbookScope = this.state.pdfScope === "workbook";
    // Snapshot before any await — refresh()/setActiveSheet must not overwrite UI edits.
    const exportParams = mergePrintParams({ ...this.state.params });
    this.setState({
      exportBusy: true,
      error: "",
      info: "",
      exportProgress: "Applying…",
    });
    const setBusy = (text, pct) => {
      if (typeof window !== "undefined" && typeof window.__skerSetBusy === "function") {
        window.__skerSetBusy(text, pct);
      }
    };
    try {
      setBusy("Applying print settings…", 0);
      const persisted = await this.persistPrintParameters(exportParams);
      if (!persisted) {
        return;
      }
      setBusy("Preparing PDF…", 0);
      this.setState({ exportProgress: "Preparing…" });
      const activePath = getActiveFilePath();
      const wFileBase = activePath
        ? activePath.split("/").pop()?.replace(/\.sker$/i, "") || wSheet || "export"
        : wSheet || "export";

      const onProgress = (done, total, meta) => {
        const wTotal = total > 0 ? total : 1;
        if (meta && meta.sheetCount > 1) {
          // Overall progress: completed sheets + fraction of the current sheet's pages.
          const wFrac = (meta.sheetIndex - 1 + done / wTotal) / meta.sheetCount;
          const wPct = Math.max(0, Math.min(100, Math.round(wFrac * 100)));
          this.setState({
            exportProgress: `Sheet ${meta.sheetIndex}/${meta.sheetCount} — page ${done}/${total}`,
          });
          setBusy(
            `Exporting PDF — sheet ${meta.sheetIndex}/${meta.sheetCount} (${fixedWidthSheetName(meta.sheet)})`,
            wPct,
          );
        } else {
          const wPct = Math.max(0, Math.min(100, Math.round((done / wTotal) * 100)));
          this.setState({ exportProgress: `Page ${done} / ${total}` });
          setBusy("Exporting PDF…", wPct);
        }
      };

      if (wWorkbookScope) {
        // Each sheet merges workbook print parameters with its own orientation / FitToPage.
        const resolveParamsForSheet = async (sSheet) => {
          try {
            const api = await waitForSkUISpreadSheet();
            let raw = await api.jsonPrintParameters(sSheet);
            raw = unwrapWorkerResult(raw);
            return mergePrintParams(parseJsonResponse(raw));
          } catch {
            return mergePrintParams({ ...PRINT_DEFAULTS });
          }
        };
        await downloadWorkbookPdf(
          this.m_SpInterface,
          resolveParamsForSheet,
          `${wFileBase}-workbook`,
          { onProgress },
        );
        this.setState({
          info: "Workbook PDF downloaded (all sheets).",
          exportProgress: "",
        });
      } else {
        if (wSheet && typeof this.m_SpInterface.setActiveSheet === "function") {
          await this.m_SpInterface.setActiveSheet(wSheet);
        }
        await downloadActiveSheetPdf(this.m_SpInterface, exportParams, wFileBase, {
          onProgress,
        });
        this.setState({
          info: "PDF downloaded (client export with sparklines).",
          exportProgress: "",
        });
      }
    } catch (e) {
      console.error("SkSpPrintParameters::exportPdf", e);
      this.setState({
        error: e?.message || "PDF export failed",
        exportProgress: "",
      });
    } finally {
      this.setState({ exportBusy: false });
      setBusy(null);
    }
  }

  patchParams(partial) {
    this.setState((s) => ({
      params: { ...s.params, ...partial },
      error: "",
      info: "",
    }));
  }

  setNum(key, value, intMode) {
    const n = intMode ? parseInt(value, 10) : parseFloat(value);
    if (Number.isFinite(n)) {
      this.patchParams({ [key]: n });
    }
  }

  renderField(label, control) {
    return (
      <div style={fieldRowStyle}>
        <label style={labelStyle}>{label}</label>
        <div style={controlWrapStyle}>{control}</div>
      </div>
    );
  }

  /** Checkbox row: same line as label (global CSS sets checkboxes to width 100% for cells). */
  renderCheckboxField(label, control) {
    return (
      <div style={checkboxFieldRowStyle}>
        <label style={labelStyle}>{label}</label>
        <div style={checkboxControlWrapStyle}>{control}</div>
      </div>
    );
  }

  /** Preset dropdown + optional numeric OOXML code (custom formats). */
  renderPaperSizeControl() {
    const { params, paperSizeCustomUi } = this.state;
    const ps = params.paperSize;
    const inPreset = OOXML_PAPER_PRESET_CODES.has(ps);
    const selectValue =
      paperSizeCustomUi || !inPreset ? "custom" : String(ps);

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          width: "auto",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <select
          style={selectStyle}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") {
              this.setState({ paperSizeCustomUi: true });
            } else {
              this.setState({ paperSizeCustomUi: false });
              this.patchParams({ paperSize: parseInt(v, 10) });
            }
          }}
        >
          {OOXML_PAPER_CHOICES.map((o) => (
            <option key={o.code} value={String(o.code)}>
              {o.label}{" "}
              <span style={{ opacity: 0.75 }}>({o.code})</span>
            </option>
          ))}
          <option value="custom">Custom OOXML code…</option>
        </select>
        {(paperSizeCustomUi || !inPreset) && (
          <div style={customPaperHintStyle}>
            <SkInput
              type="number"
              min={1}
              max={255}
              title="ECMA-376 paperSize value (1–255) for formats not listed above"
              value={String(ps)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("paperSize", e.target.value, true)}
            />
            <span style={customPaperCaptionStyle}>
              Numeric code stored in the workbook; see OOXML reference for uncommon
              paper sizes.
            </span>
          </div>
        )}
      </div>
    );
  }

  render() {
    const { params, error, info } = this.state;
    const wActiveSheet = this.resolveTargetSheet();

    return (
      <div className="SkSpPrintParameters" style={rootStyle}>
        <div style={headerStyle}>
          <div style={{ fontWeight: "bold", fontSize: "14px" }}>Print parameters</div>
          <div style={{ display: "flex", gap: "6px" }}>
            <SkButton onClick={this.refresh} title="Reload from engine">
              ⟳
            </SkButton>
          </div>
        </div>

        <div style={hintStyle}>
          <strong>Orientation</strong> and <strong>Fit to page</strong> apply to the
          active sheet{wActiveSheet ? ` (${wActiveSheet})` : ""}. All other settings
          apply to the whole workbook. Use <strong>Apply</strong> to persist.
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {info ? <div style={infoStyle}>{info}</div> : null}

        <div style={pdfScopeRowStyle}>
          <label style={labelStyle}>PDF scope</label>
          <select
            style={selectStyle}
            value={this.state.pdfScope}
            disabled={this.state.exportBusy}
            onChange={(e) => this.setState({ pdfScope: e.target.value })}
          >
            <option value="active">Active sheet</option>
            <option value="workbook">Entire workbook</option>
          </select>
        </div>

        <div style={buttonsRowStyle}>
          <SkButton
            onClick={this.exportPdf}
            title="Apply print settings, then download PDF from the browser (includes sparklines and widgets)"
            disabled={this.state.exportBusy}
          >
            {this.state.exportBusy ? "Exporting…" : "Export PDF"}
          </SkButton>
          <SkButton
            onClick={this.apply}
            title="Write workbook settings plus this sheet's orientation and Fit to page"
          >
            Apply
          </SkButton>
          <SkButton onClick={this.resetDefaults} title="Reset form to Excel-style defaults">
            Reset form
          </SkButton>
        </div>
        {this.state.exportProgress ? (
          <div style={{ ...hintStyle, marginTop: "6px" }}>{this.state.exportProgress}</div>
        ) : null}

        <div style={formScrollStyle}>
          <div style={{ ...sectionTitleStyle, marginTop: 0 }}>
            This sheet{wActiveSheet ? ` — ${wActiveSheet}` : ""}
          </div>
          {this.renderField(
            "Orientation",
            <div style={orientationControlRowStyle}>
              <select
                style={orientationSelectStyle}
                value={String(Number(params.orientation) === 1 ? 1 : 0)}
                onChange={(e) =>
                  this.patchParams({ orientation: parseInt(e.target.value, 10) })
                }
              >
                <option value="0">Portrait</option>
                <option value="1">Landscape</option>
              </select>
              <PrintOrientationPreview
                orientation={Number(params.orientation) === 1 ? 1 : 0}
              />
            </div>
          )}
          {this.renderCheckboxField(
            "Fit to page",
            <input
              type="checkbox"
              checked={params.fitToPage}
              onChange={(e) => this.patchParams({ fitToPage: e.target.checked })}
            />
          )}

          <div style={sectionTitleStyle}>Workbook — page</div>
          {this.renderField("Paper size", this.renderPaperSizeControl())}
          {this.renderField(
            "Page order",
            <select
              style={selectStyle}
              value={params.pageOrder}
              onChange={(e) =>
                this.patchParams({ pageOrder: parseInt(e.target.value, 10) })
              }
            >
              <option value={0}>Down, then over</option>
              <option value={1}>Over, then down</option>
            </select>
          )}

          <div style={sectionTitleStyle}>Workbook — scaling</div>
          {this.renderField(
            "Scale % (10–400)",
            <SkInput
              type="number"
              min={10}
              max={400}
              value={String(params.scale)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("scale", e.target.value, true)}
              disabled={params.fitToPage}
            />
          )}
          {this.renderField(
            "Fit to width (pages)",
            <SkInput
              type="number"
              min={1}
              value={String(params.fitToWidthPages)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("fitToWidthPages", e.target.value, true)}
              disabled={!params.fitToPage}
            />
          )}
          {this.renderField(
            "Fit to height (pages)",
            <SkInput
              type="number"
              min={1}
              value={String(params.fitToHeightPages)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("fitToHeightPages", e.target.value, true)}
              disabled={!params.fitToPage}
            />
          )}

          <div style={sectionTitleStyle}>Workbook — margins (inches)</div>
          {["marginLeft", "marginRight", "marginTop", "marginBottom", "marginHeader", "marginFooter"].map(
            (k) =>
              this.renderField(
                MARGIN_LABELS[k] || k,
                <SkInput
                  type="number"
                  step="0.05"
                  value={String(params[k])}
                  style={printValueInputStyle}
                  onChange={(e) => this.setNum(k, e.target.value, false)}
                />
              )
          )}

          <div style={sectionTitleStyle}>Workbook — output</div>
          {this.renderField(
            "Copies",
            <SkInput
              type="number"
              min={1}
              value={String(params.copies)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("copies", e.target.value, true)}
            />
          )}
          {this.renderField(
            "First page # (0 = auto)",
            <SkInput
              type="number"
              min={0}
              value={String(params.firstPageNumber)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("firstPageNumber", e.target.value, true)}
            />
          )}
          {this.renderField(
            "Horizontal DPI",
            <SkInput
              type="number"
              min={1}
              value={String(params.horizontalDpi)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("horizontalDpi", e.target.value, true)}
            />
          )}
          {this.renderField(
            "Vertical DPI",
            <SkInput
              type="number"
              min={1}
              value={String(params.verticalDpi)}
              style={printValueInputStyle}
              onChange={(e) => this.setNum("verticalDpi", e.target.value, true)}
            />
          )}
          {this.renderCheckboxField(
            "Black and white",
            <input
              type="checkbox"
              checked={params.blackAndWhite}
              onChange={(e) => this.patchParams({ blackAndWhite: e.target.checked })}
            />
          )}
          {this.renderCheckboxField(
            "Draft",
            <input
              type="checkbox"
              checked={params.draft}
              onChange={(e) => this.patchParams({ draft: e.target.checked })}
            />
          )}
          {this.renderCheckboxField(
            "Use printer defaults",
            <input
              type="checkbox"
              checked={params.usePrinterDefaults}
              onChange={(e) =>
                this.patchParams({ usePrinterDefaults: e.target.checked })
              }
            />
          )}

          <div style={sectionTitleStyle}>Workbook — print display</div>
          {this.renderCheckboxField(
            "Print gridlines",
            <input
              type="checkbox"
              checked={params.printGridLines}
              onChange={(e) => this.patchParams({ printGridLines: e.target.checked })}
            />
          )}
          {this.renderCheckboxField(
            "Print row and column headings",
            <input
              type="checkbox"
              checked={params.printHeadings}
              onChange={(e) => this.patchParams({ printHeadings: e.target.checked })}
            />
          )}
          {this.renderCheckboxField(
            "Center horizontally",
            <input
              type="checkbox"
              checked={params.horizontalCentered}
              onChange={(e) =>
                this.patchParams({ horizontalCentered: e.target.checked })
              }
            />
          )}
          {this.renderCheckboxField(
            "Center vertically",
            <input
              type="checkbox"
              checked={params.verticalCentered}
              onChange={(e) =>
                this.patchParams({ verticalCentered: e.target.checked })
              }
            />
          )}
          {this.renderCheckboxField(
            "Automatic page breaks",
            <input
              type="checkbox"
              checked={params.autoPageBreaks}
              onChange={(e) => this.patchParams({ autoPageBreaks: e.target.checked })}
            />
          )}
        </div>
      </div>
    );
  }
}

const rootStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  padding: "8px",
  boxSizing: "border-box",
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "8px",
};

const hintStyle = {
  fontSize: "11px",
  color: "var(--sk-text-muted, #888)",
  marginBottom: "8px",
  lineHeight: 1.35,
};

const formScrollStyle = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  overflowX: "auto",
  border: "1px solid var(--sk-border-color, #e0e0e0)",
  borderRadius: "4px",
  padding: "10px",
  marginTop: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const sectionTitleStyle = {
  fontSize: "12px",
  fontWeight: "600",
  color: "var(--sk-text-color, #444)",
  marginTop: "6px",
  borderBottom: "1px solid var(--sk-border-color, #eee)",
  paddingBottom: "4px",
};

const fieldRowStyle = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "6px",
  flexWrap: "nowrap",
  justifyContent: "flex-start",
};

const checkboxFieldRowStyle = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "6px",
  flexWrap: "nowrap",
  justifyContent: "flex-start",
};

/** Label width follows text; long labels may wrap */
const labelStyle = {
  flex: "0 1 auto",
  fontSize: "12px",
  color: "var(--sk-text-color, #333)",
  lineHeight: 1.3,
  maxWidth: "55%",
};

const controlWrapStyle = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "100%",
};

const checkboxControlWrapStyle = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
};

const selectStyle = {
  width: "auto",
  minWidth: "10.5rem",
  maxWidth: "100%",
  padding: "6px 8px",
  fontSize: "13px",
  borderRadius: "4px",
  border: "1px solid var(--sk-border-color, #ccc)",
  color: "var(--sk-input-color, #333)",
  backgroundColor: "var(--sk-input-color-background, #fff)",
  boxSizing: "border-box",
};

const orientationControlRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  width: "auto",
  maxWidth: "100%",
  flexWrap: "nowrap",
};

const orientationSelectStyle = {
  ...selectStyle,
  minWidth: "8.5rem",
};

/** Numeric / short text inputs in this panel */
const printValueInputStyle = {
  width: "auto",
  minWidth: "4.25rem",
  maxWidth: "100%",
  boxSizing: "border-box",
};

const errorStyle = { color: "var(--sk-error-color, #e5484d)", fontSize: "12px", marginBottom: "6px" };
const infoStyle = { color: "var(--sk-success-color, #2fbf71)", fontSize: "12px", marginBottom: "6px" };

const buttonsRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "10px",
};

const pdfScopeRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "4px",
};

const customPaperHintStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const customPaperCaptionStyle = {
  fontSize: "11px",
  color: "var(--sk-text-muted, #777)",
  lineHeight: 1.35,
};

export default SkSpPrintParameters;
