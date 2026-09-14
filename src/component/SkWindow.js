//=============================================================================
// SkWindow
// Window PopUp
//=============================================================================
import React  from "react";

import SkComponent  from "./SkComponent";

class SkWindow extends SkComponent {
   constructor(props) {
    super(props);
    this.state ={ Cursor : "auto" };
    this.m_MouseDown=false;
    this.state = ({  Pos : { x :600, y:100 } });
    this.m_Diff = { x :0, y:0 } ;
 }
  
  componentDidMount() {
    this.m_Ref.current.addEventListener('mousedown', this.mouseDown.bind(this));
    this.m_Ref.current.addEventListener('mousemove', this.mouseMove.bind(this));
    this.m_Ref.current.addEventListener('mouseup', this.mouseUp.bind(this));
  }

  componentWillUnmount(prevProps) {
    this.m_Ref.current.removeEventListener('mousedown', this.mouseDown.bind(this));
    this.m_Ref.current.removeEventListener('mousemove', this.mouseMove.bind(this));
    this.m_Ref.current.removeEventListener('mouseup', this.mouseUp.bind(this));
  }

  mouseDown(event) {
    if (this.isEventTarget(event)) {
      this.m_MouseDown=true;
      const wContainerRect = this.m_Ref.current.getBoundingClientRect();
      this.m_Diff = { x : event.clientX-wContainerRect.x, y : event.clientY-wContainerRect.y };
      console.log( "Diff " + this.m_Diff);
      let wPos={x : event.clientX, y : event.clientY};
      console.log( "Down " + wPos);
      this.setState( this.state.Pos = wPos);
    }
  }

  mouseMove(event) {
    if (this.m_MouseDown) {
        let wPos={x : event.clientX, y : event.clientY};
        this.setState( this.state.Pos = wPos);
        console.log( "Move " + wPos);
    }
  }

  mouseUp(event) {
    this.m_MouseDown=false;
  }
  
  invalidate() {
    this.paint();  
  }

  render() {
    let wLeft = (this.state.Pos.x-this.m_Diff.x) + 'px';
    let wTop = (this.state.Pos.y-this.m_Diff.y) +'px';
    //console.log( "-----> " + wLeft + " " + wTop);
    return (
    <div ref={this.m_Ref}  style={{ left : wLeft, top : wTop}} className="SkWindow">
        <h1>Float</h1>
    </div>);
  }
}
// ========================================

export default SkWindow;