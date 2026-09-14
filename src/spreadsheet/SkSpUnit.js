import React, { Component } from "react";

import "./SkSpreadSheet.css";

import SkMenuElement from "../component/SkMenuElement";
import { UNIT_MENU_FAMILIES } from "./SkUnitDefinitions";

/**
 * Applies physical / monetary units from the catalog in SkUnitDefinitions.js (aligned with SkRoot SkUnit.hpp).
 */
class SkSpUnit extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.handleApply = this.handleApply.bind(this);
  }

  async handleApply(apiFamily, apiUnit) {
    this.m_SpInterface.setExtraUndo();
    const wSelection = this.m_SpInterface.selectstr();
    window.SkUISpreadSheet.applyUnit(wSelection, apiFamily, apiUnit);
    await this.m_SpInterface.reloadView().catch((error) => {
      console.error("Error in reloadView:", error);
    });
  }

  render() {
    return (
      <div className="SkSpUnit">
        <p className="SkSpUnit-intro">
          Select a range, then pick a family and a unit (matches the SkUnit engine identifiers).
        </p>
        {UNIT_MENU_FAMILIES.map((family) => (
          <details key={family.apiFamily} className="SkSpUnit-family" open>
            <summary className="SkSpUnit-summary">{family.menuLabel}</summary>
            <div className="SkSpUnit-unitList">
              {family.units.map((u) => (
                <SkMenuElement
                  key={`${family.apiFamily}-${u.apiUnit}`}
                  onSelect={() => this.handleApply(family.apiFamily, u.apiUnit)}
                >
                  <span className="SkSpUnit-symbol">{u.symbol}</span>
                  <span className="SkSpUnit-label">{u.label}</span>
                </SkMenuElement>
              ))}
            </div>
          </details>
        ))}
      </div>
    );
  }
}

export default SkSpUnit;
