//=============================================================================
// SkComponent
// Anscestor Component
//=============================================================================
import React, { Component } from "react";

import './SkComponent.css'


export function stringToStyles(sStyles) {
  if (sStyles===undefined) return ({})
  const wStyleCss = `{${sStyles
      .replace(/'/g, '"')
      .replace(";", "")
  }}`;
      
  let wObjStyles={}
  try {
   wObjStyles = JSON.parse(wStyleCss);
  } catch (sError) {
      console.error( sError + " --> " + wStyleCss);
  } 
  const keyValues = Object.keys(wObjStyles).map((key) => {
      var camelCased = key.replace(/-[a-z]/g, (g) => g[1].toUpperCase());
      return { [camelCased]: wObjStyles[key] };
  });
  return Object.assign({}, ...keyValues);
}

export class SkComponent extends Component {
  constructor(props) {
    super(props);
    // don't forget <div ref={this.m_Ref}> to children 
    this.m_Ref = React.createRef();
  }


  getClassName() {
    if (this.m_Ref.current==null) return("");
    return(this.m_Ref.current.className);
  }

  isEventTarget(event) {
    if (!this.m_Ref.current) return(false);
    return(event.target===this.m_Ref.current);
  }

  isEventOnClass(event) {
    let wClassName = event.srcElement.className;
    const cnStr =
      typeof wClassName === 'string'
        ? wClassName
        : wClassName && typeof wClassName.baseVal === 'string'
          ? wClassName.baseVal
          : '';
    if (cnStr !== '') {
      if (cnStr === this.getClassName()) {
        return true;
      }
    }
    return false;
  }

  isMouseInComponent(event) {
    if (!this.m_Ref.current) return false;
    
    const rect = this.m_Ref.current.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  offsetMousePos(event) {
    //console.log("X=", event.offsetX, " Y=", event.offsetY);
    return( { X : event.offsetX , Y : event.offsetY });
  }

  clientMousePos(event) {
    //console.log("X=", event.offsetX, " Y=", event.offsetY);
    return( { X : event.clientX , Y : event.clientY });
  }

}

// ============================================================================
export default SkComponent;
