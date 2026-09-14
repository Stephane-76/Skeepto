//=============================================================================
// SkSpTables — inspect RangeData tables on the active sheet (name, ref, columns).
//=============================================================================
import React, { Component } from "react";

import SkButton from "../component/SkButton";
import {
  columnDisplayTitle,
  enrichTableFromSheetHeaders,
  indexToColLetters,
  parseSheetTables,
  sheetColFromColumn,
} from "./SkTableFilter";
import {
  TABLE_STYLE_FAMILIES,
  buildFullRangeDataJson,
  listBuiltinStyles,
  parseTableStyleName,
} from "./SkTableStyleCatalog";
import { createTableFromSelection, listNamedRangeNames } from "./SkCreateTableFromSelection";
import { tPoint, tRange } from "./SkSpSelect";
import { showConfirm } from "../skDialog.js";
import "./SkSpreadSheet.css";

function formatFilterSummary(sCol) {
  const wOp = String(sCol?.filterop ?? "None");
  if (wOp === "None" || wOp === "Unknown") return "";
  if (wOp === "IsEmpty" || wOp === "IsNotEmpty") return wOp;
  const wMulti = Array.isArray(sCol.filtervalues)
    ? sCol.filtervalues
        .map((item) => String(item?.v ?? "").trim())
        .filter(Boolean)
    : [];
  if (wMulti.length > 0) {
    const wPreview =
      wMulti.length <= 2 ? wMulti.join(", ") : `${wMulti.slice(0, 2).join(", ")} (+${wMulti.length - 2})`;
    return `${wOp}: ${wPreview}`;
  }
  const wVal = sCol?.filtervalue?.v;
  if (wVal != null && String(wVal).trim() !== "") {
    return `${wOp}: ${wVal}`;
  }
  return wOp;
}

function formatStyleLabel(sName) {
  const wParsed = parseTableStyleName(sName);
  const wFamily = TABLE_STYLE_FAMILIES.find((f) => f.id === wParsed.family);
  return `${wFamily?.label || "Style"} ${wParsed.number}`;
}

function StyleSwatchPreview({ preview }) {
  if (!preview) return null;
  return (
    <span className="SkSpTables-swatchPreview" aria-hidden="true">
      <span
        className="SkSpTables-swatchHeader"
        style={{
          background: preview.header,
          color: preview.headerText || "#1a1a1a",
          borderColor: preview.headerBorder || preview.border,
        }}
      />
      <span className="SkSpTables-swatchBody">
        <span style={{ background: preview.rowA }} />
        <span
          style={{
            background: preview.rowB,
            opacity: preview.rowBOpacity ?? 1,
          }}
        />
      </span>
    </span>
  );
}

function formatSortSummary(sCol) {
  const wOrder = String(sCol?.order ?? "None");
  if (wOrder === "None") return "";
  return wOrder;
}

class SkSpTables extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.state = {
      tables: [],
      sheet: "",
      expandedTable: null,
      styleFamilyByTable: {},
      styleApplying: null,
      creating: false,
      renaming: false,
      deleting: false,
      draftName: "",
      renameAllowed: true,
      error: "",
      info: "",
    };
    this.refresh = this.refresh.bind(this);
    this.onTableClick = this.onTableClick.bind(this);
    this.toggleExpanded = this.toggleExpanded.bind(this);
    this.applyTableStyle = this.applyTableStyle.bind(this);
    this.onStyleFamilyChange = this.onStyleFamilyChange.bind(this);
    this.onTableOptionToggle = this.onTableOptionToggle.bind(this);
    this.onCreateFromSelection = this.onCreateFromSelection.bind(this);
    this.onDraftNameChange = this.onDraftNameChange.bind(this);
    this.onRenameKeyDown = this.onRenameKeyDown.bind(this);
    this.confirmRename = this.confirmRename.bind(this);
    this.cancelRename = this.cancelRename.bind(this);
    this.deleteTable = this.deleteTable.bind(this);
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

  currentSheet() {
    return (
      this.m_SpInterface?.m_UIView?.sheet ||
      this.state.sheet ||
      ""
    );
  }

  async refresh() {
    if (!window.SkUISpreadSheet?.jsonRangeData) {
      this.setState({ tables: [], sheet: "", error: "Spreadsheet engine not ready." });
      return;
    }
    try {
      const wSheet =
        this.m_SpInterface?.m_UIView?.sheet ||
        (window.SkUISpreadSheet.getActiveSheet?.()) ||
        "";
      const wRaw = window.SkUISpreadSheet.jsonRangeData();
      const wParsed =
        typeof wRaw === "string" && wRaw.length > 0 ? JSON.parse(wRaw) : wRaw;
      const wTables = parseSheetTables(wParsed, wSheet).map((t) =>
        enrichTableFromSheetHeaders(t, this.m_SpInterface)
      );
      if (this.m_SpInterface) {
        this.m_SpInterface.m_TableFilterTables = wTables;
      }
      let wRenameAllowed = true;
      if (typeof window.SkUISpreadSheet.isRenameAllowed === "function") {
        try {
          wRenameAllowed = !!window.SkUISpreadSheet.isRenameAllowed();
        } catch (_) {
          wRenameAllowed = true;
        }
      }
      this.setState({
        tables: wTables,
        sheet: wSheet,
        renameAllowed: wRenameAllowed,
        error: "",
        info: "",
      });
    } catch (err) {
      console.warn("SkSpTables::refresh", err);
      this.setState({
        tables: [],
        error: err?.message || "Failed to load tables.",
        info: "",
      });
    }
  }

  async onCreateFromSelection() {
    if (this.state.creating) return;
    this.setState({ creating: true, error: "", info: "" });
    try {
      const wResult = await createTableFromSelection(this.m_SpInterface);
      if (!wResult?.ok) {
        this.setState({
          creating: false,
          error: wResult?.error || "Failed to create table.",
          info: "",
        });
        return;
      }
      await this.refresh();
      this.setState({
        creating: false,
        expandedTable: wResult.name,
        info: `Table "${wResult.name}" created on ${wResult.ref}.`,
        error: "",
      });
    } catch (err) {
      console.error("SkSpTables::onCreateFromSelection", err);
      this.setState({
        creating: false,
        error: err?.message || "Failed to create table.",
        info: "",
      });
    }
  }

  toggleExpanded(sName, event) {
    event?.stopPropagation?.();
    this.setState((prev) => {
      const wOpening = prev.expandedTable !== sName;
      const wNext = {
        expandedTable: prev.expandedTable === sName ? null : sName,
        draftName: wOpening ? sName : "",
        error: "",
        info: "",
      };
      if (wOpening) {
        const wTable = prev.tables.find((t) => t.name === sName);
        if (wTable) {
          const wParsed = parseTableStyleName(wTable.data?.tableStyleName);
          wNext.styleFamilyByTable = {
            ...prev.styleFamilyByTable,
            [sName]: wParsed.family,
          };
        }
      }
      return wNext;
    });
  }

  onDraftNameChange(event) {
    this.setState({ draftName: event.target.value, error: "", info: "" });
  }

  onRenameKeyDown(event, sTable) {
    if (event.key === "Enter") {
      event.preventDefault();
      void this.confirmRename(sTable);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.cancelRename(sTable);
    }
  }

  cancelRename(sTable) {
    this.setState({
      draftName: sTable?.name || "",
      error: "",
      info: "",
    });
  }

  async deleteTable(sTable) {
    if (!sTable?.name || this.state.deleting) return;
    // Deleting a table is a structural mutation; block it under the same multi-user lock as rename.
    if (!this.state.renameAllowed) {
      this.setState({
        error:
          "Deleting a table is disabled while other users are editing this workbook.",
        info: "",
      });
      return;
    }
    if (!window.SkUISpreadSheet?.deleteNamedRange) {
      this.setState({ error: "Spreadsheet engine not ready.", info: "" });
      return;
    }
    const wConfirmed = await showConfirm({
      // Only the table object (structure/filter/style) is removed; cell values are kept.
      message: `Delete table "${sTable.name}"? Cell contents are kept.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!wConfirmed) return;

    this.setState({ deleting: true, error: "", info: "" });
    try {
      if (typeof this.m_SpInterface?.setExtraUndo === "function") {
        await this.m_SpInterface.setExtraUndo();
      }
      const wOk = window.SkUISpreadSheet.deleteNamedRange(
        sTable.name,
        sTable.sheet || this.currentSheet()
      );
      if (!wOk) {
        this.setState({
          deleting: false,
          error: `Failed to delete "${sTable.name}".`,
          info: "",
        });
        return;
      }
      if (this.m_SpInterface) {
        await this.m_SpInterface.refreshTableFilterTables?.();
        await this.m_SpInterface.reloadViewAfterSpreadsheetMutation?.();
      }
      await this.refresh();
      this.setState({
        deleting: false,
        expandedTable: null,
        info: `Table "${sTable.name}" deleted.`,
        error: "",
      });
    } catch (err) {
      console.error("SkSpTables::deleteTable", err);
      this.setState({
        deleting: false,
        error: err?.message || "Failed to delete table.",
        info: "",
      });
    }
  }

  async confirmRename(sTable) {
    if (!sTable?.name || this.state.renaming) return;
    const wNewName = String(this.state.draftName || "").trim();
    if (!wNewName) {
      this.setState({ error: "Table name is required.", info: "" });
      return;
    }
    if (wNewName === sTable.name) {
      return;
    }
    // Excel-like table names: start with letter/underscore; letters, digits, ._ and spaces.
    if (!/^[A-Za-z_][A-Za-z0-9._ ]*$/.test(wNewName)) {
      this.setState({
        error: "Invalid table name.",
        info: "",
      });
      return;
    }
    const wExisting = listNamedRangeNames().map((n) => n.toLowerCase());
    const wClash = wExisting.some(
      (n) => n === wNewName.toLowerCase() && n !== sTable.name.toLowerCase()
    );
    if (wClash) {
      this.setState({
        error: `A range or table named "${wNewName}" already exists.`,
        info: "",
      });
      return;
    }
    if (!this.state.renameAllowed) {
      this.setState({
        error:
          "Renaming a table is disabled while other users are editing this workbook.",
        info: "",
      });
      return;
    }
    if (!window.SkUISpreadSheet?.updateNamedRange) {
      this.setState({ error: "Spreadsheet engine not ready.", info: "" });
      return;
    }

    this.setState({ renaming: true, error: "", info: "" });
    try {
      if (typeof this.m_SpInterface?.setExtraUndo === "function") {
        await this.m_SpInterface.setExtraUndo();
      }
      const wOk = window.SkUISpreadSheet.updateNamedRange(
        sTable.name,
        wNewName,
        sTable.ref,
        sTable.sheet || this.currentSheet()
      );
      if (!wOk) {
        this.setState({
          renaming: false,
          error: this.state.renameAllowed
            ? `Failed to rename "${sTable.name}".`
            : "Renaming was refused: another user is now editing this workbook.",
          info: "",
        });
        return;
      }
      if (typeof this.m_SpInterface?.reloadViewAfterSpreadsheetMutation === "function") {
        await this.m_SpInterface.reloadViewAfterSpreadsheetMutation();
      } else if (typeof this.m_SpInterface?.reloadView === "function") {
        await this.m_SpInterface.reloadView();
      }
      await this.refresh();
      this.setState({
        renaming: false,
        expandedTable: wNewName,
        draftName: wNewName,
        info: `Table renamed to "${wNewName}".`,
        error: "",
      });
    } catch (err) {
      console.error("SkSpTables::confirmRename", err);
      this.setState({
        renaming: false,
        error: err?.message || "Failed to rename table.",
        info: "",
      });
    }
  }

  styleFamilyForTable(sTable) {
    return (
      this.state.styleFamilyByTable[sTable.name] ||
      parseTableStyleName(sTable.data?.tableStyleName).family
    );
  }

  async applyTableStyle(sTable, sStyleName, sOptions = {}) {
    const wSp = this.m_SpInterface;
    if (!sTable?.name || !window.SkUISpreadSheet?.undoApplyRangeData) return;
    const wPatch =
      typeof sOptions === "boolean" || sOptions == null
        ? {
            tableStyleName: sStyleName,
            omitStyleElements: true,
            ...(sOptions != null ? { tableShowRowStripes: sOptions } : {}),
          }
        : {
            tableStyleName: sStyleName,
            omitStyleElements: true,
            ...sOptions,
          };
    const wJson = buildFullRangeDataJson(sTable, wPatch);
    this.setState({ styleApplying: sTable.name });
    try {
      const wOk = window.SkUISpreadSheet.undoApplyRangeData(
        sTable.name,
        wJson,
        sTable.sheet
      );
      if (wOk && wSp) {
        await wSp.refreshTableFilterTables?.();
        await wSp.reloadViewAfterSpreadsheetMutation?.();
        await this.refresh();
      }
    } catch (err) {
      console.error("SkSpTables::applyTableStyle", err);
    } finally {
      this.setState({ styleApplying: null });
    }
  }

  onStyleFamilyChange(sTable, sFamilyId, event) {
    event?.stopPropagation?.();
    this.setState((prev) => ({
      styleFamilyByTable: {
        ...prev.styleFamilyByTable,
        [sTable.name]: sFamilyId,
      },
    }));
  }

  currentStyleOptions(sTable) {
    const wData = sTable?.data || {};
    return {
      tableShowRowStripes: !!wData.tableShowRowStripes,
      tableShowColumnStripes: !!wData.tableShowColumnStripes,
      tableShowFirstColumn: !!wData.tableShowFirstColumn,
      tableShowLastColumn: !!wData.tableShowLastColumn,
      firstrow: wData.firstrow !== false,
      lastrow: !!(wData.lastrow || Number(wData.totalsRowCount) > 0),
      totalsRowCount:
        Number(wData.totalsRowCount) > 0
          ? Number(wData.totalsRowCount)
          : wData.lastrow
            ? 1
            : 0,
    };
  }

  async ensureTotalsRowBelow(sTable) {
    const wRange = sTable?.range;
    if (!wRange || !window.SkUISpreadSheet?.insertRowByRect) {
      return false;
    }
    const wTotalsRow = Number(wRange.bottom) + 1;
    const wLeft = indexToColLetters(wRange.left);
    const wRight = indexToColLetters(wRange.right);
    if (!wLeft || !wRight || wTotalsRow < 2) {
      return false;
    }
    const wSheet = sTable.sheet || this.currentSheet() || "";
    const wRef = `${wLeft}${wTotalsRow}:${wRight}${wTotalsRow}`;
    const wLabelRef = `${wLeft}${wTotalsRow}`;
    try {
      if (typeof this.m_SpInterface?.setExtraUndo === "function") {
        await this.m_SpInterface.setExtraUndo();
      }
      // One undo: insert the totals row and write the "Total" label together.
      if (typeof window.SkUISpreadSheet.insertRowByRectWithLabel === "function") {
        window.SkUISpreadSheet.insertRowByRectWithLabel(
          wRef,
          wLabelRef,
          "Total",
          wSheet
        );
      } else {
        window.SkUISpreadSheet.insertRowByRect(wRef, wSheet);
        if (typeof window.SkUISpreadSheet.value === "function") {
          window.SkUISpreadSheet.value(wLabelRef, "Total", wSheet);
        }
      }
      return true;
    } catch (err) {
      console.error("SkSpTables::ensureTotalsRowBelow", err);
      return false;
    }
  }

  async removeTotalsRowBelow(sTable) {
    const wRange = sTable?.range;
    if (!wRange || !window.SkUISpreadSheet?.deleteRowByRect) {
      return false;
    }
    const wTotalsRow = Number(wRange.bottom) + 1;
    const wLeft = indexToColLetters(wRange.left);
    const wRight = indexToColLetters(wRange.right);
    if (!wLeft || !wRight || wTotalsRow < 2) {
      return false;
    }
    const wSheet = sTable.sheet || this.currentSheet() || "";
    const wRef = `${wLeft}${wTotalsRow}:${wRight}${wTotalsRow}`;
    try {
      if (typeof this.m_SpInterface?.setExtraUndo === "function") {
        await this.m_SpInterface.setExtraUndo();
      }
      window.SkUISpreadSheet.deleteRowByRect(wRef, wSheet);
      return true;
    } catch (err) {
      console.error("SkSpTables::removeTotalsRowBelow", err);
      return false;
    }
  }

  async onTableOptionToggle(sTable, sKey, event) {
    event?.stopPropagation?.();
    const wChecked = event.target.checked;
    const wStyleName =
      sTable.data?.tableStyleName || parseTableStyleName("").name;
    const wPrev = this.currentStyleOptions(sTable);
    const wOptions = { ...wPrev };
    if (sKey === "lastrow") {
      if (wChecked && !wPrev.lastrow) {
        await this.ensureTotalsRowBelow(sTable);
      } else if (!wChecked && wPrev.lastrow) {
        await this.removeTotalsRowBelow(sTable);
      }
      wOptions.lastrow = wChecked;
      wOptions.totalsRowCount = wChecked ? Math.max(1, wOptions.totalsRowCount || 1) : 0;
    } else if (sKey === "firstrow") {
      wOptions.firstrow = wChecked;
    } else {
      wOptions[sKey] = wChecked;
    }
    await this.applyTableStyle(sTable, wStyleName, wOptions);
  }

  async applyRangeToSelection(sTable) {
    const wSp = this.m_SpInterface;
    if (!wSp?.m_Select || !sTable?.range) return;
    const r = sTable.range;
    wSp.m_Select.raz();
    wSp.m_SelectRow?.raz?.();
    wSp.m_SelectCol?.raz?.();
    wSp.m_Select.setCursor(new tPoint(r.top, r.left));
    wSp.m_Select.push(new tRange(r.top, r.left, r.bottom, r.right));
    await wSp.resetView(wSp.m_Select.cursor());
    await wSp.snapScrollFirstRowAlignment?.();
    await wSp.snapScrollFirstColAlignment?.();
    await wSp.setScrollBar?.();
    wSp.invalidateAll();
    wSp.scheduleInvalidateSelection?.();
  }

  async onTableClick(sTable) {
    if (!sTable) return;
    try {
      const wCurrent = this.currentSheet();
      if (sTable.sheet && sTable.sheet !== wCurrent && this.m_SpInterface?.setActiveSheet) {
        await this.m_SpInterface.setActiveSheet(sTable.sheet);
      }
      await this.applyRangeToSelection(sTable);
    } catch (err) {
      console.error("SkSpTables::onTableClick", err);
    }
  }

  renderTableStylePanel(sTable) {
    const wData = sTable.data || {};
    const wCurrentName = String(wData.tableStyleName || "").trim() || "TableStyleMedium2";
    const wParsedCurrent = parseTableStyleName(wCurrentName);
    const wFamilyId = this.styleFamilyForTable(sTable);
    const wStyles = listBuiltinStyles(wFamilyId);
    const wApplying = this.state.styleApplying === sTable.name;
    const wOpts = this.currentStyleOptions(sTable);

    const wOption = (sKey, sLabel, sChecked) => (
      <label key={sKey} className="SkSpTables-styleOption">
        <input
          type="checkbox"
          checked={!!sChecked}
          disabled={wApplying}
          onChange={(e) => this.onTableOptionToggle(sTable, sKey, e)}
          onClick={(e) => e.stopPropagation()}
        />
        <span>{sLabel}</span>
      </label>
    );

    return (
      <div className="SkSpTables-styleSection">
        <div className="SkSpTables-styleHeader">
          <span className="SkSpTables-styleTitle">Style</span>
          <span className="SkSpTables-styleCurrent" title={wCurrentName}>
            {formatStyleLabel(wCurrentName)}
          </span>
        </div>
        <div className="SkSpTables-styleTabs" role="tablist" aria-label="Table style family">
          {TABLE_STYLE_FAMILIES.map((family) => (
            <button
              key={family.id}
              type="button"
              role="tab"
              aria-selected={wFamilyId === family.id}
              className={`SkSpTables-styleTab${wFamilyId === family.id ? " SkSpTables-styleTab--active" : ""}`}
              onClick={(e) => this.onStyleFamilyChange(sTable, family.id, e)}
            >
              {family.label}
            </button>
          ))}
        </div>
        <div className="SkSpTables-styleGrid">
          {wStyles.map((style) => {
            const wSelected =
              wParsedCurrent.family === style.family &&
              wParsedCurrent.number === style.number;
            return (
              <button
                key={style.name}
                type="button"
                className={`SkSpTables-styleSwatch${wSelected ? " SkSpTables-styleSwatch--selected" : ""}`}
                title={style.name}
                disabled={wApplying}
                aria-pressed={wSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  this.applyTableStyle(sTable, style.name, wOpts);
                }}
              >
                <StyleSwatchPreview preview={style.preview} />
                <span className="SkSpTables-styleSwatchNum">{style.number}</span>
              </button>
            );
          })}
        </div>
        <div className="SkSpTables-styleOptions" aria-label="Table display options">
          {wOption("firstrow", "Header row", wOpts.firstrow)}
          {wOption("lastrow", "Total row", wOpts.lastrow)}
          {wOption("tableShowRowStripes", "Banded rows", wOpts.tableShowRowStripes)}
          {wOption("tableShowColumnStripes", "Banded columns", wOpts.tableShowColumnStripes)}
          {wOption("tableShowFirstColumn", "First column", wOpts.tableShowFirstColumn)}
          {wOption("tableShowLastColumn", "Last column", wOpts.tableShowLastColumn)}
        </div>
      </div>
    );
  }

  renderColumnRow(sTable, sCol) {
    const wTitle = columnDisplayTitle(sTable, sCol);
    const wColLetter = indexToColLetters(
      sheetColFromColumn(sCol, sTable.range)
    );
    const wFilter = formatFilterSummary(sCol);
    const wSort = formatSortSummary(sCol);
    const wMeta = [wFilter, wSort].filter(Boolean).join(" · ");
    return (
      <li key={`${sTable.name}-${sheetColFromColumn(sCol, sTable.range)}-${wTitle}`} className="SkSpTables-colRow">
        <span className="SkSpTables-colLetter">{wColLetter}</span>
        <span className="SkSpTables-colName">{wTitle}</span>
        {wMeta ? <span className="SkSpTables-colMeta">{wMeta}</span> : null}
      </li>
    );
  }

  renderTable(sTable) {
    const wExpanded = this.state.expandedTable === sTable.name;
    const wCols = sTable.data?.columns || [];
    const wActiveFilters = wCols.filter(
      (c) => formatFilterSummary(c) || formatSortSummary(c)
    ).length;
    const wDraftName = wExpanded ? this.state.draftName : sTable.name;
    const wNameDirty = wExpanded && wDraftName.trim() !== sTable.name;

    return (
      <li
        key={`${sTable.sheet}-${sTable.name}`}
        className={`SkSpTables-row${wExpanded ? " SkSpTables-row--expanded" : ""}`}
      >
        <div className="SkSpTables-rowTop">
          <button
            type="button"
            className="SkSpTables-rowHeader"
            onClick={() => this.onTableClick(sTable)}
            title="Select table range on the grid"
          >
            <span className="SkSpTables-rowName">{sTable.name}</span>
            <span className="SkSpTables-rowRef">{sTable.ref}</span>
            <span className="SkSpTables-rowCount">
              {wCols.length} col{wCols.length !== 1 ? "s" : ""}
              {wActiveFilters > 0 ? ` · ${wActiveFilters} active` : ""}
            </span>
          </button>
          <button
            type="button"
            className="SkSpTables-expandBtn"
            aria-expanded={wExpanded}
            title={wExpanded ? "Hide columns" : "Show columns"}
            onClick={(e) => this.toggleExpanded(sTable.name, e)}
          >
            {wExpanded ? "▾" : "▸"}
          </button>
        </div>
        {wExpanded ? (
          <>
            <div className="SkSpTables-renameRow">
              <label className="SkSpTables-renameLabel" htmlFor={`sk-table-name-${sTable.name}`}>
                Name
              </label>
              <input
                id={`sk-table-name-${sTable.name}`}
                className="SkSpTables-renameInput"
                type="text"
                value={wDraftName}
                disabled={this.state.renaming || !this.state.renameAllowed}
                onChange={this.onDraftNameChange}
                onKeyDown={(e) => this.onRenameKeyDown(e, sTable)}
                onClick={(e) => e.stopPropagation()}
                title={
                  this.state.renameAllowed
                    ? "Rename table (Enter to confirm, Esc to cancel)"
                    : "Rename disabled while other users edit this workbook"
                }
              />
              <SkButton
                onClick={() => this.confirmRename(sTable)}
                disabled={
                  this.state.renaming ||
                  !this.state.renameAllowed ||
                  !wNameDirty ||
                  !String(wDraftName || "").trim()
                }
                title="Apply new table name"
              >
                {this.state.renaming ? "…" : "Rename"}
              </SkButton>
            </div>
            <div className="SkSpTables-deleteRow">
              <SkButton
                className="SkSpTables-deleteBtn"
                onClick={() => this.deleteTable(sTable)}
                disabled={
                  this.state.deleting ||
                  this.state.renaming ||
                  !this.state.renameAllowed
                }
                title={
                  this.state.renameAllowed
                    ? "Delete this table (cell contents are kept)"
                    : "Delete disabled while other users edit this workbook"
                }
              >
                {this.state.deleting ? "…" : "Delete"}
              </SkButton>
            </div>
            {this.renderTableStylePanel(sTable)}
            <ul className="SkSpTables-colList">
              {wCols.map((col) => this.renderColumnRow(sTable, col))}
            </ul>
          </>
        ) : null}
      </li>
    );
  }

  render() {
    const { tables, sheet, error, info, creating } = this.state;

    return (
      <div className="SkSpTables">
        <div className="SkSpTables-header">
          <div className="SkSpTables-title">
            Tables ({tables.length})
            {sheet ? (
              <span className="SkSpTables-sheet"> — {sheet}</span>
            ) : null}
          </div>
          <div className="SkSpTables-headerActions">
            <SkButton
              onClick={this.onCreateFromSelection}
              disabled={creating}
              title="Create a table from the current selection"
            >
              {creating ? "…" : "+"}
            </SkButton>
            <SkButton onClick={this.refresh} title="Refresh table list">
              ⟳
            </SkButton>
          </div>
        </div>

        {error ? <div className="SkSpTables-error">{error}</div> : null}
        {info ? <div className="SkSpTables-info">{info}</div> : null}

        <ul className="SkSpTables-list">
          {tables.length === 0 ? (
            <li className="SkSpTables-empty">
              No RangeData table on this sheet (ListObject or AutoFilter).
              Select a range (header + data) and click +.
            </li>
          ) : (
            tables.map((t) => this.renderTable(t))
          )}
        </ul>

        {tables.length > 0 ? (
          <div className="SkSpTables-hint">
            Click a table to select its range. Expand ▸ for style, options, columns, filters and sort.
          </div>
        ) : null}
      </div>
    );
  }
}

export default SkSpTables;
