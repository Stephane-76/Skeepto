//=============================================================================
// SkWindow
// Window PopUp
//=============================================================================
import  React from "react";
import { createPortal } from "react-dom";
import SkComponent  from "./SkComponent";
import { alignPopupWithinViewport } from "../utility/SkUtility.js";

class SkMenuPopUp extends SkComponent {
   constructor(props) {
    super(props);
    this.state ={ 
      Cursor : "auto"
    };
    
    this.m_MouseDown=false;

    this.m_AutoClose=true;
    if (this.props.autoClose !== undefined) {
      this.m_AutoClose=false
    }
  

    this.state = ({
      Pos: { x: 10, y: 10 },
      openUpward: false,
      useFixed: false,
      useBottomAnchor: false,
      alignRight: false,
    });
    this.m_onClose=this.props.onClose;
 }
  
  componentDidUpdate(prevProps) {
    if (this.props.Visible && !prevProps.Visible && this.state.useFixed) {
      requestAnimationFrame(() => {
        if (this.m_Ref.current) {
          alignPopupWithinViewport(this.m_Ref.current);
        }
      });
    }
  }
  
  componentDidMount() {
    // Store bound event handlers to properly remove them later
    this.boundMouseDown = this.mouseDown.bind(this);
    this.boundMouseMove = this.mouseMove.bind(this);
    this.boundMouseUp = this.mouseUp.bind(this);
    
    const wRoot = window; 
    wRoot.addEventListener('mousedown', this.boundMouseDown);
    wRoot.addEventListener('mousemove', this.boundMouseMove);
    wRoot.addEventListener('mouseup', this.boundMouseUp);  
  }

  componentWillUnmount(prevProps) {
    const wRoot = window; 
    wRoot.removeEventListener('mousedown', this.boundMouseDown);
    wRoot.removeEventListener('mousemove', this.boundMouseMove);
    wRoot.removeEventListener('mouseup', this.boundMouseUp);
  }
    
  SetPos(event,sDiff) {
    let wDiff = { x :0, y:0 } ;
    if (sDiff!=null) {
      wDiff = sDiff;
    }
    // Use viewport (client) coordinates + fixed positioning via a portal to
    // <body> (see render()/useFixed). This keeps the popup at its natural size
    // and screen position regardless of the CSS `zoom` applied to .SkSpreadSheet
    // (grid, left/top headers) — otherwise the menu scaled with the sheet zoom.
    let wX=event.clientX+wDiff.x;
    let wY=event.clientY+wDiff.y;

    this.setState({
      Pos: { x: wX, y: wY },
      useFixed: true,
      useBottomAnchor: false,
      openUpward: false,
      alignRight: false,
    });
  }

  /** Position popup above an anchor rect (viewport coords); uses portal + fixed layout. */
  SetPosAnchor(anchorRect, options = {}) {
    if (!anchorRect) {
      return;
    }
    const wGap = options.gap ?? 4;
    // Cap the popup to the space actually available above the anchor button so a long list
    // (many sheets) stays fully visible and scrolls instead of being clipped by the viewport.
    const wViewportMargin = 8;
    const wMaxHeight = Math.max(
      120,
      anchorRect.top - wGap - wViewportMargin
    );
    this.setState({
      Pos: {
        x: options.alignRight ? anchorRect.right : anchorRect.left,
        y: window.innerHeight - anchorRect.top + wGap,
      },
      openUpward: true,
      useFixed: true,
      useBottomAnchor: true,
      alignRight: options.alignRight === true,
      maxHeight: wMaxHeight,
    });
  }
  
  mouseDown(event) {
    if (!this.m_Ref.current) return;
    //console.log("PopUp client --->",event.clientX,",",event.clientY);
    //console.log("PopUp layer --->",event.layerX,",",event.layerY);
    //const wContainerRect = this.m_Ref.current.getBoundingClientRect();
    //var wDiff = { x : event.clientX-wContainerRect.x, y : event.clientY-wContainerRect.y };
    //console.log("PopUp Diff --->",wDiff);
    
    if (this.isEventOnClass(event)) {
      this.m_MouseDown=true;
      let wPos={x : event.clientX, y : event.clientY};
      //console.log ("Down",wPos);
      this.setState( this.state.Pos = wPos);
    } else {
      this.m_onClose();
    }
  }

  mouseMove(event) {
    if (this.m_MouseDown) {
        let wPos={x : event.clientX, y : event.clientY};
        this.setState( this.state.Pos = wPos);
        //console.log ("Move",wPos);
    }
  }

  mouseUp(event) {
    this.m_MouseDown=false;
  }
  

  render() {
    if (this.props.Visible !== true) {
      return null;
    }

    const wLeft = `${this.state.Pos.x}px`;
    const wBottom = `${this.state.Pos.y}px`;
    const wClassName =
      "SkMenuPopUp SkFlexColumn" +
      (this.state.useBottomAnchor ? " SkMenuPopUp--anchorBottom" : "") +
      (this.state.openUpward && !this.state.useBottomAnchor ? " SkMenuPopUp--openUpward" : "") +
      (this.state.useFixed ? " SkMenuPopUp--fixed" : "") +
      (this.state.alignRight ? " SkMenuPopUp--alignRight" : "");

    const wStyle = this.state.useBottomAnchor
      ? {
          left: this.state.alignRight ? "auto" : wLeft,
          right: this.state.alignRight ? `${window.innerWidth - this.state.Pos.x}px` : "auto",
          bottom: wBottom,
          top: "auto",
          ...(this.state.maxHeight != null
            ? { maxHeight: `${this.state.maxHeight}px`, overflowY: "auto" }
            : {}),
        }
      : { left: wLeft, top: `${this.state.Pos.y}px` };

    const wPopup = (
      <div ref={this.m_Ref} className={wClassName} style={wStyle}>
        {this.props.children}
      </div>
    );

    if (this.state.useFixed) {
      return createPortal(wPopup, document.body);
    }
    return <div>{wPopup}</div>;
  }
}
// ========================================

export default SkMenuPopUp;
