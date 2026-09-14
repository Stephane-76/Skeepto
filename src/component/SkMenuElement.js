//=============================================================================
// SkWindow
// Window PopUp
//=============================================================================
import React from "react";
import SkComponent  from "./SkComponent";
import './SkComponent.css'

class SkMenuElement extends SkComponent {
   constructor(props) {
    super(props);
    this.state ={ 
      Cursor : "auto",
      ClassName : "SkMenuElement SkWidth100"
    };
    this.m_onSelect=props.onSelect;
    this.m_id=props.id;
    
    this.MouseEnter = this.MouseEnter.bind(this);
    this.MouseLeave = this.MouseLeave.bind(this);

    this.MouseDown= this.mouseDown.bind(this);
  }
 
  mouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const wOnSelect = this.props.onSelect ?? this.m_onSelect;
    if (typeof wOnSelect === "function") {
      wOnSelect(event, this.m_id);
    }
  }

  MouseEnter(event) {
    this.setState( { ClassName : "SkMenuElement SkMenuSelected SkWidth100"} )
  }
  MouseLeave(event) {
    this.setState( { ClassName : "SkMenuElement SkWidth100"} )
  }
 
  render() {
    const { title, children } = this.props;
    return (
      <div
        ref={this.m_Ref}
        className={this.state.ClassName}
        title={title}
        aria-label={title}
        onMouseDown={this.MouseDown}
        onMouseEnter={this.MouseEnter}
        onMouseLeave={this.MouseLeave}
      >
        <div className={this.state.ClassName}>
          {children}
        </div>
      </div>
    );
  }
}
// ========================================

export default SkMenuElement;

