import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetInput from "./SkWidgetInput";

import "./App.css";


class SkRelationship extends SkComponent {
  render() {
    return (
      <SkWidgetInput widgetname='Relationship' tablename='Relationship'></SkWidgetInput>
    )
  }
}

export default SkRelationship;
