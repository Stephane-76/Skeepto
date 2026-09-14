//=============================================================================
// SkSpFunction
// User-defined spreadsheet functions editor (secure registration).
//=============================================================================
import React from "react";
import SkButton from "../component/SkButton.js";
import SkComponent from "../component/SkComponent";
import SkMonacoEditor from "../component/SkMonacoEditor";
import { formulaUsesRegisteredNames } from "./SkSpFunctionContainer.js";

const DEFAULT_USER_FUNCTION_SCRIPT = `// Register user functions with registerUserFunction({ ... }).
// Only "pure" functions are allowed (Math, String, Date on arguments — no fetch/DOM/window).

registerUserFunction({
  name: "SUMSTR",
  label: "Sum of squares",
  family: "Script",
  nbArg: 2,
  source: "function (a, b) { return a * a + b * b; }",
});

registerUserFunction({
  name: "UPPERCASE",
  label: "Uppercase",
  family: "Script",
  nbArg: 1,
  source: "function (a) { return String(a).toUpperCase(); }",
});

registerUserFunction({
  name: "CURRENTDATE",
  label: "Today",
  family: "Script",
  nbArg: 0,
  source: "function () { return new Date(); }",
});
`;

class SkSpFunction extends SkComponent {
  constructor(props) {
    super(props);
    this.m_RefEditor = React.createRef();
    this.m_SpInterface = props.SpInterface;
    this.state = { Error: "", status: "idle" };
  }

  ExecuteCode = async () => {
    const wEditor = this.m_RefEditor.current;
    if (wEditor === null) {
      return;
    }

    wEditor.clearMarkers();
    this.setState({ Error: "", status: "running" });

    try {
      if (this.m_SpInterface && typeof this.m_SpInterface.loadWebAssembly === "function") {
        await this.m_SpInterface.loadWebAssembly();
      }
      const wContainer =
        typeof window !== "undefined" ? window.FunctionContainer : null;
      if (wContainer == null || typeof wContainer.runRegistrationScript !== "function") {
        throw new Error("FunctionContainer is not ready. Reload the spreadsheet.");
      }
      if (window.SkUISpreadSheet == null) {
        throw new Error("SkUISpreadSheet is not ready.");
      }

      const wCode = wEditor.getCode();
      const wRegistered = await wContainer.runRegistrationScript(wCode);
      if (wRegistered.length === 0) {
        throw new Error("No registerUserFunction({...}) calls found in the script.");
      }

      if (typeof window.SkUISpreadSheet.recalculateAll === "function") {
        window.SkUISpreadSheet.recalculateAll();
      }
      if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
        await this.m_SpInterface.reloadView();
      }

      // Formula entered before Run may not be in workbook JSON — re-apply from the formula bar.
      if (
        this.m_SpInterface &&
        typeof this.m_SpInterface.getCursorFormulaCached === "function" &&
        this.m_SpInterface.m_UIView?.cursor
      ) {
        const wCursor = this.m_SpInterface.m_UIView.cursor;
        const wRef = window.SkUISpreadSheet.base10toAlphaSync(wCursor.col) + wCursor.row;
        const wSheet = this.m_SpInterface.m_UIView.sheet || "";
        const wFormula = await this.m_SpInterface.getCursorFormulaCached();
        const wNames = wRegistered.map((wEntry) => wEntry.name);
        if (wFormula && formulaUsesRegisteredNames(wFormula, wNames)) {
          window.SkUISpreadSheet.value(wRef, `=${wFormula}`, wSheet);
          window.SkUISpreadSheet.recalculateAll();
          await this.m_SpInterface.reloadView();
        }
      }

      const wMessage = `OK — ${wRegistered.length} function(s) registered: ${wRegistered
        .map((wEntry) => wEntry.name)
        .join(", ")}. Formulas recompiled.`;
      this.setState({ Error: wMessage, status: "ok" });
    } catch (wError) {
      const wMessage = wError?.message || String(wError);
      wEditor.reportError(wError);
      this.setState({ Error: wMessage, status: "error" });
    }
  };

  render() {
    const wStatusClass =
      this.state.status === "error"
        ? "SkSpFunction-status SkSpFunction-status--error"
        : this.state.status === "ok"
          ? "SkSpFunction-status SkSpFunction-status--ok"
          : "SkSpFunction-status";

    return (
      <div className="SkSpFunction" style={{ height: "500px" }}>
        <div className="SkWidth100" style={{ height: "70%" }}>
          <SkMonacoEditor
            className="SkJavascriptEditor"
            ref={this.m_RefEditor}
            Code={DEFAULT_USER_FUNCTION_SCRIPT}
          />
          <div className={wStatusClass}>{this.state.Error}</div>
          <SkButton onClick={this.ExecuteCode}>Run</SkButton>
        </div>
      </div>
    );
  }
}

export default SkSpFunction;
