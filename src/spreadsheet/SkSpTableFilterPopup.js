import React from "react";
import { createPortal } from "react-dom";
import SkComponent from "../component/SkComponent";
import SkListBox from "../component/SkListBox";
import { alignPopupWithinViewport } from "../utility/SkUtility.js";
import {
  buildRangeDataJson,
  columnDisplayTitle,
  columnOffset,
  normalizeFilterValues,
  selectedFilterValuesFromColumn,
} from "./SkTableFilter";

/**
 * Excel-like sort/filter popup for RangeData table header columns.
 */
class SkSpTableFilterPopup extends SkComponent {
  constructor(props) {
    super(props);
    const wValues = normalizeFilterValues(props.popup?.values || []);
    const wSelected = selectedFilterValuesFromColumn(
      props.popup?.column,
      wValues
    );
    this.state = {
      search: "",
      sortOrder: props.popup?.column?.order || "None",
      selectedValues: new Set(wSelected),
      values: wValues,
      loading: false,
    };
    this.m_Ref = React.createRef();
  }

  componentDidMount() {
    this._alignPopupInViewport();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.popup !== this.props.popup && this.props.popup) {
      const wValues = normalizeFilterValues(this.props.popup.values || []);
      const wSelected = selectedFilterValuesFromColumn(
        this.props.popup.column,
        wValues
      );
      this.setState({
        search: "",
        sortOrder: this.props.popup.column?.order || "None",
        selectedValues: new Set(wSelected),
        values: wValues,
        loading: false,
      });
    }
    this._alignPopupInViewport();
  }

  _alignPopupInViewport() {
    if (this.m_Ref?.current) {
      alignPopupWithinViewport(this.m_Ref.current);
    }
  }

  filteredValues() {
    const q = String(this.state.search || "").trim().toLowerCase();
    const list = Array.isArray(this.state.values) ? this.state.values : [];
    if (!q) return list;
    return list.filter((v) => String(v).toLowerCase().includes(q));
  }

  isAllVisibleSelected() {
    const wVisible = this.filteredValues();
    if (!wVisible.length) return false;
    return wVisible.every((v) => this.state.selectedValues.has(v));
  }

  toggleSelectAll = () => {
    const wVisible = this.filteredValues();
    const wNext = new Set(this.state.selectedValues);
    if (this.isAllVisibleSelected()) {
      wVisible.forEach((v) => wNext.delete(v));
    } else {
      wVisible.forEach((v) => wNext.add(v));
    }
    this.setState({ selectedValues: wNext });
  };

  toggleValue = (sValue) => {
    const wNext = new Set(this.state.selectedValues);
    if (wNext.has(sValue)) {
      wNext.delete(sValue);
    } else {
      wNext.add(sValue);
    }
    this.setState({ selectedValues: wNext });
  };

  /** Build filter + sort payload from popup UI state (Excel: sort keeps active filter). */
  buildActivePatch(sSortOrder) {
    const wAll = Array.isArray(this.state.values) ? this.state.values : [];
    const wSelected = Array.from(this.state.selectedValues);
    const wSearch = String(this.state.search || "").trim();
    const wSortOrder = sSortOrder ?? this.state.sortOrder ?? "None";
    const wPatch = { sortOrder: wSortOrder };

    if (wAll.length > 0 && wSelected.length >= wAll.length) {
      wPatch.filterop = "None";
      wPatch.filtervalue = { t: "n", v: null };
      return wPatch;
    }

    if (wSelected.length >= 1) {
      const wFilterValues = wSelected.map((v) => ({ t: "s", v }));
      wPatch.filterop = "Equals";
      wPatch.filtervalues = wFilterValues;
      wPatch.filtervalue = wFilterValues[0];
      return wPatch;
    }

    if (wSearch) {
      wPatch.filterop = "Contains";
      wPatch.filtervalue = { t: "s", v: wSearch };
      return wPatch;
    }

    const wCol = this.props.popup?.column;
    if (wCol?.filterop && wCol.filterop !== "None") {
      wPatch.filterop = wCol.filterop;
      wPatch.filtervalue = wCol.filtervalue
        ? { ...wCol.filtervalue }
        : { t: "n", v: null };
      if (Array.isArray(wCol.filtervalues) && wCol.filtervalues.length > 0) {
        wPatch.filtervalues = wCol.filtervalues.map((item) => ({ ...item }));
      }
    }

    return wPatch;
  }

  async applyFilter(sPatch) {
    const wPopup = this.props.popup;
    const wSp = this.props.SpInterface;
    if (!wPopup || !wSp) return;
    const wJson = buildRangeDataJson(
      wPopup.table.data,
      columnOffset(wPopup.column, wPopup.table.range),
      sPatch,
      wPopup.table.range,
      wPopup.sheetCol
    );
    const wOk = window.SkUISpreadSheet.undoApplyRangeData(
      wPopup.table.name,
      wJson,
      wPopup.table.sheet
    );
    if (wOk) {
      await wSp.refreshTableFilterTables();
      await wSp.reloadViewAfterSpreadsheetMutation();
    }
    this.props.onClose?.();
  }

  onSortAsc = () => {
    this.setState({ sortOrder: "Ascending" }, () => {
      this.applyFilter(this.buildActivePatch("Ascending"));
    });
  };

  onSortDesc = () => {
    this.setState({ sortOrder: "Descending" }, () => {
      this.applyFilter(this.buildActivePatch("Descending"));
    });
  };

  onApplyValue = () => {
    // Excel-like: all values checked => clear filter on this column only.
    this.applyFilter(this.buildActivePatch());
  };

  onClear = () => {
    this.applyFilter({
      filterop: "None",
      filtervalue: { t: "n", v: null },
      sortOrder: "None",
    });
  };

  render() {
    const wPopup = this.props.popup;
    if (!wPopup) return null;
    const wList = this.filteredValues();
    const wTitle = columnDisplayTitle(wPopup.table, wPopup.column);
    const wAllSelected = this.isAllVisibleSelected();
    const wStyle = {
      position: "fixed",
      left: wPopup.screenX,
      top: wPopup.screenY,
      zIndex: 12000,
    };

    const wPanel = (
      <div
        ref={this.m_Ref}
        className="SkTableFilterPopup"
        style={wStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="SkTableFilterPopup-header">
          <span className="SkTableFilterPopup-title">{wTitle}</span>
          <button
            type="button"
            className="SkTableFilterPopup-close"
            aria-label="Close"
            onClick={() => this.props.onClose?.()}
          >
            ×
          </button>
        </div>
        <div className="SkTableFilterPopup-section">
          <div className="SkTableFilterPopup-label">Trier</div>
          <div className="SkTableFilterPopup-sortRow">
            <button type="button" onClick={this.onSortAsc}>
              Croissant
            </button>
            <button type="button" onClick={this.onSortDesc}>
              Décroissant
            </button>
          </div>
        </div>
        <div className="SkTableFilterPopup-section SkTableFilterPopup-section-grow">
          <div className="SkTableFilterPopup-label">Filtrer</div>
          <input
            className="SkTableFilterPopup-search"
            type="search"
            placeholder="Rechercher"
            value={this.state.search}
            onChange={(e) => this.setState({ search: e.target.value })}
            autoComplete="off"
          />
          <SkListBox
            className="SkTableFilterPopup-listbox"
            height={220}
            autoFocus
            ariaLabel={`Valeurs pour ${wTitle}`}
            items={wList.map((v) => ({ value: v, label: v }))}
            selected={this.state.selectedValues}
            onToggle={this.toggleValue}
            headerItem={{
              value: "__all__",
              label: "(Tout sélectionner)",
              checked: wAllSelected && wList.length > 0,
              onToggle: this.toggleSelectAll,
            }}
            emptyText="Aucune valeur"
          />
        </div>
        <div className="SkTableFilterPopup-actions">
          <button type="button" onClick={this.onApplyValue}>
            Appliquer le filtre
          </button>
          <button type="button" onClick={this.onClear}>
            Effacer le filtre
          </button>
        </div>
      </div>
    );

    return createPortal(wPanel, document.body);
  }
}

export default SkSpTableFilterPopup;
