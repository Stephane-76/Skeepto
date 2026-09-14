import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetGrid from "./SkWidgetGrid";

import "./App.css";


class SkUserGrid extends SkComponent {
  render() {
    return (
    <SkWidgetGrid widgetname='User' tablename='User'></SkWidgetGrid>
    )
  }
}
// ========================================

export default SkUserGrid;