//=============================================================================
// SkSpRightPanel
// Anscestor RightPanel
//=============================================================================
import React, { createRef } from 'react';
import SkComponent  from "../component/SkComponent";
import { LogMessage } from "../component/SkLogMessage";


class SkSpRightPanel extends SkComponent {
  constructor(props) {
    super(props);
    this.m_Size=300;
    this.state = {
      invalidate : false
    };
    this.m_Click=false;
    this.m_SpInterface=props.SpInterface;
    this.ShowHideCommand = this.ShowHideCommand.bind(this);
  }

  componentDidMount(prevProps) {
    //console.log( "SkRightPanel::componentDidMount()");
    
    // Store bound event handlers to properly remove them later
    this.boundResize = this.resize.bind(this);
    this.boundMouseDown = this.mouseDown.bind(this);
    this.boundMouseMove = this.mouseMove.bind(this);
    this.boundMouseUp = this.mouseUp.bind(this);
    
    this.m_Ref.current.addEventListener('resize', this.boundResize);
    // Anchor on Windon
    const wRoot = window; 
    wRoot.addEventListener('mousedown', this.boundMouseDown);
    wRoot.addEventListener('mousemove', this.boundMouseMove);
    wRoot.addEventListener('mouseup', this.boundMouseUp);
    var wRootStyle = document.querySelector(':root');
    let wProperty=getComputedStyle(wRootStyle).getPropertyValue('--sk-command-size').trim()
    console.log( "--sk-command-size " + wProperty);
    this.m_Size = parseFloat(wProperty);

  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes all event listeners (resize, mouse events)
   * - Resets component state
   */
  componentWillUnmount(prevProps) {
    console.log( "SkRightPanel::componentWillUnmount()");
    
    // Clean up all event listeners using stored bound references
    if (this.m_Ref.current) {
      this.m_Ref.current.removeEventListener('resize', this.boundResize);
    }
    
    // Clean up window event listeners
    const wRoot = window;
    wRoot.removeEventListener('mousedown', this.boundMouseDown);
    wRoot.removeEventListener('mousemove', this.boundMouseMove);
    wRoot.removeEventListener('mouseup', this.boundMouseUp);
    
    // Reset component state
    this.m_Click = false;
    
    // Clean up other references
    this.m_SpInterface = null;
  }

  mouseRelative(event) {
    // Get the bounding rectangle of the parent container
    const rect = this.m_Ref.current.getBoundingClientRect();
    // Calculate the position relative to the parent container
    const X = event.clientX - rect.left; 
    const Y = event.clientY - rect.top;  
    return { X,Y }
  }

  // Start resizing
  mouseDown(event) {
    if (this.isEventOnClass(event)) {
      this.m_Pos=this.mouseRelative(event);
      this.m_Diff=this.m_Pos;
      this.m_Click=true;
    }
  };
  
  // Function to handle resizing the box
  mouseMove(event) {
    if (this.isEventOnClass(event)) {
      if (this.m_Click) { // Change size only if we are resizing
        this.m_Diff=this.mouseRelative(event);
        let wDiff=this.m_Pos.X-this.m_Diff.X;
        
        if ((wDiff!==0)&&(this.m_Size+wDiff>=0)) {
          console.log( "ChangeSize: " + this.m_Pos);   
          this.m_Size=this.m_Size+wDiff*2;   
          this.modifySize();
          this.m_Pos=this.m_Diff;
        }
      }
    }
  };


  // End resizing
  mouseUp(event) {
    this.m_Click=false;
  };
  
  modifySize() {
    return;
    var wRootStyle = document.querySelector(':root');
    this.setState({ invalidate : !this.state.invalidate });
    let wInterface=this.m_SpInterface;
    let wOldSize = getComputedStyle(wRootStyle).getPropertyValue('--sk-command-size').trim();
    console.log( "ChangeSize: " + this.m_Size + '/' + wOldSize);
    let wNewSize=this.m_Size+"px";
    wRootStyle.style.setProperty('--sk-command-display', 'flex');
    wRootStyle.style.setProperty('--sk-command-size',`${wNewSize}`);
    wRootStyle.style.setProperty('--sk-command-animation', 'stop');
  
    wInterface.reloadView()
      .then(() => {
        let wProperty=getComputedStyle(wRootStyle).getPropertyValue('--sk-command-size').trim()
        console.log( "--sk-command-size " + wProperty);
        this.m_Size = parseFloat(wProperty);
      })
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }  

  ShowHideCommand(event) {
    var wRootStyle = document.querySelector(':root');
    this.setState({ invalidate : !this.state.invalidate });
    let wInterface=this.m_SpInterface;
    let wNewSize="30%";
    if (this.state.invalidate) {
      wRootStyle.style.setProperty('--sk-command-display', 'none');
      wRootStyle.style.setProperty('--sk-command-size', '0%');
      wRootStyle.style.setProperty('--sk-command-animation', 'stop');
    } else {
      wRootStyle.style.setProperty('--sk-command-display', 'flex');
      wRootStyle.style.setProperty('--sk-command-size',`${wNewSize}`);
      wRootStyle.style.setProperty('--sk-command-animation', 'start');
    }
    
    wInterface.reloadView()
      .then(() => {
        return wInterface.reloadView();
      })
      .then(() => {
        let wProperty=getComputedStyle(wRootStyle).getPropertyValue('--sk-command-size').trim()
        console.log( "--sk-command-size " + wProperty);
        this.m_Size = parseFloat(wProperty);
      })
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }

  resize() {
    this.m_SpInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }
  
  render() {
    return (
      <div ref={this.m_Ref}  className="SkSpRightPanel">
        <svg onClick={this.ShowHideCommand} width="24" height="24">
          <circle cx="12" cy="12" r="8" stroke="black" strokeWidth="1" fill="white" />
        </svg>
      </div>);
  }


}
// ============================================================================
export default SkSpRightPanel;