import React from "react";
import SkComponent from "./SkComponent";
import SkColor from "./SkColor";
import './SkBorder.css'
import SkMenuElement from "./SkMenuElement";

import { ReactComponent as SvgBorderLeft } from "../svg/border_left.svg";
import { ReactComponent as SvgBorderTop } from "../svg/border_top.svg";
import { ReactComponent as SvgBorderRight } from '../svg/border_right.svg'
import { ReactComponent as SvgBorderBottom } from "../svg/border_bottom.svg";
import { ReactComponent as SvgBorderAll } from "../svg/border_all.svg";
import { ReactComponent as SvgBorderNone } from "../svg/border_none.svg";
import { ReactComponent as SvgBorderOutside } from "../svg/border_outside.svg";
import { ReactComponent as SvgBorderInside } from "../svg/border_inside.svg";
import { ReactComponent as SvgBorderHorizontal } from "../svg/border_horizontal.svg";
import { ReactComponent as SvgBorderVertical } from "../svg/border_vertical.svg";

class SkBorder extends SkComponent {
 
    constructor(props) {
        super(props);
        this.m_SpInterface = props.SpInterface;
        console.log("SkBorder::constructor");
        this.state = ({ 
            borderColor: "#000000",
            borderStyle: "solid",
            borderSize: "1px",
            showColorPicker: false,
            showStylePicker: false,
            showSizePicker: false
        });
      
        this.onSelect = this.onSelect.bind(this);
        this.onColorChange = this.onColorChange.bind(this);
        this.onStyleChange = this.onStyleChange.bind(this);
        this.onSizeChange = this.onSizeChange.bind(this);
        
        // Create ref for the component
        this.componentRef = React.createRef();
    }

    componentDidMount() {
        console.log("SkBorder::componentDidMount");
        // Add global click handler to close dropdowns when clicking outside
        document.addEventListener('click', this.handleGlobalClick);
    }

    componentWillUnmount() {
        // Remove global click handler
        document.removeEventListener('click', this.handleGlobalClick);
    }

    handleGlobalClick = (event) => {
        // Check if click is outside the component
        if (!this.componentRef.current || !this.componentRef.current.contains(event.target)) {
            this.setState({
                showStylePicker: false,
                showSizePicker: false
            });
        }
    }

    // Prevent event propagation to parent popup
    handleComponentClick = (event) => {
        event.stopPropagation();
        event.preventDefault();
    }

    // Enhanced event handlers for popup context
    handleStylePickerClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setState(prevState => ({ 
            showStylePicker: !prevState.showStylePicker,
            showColorPicker: false,
            showSizePicker: false
        }));
    }

    handleSizePickerClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setState(prevState => ({ 
            showSizePicker: !prevState.showSizePicker,
            showColorPicker: false,
            showStylePicker: false
        }));
    }

    onSelect = async (event, id) => {
        console.log("SkBorder::onSelect called");
        console.log("Border: " + id);
        this.m_SpInterface.setExtraUndo();
        await this.m_SpInterface.applyBorder(
            parseInt(id),
            this.state.borderColor,
            this.state.borderStyle,
            this.state.borderSize
        );
        await this.m_SpInterface.reloadView();
        // Close the parent toolbar popup after applying a border (Excel UX:
        // the picker dismisses itself once an action has been chosen).
        if (typeof this.props.onApply === "function") {
            this.props.onApply();
        }
    }

    onColorChange = (color) => {
        console.log("Border color changed to:", color);
        this.setState({ borderColor: color });
    }

    onStyleChange = (style) => {
        console.log("Border style changed to:", style);
        this.setState({ borderStyle: style });
    }

    onSizeChange = (size) => {
        console.log("Border size changed to:", size);
        this.setState({ borderSize: size });
    }

    toggleColorPicker = () => {
        this.setState(prevState => ({ 
            showColorPicker: !prevState.showColorPicker,
            showStylePicker: false,
            showSizePicker: false
        }));
    }

    toggleStylePicker = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setState(prevState => ({ 
            showStylePicker: !prevState.showStylePicker,
            showColorPicker: false,
            showSizePicker: false
        }));
    }

    toggleSizePicker = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setState(prevState => ({ 
            showSizePicker: !prevState.showSizePicker,
            showColorPicker: false,
            showStylePicker: false
        }));
    }

    // Enhanced option click handlers
    handleStyleOptionClick = (style, event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onStyleChange(style);
        this.setState({ showStylePicker: false });
    }

    handleSizeOptionClick = (size, event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onSizeChange(size);
        this.setState({ showSizePicker: false });
    }

    // Enhanced dropdown click handler
    handleDropdownClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
    }

    // Enhanced border button click handler
    handleBorderButtonClick = (event, id) => {
        event.preventDefault();
        event.stopPropagation();
        this.onSelect(event, id);
    }



    // Enhanced section click handler
    handleSectionClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
    }

    // Enhanced color container click handler
    handleColorContainerClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
    }

    render() {
        console.log("SkBorder::render");
        const { borderColor, borderStyle, borderSize, showStylePicker, showSizePicker } = this.state;

        // Border styles available
        const borderStyles = [
            { value: "none", label: "None", preview: "—" },
            { value: "hidden", label: "Hidden", preview: "□" },
            { value: "solid", label: "Solid", preview: "━" },
            { value: "dashed", label: "Dashed", preview: "┄┄" },
            { value: "dotted", label: "Dotted", preview: "┈┈" },
            { value: "double", label: "Double", preview: "═" },
            { value: "groove", label: "Groove", preview: "┃" },
            { value: "ridge", label: "Ridge", preview: "┃" },
            { value: "inset", label: "Inset", preview: "┃" },
            { value: "outset", label: "Outset", preview: "┃" }
        ];

        // Border sizes available
        const borderSizes = [
            { value: "1px", label: "1px" },
            { value: "2px", label: "2px" },
            { value: "3px", label: "3px" },
            { value: "4px", label: "4px" },
            { value: "5px", label: "5px" },
            { value: "6px", label: "6px" }
        ];

        return (
            <div
                className={`SkBorder${this.props.embedded ? ' SkBorder--embedded' : ''}`}
                ref={this.componentRef}
                onClick={this.handleComponentClick}
            >
                {/* Border type buttons */}
                <div className="SkBorder-section" onClick={this.handleSectionClick}>
                    <h4 className="SkSpPanelTitle">Border Types</h4>
                    <div className="SkBorder-buttons">
                        <SkMenuElement id="1" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="All borders">
                            <SvgBorderAll className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="0" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="No border">
                            <SvgBorderNone className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="2" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Left border">
                            <SvgBorderLeft className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="4" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Top border">
                            <SvgBorderTop className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="8" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Right border">
                            <SvgBorderRight className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="16" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Bottom border">
                            <SvgBorderBottom className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="32" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Outside borders">
                            <SvgBorderOutside className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="64" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Inside borders">
                            <SvgBorderInside className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="128" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Horizontal borders">
                            <SvgBorderHorizontal className="SkSvg" />
                        </SkMenuElement>
                        <SkMenuElement id="256" onSelect={(event, id) => this.handleBorderButtonClick(event, id)} title="Vertical borders">
                            <SvgBorderVertical className="SkSvg" />
                        </SkMenuElement>
                    </div>
                </div>

                {/* Border style selector */}
                <div className="SkBorder-section" onClick={this.handleSectionClick}>
                    <h4 className="SkSpPanelTitle">Border Style</h4>
                    <div className="SkBorder-styleSelector">
                        <button 
                            className="SkBorder-styleButton"
                            onClick={this.handleStylePickerClick}
                            title="Border style"
                        >
                            <span className="SkBorder-stylePreview" style={{
                                borderBottom: `${borderSize} ${borderStyle} ${borderColor}`
                            }}>
                                {borderStyles.find(s => s.value === borderStyle)?.preview || "━"}
                            </span>
                            <span className="SkBorder-styleLabel">
                                {borderStyles.find(s => s.value === borderStyle)?.label || "Style"}
                            </span>
                            <span className="SkBorder-dropdownArrow">▼</span>
                        </button>
                        
                        {showStylePicker && (
                            <div className="SkBorder-styleDropdown" onClick={this.handleDropdownClick}>
                                {borderStyles.map((style) => (
                                    <div 
                                        key={style.value}
                                        className="SkBorder-styleOption"
                                        onClick={(event) => this.handleStyleOptionClick(style.value, event)}
                                    >
                                        <span className="SkBorder-stylePreview" style={{
                                            borderBottom: `${borderSize} ${style.value} ${borderColor}`
                                        }}>
                                            {style.preview}
                                        </span>
                                        <span className="SkBorder-styleLabel">{style.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Border size selector */}
                <div className="SkBorder-section" onClick={this.handleSectionClick}>
                    <h4 className="SkSpPanelTitle">Border Size</h4>
                    <div className="SkBorder-sizeSelector">
                        <button 
                            className="SkBorder-sizeButton"
                            onClick={this.handleSizePickerClick}
                            title="Border size"
                        >
                            <span className="SkBorder-sizePreview" style={{
                                borderBottom: `${borderSize} ${borderStyle} ${borderColor}`
                            }}>
                                {borderSize}
                            </span>
                            <span className="SkBorder-sizeLabel">Size</span>
                            <span className="SkBorder-dropdownArrow">▼</span>
                        </button>
                        
                        {showSizePicker && (
                            <div className="SkBorder-sizeDropdown" onClick={this.handleDropdownClick}>
                                {borderSizes.map((size) => (
                                    <div 
                                        key={size.value}
                                        className="SkBorder-sizeOption"
                                        onClick={(event) => this.handleSizeOptionClick(size.value, event)}
                                    >
                                        <span className="SkBorder-sizePreview" style={{
                                            borderBottom: `${size.value} ${borderStyle} ${borderColor}`
                                        }}>
                                            {size.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Color picker */}
                <div className="SkBorder-section" onClick={this.handleSectionClick}>
                    <h4 className="SkSpPanelTitle">Border Color</h4>
                    <div className="SkBorder-colorSelector" onClick={this.handleColorContainerClick}>
                        <SkColor 
                            defaultColor={borderColor}
                            onColorChange={this.onColorChange}
                            inline={true}
                            size="small"
                        />
                    </div>
                </div>
            </div>
        );
    }
}

export default SkBorder;