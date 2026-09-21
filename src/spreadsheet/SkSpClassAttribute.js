//=============================================================================
// SkSpClass
// Anscestor SkComponent
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent";
import SkButton from "../component/SkButton";
import SkComboBox from "../component/SkComboBox";
import SkSpInplaceEdit from "./SkSpInplaceEdit";
import SkCellClass, { GetClass } from "./CellClass/SkCellClass";
import { hasFloatingObjectAttributes } from "./SkSpFloatingObject.js";
import { tPoint } from "./SkSpSelect";

/** Display hint for attribute value input (value, formula, or grid range). */
function attributeTypeHint(sTypeCode) {
  switch (sTypeCode) {
    case "i":
    case "d":
      return "number";
    case "s":
      return "string";
    case "b":
      return "bool";
    case "da":
      return "date";
    default:
      return "value";
  }
}

function attributeValueHint(sTypeCode, sKind = "") {
  if (SkCellClass.isRangePropertyKind(sKind)) {
    return "(range)";
  }
  if (SkCellClass.isEnumPropertyKind(sKind)) {
    const wChoices = SkCellClass.enumChoicesFromKind(sKind);
    return wChoices.length > 0 ? `(${wChoices.join("|")})` : "(enum)";
  }
  const wBase = attributeTypeHint(sTypeCode);
  if (wBase === "bool") {
    return `(${wBase})`;
  }
  return `(${wBase}|formula)`;
}

/** Model default from JsonCellClass property schema (`d.v`). */
function readModelPropertyDefault(sModelItem) {
  const wDefault = sModelItem?.d;
  if (!wDefault || wDefault.v == null) {
    return "";
  }
  const wText = String(wDefault.v);
  if (wText === "Null" || wText === "null") {
    return "";
  }
  return wText;
}

class SkSpClassAttribute extends SkComponent {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.m_SpInterface.m_SkSpClassAttribute=this;
    
    this.state = {
      Classe: {},
      Cursor: "",
      properties: [],
      instanceName: "",
      commitError: "",
    };
    this.m_Classe = {};
    this.m_Cursor = new tPoint(1, 1);
    this.m_InplaceEditRefs = {};
    this.m_ClassName = "";
    this.m_NameObject = "";
    this.m_AnchorRow = null;
    this.m_AnchorCol = null;
    this.m_FloatingObjectName = null;
    this.m_AttributeFieldsLocked = false;
    this.m_EnumDraftValues = {};
    this.m_EnumComboRefs = {};
  }

  syncEnumDraftFromProperties(sProperties) {
    const wDraft = {};
    for (const wItem of sProperties) {
      if (SkCellClass.isEnumPropertyKind(wItem.k)) {
        wDraft[wItem.n] = wItem.v != null ? String(wItem.v) : "";
      }
    }
    this.m_EnumDraftValues = wDraft;
  }

  ensureEnumComboRef(sPropertyName) {
    if (!this.m_EnumComboRefs[sPropertyName]) {
      this.m_EnumComboRefs[sPropertyName] = React.createRef();
    }
    return this.m_EnumComboRefs[sPropertyName];
  }

  resolveEnumPropertyValue(sPropertyName, sFallbackValue = "") {
    const wComboRef = this.m_EnumComboRefs[sPropertyName]?.current;
    if (wComboRef != null && typeof wComboRef.getValue === "function") {
      const wFromCombo = wComboRef.getValue();
      if (wFromCombo != null && String(wFromCombo).trim() !== "") {
        return String(wFromCombo);
      }
    }
    if (
      this.m_EnumDraftValues != null &&
      Object.prototype.hasOwnProperty.call(this.m_EnumDraftValues, sPropertyName)
    ) {
      return String(this.m_EnumDraftValues[sPropertyName]);
    }
    return sFallbackValue != null ? String(sFallbackValue) : "";
  }

  isFloatingObjectAttributeMode() {
    if (
      typeof this.m_FloatingObjectName === "string" &&
      this.m_FloatingObjectName.length > 0
    ) {
      return true;
    }
    const wEntry = this.m_SpInterface?.getSelectedFloatingObject?.();
    return wEntry != null && hasFloatingObjectAttributes(wEntry);
  }

  /** Ensure m_FloatingObjectName matches the selected floating object before commit. */
  resolveFloatingObjectNameForCommit() {
    if (
      typeof this.m_FloatingObjectName === "string" &&
      this.m_FloatingObjectName.length > 0
    ) {
      return this.m_FloatingObjectName;
    }
    const wEntry = this.m_SpInterface?.getSelectedFloatingObject?.();
    if (wEntry != null && typeof wEntry.n === "string" && wEntry.n.length > 0) {
      this.m_FloatingObjectName = wEntry.n;
      return wEntry.n;
    }
    return null;
  }

  onFloatingObjectSelectionChanged(sForce = false) {
    if (!sForce && this.isPropertyEditActive()) {
      return;
    }
    if (sForce && this.isPropertyEditActive()) {
      void this.m_SpInterface.endEdit();
    }
    void this.reloadAttributePropertiesFromAnchor(sForce);
  }

  /** True when the active property edit belongs to this attribute panel. */
  static isAttributePanelPropertyEdit(sSpInterface) {
    const wEd = sSpInterface?.m_SkSpInplaceEditProperty;
    if (wEd == null) {
      return false;
    }
    const wId = wEd.m_Id;
    return typeof wId === "string" && wId.startsWith("InplaceEditAttr_");
  }

  isPropertyEditActive() {
    return SkSpClassAttribute.isAttributePanelPropertyEdit(this.m_SpInterface);
  }

  async releaseForeignPropertyEdit() {
    const sp = this.m_SpInterface;
    if (sp?.m_SkSpInplaceEditProperty != null && !this.isPropertyEditActive()) {
      await sp.endEdit();
    }
  }

  /** True when a previously resolved class host cell is still a valid attribute target. */
  hasResolvedClassAnchor() {
    const sp = this.m_SpInterface;
    if (sp == null || this.m_AnchorRow == null || this.m_AnchorCol == null) {
      return false;
    }
    return SkSpClassAttribute.hasClassAttributes(
      sp.getCell(this.m_AnchorRow, this.m_AnchorCol),
    );
  }

  /** Resolve anchor from selection, or lock it during attribute property edit (formula pick). */
  ensureClassAnchorCell() {
    const sp = this.m_SpInterface;
    if (sp == null) {
      return false;
    }

    if (
      typeof this.m_FloatingObjectName === "string" &&
      this.m_FloatingObjectName.length > 0
    ) {
      const wSelected = sp.getSelectedFloatingObject?.();
      if (wSelected != null && wSelected.n === this.m_FloatingObjectName) {
        this.m_AnchorRow = Number(wSelected.ar) || 1;
        this.m_AnchorCol = Number(wSelected.ac) || 1;
        return true;
      }
      // Range picks move the grid cursor onto data cells and clear floating
      // selection. Keep the panel host while the named object still exists —
      // do not require Sheet1 class attrs (host lives on _$$A).
      const wByName =
        typeof sp.findFloatingObjectEntry === "function"
          ? sp.findFloatingObjectEntry(this.m_FloatingObjectName)
          : null;
      if (wByName != null) {
        this.m_AnchorRow = Number(wByName.ar) || this.m_AnchorRow || 1;
        this.m_AnchorCol = Number(wByName.ac) || this.m_AnchorCol || 1;
        return true;
      }
      if (this.isPropertyEditActive() || this.hasResolvedClassAnchor()) {
        return true;
      }
      this.m_FloatingObjectName = null;
    }

    const wCur = sp.cursor();
    const wCursorCell = sp.getCell(wCur.row(), wCur.col());

    // While editing an attribute field, keep the class host cell — not the pick cursor.
    if (this.isPropertyEditActive()) {
      if (this.hasResolvedClassAnchor()) {
        return true;
      }
      if (SkSpClassAttribute.hasClassAttributes(wCursorCell)) {
        this.m_AnchorRow = wCur.row();
        this.m_AnchorCol = wCur.col();
        this.m_Cursor = wCur;
        return true;
      }
      return this.m_AnchorRow != null && this.m_AnchorCol != null;
    }

    // Normal grid selection: always follow the cursor cell.
    if (SkSpClassAttribute.hasClassAttributes(wCursorCell)) {
      this.m_AnchorRow = wCur.row();
      this.m_AnchorCol = wCur.col();
      this.m_Cursor = wCur;
      return true;
    }

    this.m_AnchorRow = null;
    this.m_AnchorCol = null;
    return false;
  }

  resolveAnchorCell() {
    const sp = this.m_SpInterface;
    if (
      this.isPropertyEditActive() &&
      this.m_AnchorRow != null &&
      this.m_AnchorCol != null
    ) {
      return sp.getCell(this.m_AnchorRow, this.m_AnchorCol);
    }
    this.m_Cursor = sp.cursor();
    return sp.getCell(this.m_Cursor.row(), this.m_Cursor.col());
  }

  async componentDidMount() {
    try {
      await this.releaseForeignPropertyEdit();
      await this.Resetcursor();
      const wJson = await this.getJsonCellClass();
      if (!wJson) {
        return;
      }
      this.m_Classe = JSON.parse(wJson);
      const wClass = GetClass(this.m_ClassName);
      this.m_Code = wClass.Code();
      this.setState({ Classe: this.m_Classe });
    } catch (e) {
      console.error('SkSpClassAttribute: componentDidMount', e);
    }
  }

  componentWillUnmount() {
    if (this.isPropertyEditActive()) {
      void this.m_SpInterface.endEdit();
    }
    if (this.m_SpInterface.m_SkSpClassAttribute === this) {
      this.m_SpInterface.m_SkSpClassAttribute = null;
    }
  }

  componentDidUpdate(prevProps) {
    // Add any update logic here if needed
  }

  endEdit() {
    this.setState({ Cursor: "" });
  }

  /** True when the cursor cell hosts a React class with model properties. */
  static hasClassAttributes(sCell) {
    return (
      sCell != null &&
      sCell.c_t === "c" &&
      sCell.c_v != null &&
      sCell.c_v.co === true &&
      typeof sCell.c_v.n === "string" &&
      sCell.c_v.n.length > 0 &&
      sCell.c_v.c != null
    );
  }

  clearAttributeList() {
    this.m_ClassName = "";
    this.m_NameObject = "";
    this.m_Code = "";
    this.m_Classe = {};
    this.m_InplaceEditRefs = {};
    this.m_AnchorRow = null;
    this.m_AnchorCol = null;
    this.m_FloatingObjectName = null;
    this.m_AttributeFieldsLocked = false;
    this.m_EnumDraftValues = {};
    this.m_EnumComboRefs = {};
    this.endEdit();
    this.setState({ properties: [], Classe: {}, instanceName: "" });
  }

  applyPropertyValuesToFields(sProperties) {
    for (const wItem of sProperties) {
      const wRef = this.m_InplaceEditRefs[wItem.n]?.current;
      if (wRef == null || typeof wRef.setText !== "function") {
        continue;
      }
      const wText = wItem.v != null ? String(wItem.v) : "";
      wRef.setText(wText);
      if (typeof wRef.setDisabled === "function") {
        wRef.setDisabled(true);
      }
    }
  }

  /** Load attribute values from a selected workbook floating object (host c_v.c.a). */
  async reloadAttributePropertiesFromFloatingObject(sEntry, sForce = false) {
    const wSp = this.m_SpInterface;
    if (wSp == null || sEntry == null || !hasFloatingObjectAttributes(sEntry)) {
      this.m_FloatingObjectName = null;
      return false;
    }

    if (sForce && typeof wSp.loadFloatingObjectsForActiveSheet === "function") {
      const wName = sEntry.n;
      await wSp.loadFloatingObjectsForActiveSheet();
      const wRefreshed =
        wSp.getSelectedFloatingObject?.() ||
        (typeof wSp.findFloatingObjectEntry === "function"
          ? wSp.findFloatingObjectEntry(wName)
          : null);
      if (wRefreshed != null) {
        sEntry = wRefreshed;
      }
    }

    if (this.m_FloatingObjectName !== sEntry.n) {
      this.m_InplaceEditRefs = {};
    }

    this.m_FloatingObjectName = sEntry.n;
    this.m_AnchorRow = Number(sEntry.ar) || 1;
    this.m_AnchorCol = Number(sEntry.ac) || 1;
    this.m_ClassName = sEntry.c || sEntry.host?.c_v?.n || "";
    const wHostCv = sEntry.host?.c_v;
    this.m_NameObject =
      (typeof wHostCv?.c?.n === "string" && wHostCv.c.n.length > 0
        ? wHostCv.c.n
        : sEntry.n) || sEntry.n;

    try {
      const wClass = GetClass(this.m_ClassName);
      if (wClass == null || typeof wClass.Code !== "function") {
        this.clearAttributeList();
        return false;
      }
      this.m_Code = wClass.Code();

      const wJson = await this.getJsonCellClass();
      if (!wJson) {
        this.clearAttributeList();
        return false;
      }
      this.m_Classe = JSON.parse(wJson);
      const wRawAttrs = wHostCv?.c?.a;
      const wArrayInstance = Array.isArray(wRawAttrs) ? wRawAttrs : [];
      const wArray = Array.isArray(this.m_Classe.p) ? this.m_Classe.p : [];
      const wTargetSheet =
        (typeof sEntry.t === "string" && sEntry.t.trim()) || "";
      const wHostSheet =
        (typeof sEntry.hs === "string" && sEntry.hs.trim()) || "_$$A";
      const wHostRef = SkCellClass.buildHostCellRef(
        wHostSheet,
        sEntry.hr,
        sEntry.hc,
      );

      const wProperties = await Promise.all(
        wArray.map(async (item) => {
        const wObj = {
          n: item.n,
          l: typeof item.l === "string" && item.l.length > 0 ? item.l : item.n,
          t: typeof item.t === "string" ? item.t : "s",
          k: SkCellClass.propertyKindFromSchemaItem(item),
          v: "",
        };
        const wInst = wArrayInstance.find((attr) => attr?.n === item.n);
        if (wInst) {
          if (SkCellClass.isRangeProperty(item)) {
            wObj.v = await SkCellClass.resolveLiveRangeAttributeDisplayValue(
              wHostRef,
              item.n,
              wHostSheet,
              wTargetSheet,
              wInst,
            );
          } else {
            wObj.v = await SkCellClass.resolveLiveFormulaAttributeDisplayValue(
              wHostRef,
              item.n,
              wHostSheet,
              wTargetSheet,
              wInst,
            );
          }
        }
        if (wObj.v == null || String(wObj.v).trim() === "") {
          wObj.v = readModelPropertyDefault(item);
        }
        if (SkCellClass.isEnumPropertyKind(wObj.k)) {
          wObj.v = SkCellClass.coerceEnumAttributeValue(wObj.v, wObj.k);
        }
        return wObj;
        }),
      );

      if (!sForce) {
        this.m_InplaceEditRefs = {};
      }
      this.m_AttributeFieldsLocked = false;
      this.endEdit();
      const wInstanceName =
        typeof this.m_NameObject === "string" ? this.m_NameObject.trim() : "";
      return await new Promise((resolve) => {
        this.setState(
          {
            properties: wProperties,
            Classe: this.m_Classe,
            instanceName: wInstanceName,
          },
          () => {
            this.syncEnumDraftFromProperties(wProperties);
            this.applyPropertyValuesToFields(wProperties);
            resolve(true);
          },
        );
      });
    } catch (error) {
      console.error(
        "SkSpClassAttribute: reloadAttributePropertiesFromFloatingObject failed",
        error,
      );
      this.clearAttributeList();
      return false;
    }
  }

  /** Load attribute values from the anchored class instance (JsonView c_v.c.a). */
  async reloadAttributePropertiesFromAnchor(sForce = false) {
    if (
      !sForce &&
      this.isPropertyEditActive() &&
      this.state.properties.length > 0
    ) {
      if (this.isFloatingObjectAttributeMode()) {
        const wEntry = this.m_SpInterface?.getSelectedFloatingObject?.();
        if (
          wEntry != null &&
          wEntry.n === this.m_FloatingObjectName &&
          hasFloatingObjectAttributes(wEntry)
        ) {
          return false;
        }
      } else {
        const wAnchorCell = this.resolveAnchorCell();
        if (SkSpClassAttribute.hasClassAttributes(wAnchorCell)) {
          return false;
        }
      }
    }

    const wSp = this.m_SpInterface;
    let wFloatEntry = wSp?.getSelectedFloatingObject?.();
    if (
      (wFloatEntry == null || !hasFloatingObjectAttributes(wFloatEntry)) &&
      typeof this.m_FloatingObjectName === "string" &&
      this.m_FloatingObjectName.length > 0 &&
      typeof wSp?.findFloatingObjectEntry === "function"
    ) {
      // Range picks clear floating selection — reload by the panel's object name.
      wFloatEntry = wSp.findFloatingObjectEntry(this.m_FloatingObjectName);
    }
    if (wFloatEntry != null && hasFloatingObjectAttributes(wFloatEntry)) {
      return this.reloadAttributePropertiesFromFloatingObject(wFloatEntry, sForce);
    }
    this.m_FloatingObjectName = null;

    // Keep host across reloadView: Apply often leaves the grid cursor on a picked range.
    const wSavedAnchorRow = this.m_AnchorRow;
    const wSavedAnchorCol = this.m_AnchorCol;

    if (sForce && typeof wSp.reloadView === "function") {
      await wSp.reloadView();
    }

    this.ensureClassAnchorCell();
    if (
      (this.m_AnchorRow == null || this.m_AnchorCol == null) &&
      wSavedAnchorRow != null &&
      wSavedAnchorCol != null &&
      SkSpClassAttribute.hasClassAttributes(
        wSp.getCell(wSavedAnchorRow, wSavedAnchorCol),
      )
    ) {
      this.m_AnchorRow = wSavedAnchorRow;
      this.m_AnchorCol = wSavedAnchorCol;
    }
    const wRow = this.m_AnchorRow;
    const wCol = this.m_AnchorCol;
    if (wRow == null || wCol == null) {
      this.clearAttributeList();
      return false;
    }

    const wCell = wSp.getCell(wRow, wCol);

    if (!SkSpClassAttribute.hasClassAttributes(wCell)) {
      if (
        wSp.getUseEdit() &&
        wSp.m_SkSpInplaceEditProperty != null
      ) {
        await wSp.endEdit();
      }
      this.clearAttributeList();
      return false;
    }

    try {
      this.m_ClassName = wCell.c_v.n;
      this.m_NameObject = wCell.c_v.c.n;
      const wClass = GetClass(this.m_ClassName);
      if (wClass == null || typeof wClass.Code !== "function") {
        this.clearAttributeList();
        return false;
      }
      this.m_Code = wClass.Code();

      const wJson = await this.getJsonCellClass();
      if (!wJson) {
        this.clearAttributeList();
        return false;
      }
      this.m_Classe = JSON.parse(wJson);
      const wArrayInstance = wCell.c_v.c.a || [];
      const wArray = Array.isArray(this.m_Classe.p) ? this.m_Classe.p : [];
      const wTargetSheet = wSp.m_UIView?.sheet || "";
      const wHostRef =
        typeof window !== "undefined" && window.SkUISpreadSheet
          ? window.SkUISpreadSheet.base10toAlphaSync(wCol) + wRow
          : "";

      const wProperties = await Promise.all(
        wArray.map(async (item) => {
        const wObj = {
          n: item.n,
          l: typeof item.l === "string" && item.l.length > 0 ? item.l : item.n,
          t: typeof item.t === "string" ? item.t : "s",
          k: SkCellClass.propertyKindFromSchemaItem(item),
          v: "",
        };
        const wInst = wArrayInstance.find((attr) => attr?.n === item.n);
        if (wInst) {
          if (SkCellClass.isRangeProperty(item)) {
            wObj.v = await SkCellClass.resolveLiveRangeAttributeDisplayValue(
              wHostRef,
              item.n,
              "",
              wTargetSheet,
              wInst,
            );
          } else {
            wObj.v = await SkCellClass.resolveLiveFormulaAttributeDisplayValue(
              wHostRef,
              item.n,
              "",
              wTargetSheet,
              wInst,
            );
          }
        }
        if (wObj.v == null || String(wObj.v).trim() === "") {
          wObj.v = readModelPropertyDefault(item);
        }
        if (SkCellClass.isEnumPropertyKind(wObj.k)) {
          wObj.v = SkCellClass.coerceEnumAttributeValue(wObj.v, wObj.k);
        }
        return wObj;
        }),
      );

      if (!sForce) {
        this.m_InplaceEditRefs = {};
      }
      this.m_AttributeFieldsLocked = false;
      this.endEdit();
      const wInstanceName =
        typeof this.m_NameObject === "string" ? this.m_NameObject.trim() : "";
      return await new Promise((resolve) => {
        this.setState(
          {
            properties: wProperties,
            Classe: this.m_Classe,
            instanceName: wInstanceName,
          },
          () => {
            this.syncEnumDraftFromProperties(wProperties);
            this.applyPropertyValuesToFields(wProperties);
            resolve(true);
          }
        );
      });
    } catch (error) {
      console.error("SkSpClassAttribute: reloadAttributePropertiesFromAnchor failed", error);
      this.clearAttributeList();
      return false;
    }
  }

  async Resetcursor() {
    await this.reloadAttributePropertiesFromAnchor(false);
  }

  async getJsonCellClass() {
    if (this.m_SpInterface && typeof this.m_SpInterface.loadUI === 'function') {
      await this.m_SpInterface.loadUI();
    }
    if (
      typeof window === 'undefined' ||
      !window.SkUISpreadSheet ||
      typeof window.SkUISpreadSheet.jsonCellClassByName !== 'function'
    ) {
      console.warn('SkSpClassAttribute: SkUISpreadSheet.jsonCellClassByName unavailable');
      return '';
    }
    const wClassName = typeof this.m_ClassName === "string" ? this.m_ClassName : "";
    if (!wClassName) {
      return "";
    }
    return window.SkUISpreadSheet.jsonCellClassByName(wClassName);
  }

  ensurePropertyRef(sPropertyName) {
    if (!this.m_InplaceEditRefs[sPropertyName]) {
      this.m_InplaceEditRefs[sPropertyName] = React.createRef();
    }
    return this.m_InplaceEditRefs[sPropertyName];
  }

  setActiveProperty(sPropertyName) {
    if (!sPropertyName || this.state.Cursor === sPropertyName) {
      return;
    }
    this.setState({ Cursor: sPropertyName });
  }

  onPropertyEditStart = (sEdit) => {
    this.ensureClassAnchorCell();
    const wName = sEdit != null && typeof sEdit.property === "function"
      ? sEdit.property()
      : null;
    if (wName) {
      this.setActiveProperty(wName);
    }
  };

  onPropertyTextChange = (sPropertyName) => {
    this.setActiveProperty(sPropertyName);
  };

  resolveActivePropertyEdit() {
    const sp = this.m_SpInterface;
    if (sp?.m_SkSpInplaceEditProperty != null && this.isPropertyEditActive()) {
      return sp.m_SkSpInplaceEditProperty;
    }

    const wCursor = this.state.Cursor;
    if (wCursor && this.m_InplaceEditRefs[wCursor]?.current) {
      return this.m_InplaceEditRefs[wCursor].current;
    }

    for (const wItem of this.state.properties) {
      const wRef = this.m_InplaceEditRefs[wItem.n]?.current;
      const wEl = wRef?.m_Ref?.current;
      if (wEl && document.activeElement === wEl) {
        return wRef;
      }
    }

    const wFirst = this.state.properties[0];
    if (wFirst && this.m_InplaceEditRefs[wFirst.n]?.current) {
      return this.m_InplaceEditRefs[wFirst.n].current;
    }
    return null;
  }

  activatePropertyEdit = async (sPropertyName) => {
    const wRef = this.m_InplaceEditRefs[sPropertyName];
    if (!wRef?.current) {
      return;
    }
    const wEdit = wRef.current;

    if (
      this.isPropertyEditActive() &&
      this.m_SpInterface.m_SkSpInplaceEditProperty === wEdit
    ) {
      this.setActiveProperty(sPropertyName);
      return;
    }

    if (
      this.m_SpInterface.m_SkSpInplaceEditProperty != null &&
      this.m_SpInterface.m_SkSpInplaceEditProperty !== wEdit
    ) {
      await this.m_SpInterface.endEdit();
    }

    this.ensureClassAnchorCell();
    this.m_SpInterface.pushInplaceEdit(wEdit);
    wEdit.setDisabled(false);
    this.onPropertyEditStart(wEdit);
    await this.m_SpInterface.beginEdit();

    const wEl = wEdit.m_Ref?.current;
    if (wEl) {
      wEl.focus();
      const wLen = wEl.value != null ? wEl.value.length : 0;
      wEl.setSelectionRange(wLen, wLen);
    }
  };

  handleAttributeFieldMouseDown = async (sPropertyName, event) => {
    const wProp = this.state.properties.find((wItem) => wItem.n === sPropertyName);
    if (wProp && SkCellClass.isEnumPropertyKind(wProp.k)) {
      if (this.m_AttributeFieldsLocked) {
        event.preventDefault();
        return;
      }
      this.setActiveProperty(sPropertyName);
      return;
    }
    const wRef = this.m_InplaceEditRefs[sPropertyName];
    const wEdit = wRef?.current;
    if (
      wEdit &&
      this.isPropertyEditActive() &&
      this.m_SpInterface.m_SkSpInplaceEditProperty === wEdit
    ) {
      return;
    }
    event.preventDefault();
    await this.activatePropertyEdit(sPropertyName);
  };

  lockAllPropertyFields() {
    this.m_AttributeFieldsLocked = true;
    for (const wItem of this.state.properties) {
      if (SkCellClass.isEnumPropertyKind(wItem.k)) {
        continue;
      }
      const wRef = this.m_InplaceEditRefs[wItem.n]?.current;
      if (wRef != null && typeof wRef.setDisabled === "function") {
        wRef.setDisabled(true);
      }
    }
  }

  async reloadEnumPropertiesAfterCommit() {
    if (this.isFloatingObjectAttributeMode()) {
      const wEntry = this.m_SpInterface?.getSelectedFloatingObject?.();
      if (wEntry != null) {
        await this.reloadAttributePropertiesFromFloatingObject(wEntry, true);
        return;
      }
    }
    await this.reloadAttributePropertiesFromAnchor(true);
  }

  handleEnumPropertyChange = async (sPropertyName, sValue) => {
    if (this.m_AttributeFieldsLocked) {
      return;
    }
    const wProp = this.state.properties.find((wItem) => wItem.n === sPropertyName);
    if (!wProp) {
      return;
    }
    const wValue = SkCellClass.coerceEnumAttributeValue(
      sValue != null ? String(sValue) : "",
      wProp.k,
    );
    if (String(wProp.v ?? "") === wValue) {
      this.setActiveProperty(sPropertyName);
      return;
    }
    this.m_EnumDraftValues = {
      ...this.m_EnumDraftValues,
      [sPropertyName]: wValue,
    };
    const wNextProp = { ...wProp, v: wValue };
    this.setState((prevState) => ({
      Cursor: sPropertyName,
      properties: prevState.properties.map((wItem) => (
        wItem.n === sPropertyName ? wNextProp : wItem
      )),
    }));
    // Enums (chartType, barDirection, …) commit immediately for live preview.
    this.clearCommitError();
    try {
      const wOk = await this.commitEnumProperty(wNextProp);
      if (!wOk) {
        this.setState({
          commitError: "Could not apply the selected value.",
        });
        return;
      }
      await this.reloadEnumPropertiesAfterCommit();
    } catch (err) {
      console.error("SkSpClassAttribute: enum commit failed", sPropertyName, err);
      this.setState({
        commitError: "Could not apply the selected value.",
      });
    }
  };

  resolveAttributeHostCellRef() {
    const sp = this.m_SpInterface;
    if (
      this.m_AnchorRow != null &&
      this.m_AnchorCol != null &&
      typeof window !== "undefined" &&
      window.SkUISpreadSheet
    ) {
      return (
        window.SkUISpreadSheet.base10toAlphaSync(this.m_AnchorCol) +
        this.m_AnchorRow
      );
    }
    return typeof sp?.editCellRef === "function" ? sp.editCellRef() : null;
  }

  async commitEnumProperty(sProp) {
    const sp = this.m_SpInterface;
    if (sp == null || sProp == null) {
      return false;
    }
    const wRaw = this.resolveEnumPropertyValue(sProp.n, sProp.v);
    const wValue = SkCellClass.coerceEnumAttributeValue(wRaw, sProp.k);
    const wWire = SkCellClass.normalizeScalarAttributeInput(wValue, sProp.k);
    if (this.isFloatingObjectAttributeMode()) {
      const wObjectName = this.resolveFloatingObjectNameForCommit();
      if (!wObjectName) {
        return false;
      }
      if (sp.getUseEdit?.()) {
        await sp.endEdit();
      }
      return sp.commitAllFloatingObjectAttributes(wObjectName, [{
        n: sProp.n,
        v: wWire,
        k: sProp.k != null ? String(sProp.k) : "",
      }]);
    }

    this.ensureClassAnchorCell();
    if (typeof sp.syncAttributeEditAnchorCursor === "function") {
      sp.syncAttributeEditAnchorCursor();
    }
    const wCellRef = this.resolveAttributeHostCellRef();
    if (!wCellRef) {
      return false;
    }
    sp.setExtraUndo();
    return window.SkUISpreadSheet.valueAttribute(wCellRef, sProp.n, wWire);
  }

  collectPropertyValuesForCommit() {
    return this.state.properties.map((wItem) => {
      let wText = wItem.v != null ? String(wItem.v) : "";
      if (!SkCellClass.isEnumPropertyKind(wItem.k)) {
        const wRef = this.m_InplaceEditRefs[wItem.n]?.current;
        if (wRef != null && typeof wRef.text === "function") {
          const wCurrent = wRef.text();
          wText = wCurrent != null ? String(wCurrent) : wText;
        }
        // Ensure JSON(...) options formulas keep a leading "=" for wasm CellValue.
        if (SkCellClass.looksLikeJsonOptionsFormulaBody(wText)) {
          wText = SkCellClass.normalizeJsonOptionsAttributeInput(wText);
        }
      } else {
        wText = SkCellClass.coerceEnumAttributeValue(
          this.resolveEnumPropertyValue(wItem.n, wText),
          wItem.k,
        );
      }
      return {
        n: wItem.n,
        l: wItem.l != null ? String(wItem.l) : wItem.n,
        v: wText,
        k: wItem.k != null ? String(wItem.k) : "",
      };
    });
  }

  clearCommitError() {
    if (this.state.commitError !== "") {
      this.setState({ commitError: "" });
    }
    if (typeof this.m_SpInterface?.clearFormulaBarCompileError === "function") {
      this.m_SpInterface.clearFormulaBarCompileError();
    }
  }

  confirmEdit = async () => {
    if (this.state.properties.length === 0) {
      return;
    }
    this.clearCommitError();
    try {
      const wValues = this.collectPropertyValuesForCommit();
      // Capture floating host before ensure/endEdit: range picks deselect the
      // object and move the cursor onto data (e.g. V4), which must not become
      // the CellClassAttributes target.
      const wFloatingNameBefore = this.resolveFloatingObjectNameForCommit();
      this.ensureClassAnchorCell();
      const wFloatingName =
        wFloatingNameBefore ||
        (this.isFloatingObjectAttributeMode()
          ? this.resolveFloatingObjectNameForCommit()
          : null);
      const wAnchorRow = this.m_AnchorRow;
      const wAnchorCol = this.m_AnchorCol;
      const wCellRef = wFloatingName
        ? null
        : this.resolveAttributeHostCellRef();
      if (this.m_SpInterface.getUseEdit?.()) {
        await this.m_SpInterface.endEdit();
      }
      if (wFloatingName) {
        this.m_FloatingObjectName = wFloatingName;
      }
      if (wAnchorRow != null && wAnchorCol != null) {
        this.m_AnchorRow = wAnchorRow;
        this.m_AnchorCol = wAnchorCol;
      }
      let wOk = false;
      if (wFloatingName) {
        console.log(
          "[SkSpClassAttribute] Apply → floatingObjectAttributes",
          wFloatingName,
        );
        wOk = await this.m_SpInterface.commitAllFloatingObjectAttributes(
          wFloatingName,
          wValues,
        );
      } else {
        if (!wCellRef) {
          console.warn("SkSpClassAttribute: Apply ignored — no host cell");
          this.setState({
            commitError:
              "Could not apply attributes: host cell not found (reselect the chart).",
          });
          return;
        }
        console.warn(
          "[SkSpClassAttribute] Apply → cellClassAttributes (not floating)",
          wCellRef,
        );
        const wSheet = this.m_SpInterface.m_UIView?.sheet || "";
        wOk = await this.m_SpInterface.commitAllCellClassAttributes(
          wCellRef,
          wValues,
          wSheet,
        );
      }
      if (wOk) {
        this.lockAllPropertyFields();
        this.endEdit();
        await this.reloadAttributePropertiesFromAnchor(true);
      } else {
        const wStored = this.m_SpInterface.m_LastAttributeCommitError;
        const wMessage =
          typeof wStored === "string" && wStored.trim() !== ""
            ? wStored.trim()
            : await this.m_SpInterface.buildWasmErrorMessage(
                "Attribute validation failed.",
              );
        this.setState({ commitError: wMessage });
        console.error("SkSpClassAttribute: attribute batch commit failed", wValues);
      }
    } catch (error) {
      const wMessage = await this.m_SpInterface.notifyOperationFailure(
        "Attribute validation failed.",
        error,
      );
      this.setState({ commitError: wMessage });
      console.error("SkSpClassAttribute confirmEdit failed:", error);
    }
  };

  /** End the edit session and reload saved values from the class instance. */
  resetEdit = async () => {
    try {
      this.clearCommitError();
      if (
        this.m_SpInterface.getUseEdit() ||
        this.isPropertyEditActive()
      ) {
        await this.m_SpInterface.endEdit();
      }
      this.endEdit();
      await this.reloadAttributePropertiesFromAnchor(true);
    } catch (error) {
      console.error("SkSpClassAttribute resetEdit failed:", error);
    }
  };

  render() {
    const wProperties = this.state.properties;
    const wInstanceName = this.state.instanceName;
    const wCanValidate = wProperties.length > 0;
    const wValidateTitle = "Apply all attribute values";
    if (wInstanceName === "" && wProperties.length === 0) {
      return null;
    }

    return (
      <div className="SkSpListAttribute">
        {wInstanceName !== "" ? (
          <>
            <div className="SkSpListAttribute-instance" title="Class instance name">
              {wInstanceName}
            </div>
            <hr className="SkSpListAttribute-separator" aria-hidden="true" />
          </>
        ) : null}
        {wProperties.length > 0 ? (
          <>
            <h4 className="SkSpPanelTitle">Attribute(s)</h4>
            <div className="SkSpListAttribute-content">
          {
            wProperties.map((wItem, wIndex) => {
              const wIsActiveField = this.state.Cursor === wItem.n;
              const wTypeHint = attributeValueHint(wItem.t, wItem.k);
              const wIsEnum = SkCellClass.isEnumPropertyKind(wItem.k);
              const wEnumChoices = wIsEnum
                ? SkCellClass.enumChoicesFromKind(wItem.k).map((wChoice) => ({
                    value: wChoice,
                    label: wChoice,
                  }))
                : [];
              const wEnumValue = wIsEnum
                ? SkCellClass.coerceEnumAttributeValue(
                    this.resolveEnumPropertyValue(wItem.n, wItem.v),
                    wItem.k,
                  )
                : wItem.v;
              return (
                <div
                  className={[
                    "SkSpAttribute",
                    "SkWidth100",
                    wIsActiveField ? "SkSpAttribute--editing" : "",
                  ].filter(Boolean).join(" ")}
                  key={wItem.n || wIndex}
                >
                  <label className="SkSpAttribute-argLabel">
                    {wItem.l}
                    <span className="SkSpAttribute-argType">{wTypeHint}</span>
                  </label>
                  <div
                    className={[
                      "SkSpAttribute-field",
                      wIsEnum ? "SkSpAttribute-field--enum" : "SkSpControlPanel-formula",
                    ].join(" ")}
                    onMouseDownCapture={
                      wIsEnum
                        ? undefined
                        : (event) => this.handleAttributeFieldMouseDown(wItem.n, event)
                    }
                    onMouseDown={
                      wIsEnum && !this.m_AttributeFieldsLocked
                        ? () => this.setActiveProperty(wItem.n)
                        : undefined
                    }
                    title={wIsEnum ? "Choose a value" : "Click to edit"}
                  >
                    {wIsEnum ? (
                      <SkComboBox
                        ref={this.ensureEnumComboRef(wItem.n)}
                        className="SkComboBox--attribute-enum"
                        options={wEnumChoices}
                        value={wEnumValue}
                        onChange={(event) =>
                          this.handleEnumPropertyChange(wItem.n, event.target.value)
                        }
                        readOnly
                        showToggleButton
                        openOnFocus={!this.m_AttributeFieldsLocked}
                        disabled={this.m_AttributeFieldsLocked}
                        measureContainerWidth={false}
                        style={{
                          width: "100%",
                          minWidth: "100px",
                          pointerEvents: this.m_AttributeFieldsLocked ? "none" : "auto",
                        }}
                        listZIndex={2500}
                      />
                    ) : (
                      <SkSpInplaceEdit
                        ref={this.ensurePropertyRef(wItem.n)}
                        static="true"
                        ToolbarLike="true"
                        AcceptSelection="true"
                        SpInterface={this.m_SpInterface}
                        Id={`InplaceEditAttr_${wItem.n}`}
                        Property={wItem.n}
                        PropertyKind={wItem.k}
                        Text={wItem.v}
                        placeholder={`Enter ${wItem.l}`}
                        rows={1}
                        style={{ width: "100%", minWidth: 0, height: "100%", margin: 0 }}
                        onEditStart={this.onPropertyEditStart}
                        onTextChange={() => this.onPropertyTextChange(wItem.n)}
                      />
                    )}
                  </div>
                </div>
              );
            })
          }
            </div>
            <div className="SkSpListAttribute-actions">
              <SkButton
                onClick={this.resetEdit}
                title="Reload attribute values from the class instance"
              >
                Reset
              </SkButton>
              <SkButton
                onClick={this.confirmEdit}
                disabled={!wCanValidate}
                title={wValidateTitle}
              >
                Apply
              </SkButton>
            </div>
            {this.state.commitError ? (
              <div className="SkSpListAttribute-error" role="alert">
                {this.state.commitError}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }
}

export default SkSpClassAttribute;

/*
<Button
            onClick={this.ExexuteCode}
            variant="primary"
            size="lg" 
            active
          >Exec...</Button>
*/