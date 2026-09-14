//=============================================================================
// SkWindow
// Window PopUp
//=============================================================================
import React  from "react";
import SkComponent  from "./SkComponent";
import { Max, SkRoundRect } from "../utility/SkUtility";

class SkScrollBar extends SkComponent {
    constructor(props) {
        super(props);
       
        this.m_Height=0;
        this.m_Width=0;
        this.m_Cursor="move";
        this.m_MouseDown=false;
        this.m_Diff=0;

        this.m_ClassName=props.ClassName;
        this.m_Vertical=(this.m_ClassName==="SkVScrollBar");
        this.m_ParentInterface=props.ParentInterface;
        this.m_ParentView=props.ParentView;

        //  Screen last - top
        this.m_Top=1;
        this.m_Last=1;

        // Size of all element
        this.m_SizeTotal=1;

        if(this.m_Vertical) {
            this.m_ParentInterface.initVScrollBar(this);
        } else {
            this.m_ParentInterface.initHScrollBar(this);
        }
        // Avoids untimely redisplays
        this.m_InMouseProcess=false;
    }

    componentDidMount() {
        //console.log("SkScrollBar::componentDidMount()")
        this.setState( { Pos : 1 });
        // Get Color  and font
        var wRootStyle = document.querySelector(':root');
        var wStyleComputed = getComputedStyle(wRootStyle);
        this.m_ColorThumb=wStyleComputed.getPropertyValue('--sk-scrollBar-thumb-color');
      
        // Store bound event handlers to properly remove them later
        this.boundResize = this.resize.bind(this);
        this.boundMouseDown = this.mouseDown.bind(this);
        this.boundMouseMove = this.mouseMove.bind(this);
        this.boundMouseUp = this.mouseUp.bind(this);
        this.boundMouseLeave = this.MouseLeave.bind(this);
        
        let wRoot=window;
        wRoot.addEventListener('resize', this.boundResize);
        wRoot.addEventListener('mousedown', this.boundMouseDown, true);
        wRoot.addEventListener('mousemove', this.boundMouseMove, true);
        wRoot.addEventListener('mouseup', this.boundMouseUp, true);
        wRoot.addEventListener('mouseleave', this.boundMouseLeave, true);
        this.setState({ Pos : 1});
        this.invalidate();
    }

    componentWillUnmount(prevProps) {
        //console.log("SkScrollBar::componentWillUnmount()")
        let wRoot=window;
        wRoot.removeEventListener('resize', this.boundResize);
        wRoot.removeEventListener('mousedown', this.boundMouseDown, true);
        wRoot.removeEventListener('mousemove', this.boundMouseMove, true);
        wRoot.removeEventListener('mouseup', this.boundMouseUp, true);
        wRoot.removeEventListener('mouseleave', this.boundMouseLeave, true);
    }

    _viewportSpanPx() {
        return Math.max(1e-6, this.m_Last - this.m_Top);
    }

    _sizeTotalSafe() {
        return Math.max(1, Number(this.m_SizeTotal) || 0);
    }

    SizeThumb() {
        const screenLen = this._viewportSpanPx();
        const total = this._sizeTotalSafe();
        let wSize = (screenLen / total) * this.Size();
        wSize = Max(wSize, 15);
        if (Number.isFinite(this.Size()) && wSize > this.Size()) {
            wSize = this.Size();
        }
        return wSize;
    }

    PixelToPos(sPixelPos) {
        const wSizeScreen = this._viewportSpanPx();
        const total = this._sizeTotalSafe();
        return (sPixelPos * total) / wSizeScreen;
    }

    PosToPixel(sPos) {
        const wSizeScreen = this._viewportSpanPx();
        const total = this._sizeTotalSafe();
        const maxStart = Math.max(0, total - wSizeScreen);
        const clamped = Math.min(Math.max(0, Number(sPos) || 0), maxStart);
        return (clamped * wSizeScreen) / total;
    }

    SetView(sTop,sLast,sSizeTotal) {     
        const total = Math.max(1, Number(sSizeTotal) || 0);
        if ((sTop!==this.m_Top) || (sLast!==this.m_Last) || (total!==this.m_SizeTotal)) {
            this.m_Top=sTop;
            this.m_Last=sLast;
            this.m_SizeTotal=total;
            // Avoids untimely redisplays
            if (this.m_InMouseProcess===false) {
                this.setState({
                    Pos : this.m_Top
                }, () => {
                    this.invalidate();;
                });
            }
            //console.log(this.m_ClassName, "-> SetView( Top:",sTop,", Last",sLast,", Length ", sLast-sTop, ", SizeTotal",sSizeTotal);
        }
    }

    invalidate() {
        this.Paint();
    }

    MousePos(event) {
        let wPos=this.offsetMousePos(event);
        if (this.m_Vertical) {
            return(wPos.Y);
        } else {
            return(wPos.X);      
        }   
    }

    /**
     * Position along the scrollbar track from client coordinates. Use during thumb drag so movement
     * still works when the pointer leaves the canvas (offsetX/offsetY would be wrong for other targets).
     */
    mousePosInScrollbarTrack(event) {
        const el = this.m_Ref.current;
        if (!el || event == null) {
            return null;
        }
        const rect = el.getBoundingClientRect();
        if (this.m_Vertical) {
            return event.clientY - rect.top;
        }
        return event.clientX - rect.left;
    }
    
    Size() {
        if (this.m_Vertical) {
            return(this.m_Height);
        } else {
            return(this.m_Width);      
        }   
    }

    SetPos(sPos) {
        if (sPos!==this.state.Pos) {
             //console.log(this.m_ClassName, "-> SetPos(",sPos,")")
            this.setState({ Pos : sPos});
            if (this.m_Vertical) {
                this.m_ParentInterface.setVScrollBar(sPos);
            } else {
                this.m_ParentInterface.setHScrollBar(sPos);
            }
        }
    }
    
    mouseDown(event) {
        if (this.isEventOnClass(event)) {
            // Stop the browser's default drag-select on the canvas: without it, dragging the thumb
            // starts a text selection and swaps in an I-beam/no-drop cursor that trails the pointer.
            if (typeof event.preventDefault === "function") {
                event.preventDefault();
            }
            let wMousePos=this.MousePos(event);
    
            if ((wMousePos > this.PosToPixel(this.state.Pos)) && (wMousePos < this.PosToPixel(this.state.Pos)+this.SizeThumb())) {
                this.m_MouseDown=true;
                this.m_Diff=wMousePos-this.PosToPixel(this.state.Pos);
            } else {
                this.m_MouseDown=true;
                this.m_Diff=this.SizeThumb()/2;
            }
            // Keep true until mouseup: async setV/HScrollBar + getView must not call SetView() which overwrites Pos mid-drag.
            this.m_InMouseProcess = true;
            const el = this.m_Ref.current;
            if (
                el &&
                typeof event.pointerId === "number" &&
                typeof el.setPointerCapture === "function"
            ) {
                try {
                    el.setPointerCapture(event.pointerId);
                } catch (_) {
                    /* ignore */
                }
            }
        }
    }

    mouseMove(event) {
        if (this.m_MouseDown===true) {
            const wMousePos = this.mousePosInScrollbarTrack(event);
            if (wMousePos == null || !Number.isFinite(wMousePos)) {
                return;
            }

            let wPos=this.PixelToPos(wMousePos-this.m_Diff);

            //let wPixelPos=this.PosToPixel(wPos);
            //console.log("Mouse Move wPos=",wPos," Mouse=",wMousePos," Pixel=",wPixelPos," Size=",this.Size(), " SizeTotal=",this.m_SizeTotal);

            if (wPos<1) wPos=1;
            if (wPos> this.m_SizeTotal) { 
                wPos=this.m_SizeTotal;
            }
            this.SetPos(wPos);
            this.invalidate();
        }
    }

    mouseUp(event) {
        const elCap = this.m_Ref.current;
        if (
            elCap &&
            typeof event.pointerId === "number" &&
            typeof elCap.releasePointerCapture === "function"
        ) {
            try {
                if (elCap.hasPointerCapture(event.pointerId)) {
                    elCap.releasePointerCapture(event.pointerId);
                }
            } catch (_) {
                /* ignore */
            }
        }
        const wWasDragging = this.m_MouseDown;
        this.m_MouseDown = false;
        this.m_InMouseProcess = false;
        if (!wWasDragging || !this.m_ParentInterface) {
            return;
        }
        if (this.m_Vertical) {
            if (typeof this.m_ParentInterface.finishVerticalScrollSnap === "function") {
                void this.m_ParentInterface.finishVerticalScrollSnap();
            }
        } else {
            if (typeof this.m_ParentInterface.finishHorizontalScrollSnap === "function") {
                void this.m_ParentInterface.finishHorizontalScrollSnap();
            }
        }
    }

    MouseLeave(event) {
        if (this.m_MouseDown) {
            let wClassName=event.srcElement.className;
            if  (wClassName!==this.m_ParentView.getClassName()) {
                this.m_MouseDown=false;
                this.m_InMouseProcess = false;
            }
        }
    }

    resize() {
        this.invalidate();
    }

    Paint() {
        // ** Get the canvas
        const wCanvas = this.m_Ref.current;
        if (!wCanvas) {
            return; // This probably won't happen
        }
      
      
        // Get the context for drawing ============================================
        const wContext = wCanvas.getContext("2d");

        this.m_Width= wCanvas.offsetWidth;
        this.m_Height= wCanvas.offsetHeight;
        let wRatio= this.m_ParentInterface.m_Ratio;
        
        wCanvas.width = this.m_Width * wRatio;
        wCanvas.height = this.m_Height * wRatio;
        wContext.scale(wRatio, wRatio);

        wContext.strokeStyle = this.m_ColorThumb;
        wContext.fillStyle =  this.m_ColorThumb;
        if (this.m_Vertical) {
            SkRoundRect(wContext, 1, this.PosToPixel(this.state.Pos), 9, this.SizeThumb(), 5, true);
        } else {
            SkRoundRect(wContext, this.PosToPixel(this.state.Pos),1, this.SizeThumb(),9, 5, true);
        }
    }
    render() {
        if (this.state === null) {
            return null;
        }
        // Show track only when content is taller/wider than the viewport. Do not tie visibility to
        // state.Pos (stale Pos >= SizeTotal or float mismatch used to remove the canvas entirely).
        const span = Math.max(1, this.m_Last - this.m_Top);
        const total = this._sizeTotalSafe();
        if (total <= span + 0.5) {
            return <div></div>;
        }
        return (
            <canvas style={{cursor: this.m_Cursor}} ref={this.m_Ref} id={this.m_Id} className={this.m_ClassName}></canvas>
        );
    }
      
            
}

export default SkScrollBar;