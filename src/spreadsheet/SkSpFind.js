//=============================================================================
// SkSpFind — workbook-wide cell search (C++ JsonFindCellWorkBook) in the right stack panel.
//=============================================================================
import React, { Component } from "react";

import SkInput from "../component/SkInput";
import { findSheetRefSeparator, parseCellRefSync, stripSheetPrefixFromRef } from "./SkA1Ref.js";
import "./SkSpreadSheet.css";

function parseFindResultJson(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  try {
    const wData = typeof raw === "string" ? JSON.parse(raw) : raw;
    const wCells = Array.isArray(wData?.cells) ? wData.cells : [];
    return wCells.filter((ref) => typeof ref === "string" && ref.trim() !== "");
  } catch (_err) {
    return [];
  }
}

/** Split "Sheet1!A1" or "'My Sheet'!B2" into { sheet, cellRef }. */
function parseQualifiedCellRef(sRef) {
  const wText = String(sRef || "").trim();
  const wSep = findSheetRefSeparator(wText);
  if (wSep < 0) {
    return { sheet: "", cellRef: wText };
  }
  let wSheet = wText.substring(0, wSep).trim();
  if (wSheet.length >= 2 && wSheet.startsWith("'") && wSheet.endsWith("'")) {
    wSheet = wSheet.slice(1, -1).replace(/''/g, "'");
  }
  return { sheet: wSheet, cellRef: wText.substring(wSep + 1).trim() };
}

class SkSpFind extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;

    this.state = {
      search: "",
      matchCase: false,
      matchEntireCell: false,
      results: [],
      currentIndex: -1,
      status: "",
      busy: false,
    };

    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.handleMatchCaseChange = this.handleMatchCaseChange.bind(this);
    this.handleMatchEntireChange = this.handleMatchEntireChange.bind(this);
    this.handleSearchKeyDown = this.handleSearchKeyDown.bind(this);
    this.runFindAll = this.runFindAll.bind(this);
    this.runFindNext = this.runFindNext.bind(this);
    this.runFindPrevious = this.runFindPrevious.bind(this);
    this.goToResult = this.goToResult.bind(this);
    this.onResultClick = this.onResultClick.bind(this);
  }

  focusSearchInput() {
    const wEl = document.getElementById("SkSpFind-search");
    if (wEl && typeof wEl.focus === "function") {
      wEl.focus();
      if (typeof wEl.select === "function") {
        wEl.select();
      }
    }
  }

  headerHint() {
    const { status, busy, results } = this.state;
    if (busy) {
      return "Searching…";
    }
    if (status) {
      return status;
    }
    if (results.length > 0) {
      return `${results.length} match${results.length > 1 ? "es" : ""}`;
    }
    return "All sheets";
  }

  async goToResult(sIndex) {
    const wResults = this.state.results;
    if (sIndex < 0 || sIndex >= wResults.length || !this.m_SpInterface) {
      return;
    }
    const wRef = wResults[sIndex];
    const wQualified = parseQualifiedCellRef(wRef);
    const wParsed = parseCellRefSync(wQualified.cellRef || stripSheetPrefixFromRef(wRef));
    if (!wParsed) {
      return;
    }
    if (wQualified.sheet) {
      const wActive = await this.m_SpInterface.getActiveSheet();
      if (wActive !== wQualified.sheet) {
        await this.m_SpInterface.setActiveSheet(wQualified.sheet);
      }
    }
    await this.m_SpInterface.selectCellAt(wParsed.row, wParsed.col);
    await this.m_SpInterface.reloadView();
    this.setState({
      currentIndex: sIndex,
      status: `${sIndex + 1} / ${wResults.length}`,
    });
  }

  async runFindAll() {
    const wNeedle = String(this.state.search || "").trim();
    if (!wNeedle) {
      this.setState({ results: [], currentIndex: -1, status: "Enter a search term." });
      return;
    }
    if (!window.SkUISpreadSheet?.jsonFindCell) {
      this.setState({ status: "Engine unavailable (WASM)." });
      return;
    }

    this.setState({ busy: true, status: "Searching…" });
    try {
      const wRaw = window.SkUISpreadSheet.jsonFindCell(
        wNeedle,
        this.state.matchCase,
        this.state.matchEntireCell,
        ""
      );
      const wResults = parseFindResultJson(wRaw);
      const wCount = wResults.length;
      this.setState({
        results: wResults,
        currentIndex: wCount > 0 ? 0 : -1,
        busy: false,
        status:
          wCount === 0
            ? "No matches"
            : wCount === 1
              ? "1 match"
              : `${wCount} matches`,
      });
      if (wCount > 0) {
        await this.goToResult(0);
      }
    } catch (err) {
      console.error("SkSpFind::runFindAll", err);
      this.setState({ busy: false, status: "Search error" });
    }
  }

  async runFindNext() {
    const wResults = this.state.results;
    if (wResults.length === 0) {
      await this.runFindAll();
      return;
    }
    const wNext =
      this.state.currentIndex < 0
        ? 0
        : (this.state.currentIndex + 1) % wResults.length;
    await this.goToResult(wNext);
  }

  async runFindPrevious() {
    const wResults = this.state.results;
    if (wResults.length === 0) {
      await this.runFindAll();
      return;
    }
    const wPrev =
      this.state.currentIndex < 0
        ? wResults.length - 1
        : (this.state.currentIndex - 1 + wResults.length) % wResults.length;
    await this.goToResult(wPrev);
  }

  handleSearchChange(event) {
    this.setState({ search: event.target.value });
  }

  handleMatchCaseChange(event) {
    this.setState({ matchCase: event.target.checked });
  }

  handleMatchEntireChange(event) {
    this.setState({ matchEntireCell: event.target.checked });
  }

  handleSearchKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        void this.runFindPrevious();
      } else {
        void this.runFindNext();
      }
    }
  }

  onResultClick(sIndex) {
    void this.goToResult(sIndex);
  }

  render() {
    const { search, matchCase, matchEntireCell, results, currentIndex, busy } = this.state;

    return (
      <div className="SkSpFind">
        <div className="SkSpTables-styleSection SkSpFind-section">
          <div className="SkSpTables-styleHeader">
            <span className="SkSpTables-styleTitle">Find</span>
            <span className="SkSpTables-styleCurrent" title={this.headerHint()}>
              {this.headerHint()}
            </span>
          </div>

          <div className="SkSpFind-inputWrap">
            <SkInput
              id="SkSpFind-search"
              placeholder="Text to find…"
              value={search}
              onChange={this.handleSearchChange}
              onKeyDown={this.handleSearchKeyDown}
              disabled={busy}
            />
          </div>

          <div className="SkSpTables-styleTabs" role="toolbar" aria-label="Search actions">
            <button
              type="button"
              className="SkSpTables-styleTab SkSpTables-styleTab--active"
              disabled={busy}
              onClick={this.runFindAll}
            >
              Find all
            </button>
            <button
              type="button"
              className="SkSpTables-styleTab"
              disabled={busy}
              onClick={this.runFindNext}
            >
              Next
            </button>
            <button
              type="button"
              className="SkSpTables-styleTab"
              disabled={busy}
              onClick={this.runFindPrevious}
            >
              Previous
            </button>
          </div>

          <div className="SkSpTables-styleOptions" aria-label="Search options">
            <label className="SkSpTables-styleOption">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={this.handleMatchCaseChange}
                disabled={busy}
              />
              <span>Match case</span>
            </label>
            <label className="SkSpTables-styleOption">
              <input
                type="checkbox"
                checked={matchEntireCell}
                onChange={this.handleMatchEntireChange}
                disabled={busy}
              />
              <span>Match entire cell</span>
            </label>
          </div>
        </div>

        {results.length > 0 ? (
          <div className="SkSpTables-styleSection SkSpFind-resultsSection">
            <div className="SkSpTables-styleHeader">
              <span className="SkSpTables-styleTitle">Results</span>
              <span className="SkSpTables-styleCurrent">
                {currentIndex >= 0
                  ? `${currentIndex + 1} / ${results.length}`
                  : String(results.length)}
              </span>
            </div>
            <ul className="SkSpFind-resultsList" aria-label="Search results">
              {results.map((ref, index) => (
                <li key={`${ref}-${index}`}>
                  <button
                    type="button"
                    className={
                      index === currentIndex
                        ? "SkSpFind-resultItem SkSpFind-resultItem--selected"
                        : "SkSpFind-resultItem"
                    }
                    onClick={() => this.onResultClick(index)}
                  >
                    {ref}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
}

export default SkSpFind;
