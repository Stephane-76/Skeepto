//=============================================================================
// SkCellClassButton
// Button class for spreadsheet cells
//=============================================================================
import React from "react";
import { GetTextAlign, GetVerticalTextAlign, GetFontStyle, GetFontWeight } from '../../utility/SkUtility.js'
import SkCellClass from "./SkCellClass.js"

function Render(sCell,sSpInterface) {
    return(<SkCellClassButton Cell={sCell}  key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassButton>)
}

class SkCellClassButton extends SkCellClass  {
    static ClassName() { return("SkCellClassButton") }

    // SVG icon representing a clickable button
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <defs>
                    <linearGradient id="skBtnIconGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%"   stopColor="#ffffff" />
                        <stop offset="100%" stopColor="#c8d3e0" />
                    </linearGradient>
                </defs>
                <rect x="3" y="7" width="18" height="10" rx="3" ry="3"
                      fill="url(#skBtnIconGrad)" stroke="currentColor" strokeWidth="1.2"/>
                <text x="12" y="14.5" textAnchor="middle" fontSize="6"
                      fontFamily="Roboto" fontWeight="bold" fill="currentColor">OK</text>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet,"Button","Javascript",Render);
       
    }
    
    constructor(props) {
        super(props);
        this.state = {
            isPressed: false
        };
        this.RegisterEvent("onClick",this.onClick);
    }

    onClick = (event) => {
        console.log( "onClick " + this.props.Cell);
    }

    renderButton(text, styles) {
        const { isPressed } = this.state;
        //let wCell = this.props.Cell;
        let wColor = styles.color || "#333";
        let wBackgroundColor = styles.backgroundColor || "#ffffff";
        let wFontFamily = styles.fontFamily || "Roboto";
        let wFontSize = styles.fontSize || "14px";
        let wFontWeight = styles.fontWeight || "normal";
        let wFontStyle = styles.fontStyle || "normal";
        
        return (
            <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 40"
                preserveAspectRatio="xMidYMid meet"
                xmlns="http://www.w3.org/2000/svg"
                style={{ cursor: 'pointer' }}
                onMouseDown={() => this.setState({ isPressed: true })}
                onMouseUp={() => this.setState({ isPressed: false })}
                onMouseLeave={() => this.setState({ isPressed: false })}
                onClick={() => {
                    this.m_Event["onClick"]();
                }}
            >
                {/* Gradients */}
                <defs>
                    <linearGradient id="buttonGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style={{ 
                            stopColor: isPressed ? this.adjustColor(wBackgroundColor, -20) : wBackgroundColor,
                            stopOpacity: 1 
                        }} />
                        <stop offset="100%" style={{ 
                            stopColor: isPressed ? this.adjustColor(wBackgroundColor, -40) : this.adjustColor(wBackgroundColor, -20),
                            stopOpacity: 1 
                        }} />
                    </linearGradient>
                    
                    {/* Shine effect */}
                    <linearGradient id="shineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 0.5 }} />
                        <stop offset="100%" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                    </linearGradient>
                </defs>

                {/* Shadow */}
                <defs>
                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation={isPressed ? 0.5 : 1} result="shadow" />
                        <feOffset dx={isPressed ? 0.5 : 1} dy={isPressed ? 0.5 : 1} />
                    </filter>
                </defs>

                {/* Main rectangle */}
                <rect
                    x={isPressed ? 3 : 2}
                    y={isPressed ? 3 : 2}
                    width={isPressed ? 94 : 96}
                    height={isPressed ? 34 : 36}
                    rx="6"
                    ry="6"
                    fill="url(#buttonGradient)"
                    stroke={wColor}
                    strokeWidth="1"
                    filter="url(#shadow)"
                />

                {/* Shine effect */}
                <rect
                    x={isPressed ? 3 : 2}
                    y={isPressed ? 3 : 2}
                    width={isPressed ? 94 : 96}
                    height={isPressed ? 17 : 18}
                    rx="6"
                    ry="6"
                    fill="url(#shineGradient)"
                    style={{ opacity: isPressed ? 0.3 : 0.5 }}
                />

                {/* Text */}
                <text
                    x="50"
                    y={isPressed ? 25 : 24}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={wColor}
                    fontFamily={wFontFamily}
                    fontSize={wFontSize}
                    fontWeight={wFontWeight}
                    fontStyle={wFontStyle}
                    textDecoration={styles.textDecoration || 'none'}
                >
                    {text || 'Button'}
                </text>
            </svg>
        );
    }

    // Add this utility method to adjust colors
    adjustColor(color, amount) {
        // Convert color to RGB if it's in hexadecimal format
        let r, g, b;
        if (color.startsWith('#')) {
            r = parseInt(color.slice(1, 3), 16);
            g = parseInt(color.slice(3, 5), 16);
            b = parseInt(color.slice(5, 7), 16);
        } else if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            r = parseInt(matches[0]);
            g = parseInt(matches[1]);
            b = parseInt(matches[2]);
        } else {
            return color; // Return original color if format not supported
        }

        // Adjust components
        r = Math.max(0, Math.min(255, r + amount));
        g = Math.max(0, Math.min(255, g + amount));
        b = Math.max(0, Math.min(255, b + amount));

        // Convert to hexadecimal
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wText = wStyles.displayValue || "Button";
        const wInset = wStyles.inset ?? 2;
        const wBx = wInset;
        const wBy = wInset;
        const wBw = Math.max(0, width - wInset * 2);
        const wBh = Math.max(0, height - wInset * 2);
        const wBg =
            wStyles.backgroundColor && wStyles.backgroundColor !== "transparent"
                ? wStyles.backgroundColor
                : "#ffffff";
        const wColor = wStyles.color || "#333333";
        const wGrad = ctx.createLinearGradient(0, wBy, 0, wBy + wBh);
        wGrad.addColorStop(0, this.adjustColor(wBg, 0));
        wGrad.addColorStop(1, this.adjustColor(wBg, -20));
        ctx.fillStyle = wGrad;
        ctx.strokeStyle = wColor;
        ctx.lineWidth = 1;
        SkCellClass.roundRectPath(ctx, wBx, wBy, wBw, wBh, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        SkCellClass.roundRectPath(ctx, wBx, wBy, wBw, wBh / 2, 6);
        ctx.fill();
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(wText, width / 2, height / 2);
    }

    render() {
        let wCell=this.props.Cell;
        // Set default value
       
        const wZIndex = 3;

        let wFontName="Roboto";
        let wFontSize=12;
        let wPadding="0px";
        let wColor="black";
        let wTextAlign="end"; // Default Right
        let wVerticalTextAlign="end"; // Default Bottom
        let wBackgroundColor="transparent";
        let wTextDecoration="";
        let wFontStyle="";
        let wFontWeight="";
        
        // Padding 
        if (wCell.f_p!=="") {
            wPadding=wCell.f_p;
        }
       
        // Formatted value
        if (wCell.hasOwnProperty("f_value")) {
            if (wCell.f_value!==null) {
             //wCellText=String(wCell.f_value) // IMPORTANT BUG OBJECT;
            }
        }
        // Color
        if (wCell.hasOwnProperty("f_c")) {
            wColor=wCell.f_c; 
        }
        // Background Color
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor=wCell.f_bc; 
        }
        // Horizontal Align
        if (wCell.hasOwnProperty("f_ah")) {
            wTextAlign=GetTextAlign(wCell.f_ah); 
        }
        // Vertical Align
        if (wCell.hasOwnProperty("f_av")) {
            wVerticalTextAlign=GetVerticalTextAlign(wCell.f_av); 
        }
        // Underline Line-through
        if (wCell.hasOwnProperty("f_d_u")) {
            wTextDecoration="underline"; 
        }
        if (wCell.hasOwnProperty("f_d_l")) {
            if (wTextDecoration!=="") {
            wTextDecoration=wTextDecoration+" line-through";
            } else {
            wTextDecoration="line-through";
            } 
        }
        // Italic
        if (wCell.hasOwnProperty("f_st")) {
            wFontStyle=GetFontStyle(wCell.f_st); 
        }
        // Bold
        if (wCell.hasOwnProperty("f_we")) {
            wFontWeight=GetFontWeight(wCell.f_we); 
        }
        // Font Name
        if (wCell.hasOwnProperty("f_f_n")) {
            wFontName=wCell.f_f_n;
        }
        // Font Size
        if (wCell.hasOwnProperty("f_f_s")) {
            wFontSize=wCell.f_f_s;
        }
        const wCellInset = 2;
        const wOverlay = this.CellClassClippedOverlayLayout({ inset: wCellInset });

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            display: 'inline-block',
            zIndex : wZIndex,
            padding: wPadding,
            alignItems: wVerticalTextAlign,
            justifyContent : wTextAlign,
            backgroundColor: wBackgroundColor,
        };

        const wCellStyleInner = {
            ...wOverlay.innerStyle,
        };

        return (
            <div
                style={wCellStyleParent}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wCellStyleInner}>
                    {this.renderButton(wCell.f_value, {
                        color: wColor,
                        backgroundColor: wBackgroundColor,
                        fontFamily: wFontName,
                        fontSize: wFontSize + "px",
                        fontWeight: wFontWeight,
                        fontStyle: wFontStyle,
                        textDecoration: wTextDecoration,
                        textAlign: wTextAlign,
                        verticalAlign: wVerticalTextAlign,
                        zIndex : wZIndex
                    })}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassButton);

// ============================================================================
export default SkCellClassButton;