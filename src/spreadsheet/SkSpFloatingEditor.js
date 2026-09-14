//=============================================================================
// SkSpFloatingEditor — layout + attributes for the selected floating object
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent";
import SkButton from "../component/SkButton";
import SkInput from "../component/SkInput";
import SkCellClass from "./CellClass/SkCellClass";
import { parseCellRefSync } from "./SkA1Ref.js";
import {
  buildFloatingLayoutAnchorRef,
  floatingAnchorCellLabel,
  hasFloatingObjectAttributes,
} from "./SkSpFloatingObject.js";

function attributeValueHint(sTypeCode) {
  switch (sTypeCode) {
    case "i":
    case "d":
      return "(number)";
    case "s":
      return "(string)";
    case "b":
      return "(bool)";
    case "da":
      return "(date)";
    default:
      return "(value|formula|range)";
  }
}

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

function parseAnchorCellInput(sText, sSheetName) {
  const wTrim = typeof sText === "string" ? sText.trim() : "";
  if (!wTrim) {
    return null;
  }
  const wParsed = parseCellRefSync(wTrim);
  if (!wParsed) {
    return null;
  }
  let wSheet = sSheetName || "";
  let wCell = wTrim;
  if (wTrim.includes("!")) {
    const wParts = wTrim.split("!");
    wSheet = wParts[0].trim();
    wCell = wParts.slice(1).join("!").trim();
  }
  return {
    sheet: wSheet,
    row: wParsed.row,
    col: wParsed.col,
    ref: buildFloatingLayoutAnchorRef(wSheet, wCell),
  };
}

class SkSpFloatingEditor extends SkComponent {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.m_SpInterface.m_SkSpFloatingEditor = this;
    this.state = {
      objectName: "",
      className: "",
      layout: {
        dx: "0",
        dy: "0",
        w: "100",
        h: "100",
        op: "1",
        anchor: "",
      },
      properties: [],
      attributeDrafts: {},
      busy: false,
    };
  }

  componentDidMount() {
    this.onSelectionChanged();
  }

  componentWillUnmount() {
    if (this.m_SpInterface?.m_SkSpFloatingEditor === this) {
      this.m_SpInterface.m_SkSpFloatingEditor = null;
    }
    this.m_SpInterface = null;
  }

  onSelectionChanged() {
    const wEntry = this.m_SpInterface?.getSelectedFloatingObject?.();
    if (wEntry == null) {
      this.setState({
        objectName: "",
        className: "",
        layout: {
          dx: "0",
          dy: "0",
          w: "100",
          h: "100",
          op: "1",
          anchor: "",
        },
        properties: [],
        attributeDrafts: {},
      });
      return;
    }
    void this.loadEditorForEntry(wEntry);
  }

  async loadEditorForEntry(sEntry) {
    const wLayout = {
      dx: String(Number(sEntry.dx) || 0),
      dy: String(Number(sEntry.dy) || 0),
      w: String(Number(sEntry.w) || 100),
      h: String(Number(sEntry.h) || 100),
      op: String(Number(sEntry.op) || 1),
      anchor: floatingAnchorCellLabel(sEntry),
    };
    const wProperties = await this.buildPropertyRows(sEntry);
    const wDrafts = {};
    for (const wProp of wProperties) {
      wDrafts[wProp.n] = wProp.v != null ? String(wProp.v) : "";
    }
    this.setState({
      objectName: sEntry.n || "",
      className: sEntry.c || "",
      layout: wLayout,
      properties: wProperties,
      attributeDrafts: wDrafts,
    });
  }

  async buildPropertyRows(sEntry) {
    if (!hasFloatingObjectAttributes(sEntry)) {
      return [];
    }
    const wClassName = sEntry.c || sEntry.host?.c_v?.n || "";
    if (!wClassName) {
      return [];
    }
    const wUi = window.SkUISpreadSheet;
    if (wUi == null || typeof wUi.jsonCellClassByName !== "function") {
      return [];
    }
    try {
      const wJson = wUi.jsonCellClassByName(wClassName);
      if (!wJson) {
        return [];
      }
      const wModel = JSON.parse(wJson);
      const wSchema = Array.isArray(wModel?.p) ? wModel.p : [];
      const wInstance = sEntry.host?.c_v?.c?.a || [];
      const wTargetSheet =
        (typeof sEntry.t === "string" && sEntry.t.trim()) || "";
      const wHostSheet =
        (typeof sEntry.hs === "string" && sEntry.hs.trim()) || "_$$A";
      const wHostRef = SkCellClass.buildHostCellRef(
        wHostSheet,
        sEntry.hr,
        sEntry.hc,
      );
      return Promise.all(
        wSchema.map(async (item) => {
        const wObj = {
          n: item.n,
          l: typeof item.l === "string" && item.l.length > 0 ? item.l : item.n,
          t: typeof item.t === "string" ? item.t : "s",
          k: SkCellClass.propertyKindFromSchemaItem(item),
          v: "",
        };
        const wInst = wInstance.find((attr) => attr?.n === item.n);
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
        return wObj;
        }),
      );
    } catch (err) {
      console.error("SkSpFloatingEditor: buildPropertyRows failed", err);
      return [];
    }
  }

  setLayoutField = (sField, sValue) => {
    this.setState((prev) => ({
      layout: {
        ...prev.layout,
        [sField]: sValue,
      },
    }));
  };

  setAttributeDraft = (sName, sValue) => {
    this.setState((prev) => ({
      attributeDrafts: {
        ...prev.attributeDrafts,
        [sName]: sValue,
      },
    }));
  };

  applyLayout = async () => {
    if (this.state.busy || !this.state.objectName) {
      return;
    }
    const wSheet = await this.m_SpInterface.getActiveSheet();
    if (!wSheet) {
      return;
    }
    const wParsedAnchor = parseAnchorCellInput(this.state.layout.anchor, wSheet);
    if (this.state.layout.anchor.trim() !== "" && wParsedAnchor == null) {
      console.warn("SkSpFloatingEditor: invalid anchor cell", this.state.layout.anchor);
      return;
    }
    const wEntry = this.m_SpInterface.getSelectedFloatingObject();
    const wCurrentAnchor = wEntry ? floatingAnchorCellLabel(wEntry) : "";
    const wAnchorChanged =
      this.state.layout.anchor.trim() !== "" &&
      this.state.layout.anchor.trim().toUpperCase() !== wCurrentAnchor.trim().toUpperCase();
    this.setState({ busy: true });
    try {
      const wOk = await this.m_SpInterface.commitFloatingObjectLayout(
        this.state.objectName,
        {
          dx: Number(this.state.layout.dx) || 0,
          dy: Number(this.state.layout.dy) || 0,
          w: Number(this.state.layout.w) || 0,
          h: Number(this.state.layout.h) || 0,
          op: Number(this.state.layout.op) || 1,
          anchorRef: wAnchorChanged ? wParsedAnchor?.ref || "" : "",
        },
      );
      if (!wOk) {
        console.error("SkSpFloatingEditor: layout apply failed", this.state.objectName);
        return;
      }
      const wEntry = this.m_SpInterface.getSelectedFloatingObject();
      if (wEntry != null) {
        await this.loadEditorForEntry(wEntry);
      }
    } catch (err) {
      console.error("SkSpFloatingEditor: applyLayout failed", err);
    } finally {
      this.setState({ busy: false });
    }
  };

  applyAttribute = async (sPropertyName) => {
    if (this.state.busy || !this.state.objectName || !sPropertyName) {
      return;
    }
    const wValue = this.state.attributeDrafts[sPropertyName];
    const wRow = this.state.properties.find((wItem) => wItem?.n === sPropertyName);
    const wKind = wRow?.k != null ? String(wRow.k) : "";
    this.setState({ busy: true });
    try {
      const wOk = await this.m_SpInterface.commitFloatingObjectAttribute(
        this.state.objectName,
        sPropertyName,
        wValue != null ? String(wValue) : "",
        { kind: wKind },
      );
      if (!wOk) {
        console.error(
          "SkSpFloatingEditor: attribute apply failed",
          this.state.objectName,
          sPropertyName,
        );
        return;
      }
      const wEntry = this.m_SpInterface.getSelectedFloatingObject();
      if (wEntry != null) {
        await this.loadEditorForEntry(wEntry);
      }
    } catch (err) {
      console.error("SkSpFloatingEditor: applyAttribute failed", err);
    } finally {
      this.setState({ busy: false });
    }
  };

  renderLayoutField(sLabel, sField, sType = "text") {
    return (
      <label className="SkSpFloatingEditor-field">
        <span className="SkSpFloatingEditor-fieldLabel">{sLabel}</span>
        <SkInput
          type={sType}
          value={this.state.layout[sField]}
          onChange={(event) => this.setLayoutField(sField, event.target.value)}
        />
      </label>
    );
  }

  render() {
    if (!this.state.objectName) {
      return (
        <div className="SkSpFloatingEditor SkSpFloatingEditor--empty">
          Select a floating object on the sheet or in the list below.
        </div>
      );
    }

    const wBusy = this.state.busy;

    return (
      <div className="SkSpFloatingEditor">
        <div className="SkSpFloatingEditor-header">
          <div className="SkSpFloatingEditor-title">{this.state.objectName}</div>
          {this.state.className ? (
            <div className="SkSpFloatingEditor-class" title={this.state.className}>
              {this.state.className}
            </div>
          ) : null}
        </div>

        <div className="SkSpFloatingEditor-section">
          <div className="SkSpFloatingEditor-sectionTitle">Layout</div>
          <div className="SkSpFloatingEditor-grid">
            {this.renderLayoutField("Offset X", "dx", "number")}
            {this.renderLayoutField("Offset Y", "dy", "number")}
            {this.renderLayoutField("Width", "w", "number")}
            {this.renderLayoutField("Height", "h", "number")}
            {this.renderLayoutField("Opacity", "op", "number")}
            {this.renderLayoutField("Anchor", "anchor", "text")}
          </div>
          <div className="SkSpFloatingEditor-hint">
            Drag on the sheet to move; use the corner handle to resize.
          </div>
          <SkButton
            className="SkSpFloatingEditor-apply"
            onClick={this.applyLayout}
            disabled={wBusy}
            title="Apply layout to the floating object"
          >
            Apply layout
          </SkButton>
        </div>

        {this.state.properties.length > 0 ? (
          <div className="SkSpFloatingEditor-section">
            <div className="SkSpFloatingEditor-sectionTitle">Attributes</div>
            <div className="SkSpFloatingEditor-attributes">
              {this.state.properties.map((wItem) => (
                <div className="SkSpFloatingEditor-attribute" key={wItem.n}>
                  <label className="SkSpFloatingEditor-attributeLabel">
                    {wItem.l}
                    <span className="SkSpFloatingEditor-attributeType">
                      {attributeValueHint(wItem.t)}
                    </span>
                  </label>
                  <SkInput
                    value={this.state.attributeDrafts[wItem.n] ?? ""}
                    onChange={(event) =>
                      this.setAttributeDraft(wItem.n, event.target.value)
                    }
                  />
                  <SkButton
                    className="SkSpFloatingEditor-attributeApply"
                    onClick={() => this.applyAttribute(wItem.n)}
                    disabled={wBusy}
                    title={`Apply ${wItem.l}`}
                  >
                    Apply
                  </SkButton>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
}

export default SkSpFloatingEditor;
