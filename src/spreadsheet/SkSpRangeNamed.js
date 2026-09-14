//=============================================================================
// SkSpRangeNamed
// Google-Sheets-like panel to manage named ranges.
//
// UI:
//   - Header with a "+ Add a range" button.
//   - When the button is clicked, a new inline edit form appears at the
//     top of the list (draft mode).
//   - Each existing range is shown as a compact row. Clicking a row
//     expands it inline into an edit form. Only one row (or the draft)
//     can be open at a time.
//   - Inside the edit form: Name input, Reference SkSpInplaceEdit
//     (AcceptSelection="true", pick a range from the grid by clicking),
//     Sheet input, and action buttons: OK / Cancel / Delete (Delete is
//     only shown for existing ranges, not for a new draft).
//=============================================================================
import React, { Component } from "react";
import { parseCellRefSync, parseRangeBoundsSync } from "./SkA1Ref.js";

import SkInput from "../component/SkInput";
import { showConfirm } from "../skDialog.js";
import SkButton from "../component/SkButton";
import SkSpInplaceEdit from "./SkSpInplaceEdit";
import { tPoint, tRange } from "./SkSpSelect";
import "./SkSpreadSheet.css";

// Special sentinel value for the "new range" draft.
const DRAFT_INDEX = -2;

class SkSpRangeNamed extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;

    // A fresh ref is created each time the edit form (re)mounts so that
    // switching between rows gets a brand new SkSpInplaceEdit instance.
    this.m_RefInplaceEdit = React.createRef();
    this.m_ListRef = React.createRef();
    this.m_RefBackup = "";

    this.state = {
      namedRanges: [],
      // -1 : no edit open, -2 : new draft, N : editing row N
      editingIndex: -1,
      // -1 : nothing highlighted, N : row N is keyboard-focused
      highlightedIndex: -1,
      draftName: "",
      draftRef: "",
      draftSheet: "",
      editingRef: false,
      // When false, the backend refuses to rewrite the name of a named
      // range or a sheet because other users are editing the workbook.
      // We still let pure reselects (same name, new Ref) go through; the
      // Name input is disabled and a help text is shown.
      renameAllowed: true,
      error: "",
      info: "",
    };

    this.refresh = this.refresh.bind(this);
    this.startNew = this.startNew.bind(this);
    this.startEdit = this.startEdit.bind(this);
    this.confirmEdit = this.confirmEdit.bind(this);
    this.cancelEdit = this.cancelEdit.bind(this);
    this.deleteRange = this.deleteRange.bind(this);
    this.handleNameChange = this.handleNameChange.bind(this);
    this.handleSheetChange = this.handleSheetChange.bind(this);
    this.onRefEditStart = this.onRefEditStart.bind(this);
    this.onRefTextChange = this.onRefTextChange.bind(this);
    this.selectRangeOnSpreadsheet = this.selectRangeOnSpreadsheet.bind(this);
    this.onRowClick = this.onRowClick.bind(this);
    this.onListKeyDown = this.onListKeyDown.bind(this);
    this.onListFocus = this.onListFocus.bind(this);
  }

  componentDidMount() {
    this.refresh();
    // Workbook / JsonView can still be hydrating when this panel mounts (e.g.
    // user opens "Named ranges" right after returning to the spreadsheet).
    // Reload after the next grid refresh or when the browser tab is focused again.
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

  // Read the current text from the mounted Reference SkSpInplaceEdit
  getRefText() {
    const wRef = this.m_RefInplaceEdit.current;
    if (wRef && typeof wRef.text === "function") {
      try {
        return wRef.text();
      } catch (e) {
        return this.state.draftRef;
      }
    }
    return this.state.draftRef;
  }

  // Ensure any ongoing inplace edit is cleanly torn down.
  async endInplaceEditIfNeeded() {
    if (!this.state.editingRef) return;
    try {
      await this.m_SpInterface.endEdit();
    } catch (e) {
      console.error("SkSpRangeNamed::endEdit error", e);
    }
  }

  //---------------------------------------------------------------------
  // Selection propagation to the spreadsheet grid
  //---------------------------------------------------------------------

  // Parse a single cell reference like "A1", "$A$1" into { row, col }.
  parseCellStr(sCell) {
    if (!sCell) return null;
    return parseCellRefSync(sCell);
  }

  parseRangeStr(sRange) {
    if (!sRange) return null;
    return parseRangeBoundsSync(sRange);
  }

  // Apply a reference string (potentially with multiple areas separated
  // by ";" or ",") to the current m_Select / m_SelectRow / m_SelectCol
  // state, then scroll and repaint.
  async applyRefToSelection(sRef) {
    const wInterface = this.m_SpInterface;
    if (!wInterface || !wInterface.m_Select) return;

    const wParts = String(sRef)
      .split(/[;,]/g)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (wParts.length === 0) return;

    const wRanges = [];
    for (const wPart of wParts) {
      const wRange = this.parseRangeStr(wPart);
      if (wRange) wRanges.push(wRange);
    }
    if (wRanges.length === 0) return;

    wInterface.m_Select.raz();
    if (wInterface.m_SelectRow && typeof wInterface.m_SelectRow.raz === "function") {
      wInterface.m_SelectRow.raz();
    }
    if (wInterface.m_SelectCol && typeof wInterface.m_SelectCol.raz === "function") {
      wInterface.m_SelectCol.raz();
    }

    // The first parsed range defines the cursor position (top-left corner).
    const wFirst = wRanges[0];
    wInterface.m_Select.setCursor(new tPoint(wFirst.top, wFirst.left));
    for (const r of wRanges) {
      wInterface.m_Select.push(new tRange(r.top, r.left, r.bottom, r.right));
    }

    await wInterface.resetView(wInterface.m_Select.cursor());
    await wInterface.snapScrollFirstRowAlignment();
    await wInterface.snapScrollFirstColAlignment();
    await wInterface.setScrollBar();
    wInterface.invalidateAll();
    wInterface.scheduleInvalidateSelection();
  }

  // Click handler on a list row: move the spreadsheet selection to the
  // range definition (switching to the right sheet if needed).
  async selectRangeOnSpreadsheet(r) {
    if (!r || !r.r) return;
    try {
      const wCurrentSheet = this.currentSheet();
      if (r.s && r.s !== wCurrentSheet) {
        await this.m_SpInterface.setActiveSheet(r.s);
      }
      await this.applyRefToSelection(r.r);
    } catch (e) {
      console.error("SkSpRangeNamed::selectRangeOnSpreadsheet error", e);
    }
  }

  // Scroll the row at sIndex into view inside the scrollable <ul> list.
  scrollRowIntoView(sIndex) {
    const wList = this.m_ListRef.current;
    if (!wList) return;
    const wChildren = wList.querySelectorAll(".SkSpRangeNamed-row");
    const wRow = wChildren[sIndex];
    if (wRow && typeof wRow.scrollIntoView === "function") {
      wRow.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  // Move the visual highlight to sIndex and trigger the spreadsheet
  // selection. Used by both mouse clicks and keyboard navigation.
  highlightRow(sIndex) {
    const { namedRanges } = this.state;
    if (sIndex < 0 || sIndex >= namedRanges.length) return;
    this.setState({ highlightedIndex: sIndex }, () => {
      this.scrollRowIntoView(sIndex);
    });
    this.selectRangeOnSpreadsheet(namedRanges[sIndex]);
  }

  onRowClick(idx) {
    // Focus the list so subsequent keyboard navigation works immediately.
    const wList = this.m_ListRef.current;
    if (wList && typeof wList.focus === "function") {
      wList.focus({ preventScroll: true });
    }
    this.highlightRow(idx);
  }

  // Auto-highlight the first entry when the user tabs into the list.
  onListFocus() {
    const { namedRanges, highlightedIndex, editingIndex } = this.state;
    if (namedRanges.length === 0) return;
    if (highlightedIndex >= 0 && highlightedIndex < namedRanges.length) return;
    // Skip the row currently in edit mode (if any) so the first visible
    // read-only row gets the focus instead.
    let wStart = 0;
    if (editingIndex >= 0 && editingIndex === wStart) wStart = 1;
    if (wStart >= namedRanges.length) return;
    this.highlightRow(wStart);
  }

  onListKeyDown(event) {
    const { namedRanges, highlightedIndex } = this.state;
    if (namedRanges.length === 0) return;

    const wLast = namedRanges.length - 1;
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

  // Ask the engine whether a rename is currently allowed and mirror the
  // answer into local state. Called from refresh() so the UI stays in sync
  // with the collaborative state maintained by the presence layer.
  async refreshRenameAllowed() {
    try {
      if (
        window.SkUISpreadSheet &&
        typeof window.SkUISpreadSheet.isRenameAllowed === "function"
      ) {
        const wAllowed = window.SkUISpreadSheet.isRenameAllowed();
        if (wAllowed !== this.state.renameAllowed) {
          this.setState({ renameAllowed: Boolean(wAllowed) });
        }
      }
    } catch (e) {
      // Older backends without the binding silently fall back to "allowed".
      // That is the safe default for a single-user session.
    }
  }

  async ensureUISpreadSheet() {
    if (this.m_SpInterface && typeof this.m_SpInterface.loadUI === "function") {
      await this.m_SpInterface.loadUI();
    }
    return (
      typeof window !== "undefined" &&
      window.SkUISpreadSheet != null &&
      typeof window.SkUISpreadSheet.jsonRangeNamed === "function"
    );
  }

  async refresh() {
    await this.refreshRenameAllowed();
    try {
      if (!(await this.ensureUISpreadSheet())) {
        return;
      }
      const raw = window.SkUISpreadSheet.jsonRangeNamed();
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
        parsed && Array.isArray(parsed.namedranges) ? parsed.namedranges : [];

      // Keep the edit open on the same logical range after refresh, and
      // resync the edit form drafts with the fresh backend data so that
      // the visible Name / Reference / Sheet inputs reflect the current
      // state of the engine (e.g. after an external change or a manual
      // reload via the "refresh" button).
      let wNewEditing = this.state.editingIndex;
      const wExtra = {};
      let wFreshRef = null;
      if (wNewEditing >= 0) {
        const wPrev = this.state.namedRanges[wNewEditing];
        if (wPrev) {
          const wFound = list.findIndex(
            (r) => r.n === wPrev.n && (r.s || "") === (wPrev.s || "")
          );
          wNewEditing = wFound;
          if (wFound >= 0) {
            const wCurrent = list[wFound];
            wExtra.draftName = wCurrent.n || "";
            wExtra.draftRef = wCurrent.r || "";
            wExtra.draftSheet = wCurrent.s || "";
            wFreshRef = wExtra.draftRef;
          }
        } else {
          wNewEditing = -1;
        }
      }
      this.setState(
        {
          namedRanges: list,
          editingIndex: wNewEditing,
          error: "",
          ...wExtra,
        },
        () => {
          // SkSpInplaceEdit is uncontrolled (uses defaultValue). Force its
          // internal input value to match the freshly-loaded reference.
          if (wFreshRef !== null) {
            const wInplace = this.m_RefInplaceEdit.current;
            if (wInplace && typeof wInplace.setText === "function") {
              try {
                wInplace.setText(wFreshRef);
              } catch (err) {
                console.error(
                  "SkSpRangeNamed::refresh setText error",
                  err
                );
              }
            }
          }
        }
      );
    } catch (e) {
      console.error("SkSpRangeNamed::refresh error", e);
      this.setState({ error: "Unable to load named ranges" });
    }
  }

  //---------------------------------------------------------------------
  // Edit lifecycle
  //---------------------------------------------------------------------

  handleNameChange(event) {
    this.setState({ draftName: event.target.value });
  }

  handleSheetChange(event) {
    this.setState({ draftSheet: event.target.value });
  }

  // Called from SkSpInplaceEdit (AcceptSelection) when the user clicks
  // / tabs into the Reference input.
  onRefEditStart() {
    if (this.state.editingRef) return;
    this.m_RefBackup = this.getRefText();
    this.setState({ editingRef: true });
  }

  // Live-sync draftRef with the (uncontrolled) inplace edit.
  onRefTextChange(sText) {
    if (sText !== this.state.draftRef) {
      this.setState({ draftRef: sText });
    }
  }

  // Open the "new range" draft form.
  async startNew() {
    await this.endInplaceEditIfNeeded();
    this.setState({
      editingIndex: DRAFT_INDEX,
      draftName: "",
      draftRef: "",
      draftSheet: "",
      editingRef: false,
      error: "",
      info: "",
    });
  }

  // Open the edit form for an existing range.
  async startEdit(sIndex) {
    if (this.state.editingIndex === sIndex) return;
    const r = this.state.namedRanges[sIndex];
    if (!r) return;
    await this.endInplaceEditIfNeeded();
    this.setState({
      editingIndex: sIndex,
      draftName: r.n || "",
      draftRef: r.r || "",
      draftSheet: r.s || "",
      editingRef: false,
      error: "",
      info: "",
    });
  }

  // Close the edit form without saving.
  async cancelEdit() {
    await this.endInplaceEditIfNeeded();
    this.setState({
      editingIndex: -1,
      editingRef: false,
      draftName: "",
      draftRef: "",
      draftSheet: "",
      error: "",
      info: "",
    });
  }

  // Confirm the edit (insert or update).
  async confirmEdit() {
    const {
      editingIndex,
      draftName,
      draftSheet,
      namedRanges,
      renameAllowed,
    } = this.state;
    // Read the live text from the inplace edit so that any grid
    // selection not yet captured in state is taken into account.
    const wRef = this.getRefText();
    const wName = (draftName || "").trim();
    const wSheet = (draftSheet || "").trim() || this.currentSheet();

    if (!wName) {
      this.setState({ error: "Name is required", info: "" });
      return;
    }
    if (!wRef || !wRef.trim()) {
      this.setState({ error: "Reference is required", info: "" });
      return;
    }

    // Check duplicate name (excluding the currently edited range).
    const wClash = namedRanges.some(
      (r, i) => i !== editingIndex && r.n === wName
    );
    if (wClash) {
      this.setState({
        error: `A range named "${wName}" already exists`,
        info: "",
      });
      return;
    }

    // When other users are editing the workbook, a rename cannot be
    // propagated safely (formulas embedded in cells on the peers reference
    // the name by string). Short-circuit the call so the user is not
    // silently denied by the backend.
    const wIsExisting = editingIndex !== DRAFT_INDEX;
    const wOriginal = wIsExisting ? namedRanges[editingIndex] : null;
    const wIsRename = wIsExisting && wOriginal && wName !== wOriginal.n;
    if (wIsRename && !renameAllowed) {
      this.setState({
        error:
          "Renaming a range is disabled while other users are editing this workbook.",
        info: "",
      });
      return;
    }

    // End the inplace edit before touching the engine.
    await this.endInplaceEditIfNeeded();

    try {
      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();

      if (editingIndex === DRAFT_INDEX) {
        const ok = window.SkUISpreadSheet.insertNamedRange(
          wName,
          wRef.trim(),
          wSheet
        );
        if (!ok) {
          this.setState({ error: "Insertion failed", info: "" });
          return;
        }
        this.setState({
          info: `Range "${wName}" created`,
          error: "",
          editingIndex: -1,
          editingRef: false,
          draftName: "",
          draftRef: "",
          draftSheet: "",
        });
      } else {
        if (!wOriginal) return;
        // Atomic update: the backend preserves tRange* / tAllocatorRef for
        // every area that survives between wOriginal.r and wRef, so every
        // formula that already points at the range keeps evaluating and
        // automatically renders with wName.
        const updated = window.SkUISpreadSheet.updateNamedRange(
          wOriginal.n,
          wName,
          wRef.trim(),
          wOriginal.s || wSheet
        );
        if (!updated) {
          // Most common cause: the backend refused the rename because a
          // peer joined the workbook between refresh() and confirmEdit().
          // Re-sync the gating flag so the UI reflects reality.
          await this.refreshRenameAllowed();
          this.setState({
            error: this.state.renameAllowed
              ? "Update failed"
              : "Renaming was refused: another user is now editing this workbook.",
            info: "",
          });
          await this.refresh();
          return;
        }
        this.setState({
          info: `Range "${wOriginal.n}" updated`,
          error: "",
          editingIndex: -1,
          editingRef: false,
          draftName: "",
          draftRef: "",
          draftSheet: "",
        });
      }

      await this.refresh();
      await this.m_SpInterface.reloadView();
    } catch (e) {
      console.error("SkSpRangeNamed::confirmEdit error", e);
      this.setState({ error: "Save error", info: "" });
    }
  }

  async deleteRange() {
    const { editingIndex, namedRanges } = this.state;
    if (editingIndex < 0 || editingIndex >= namedRanges.length) return;
    const r = namedRanges[editingIndex];

    const confirmed = await showConfirm({
      message: `Delete named range "${r.n}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    await this.endInplaceEditIfNeeded();

    try {
      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();
      const ok = window.SkUISpreadSheet.deleteNamedRange(
        r.n,
        r.s || ""
      );
      if (!ok) {
        this.setState({ error: `Unable to delete "${r.n}"`, info: "" });
        return;
      }
      this.setState({
        info: `Range "${r.n}" deleted`,
        error: "",
        editingIndex: -1,
        editingRef: false,
        draftName: "",
        draftRef: "",
        draftSheet: "",
      });
      await this.refresh();
      await this.m_SpInterface.reloadView();
    } catch (e) {
      console.error("SkSpRangeNamed::deleteRange error", e);
      this.setState({ error: "Deletion error", info: "" });
    }
  }

  //---------------------------------------------------------------------
  // Rendering
  //---------------------------------------------------------------------

  renderEditForm(sIsNew) {
    const {
      draftName,
      draftRef,
      draftSheet,
      namedRanges,
      editingIndex,
      renameAllowed,
      error,
    } = this.state;

    const wNameTrim = (draftName || "").trim();
    const wRefTrim = (draftRef || "").trim();
    const wNameValid = wNameTrim.length > 0;
    const wRefValid = wRefTrim.length > 0;
    const wNameClash =
      wNameValid &&
      namedRanges.some((r, i) => i !== editingIndex && r.n === wNameTrim);
    // For an existing range, the Name input is frozen in multi-user mode;
    // only reselects (same name, new Ref) are allowed through.
    const wOriginal = !sIsNew ? namedRanges[editingIndex] : null;
    const wIsRename = Boolean(
      wOriginal && wNameValid && wNameTrim !== wOriginal.n
    );
    const wRenameBlocked = wIsRename && !renameAllowed;
    const wNameDisabled = !sIsNew && !renameAllowed;
    const wCanOk =
      wNameValid && wRefValid && !wNameClash && !wRenameBlocked;

    return (
      <div className="SkSpRangeNamed-edit" style={editStyle}>
        <label style={labelStyle}>Name</label>
        <SkInput
          id="rangeNamedName"
          name="rangeNamedName"
          placeholder="e.g. Revenue_2024"
          value={draftName}
          onChange={this.handleNameChange}
          disabled={wNameDisabled}
          title={
            wNameDisabled
              ? "Renaming is disabled while other users are editing this workbook"
              : undefined
          }
        />
        {wNameDisabled && (
          <div style={hintInlineStyle}>
            Renaming is disabled — another user is editing this workbook.
            You can still change the reference.
          </div>
        )}

        <label style={labelStyle}>Reference</label>
        <SkSpInplaceEdit
          ref={this.m_RefInplaceEdit}
          style={{ flex: 1, margin: "3px", padding: "3px" }}
          static="true"
          AcceptSelection="true"
          SpInterface={this.m_SpInterface}
          Id={"InplaceEditRangeNamedRef"}
          Property={"rangeNamedRef"}
          Text={draftRef}
          onEditStart={this.onRefEditStart}
          onTextChange={this.onRefTextChange}
        >
          {draftRef}
        </SkSpInplaceEdit>

        <label style={labelStyle}>Sheet (optional, defaults to current)</label>
        <SkInput
          id="rangeNamedSheet"
          name="rangeNamedSheet"
          placeholder={this.currentSheet() || "Sheet1"}
          value={draftSheet}
          onChange={this.handleSheetChange}
        />

        <div style={buttonsRowStyle}>
          <SkButton
            onClick={this.confirmEdit}
            disabled={!wCanOk}
            title={
              wCanOk
                ? "Save"
                : wNameClash
                ? `A range named "${wNameTrim}" already exists`
                : "Fill in name and reference"
            }
          >
            OK
          </SkButton>
          <SkButton onClick={this.cancelEdit} title="Discard changes">
            Cancel
          </SkButton>
          {!sIsNew && (
            <SkButton
              onClick={this.deleteRange}
              title="Delete this named range"
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

  renderRow(r, idx) {
    const wIsEditing = this.state.editingIndex === idx;
    if (wIsEditing) {
      return (
        <li key={`edit:${r.s || ""}:${r.n}`} style={rowEditingStyle}>
          {this.renderEditForm(false)}
        </li>
      );
    }
    const wIsHighlighted = this.state.highlightedIndex === idx;
    return (
      <li
        key={`row:${r.s || ""}:${r.n}`}
        style={rowStyle}
        className={
          "SkSpRangeNamed-row" +
          (wIsHighlighted ? " SkSpRangeNamed-row--highlighted" : "")
        }
        onClick={() => this.onRowClick(idx)}
        title="Click to select in the spreadsheet"
      >
        <div style={rowContentStyle}>
          <div style={rowNameStyle}>{r.n}</div>
          <div style={rowSubStyle}>
            {(r.s ? r.s + "!" : "") + (r.r || "")}
          </div>
        </div>
        <button
          type="button"
          className="SkSpRangeNamed-pencil"
          style={pencilButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            this.startEdit(idx);
          }}
          title="Edit this named range"
          aria-label={`Edit ${r.n}`}
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
    const { namedRanges, editingIndex, info } = this.state;
    const wIsNewDraft = editingIndex === DRAFT_INDEX;
    const wAnythingEditing = editingIndex !== -1;

    return (
      <div className="SkSpRangeNamed" style={rootStyle}>
        {/* Header with + Add button */}
        <div style={headerStyle}>
          <div style={{ fontWeight: "bold", fontSize: "14px" }}>
            Named ranges ({namedRanges.length})
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <SkButton
              onClick={this.startNew}
              disabled={wIsNewDraft}
              title={
                wIsNewDraft
                  ? "Already creating a new range"
                  : "Add a new named range"
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
            <div style={draftHeaderStyle}>New range</div>
            {this.renderEditForm(true)}
          </div>
        )}

        {/* List */}
        <ul
          ref={this.m_ListRef}
          style={listStyle}
          className="SkSpRangeNamed-list"
          tabIndex={0}
          onKeyDown={this.onListKeyDown}
          onFocus={this.onListFocus}
        >
          {namedRanges.length === 0 && !wIsNewDraft ? (
            <li style={emptyStyle}>
              No named ranges — click "+ Add a range" to create one.
            </li>
          ) : (
            namedRanges.map((r, idx) => this.renderRow(r, idx))
          )}
        </ul>

        {!wAnythingEditing && namedRanges.length > 0 && (
          <div style={hintStyle}>
            Click (or use arrow keys) to select a range, pencil to edit it.
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
  minWidth: 0, // allow the sub line to ellipsis if needed
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

const hintInlineStyle = {
  fontSize: "11px",
  color: "var(--sk-row-hint-warn-color)",
  marginTop: "2px",
  marginBottom: "4px",
  fontStyle: "italic",
};

export default SkSpRangeNamed;
