
import * as React  from "react";
import { stringToStyles,SkComponent } from './component/SkComponent'

import "./App.css"


export class SkWidgetCard extends SkComponent {
  constructor(props) {
    super(props)
    this.m_Form=props.widget
    this.m_Record=props.record
    this.m_Index=props.index;
    this.m_OnCardSelect=props.onCardSelect;
    this.setState( {   
      Record : this.m_Record,
    });
  }

  RenderField(sField) {
    switch(sField.m_TypeField) {
      case 'string' : {
        return(
          <div className={sField.m_Style} key={sField.m_Name} id={"C_"+sField.m_Name}>
            <div 
            id={sField.m_Name} 
            key={sField.m_Name} 
            style={stringToStyles(sField.m_Styles)}>
              {this.m_Record[sField.m_Name]}
          </div>
          </div>
        )
      }
      default : break;
    }
  }

  RenderGroup(sGroup) {
    let wDirection='SkFlexColumn'
    if (sGroup.hasOwnProperty('m_Direction')) {
      if (sGroup.m_Direction==='row') wDirection='SkFlexRow'
    }
    return(
      <div  key={sGroup.m_Name}  style={stringToStyles(sGroup.m_Styles)} className={sGroup.m_Style}>
      <h4>{sGroup.m_Label}</h4>
      <div className={"SkFlex "+wDirection}>
      {        
        // Loop on field
        sGroup.m_Fields.map(wField  => (
            this.RenderField(wField)
         ))
      }
      </div>
      </div>
    )
  }

  render() {
    let wClassName=this.props.className;
    if (this.m_Form.hasOwnProperty('m_StyleWidget'))
       wClassName=wClassName+" "+this.m_Form.m_StyleWidget
    return (
      <div ref={this.m_Ref} className={wClassName} onClick={() => this.m_OnCardSelect(this.m_Index)}>
        {
        this.m_Form.m_Groups.map(wGroup => (
          this.RenderGroup(wGroup))) 
      }
      </div>
    )
  }
}
// ========================================

export default SkWidgetCard;