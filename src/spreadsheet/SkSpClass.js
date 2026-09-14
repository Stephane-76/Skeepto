//=============================================================================
// SkSpClass
// Anscestor SkComponent
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent";
import SkButton from "../component/SkButton";
import { GetAllClasses, GetIcon, canApplyAsFloatingObject } from "./CellClass/SkCellClass";
import {
  buildFloatingAnchorCellRef,
  DEFAULT_FLOATING_LAYOUT,
  parseFloatingObjectsJson,
  suggestFloatingObjectName,
} from "./SkSpFloatingObject.js";
import {
  IMAGE_FLOATING_CLASS,
  openImageFilePicker,
} from "./SkSpInsertImage.js";
import SkSpFloatingEditor from "./SkSpFloatingEditor.js";

/** Human label when JsonCellClass has no entry yet (e.g. SkCellClassPieChart → PieChart). */
function displayLabelFromClassName(sClassName) {
  const wPrefix = "SkCellClass";
  if (typeof sClassName === "string" && sClassName.startsWith(wPrefix)) {
    return sClassName.slice(wPrefix.length);
  }
  return sClassName || "";
}

/** Built-in unit engine — use Tools → Unit tab, not the CellClass palette. */
function isPaletteCellClassName(sClassName) {
  const wName = typeof sClassName === "string" ? sClassName : "";
  if (!wName) {
    return false;
  }
  return (
    wName !== "tCellUnit" &&
    wName !== "SkCellClassUnit" &&
    wName !== "tCellClassUnit"
  );
}

class SkSpClass extends SkComponent {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.state = { Classes: {}, floatingObjects: [], selectedFloating: "" };
    this.m_ApplyingClass = false;
    this.m_ApplyingFloat = false;
    this.m_DeletingFloat = false;
    this._onReloadView = () => this.syncFloatingObjectsFromInterface();
    if (this.m_SpInterface) {
      this.m_SpInterface.m_SkSpClass = this;
    }
  }

  async componentDidMount() {
    if (typeof window !== "undefined") {
      window.addEventListener("sker:reloadView", this._onReloadView);
    }
    await this.reloadClasses();
    if (
      this.m_SpInterface &&
      typeof this.m_SpInterface.loadFloatingObjectsForActiveSheet === "function"
    ) {
      await this.m_SpInterface.loadFloatingObjectsForActiveSheet();
    }
    this.syncFloatingObjectsFromInterface();
    this.syncSelectionFromInterface();
  }

  /** Build the class list once WASM + JS registrations are ready. */
  async reloadClasses() {
    try {
      // RegisterClasses runs inside loadWebAssembly(); loadUI alone leaves only built-in Unit.
      if (this.m_SpInterface && typeof this.m_SpInterface.loadWebAssembly === "function") {
        await this.m_SpInterface.loadWebAssembly();
      } else if (this.m_SpInterface && typeof this.m_SpInterface.loadUI === "function") {
        await this.m_SpInterface.loadUI();
      }

      let wModels = [];
      const wJson = await this.getJsonCellClass();
      if (wJson != null && wJson !== "") {
        const wParsed = JSON.parse(wJson);
        wModels = Array.isArray(wParsed?.models) ? wParsed.models : [];
      }

      const wJsEntries = GetAllClasses();
      if (wJsEntries.length > 0) {
        const wLabelByName = new Map(wModels.map((m) => [m.n, m.l]));
        const wJsNames = new Set(wJsEntries.map((e) => e.Name));
        const wMerged = wJsEntries.map((e) => ({
          n: e.Name,
          l: wLabelByName.get(e.Name) || displayLabelFromClassName(e.Name),
        }));
        for (const wModel of wModels) {
          if (!wJsNames.has(wModel.n)) {
            wMerged.push(wModel);
          }
        }
        wModels = wMerged;
      }

      wModels = wModels.filter((m) => isPaletteCellClassName(m?.n));

      this.setState({ Classes: { models: wModels } });
    } catch (e) {
      console.error("SkSpClass: failed to load cell classes", e);
    }
  }

  componentWillUnmount() {
    if (typeof window !== "undefined") {
      window.removeEventListener("sker:reloadView", this._onReloadView);
    }
    if (this.m_SpInterface?.m_SkSpClass === this) {
      this.m_SpInterface.m_SkSpClass = null;
    }
  }

  componentDidUpdate() {}

  syncFloatingObjectsFromInterface() {
    const wList = this.m_SpInterface?.m_FloatingObjects;
    if (!Array.isArray(wList)) {
      return;
    }
    this.setState({ floatingObjects: wList });
  }

  syncSelectionFromInterface() {
    const wName = this.m_SpInterface?.m_SelectedFloatingObjectName || "";
    if (this.state.selectedFloating !== wName) {
      this.setState({ selectedFloating: wName });
    }
  }

  selectFloatingObjectFromList = (sName) => {
    if (!sName || !this.m_SpInterface) {
      return;
    }
    this.m_SpInterface.selectFloatingObject(sName);
    this.setState({ selectedFloating: sName });
  };

  deleteFloatingObject = async (sName) => {
    if (this.m_DeletingFloat || this.m_ApplyingFloat || !sName) {
      return;
    }

    const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    if (!wUi || typeof wUi.deleteFloatingObject !== "function") {
      console.warn("SkSpClass: deleteFloatingObject API unavailable (rebuild wasm?)");
      return;
    }

    this.m_DeletingFloat = true;
    try {
      const wTargetSheet = await this.m_SpInterface.getActiveSheet();
      if (!wTargetSheet) {
        return;
      }

      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();

      const wDeleted = wUi.deleteFloatingObject(sName, wTargetSheet);
      if (!wDeleted) {
        console.error("SkSpClass: deleteFloatingObject failed", sName);
        return;
      }

      if (this.m_SpInterface.m_SelectedFloatingObjectName === sName) {
        this.m_SpInterface.clearFloatingObjectSelection(false);
        this.setState({ selectedFloating: "" });
      }

      await this.m_SpInterface.reloadView();
      this.m_SpInterface.invalidateAll();
    } catch (e) {
      console.error("SkSpClass: failed to delete floating object", sName, e);
    } finally {
      this.m_DeletingFloat = false;
    }
  };

  async getJsonCellClass() {
    if (
      typeof window === "undefined" ||
      !window.SkUISpreadSheet ||
      typeof window.SkUISpreadSheet.jsonCellClass !== "function"
    ) {
      console.warn("SkSpClass: SkUISpreadSheet.jsonCellClass unavailable");
      return "";
    }
    return window.SkUISpreadSheet.jsonCellClass();
  }

  applyClassToSelection = async (sClassName) => {
    if (
      this.m_ApplyingClass ||
      !this.m_SpInterface ||
      !window.SkUISpreadSheet ||
      typeof window.SkUISpreadSheet.cellClass !== "function"
    ) {
      return;
    }

    const wSelection = this.m_SpInterface.selectstr();
    if (!wSelection) {
      return;
    }

    this.m_ApplyingClass = true;
    try {
      window.SkUISpreadSheet.cellClass(wSelection, sClassName);
      await this.m_SpInterface.reloadView();
      this.m_SpInterface.invalidateAll();
    } catch (e) {
      console.error("SkSpClass: failed to apply class", sClassName, e);
    } finally {
      this.m_ApplyingClass = false;
    }
  };

  applyFloatToSelection = async (sClassName) => {
    if (
      this.m_ApplyingFloat ||
      this.m_ApplyingClass ||
      !this.m_SpInterface ||
      !canApplyAsFloatingObject(sClassName)
    ) {
      return;
    }

    if (sClassName === IMAGE_FLOATING_CLASS) {
      openImageFilePicker(this.m_SpInterface);
      return;
    }

    await this.insertFloatingObjectOfClass(sClassName);
  };

  async insertFloatingObjectOfClass(sClassName) {
    if (
      this.m_ApplyingFloat ||
      this.m_ApplyingClass ||
      !this.m_SpInterface ||
      !canApplyAsFloatingObject(sClassName)
    ) {
      return;
    }

    if (this.m_SpInterface && typeof this.m_SpInterface.loadUI === "function") {
      await this.m_SpInterface.loadUI();
    }

    const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    if (
      !wUi ||
      typeof wUi.insertFloatingObject !== "function" ||
      typeof wUi.floatingObjectLayout !== "function"
    ) {
      console.warn("SkSpClass: floating object API unavailable (rebuild wasm?)");
      return;
    }

    const wSelect = this.m_SpInterface.m_Select;
    const wCellRef =
      wSelect && typeof wSelect.cursorStr === "function" ? wSelect.cursorStr() : "";
    if (!wCellRef) {
      return;
    }

    this.m_ApplyingFloat = true;
    try {
      const wTargetSheet = await this.m_SpInterface.getActiveSheet();
      if (!wTargetSheet) {
        return;
      }

      let wExisting = [];
      if (typeof wUi.jsonFloatingObjectsForSheet === "function") {
        const wJson = wUi.jsonFloatingObjectsForSheet(wTargetSheet);
        wExisting = parseFloatingObjectsJson(wJson);
      }

      const wName = suggestFloatingObjectName(sClassName, wExisting);
      const wAnchorRef = buildFloatingAnchorCellRef(wTargetSheet, wCellRef);
      const wLayout = DEFAULT_FLOATING_LAYOUT;

      this.m_SpInterface.setExtraUndo && this.m_SpInterface.setExtraUndo();

      if (typeof wUi.ensureCell === "function") {
        wUi.ensureCell(wCellRef, wTargetSheet);
      }

      const wInserted = wUi.insertFloatingObject(
        wName,
        sClassName,
        wTargetSheet,
        "",
        wLayout.diffX,
        wLayout.diffY,
        wLayout.width,
        wLayout.height,
        wLayout.opacity,
        wAnchorRef,
      );
      if (!wInserted) {
        console.error("SkSpClass: insertFloatingObject failed", sClassName, wName);
        return;
      }

      await this.m_SpInterface.reloadView();
      this.m_SpInterface.invalidateAll();
      this.m_SpInterface.selectFloatingObject(wName);
      this.setState({ selectedFloating: wName });
    } catch (e) {
      console.error("SkSpClass: failed to apply floating object", sClassName, e);
    } finally {
      this.m_ApplyingFloat = false;
    }
  };

  render() {
    if (Object.keys(this.state.Classes).length === 0) {
      return <div></div>;
    }

    const wArrayClasses = Array.isArray(this.state.Classes.models)
      ? this.state.Classes.models.filter((m) => isPaletteCellClassName(m?.n))
      : [];
    const wFloatingObjects = Array.isArray(this.state.floatingObjects)
      ? this.state.floatingObjects
      : [];
    if (wArrayClasses.length === 0) {
      return <div></div>;
    }
    return (
      <div className="SkSpListClass">
        <div className="SkSpFloatingList">
          <div className="SkSpFloatingList-title">Floating objects</div>
          <SkSpFloatingEditor SpInterface={this.m_SpInterface} />
          {wFloatingObjects.length === 0 ? (
            <div className="SkSpFloatingList-empty">None on this sheet</div>
          ) : (
            <div className="SkSpFloatingList-items">
              {wFloatingObjects.map((wObj) => {
                const wSelected = this.state.selectedFloating === wObj.n;
                return (
                  <div
                    className={[
                      "SkSpFloatingList-row",
                      wSelected ? "SkSpFloatingList-row--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={wObj.n}
                  >
                    <button
                      type="button"
                      className="SkSpFloatingList-name"
                      title={wObj.c || wObj.n}
                      onClick={() => this.selectFloatingObjectFromList(wObj.n)}
                    >
                      {wObj.n}
                    </button>
                    <SkButton
                      className="SkSpFloatingList-delete"
                      onClick={() => this.deleteFloatingObject(wObj.n)}
                      title={`Delete floating object ${wObj.n}`}
                    >
                      Delete
                    </SkButton>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="SkSpListClass-content">
          {wArrayClasses.map((wItem, wIndex) => {
            const wIconFn = GetIcon(wItem.n);
            const wIsImageClass = wItem.n === IMAGE_FLOATING_CLASS;
            const wFloatButtonLabel = wIsImageClass ? "Insert image" : "Apply float";
            const wFloatButtonTitle = wIsImageClass
              ? "Pick an image file and insert it as a floating object on the current cell"
              : `Insert ${wItem.l} as a floating object anchored on the current cell`;
            return (
              <React.Fragment key={wItem.n || wIndex}>
                {wIndex > 0 ? (
                  <hr className="SkSpClassRow-separator" aria-hidden="true" />
                ) : null}
                <div className="SkSpClassRow">
                <label className="SkSpClassRow-label" title={wItem.n}>
                  {wItem.l}
                </label>
                <div className="SkSpClassRow-body">
                  <div className="SkSpClassRow-icon" aria-hidden="true">
                    {wIconFn ? wIconFn() : null}
                  </div>
                  <div className="SkSpClassRow-actions">
                    <SkButton
                      className="SkSpClassRow-apply"
                      onClick={() => this.applyClassToSelection(wItem.n)}
                      title={`Apply ${wItem.l} to the current selection`}
                    >
                      Apply
                    </SkButton>
                    {canApplyAsFloatingObject(wItem.n) ? (
                      <SkButton
                        className="SkSpClassRow-apply-float"
                        onClick={() => this.applyFloatToSelection(wItem.n)}
                        title={wFloatButtonTitle}
                      >
                        {wFloatButtonLabel}
                      </SkButton>
                    ) : null}
                  </div>
                </div>
              </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }
}
// ============================================================================
export default SkSpClass;
