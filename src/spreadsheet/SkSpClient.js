//=============================================================================
// SkSpClient
// Container SpreadSheet 
//=============================================================================
import React, { Component } from "react";

import './SkSpreadSheet.css'

import SkSpLeftPanel from "./SkSpLeftPanel";
import SkSpGridCanvas from "./SkSpGridCanvas";

class SkSpClient extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface=props.SpInterface;
  }

  render() { 
    return (
      <div className="SkSpClient">
      <SkSpLeftPanel SpInterface={this.m_SpInterface }></SkSpLeftPanel>
      <SkSpGridCanvas SpInterface={this.m_SpInterface }></SkSpGridCanvas>
      </div>

    );
  }
}
// ========================================
/*
      <SkSpLeftPanel></SkSpLeftPanel>
      <SkSpGridPanel></SkSpGridPanel>

*/

export default SkSpClient;