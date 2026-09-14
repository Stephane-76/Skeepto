import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetInput from "./SkWidgetInput";

import "./App.css";


class SkGroup extends SkComponent {
  render() {
    return (
    <SkWidgetInput widgetname='Group' tablename='Group'></SkWidgetInput>
    )
  }
}
// ========================================

export default SkGroup;