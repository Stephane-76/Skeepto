//=============================================================================
// SkSpFormulaNamed
// Google-Sheets-like panel to manage named formulas (Excel: "LET/LAMBDA"-style
// named formulas, e.g. "=SUM(Sheet1!A1:A10)" or "{1;1}+{0,1,2,3,4}").
//
// UI: same layout as SkSpRangeNamed (header "+ Add", scrollable list with
// pencil-to-edit, keyboard navigation, inline edit form). Differences:
//   - Each entry has only a Name and a Formula (no per-entry sheet in JSON).
//   - The Formula input is a SkSpInplaceEdit with AcceptSelection="true",
//     so users can click cells on the grid to inject A1-style references.
//   - Clicking a row does NOT change the spreadsheet selection (a formula
//     is not a range), only the row is highlighted for keyboard nav.
//=============================================================================
import React, { Component } from "react";
import { showConfirm } from "../skDialog.js";

import SkInput from "../component/SkInput";
import SkButton from "../component/SkButton";
import SkSpInplaceEdit from "./SkSpInplaceEdit";
import "./SkSpreadSheet.css";

// Special sentinel value for the "new formula" draft.
const DRAFT_INDEX = -2;

/** Named formulas compile as raw expressions — no leading '=' (unlike sheet cells). */
function normalizeNamedFormulaForEngine(text) {
  const wTrim = (text ?? "").trim();
  if (wTrim.startsWith("=")) {
    return wTrim.slice(1);
  }
  return wTrim;
}

// Ready-to-use LAMBDA / LET starter templates. Clicking one fills the Name and Formula
// fields so the user can call the function by name from any cell (e.g. =SURFACE(3, 4)).
const LAMBDA_EXAMPLES = [
  {
    name: "SURFACE",
    formula: "LAMBDA(l, h, l*h)",
    hint: "Custom function: call =SURFACE(3, 4)",
  },
  {
    name: "INCREMENT",
    formula: "LAMBDA(x, x+1)",
    hint: "One parameter: call =INCREMENT(5)",
  },
  {
    name: "FACT",
    formula: "LAMBDA(n, IF(n<=1, 1, n*FACT(n-1)))",
    hint: "Recursion: call =FACT(5)",
  },
  {
    name: "DOUBLEALL",
    formula: "LAMBDA(r, MAP(r, LAMBDA(x, x*2)))",
    hint: "Higher-order: call =DOUBLEALL(A1:A5)",
  },
  {
    name: "SUMSQ",
    formula: "LAMBDA(r, REDUCE(0, r, LAMBDA(acc, x, acc+x*x)))",
    hint: "Reduce: call =SUMSQ(A1:A5)",
  },
  {
    name: "MARGIN",
    formula: "LET(price, 100, cost, 60, (price-cost)/price)",
    hint: "LET named formula: call =MARGIN",
  },
];

class SkSpFormulaNamed extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;

    // A fresh ref is created each time the edit form (re)mounts so that
    // switching between rows gets a brand new SkSpInplaceEdit instance.
    this.m_FormulaInplaceEdit = React.createRef();
    this.m_ListRef = React.createRef();
    this.m_FormulaBackup = "";

    this.state = {
      formulaNamed: [],
      // -1 : no edit open, -2 : new draft, N : editing row N
      editingIndex: -1,
      // -1 : nothing highlighted, N : row N is keyboard-focused
      highlightedIndex: -1,
      draftName: "",
      draftFormula: "",
      editingFormula: false,
      error: "",
      info: "",
    };

    this.refresh = this.refresh.bind(this);
    this.startNew = this.startNew.bind(this);
    this.startEdit = this.startEdit.bind(this);
    this.confirmEdit = this.confirmEdit.bind(this);
    this.cancelEdit = this.cancelEdit.bind(this);
    this.deleteFormula = this.deleteFormula.bind(this);
    this.handleNameChange = this.handleNameChange.bind(this);
    this.onFormulaEditStart = this.onFormulaEditStart.bind(this);
    this.onFormulaTextChange = this.onFormulaTextChange.bind(this);
    this.onRowClick = this.onRowClick.bind(this);
    this.onListKeyDown = this.onListKeyDown.bind(this);
    this.onListFocus = this.onListFocus.bind(this);
    this.applyExample = this.applyExample.bind(this);
  }

  componentDidMount() {
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

  //---------------------------------------------------------------------
  // SpInterface helpers
  //---------------------------------------------------------------------

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

  // Read the current text from the mounted Formula SkSpInplaceEdit.
  getFormulaText() {
    const wRef = this.m_FormulaInplaceEdit.current;
    if (wRef && typeof wRef.text === "function") {
      try {
        return wRef.text();
      } catch (e) {
        return this.state.draftFormula;
      }
    }
    return this.state.draftFormula;
  }

  // Ensure any ongoing inplace edit is cleanly torn down.
  async endInplaceEditIfNeeded() {
    if (!this.state.editingFormula) return;
    try {
      await this.m_SpInterface.endEdit();
    } catch (e) {
      console.error("SkSpFormulaNamed::endEdit error", e);
    }
  }

  clearFormulaSyntaxError() {
    this.m_SpInterface?.clearFormulaBarCompileError?.();
  }

  /** Show compile diagnostics in the control panel banner (same as formula bar). */
  async notifyFormulaSyntaxError(formulaText, jsError = null) {
    if (
      this.m_SpInterface &&
      typeof this.m_SpInterface.notifyFormulaCompileFailure === "function"
    ) {
      await this.m_SpInterface.notifyFormulaCompileFailure(
        formulaText != null ? formulaText : this.getFormulaText(),
        jsError
      );
    }
  }

  //---------------------------------------------------------------------
  // List scrolling / highlighting (no grid selection: a formula is not a
  // range, so we only move the visual highlight).
  //---------------------------------------------------------------------

  scrollRowIntoView(sIndex) {
    const wList = this.m_ListRef.current;
    if (!wList) return;
    const wChildren = wList.querySelectorAll(".SkSpFormulaNamed-row");
    const wRow = wChildren[sIndex];
    if (wRow && typeof wRow.scrollIntoView === "function") {
      wRow.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  highlightRow(sIndex) {
    const { formulaNamed } = this.state;
    if (sIndex < 0 || sIndex >= formulaNamed.length) return;
    this.setState({ highlightedIndex: sIndex }, () => {
      this.scrollRowIntoView(sIndex);
    });
  }

  onRowClick(idx) {
    const wList = this.m_ListRef.current;
    if (wList && typeof wList.focus === "function") {
      wList.focus({ preventScroll: true });
    }
    this.highlightRow(idx);
  }

  onListFocus() {
    const { formulaNamed, highlightedIndex, editingIndex } = this.state;
    if (formulaNamed.length === 0) return;
    if (highlightedIndex >= 0 && highlightedIndex < formulaNamed.length) return;
    // Skip the row currently in edit mode (if any).
    let wStart = 0;
    if (editingIndex >= 0 && editingIndex === wStart) wStart = 1;
    if (wStart >= formulaNamed.length) return;
    this.highlightRow(wStart);
  }

  onListKeyDown(event) {
    const { formulaNamed, highlightedIndex } = this.state;
    if (formulaNamed.length === 0) return;

    const wLast = formulaNamed.length - 1;
    let wNext = highlightedIndex;

    switch (event.key) {
      case "ArrowDown":
        wNext = highlightedIndex < 0 ? 0 : Math.min(wLast, highlightedIndex + 1);
        break;
      case "ArrowUp":
        wNext = highlightedIndex <= 0 ? 0 : highlightedIndex - 1;
        break;
      case "Home":
        wNext = 0;
        break;
      case "End":
        wNext = wLast;
        break;
      case "PageDown":
        wNext = Math.min(
          wLast,
          (highlightedIndex < 0 ? 0 : highlightedIndex) + 10
        );
        break;
      case "PageUp":
        wNext = Math.max(
          0,
          (highlightedIndex < 0 ? 0 : highlightedIndex) - 10
        );
        break;
      case "Enter":
      case "F2":
        event.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex <= wLast) {
          this.startEdit(highlightedIndex);
        }
        return;
      default:
        return;
    }

    event.preventDefault();
    if (wNext !== highlightedIndex) {
      this.highlightRow(wNext);
    }
  }

  //---------------------------------------------------------------------
  // Data
  //---------------------------------------------------------------------

  async ensureUISpreadSheet() {
    if (this.m_SpInterface && typeof this.m_SpInterface.loadUI === "function") {
      await this.m_SpInterface.loadUI();
    }
    return (
      typeof window !== "undefined" &&
      window.SkUISpreadSheet != null &&
      typeof window.SkUISpreadSheet.jsonFormulaNamed === "function"
    );
  }

  async refresh() {
    try {
      if (!(await this.ensureUISpreadSheet())) {
        return;
      }
      const raw = window.SkUISpreadSheet.jsonFormulaNamed();
      let parsed = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = {};
        }
      }
      if (parsed && parsed.result !== undefined) {
        parsed = parsed.result;
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch (e) {
            parsed = {};
          }
        }
      }
      const list =
        parsed && Array.isArray(parsed.formulanamed) ? parsed.formulanamed : [];

      // Keep the edit open on the same logical entry after refresh, and
      // resync the draft fields with the fresh backend data.
      let wNewEditing = this.state.editingIndex;
      const wExtra = {};
      let wFreshFormula = null;
      if (wNewEditing >= 0) {
        const wPrev = this.state.formulaNamed[wNewEditing];
        if (wPrev) {
          const wFound = list.findIndex((f) => f.n === wPrev.n);
          wNewEditing = wFound;
          if (wFound >= 0) {
            const wCurrent = list[wFound];
            wExtra.draftName = wCurrent.n || "";
            wExtra.draftFormula = wCurrent.f || "";
            wFreshFormula = wExtra.draftFormula;
          }
        } else {
          wNewEditing = -1;
        }
      }
      this.setState(
        {
          formulaNamed: list,
          editingIndex: wNewEditing,
          error: "",
          ...wExtra,
        },
        () => {
          // SkSpInplaceEdit is uncontrolled; force its internal input to
          // match the freshly-loaded formula.
          if (wFreshFormula !== null) {
            const wInplace = this.m_FormulaInplaceEdit.current;
            if (wInplace && typeof wInplace.setText === "function") {
              try {
                wInplace.setText(wFreshFormula);
              } catch (err) {
                console.error(
                  "SkSpFormulaNamed::refresh setText error",
                  err
                );
              }
            }
          }
        }
      );
    } catch (e) {
      console.error("SkSpFormulaNamed::refresh error", e);
      this.setState({ error: "Unable to load named formulas" });
    }
  }

  //---------------------------------------------------------------------
  // Edit lifecycle
  //---------------------------------------------------------------------

  handleNameChange(event) {
    this.setState({ draftName: event.target.value });
  }

  onFormulaEditStart() {
    if (this.state.editingFormula) return;
    this.m_FormulaBackup = this.getFormulaText();
    this.setState({ editingFormula: true });
  }

  onFormulaTextChange(sText) {
    if (sText !== this.state.draftFormula) {
      this.clearFormulaSyntaxError();
      this.setState({ draftFormula: sText, error: "" });
    }
  }

  // Fill the edit form from a LAMBDA/LET template. The Name is only pre-filled when the
  // user has not typed one yet, so an example never clobbers a name in progress.
  applyExample(sExample) {
    this.clearFormulaSyntaxError();
    const wKeepName = (this.state.draftName || "").trim().length > 0;
    const wName = wKeepName ? this.state.draftName : sExample.name;
    this.setState({ draftName: wName, draftFormula: sExample.formula, error: "", info: "" });
    // SkSpInplaceEdit is uncontrolled: push the text into its internal input directly.
    const wInplace = this.m_FormulaInplaceEdit.current;
    if (wInplace && typeof wInplace.setText === "function") {
      try {
        wInplace.setText(sExample.formula);
      } catch (e) {
        console.error("SkSpFormulaNamed::applyExample setText error", e);
      }
    }
  }

  async startNew() {
    await this.endInplaceEditIfNeeded();
    this.clearFormulaSyntaxError();
    this.setState({
      editingIndex: DRAFT_INDEX,
      draftName: "",
      draftFormula: "",
      editingFormula: false,
      error: "",
      info: "",
    });
  }

  async startEdit(sIndex) {
    if (this.state.editingIndex === sIndex) return;
    const f = this.state.formulaNamed[sIndex];
    if (!f) return;
    await this.endInplaceEditIfNeeded();
    this.clearFormulaSyntaxError();
    this.setState({
      editingIndex: sIndex,
      draftName: f.n || "",
      draftFormula: f.f || "",
      editingFormula: false,
      error: "",
      info: "",
    });
  }

  async cancelEdit() {
    await this.endInplaceEditIfNeeded();
    this.clearFormulaSyntaxError();
    this.setState({
      editingIndex: -1,
      editingFormula: false,
      draftName: "",
      draftFormula: "",
      error: "",
      info: "",
    });
  }

  async confirmEdit() {
    const { editingIndex, draftName, formulaNamed } = this.state;
    // Read the live text from the inplace edit so that any grid selection
    // not yet captured in state is taken into account.
    const wFormula = this.getFormulaText();
    const wName = (draftName || "").trim();
    const wSheet = this.currentSheet();

    if (!wName) {
      this.setState({ error: "Name is required", info: "" });
      return;
    }
    if (!wFormula || !wFormula.trim()) {
      this.setState({ error: "Formula is required", info: "" });
      return;
    }

    // Check duplicate name (excluding the currently edited entry).
    const wClash = formulaNamed.some(
      (f, i) => i !== editingIndex && f.n === wName
    );
    if (wClash) {
      this.setState({
        error: `A formula named "${wName}" already exists`,
        info: "",
      });
      return;
    }

    const wFormulaRaw = wFormula.trim();
    const wFormulaEngine = normalizeNamedFormulaForEngine(wFormulaRaw);

    // Keep caret / Lemon diagnostics aligned with the compiled string.
    if (wFormulaEngine !== wFormulaRaw) {
      const wInplaceSync = this.m_FormulaInplaceEdit.current;
      if (wInplaceSync && typeof wInplaceSync.setText === "function") {
        wInplaceSync.setText(wFormulaEngine);
      }
      this.setState({ draftFormula: wFormulaEngine });
    }

    // Keep the formula field registered as the active property edit so compile
    // errors can target the caret (same path as formula bar validation).
    const wInplace = this.m_FormulaInplaceEdit.current;
    if (wInplace && typeof wInplace.autoPushPropertyEdit === "function") {
      wInplace.autoPushPropertyEdit();
    }

    try {
      if (!(await this.ensureUISpreadSheet())) {
        this.setState({ error: "Spreadsheet API not ready", info: "" });
        return;
      }
      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();

      if (editingIndex === DRAFT_INDEX) {
        const ok = window.SkUISpreadSheet.insertFormulaNamed(
          wName,
          wFormulaEngine,
          wSheet
        );
        if (!ok) {
          await this.notifyFormulaSyntaxError(wFormulaEngine);
          try {
            window.SkUISpreadSheet.deleteFormulaNamed(wName, wSheet);
          } catch (_) {
            /* ignore cleanup failure */
          }
          await this.refresh();
          this.setState({ error: "", info: "" });
          return;
        }
        await this.endInplaceEditIfNeeded();
        this.clearFormulaSyntaxError();
        this.setState({
          info: `Formula "${wName}" created`,
          error: "",
          editingIndex: -1,
          editingFormula: false,
          draftName: "",
          draftFormula: "",
        });
      } else {
        const wOriginal = formulaNamed[editingIndex];
        if (!wOriginal) return;
        // Updating is rename-safe: delete old, then insert new. If the name
        // is unchanged, InsertFormulaNamed replaces the existing entry so a
        // prior delete would be redundant but harmless.
        if (wOriginal.n !== wName) {
          const deleted = window.SkUISpreadSheet.deleteFormulaNamed(
            wOriginal.n,
            wSheet
          );
          if (!deleted) {
            this.setState({ error: "Update failed (delete step)", info: "" });
            return;
          }
        }
        const inserted = window.SkUISpreadSheet.insertFormulaNamed(
          wName,
          wFormulaEngine,
          wSheet
        );
        if (!inserted) {
          await this.notifyFormulaSyntaxError(wFormulaEngine);
          await this.refresh();
          this.setState({ error: "", info: "" });
          return;
        }
        await this.endInplaceEditIfNeeded();
        this.clearFormulaSyntaxError();
        this.setState({
          info: `Formula "${wOriginal.n}" updated`,
          error: "",
          editingIndex: -1,
          editingFormula: false,
          draftName: "",
          draftFormula: "",
        });
      }

      await this.refresh();
      await this.m_SpInterface.reloadView();
    } catch (e) {
      console.error("SkSpFormulaNamed::confirmEdit error", e);
      await this.notifyFormulaSyntaxError(wFormulaEngine, e);
      this.setState({ error: "", info: "" });
    }
  }

  async deleteFormula() {
    const { editingIndex, formulaNamed } = this.state;
    if (editingIndex < 0 || editingIndex >= formulaNamed.length) return;
    const f = formulaNamed[editingIndex];

    const confirmed = await showConfirm({
      message: `Delete named formula "${f.n}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    await this.endInplaceEditIfNeeded();

    try {
      if (!(await this.ensureUISpreadSheet())) {
        this.setState({ error: "Spreadsheet API not ready", info: "" });
        return;
      }
      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();
      const ok = window.SkUISpreadSheet.deleteFormulaNamed(
        f.n,
        this.currentSheet()
      );
      if (!ok) {
        this.setState({ error: `Unable to delete "${f.n}"`, info: "" });
        return;
      }
      this.setState({
        info: `Formula "${f.n}" deleted`,
        error: "",
        editingIndex: -1,
        editingFormula: false,
        draftName: "",
        draftFormula: "",
      });
      await this.refresh();
      await this.m_SpInterface.reloadView();
    } catch (e) {
      console.error("SkSpFormulaNamed::deleteFormula error", e);
      this.setState({ error: "Deletion error", info: "" });
    }
  }

  //---------------------------------------------------------------------
  // Rendering
  //---------------------------------------------------------------------

  renderEditForm(sIsNew) {
    const {
      draftName,
      draftFormula,
      formulaNamed,
      editingIndex,
      error,
    } = this.state;

    const wNameTrim = (draftName || "").trim();
    const wFormulaTrim = (draftFormula || "").trim();
    const wNameValid = wNameTrim.length > 0;
    const wFormulaValid = wFormulaTrim.length > 0;
    const wNameClash =
      wNameValid &&
      formulaNamed.some((f, i) => i !== editingIndex && f.n === wNameTrim);
    const wCanOk = wNameValid && wFormulaValid && !wNameClash;

    return (
      <div className="SkSpFormulaNamed-edit" style={editStyle}>
        <label style={labelStyle}>Name</label>
        <SkInput
          id="formulaNamedName"
          name="formulaNamedName"
          placeholder="e.g. MyList"
          value={draftName}
          onChange={this.handleNameChange}
        />

        <label style={labelStyle}>Formula</label>
        <SkSpInplaceEdit
          ref={this.m_FormulaInplaceEdit}
          style={{ flex: 1, margin: "3px", padding: "3px" }}
          static="true"
          AcceptSelection="true"
          SpInterface={this.m_SpInterface}
          Id={"InplaceEditFormulaNamedFormula"}
          Property={"formulaNamedFormula"}
          Text={draftFormula}
          onEditStart={this.onFormulaEditStart}
          onTextChange={this.onFormulaTextChange}
        >
          {draftFormula}
        </SkSpInplaceEdit>

        <div style={examplesWrapStyle}>
          <div style={examplesTitleStyle}>LAMBDA / LET templates</div>
          <div style={examplesRowStyle}>
            {LAMBDA_EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                type="button"
                style={exampleChipStyle}
                className="SkSpFormulaNamed-example"
                onClick={() => this.applyExample(ex)}
                title={`${ex.formula} — ${ex.hint}`}
              >
                {ex.name}
              </button>
            ))}
          </div>
          <div style={examplesHintStyle}>
            Click a template to fill the form. The last argument of LAMBDA is the
            body; call it by its Name, e.g. <code>=SURFACE(3, 4)</code>.
          </div>
        </div>

        <div style={buttonsRowStyle}>
          <SkButton
            onClick={this.confirmEdit}
            disabled={!wCanOk}
            title={
              wCanOk
                ? "Save"
                : wNameClash
                ? `A formula named "${wNameTrim}" already exists`
                : "Fill in name and formula"
            }
          >
            OK
          </SkButton>
          <SkButton onClick={this.cancelEdit} title="Discard changes">
            Cancel
          </SkButton>
          {!sIsNew && (
            <SkButton
              onClick={this.deleteFormula}
              title="Delete this named formula"
              className="SkButtonDanger"
            >
              Delete
            </SkButton>
          )}
        </div>

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  }

  renderRow(f, idx) {
    const wIsEditing = this.state.editingIndex === idx;
    if (wIsEditing) {
      return (
        <li key={`edit:${f.n}`} style={rowEditingStyle}>
          {this.renderEditForm(false)}
        </li>
      );
    }
    const wIsHighlighted = this.state.highlightedIndex === idx;
    return (
      <li
        key={`row:${f.n}`}
        style={rowStyle}
        className={
          "SkSpFormulaNamed-row" +
          (wIsHighlighted ? " SkSpFormulaNamed-row--highlighted" : "")
        }
        onClick={() => this.onRowClick(idx)}
        title="Click to highlight, pencil to edit"
      >
        <div style={rowContentStyle}>
          <div style={rowNameStyle}>{f.n}</div>
          <div style={rowSubStyle}>= {f.f || ""}</div>
        </div>
        <button
          type="button"
          className="SkSpFormulaNamed-pencil"
          style={pencilButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            this.startEdit(idx);
          }}
          title="Edit this named formula"
          aria-label={`Edit ${f.n}`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M11.5 2.5L13.5 4.5L5 13L2 14L3 11L11.5 2.5Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 4L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </li>
    );
  }

  render() {
    const { formulaNamed, editingIndex, info } = this.state;
    const wIsNewDraft = editingIndex === DRAFT_INDEX;
    const wAnythingEditing = editingIndex !== -1;

    return (
      <div className="SkSpFormulaNamed" style={rootStyle}>
        {/* Header with + Add button */}
        <div style={headerStyle}>
          <div style={{ fontWeight: "bold", fontSize: "14px" }}>
            Named formulas ({formulaNamed.length})
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <SkButton
              onClick={this.startNew}
              disabled={wIsNewDraft}
              title={
                wIsNewDraft
                  ? "Already creating a new formula"
                  : "Add a new named formula"
              }
            >
              +
            </SkButton>
            <SkButton onClick={this.refresh} title="Refresh">
              ⟳
            </SkButton>
          </div>
        </div>

        {info && <div style={infoStyle}>{info}</div>}

        {/* New draft at the top */}
        {wIsNewDraft && (
          <div style={draftWrapperStyle}>
            <div style={draftHeaderStyle}>New formula</div>
            {this.renderEditForm(true)}
          </div>
        )}

        {/* List */}
        <ul
          ref={this.m_ListRef}
          style={listStyle}
          className="SkSpFormulaNamed-list"
          tabIndex={0}
          onKeyDown={this.onListKeyDown}
          onFocus={this.onListFocus}
        >
          {formulaNamed.length === 0 && !wIsNewDraft ? (
            <li style={emptyStyle}>
              No named formulas — click "+" to create one.
            </li>
          ) : (
            formulaNamed.map((f, idx) => this.renderRow(f, idx))
          )}
        </ul>

        {!wAnythingEditing && formulaNamed.length > 0 && (
          <div style={hintStyle}>
            Use arrow keys to navigate, pencil to edit.
          </div>
        )}
      </div>
    );
  }
}

//---------------------------------------------------------------------
// Inline styles (kept local to this component for easy maintenance)
//---------------------------------------------------------------------

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "8px",
};

const labelStyle = {
  fontSize: "11px",
  color: "var(--sk-row-label-color)",
  marginTop: "6px",
  marginBottom: "2px",
};

const buttonsRowStyle = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  marginTop: "8px",
};

const editStyle = {
  display: "flex",
  flexDirection: "column",
  padding: "8px",
  background: "var(--sk-row-edit-background)",
  border: "1px solid var(--sk-row-edit-border)",
  borderRadius: "4px",
};

const errorStyle = {
  color: "#c00",
  fontSize: "12px",
  marginTop: "6px",
};

const infoStyle = {
  color: "#060",
  fontSize: "12px",
  marginBottom: "6px",
};

const examplesWrapStyle = {
  marginTop: "8px",
  padding: "6px 8px",
  background: "var(--sk-row-edit-background)",
  border: "1px dashed var(--sk-row-edit-border)",
  borderRadius: "4px",
};

const examplesTitleStyle = {
  fontSize: "11px",
  fontWeight: "bold",
  color: "var(--sk-row-label-color)",
  marginBottom: "4px",
};

const examplesRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
};

const exampleChipStyle = {
  fontSize: "11px",
  padding: "2px 8px",
  border: "1px solid var(--sk-row-list-border-color)",
  borderRadius: "10px",
  background: "transparent",
  color: "var(--sk-row-text-color)",
  cursor: "pointer",
};

const examplesHintStyle = {
  fontSize: "10px",
  color: "var(--sk-row-hint-color)",
  marginTop: "4px",
  lineHeight: 1.4,
};

const draftWrapperStyle = {
  marginBottom: "8px",
};

const draftHeaderStyle = {
  fontSize: "11px",
  fontWeight: "bold",
  color: "var(--sk-row-draft-header-color)",
  marginBottom: "4px",
};

const rootStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  padding: "8px",
  boxSizing: "border-box",
};

const listStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  border: "1px solid var(--sk-row-list-border-color)",
  borderRadius: "4px",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const rowStyle = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "8px",
  padding: "8px 10px",
  cursor: "pointer",
  borderBottom: "1px solid var(--sk-row-border-color)",
  transition: "background-color 0.15s",
};

const rowContentStyle = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
};

const pencilButtonStyle = {
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  height: "24px",
  padding: 0,
  border: "1px solid transparent",
  borderRadius: "4px",
  background: "transparent",
  color: "var(--sk-row-pencil-color)",
  cursor: "pointer",
  opacity: 0.4,
  transition: "opacity 0.15s, background-color 0.15s, border-color 0.15s",
};

const rowEditingStyle = {
  padding: "0",
  borderBottom: "1px solid var(--sk-row-border-color)",
  background: "var(--sk-row-editing-background)",
};

const rowNameStyle = {
  fontSize: "13px",
  fontWeight: "bold",
  color: "var(--sk-row-text-color)",
};

const rowSubStyle = {
  fontSize: "11px",
  color: "var(--sk-row-subtext-color)",
  fontFamily: "var(--sk-font-family)",
  marginTop: "2px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emptyStyle = {
  padding: "16px 10px",
  color: "var(--sk-row-empty-color)",
  fontStyle: "italic",
  textAlign: "center",
};

const hintStyle = {
  fontSize: "11px",
  color: "var(--sk-row-hint-color)",
  marginTop: "6px",
  textAlign: "center",
};

export default SkSpFormulaNamed;
