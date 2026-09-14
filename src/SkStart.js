
import React, { Component } from "react";

import "./App.css";

class SkStart extends Component {
 
  render() {
    return (
        <div className="row Space Width100">
          <div className="col-sm-4">
            <h3>Sker</h3>
            <p>Open source investment & development...</p>
          </div>
          <div className="col-sm-4">
            <h3>Lazard Bank</h3>        
            <p>Private bank backing Skeepto</p>
          </div>
          <div className="col-sm-4">
            <h3>Sker project</h3>
            <p>Spreadsheet project written in C++</p>
            <p>Includes a spreadsheet engine and an API to drive everything</p>
            <p>Available for either a desktop or a web project</p>
          </div>
          <div className="col-sm-4">
            <h3>Sker React project</h3>
            <p>Web spreadsheet UI built with React...</p>
          </div>
          <div className="col-sm-4">
            <h3>Goal</h3>        
            <p>Software creation...</p>
          </div>
        </div>
    );
  }
}
// ========================================

export default SkStart;
