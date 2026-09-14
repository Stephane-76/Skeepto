import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetInput from "./SkWidgetInput";

import "./App.css";


class SkUser extends SkComponent {
  render() {
    return (
    <SkWidgetInput widgetname='User' tablename='User'></SkWidgetInput>
    )
  }
}
// ========================================

export default SkUser;