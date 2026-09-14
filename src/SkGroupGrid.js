import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetGrid from "./SkWidgetGrid";

import "./App.css";


class SkGroupGrid extends SkComponent {
  render() {
    return (
    <SkWidgetGrid widgetname='Group' tablename='Group'></SkWidgetGrid>
    )
  }
}
// ========================================

export default SkGroupGrid; 