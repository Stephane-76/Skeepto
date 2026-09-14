import React from "react";

import SkComponent from './component/SkComponent';
import SkWidgetInput from "./SkWidgetInput";

import "./App.css";


class SkRelationshipType extends SkComponent {
  render() {
    return (
      <SkWidgetInput widgetname='RelationshipType' tablename='RelationshipType'></SkWidgetInput>
    )
  }
}

export default SkRelationshipType;
