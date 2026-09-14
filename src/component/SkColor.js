import React from 'react';
import { createPortal } from 'react-dom';
import SkComponent from './SkComponent';
import PropTypes from 'prop-types';
import './SkColor.css';

export class SkColor extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            isOpen: false,
            selectedColor: props.defaultColor || '#000000',
            customColor: props.defaultColor || '#000000',
            showCustomPicker: false,
            dropdownPosition: { top: 0, left: 0 }
        };
        this.colorPickerRef = React.createRef();
        this.dropdownRef = React.createRef();
        this.buttonRef = React.createRef();
        this.dropdownElementRef = React.createRef();
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside);
        window.addEventListener('scroll', this.updateDropdownPosition, true);
        window.addEventListener('resize', this.updateDropdownPosition);
    }

    componentDidUpdate(prevProps, prevState) {
        // Recalculate position when dropdown opens
        if (this.state.isOpen && !prevState.isOpen) {
            this.updateDropdownPosition();
        }
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside);
        window.removeEventListener('scroll', this.updateDropdownPosition, true);
        window.removeEventListener('resize', this.updateDropdownPosition);
    }

    updateDropdownPosition = () => {
        if (this.state.isOpen && this.buttonRef.current && !this.props.inline) {
            // Use requestAnimationFrame to ensure DOM is updated
            requestAnimationFrame(() => {
                if (!this.buttonRef.current) return;
                
                const buttonRect = this.buttonRef.current.getBoundingClientRect();
                const dropdownHeight = 300; // Approximate dropdown height
                const dropdownWidth = 280; // Approximate dropdown width
                
                let top = buttonRect.bottom + 4;
                let left = buttonRect.left;
                
                // Adjust if dropdown would go off bottom of screen
                if (top + dropdownHeight > window.innerHeight) {
                    top = buttonRect.top - dropdownHeight - 4;
                    // If still off screen, position at top
                    if (top < 0) {
                        top = 4;
                    }
                }
                
                // Adjust if dropdown would go off right side of screen
                if (left + dropdownWidth > window.innerWidth) {
                    left = window.innerWidth - dropdownWidth - 4;
                }
                
                // Adjust if dropdown would go off left side of screen
                if (left < 0) {
                    left = 4;
                }
                
                this.setState({
                    dropdownPosition: { top, left }
                });
            });
        }
    }

    handleClickOutside = (event) => {
        // Check if click is outside both the button container and the dropdown (which is in portal)
        const clickedButton = this.dropdownRef.current && this.dropdownRef.current.contains(event.target);
        const clickedDropdown = this.dropdownElementRef.current && this.dropdownElementRef.current.contains(event.target);

        // Native <input type="color"> UI renders outside the DOM tree
        if (this.isNativeColorPickerInteraction(event)) {
            return;
        }
        
        if (!clickedButton && !clickedDropdown) {
            this.setState({ isOpen: false, showCustomPicker: false });
        }
    }

    isNativeColorPickerInteraction(event) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.type === 'color') {
            return true;
        }
        const target = event?.target;
        if (target instanceof HTMLInputElement && target.type === 'color') {
            return true;
        }
        return !!(target instanceof Element && target.closest('input[type="color"]'));
    }

    emitColorChange(color, { closePopup = true } = {}) {
        if (this.props.onColorChange) {
            this.props.onColorChange(color, { closePopup });
        }
    }

    toggleDropdown = () => {
        // Only toggle if not in inline mode
        if (!this.props.inline) {
            const willOpen = !this.state.isOpen;
            if (willOpen) {
                // Set initial position, will be recalculated in componentDidUpdate
                this.setState({ 
                    isOpen: true,
                    showCustomPicker: false,
                    dropdownPosition: { top: 0, left: 0 }
                });
            } else {
                this.setState({ 
                    isOpen: false,
                    showCustomPicker: false 
                });
            }
        }
    }

    selectColor = (color) => {
        this.setState({ 
            selectedColor: color, 
            isOpen: false,
            showCustomPicker: false 
        });
        if (this.props.onColorChange) {
            this.props.onColorChange(color);
        }
    }

    selectColorInline = (color) => {
        // For inline mode, don't close popups, just update color
        this.setState({ 
            selectedColor: color,
            customColor: color
        });
        this.emitColorChange(color, { closePopup: true });
    }

    handleCustomColorChange = (event) => {
        const color = event.target.value;
        this.setState({ 
            customColor: color,
            selectedColor: color 
        });
        // Keep the parent popup open while adjusting custom color
        this.emitColorChange(color, { closePopup: false });
    }

    toggleCustomPicker = () => {
        this.setState(prevState => ({ 
            showCustomPicker: !prevState.showCustomPicker 
        }));
    }

    render() {
        const { className = '', disabled = false, size = 'medium', inline = false } = this.props;
        const { isOpen, selectedColor, customColor, showCustomPicker } = this.state;

        // Predefined color palette similar to Google Sheets
        // Organized by color families, no duplicates, 10 colors per row
        const colorPalette = [
            // First row - Grays and basic colors (dark to light)
            '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
            
            // Second row - Reds and pinks (dark to light)
            '#980000', '#cc0000', '#ea9999', '#f4cccc', '#ffcccc', '#ff6666', '#ff0000', '#e06666', '#cc6666', '#ff9999',
            
            // Third row - Oranges and yellows (dark to light)
            '#e69138', '#f6b26b', '#ffd966', '#fff2cc', '#ffe599', '#ffcc00', '#ff9900', '#f9cb9c', '#fce5cd', '#fff4cc',
            
            // Fourth row - Greens (dark to light)
            '#6aa84f', '#93c47d', '#b6d7a8', '#d9ead3', '#8fce00', '#76a5af', '#9fc5e8', '#a2c4c9', '#b4d7e7', '#c6d9f0',
            
            // Fifth row - Blues (dark to light)
            '#0b5394', '#3c78d8', '#3d85c6', '#6fa8dc', '#9fc5e8', '#cfe2f3', '#d0e0e3', '#c9daf8', '#d9d2e9', '#e1d5e7',
            
            // Sixth row - Purples and magentas (dark to light)
            '#351c75', '#674ea7', '#8e7cc3', '#a64d79', '#c27ba0', '#d5a6bd', '#ead1dc', '#f2d7d5', '#fce5cd', '#f9d7e3'
        ];

        // If inline mode, only show the color picker content without the button
        if (inline) {
            return (
                <div className={`SkColor SkColor--${size} SkColor--inline`} ref={this.dropdownRef}>
                    {/* Predefined colors */}
                    <div className="SkColor__palette">
                        {colorPalette.map((color, index) => (
                            <button
                                key={index}
                                className="SkColor__color-option"
                                style={{ backgroundColor: color }}
                                onClick={() => this.selectColorInline(color)}
                                title={color}
                            >
                                {selectedColor === color && (
                                    <svg className="SkColor__checkmark" viewBox="0 0 24 24">
                                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="white"/>
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Divider */}
                    <div className="SkColor__divider" />

                    {/* Recent colors section (if any) */}
                    {this.props.recentColors && this.props.recentColors.length > 0 && (
                        <>
                            <div className="SkColor__divider" />
                            <div className="SkColor__recent-section">
                                <div className="SkColor__section-title SkSpPanelTitle">Recent Colors</div>
                                <div className="SkColor__palette">
                                    {this.props.recentColors.map((color, index) => (
                                        <button
                                            key={`recent-${index}`}
                                            className="SkColor__color-option"
                                            style={{ backgroundColor: color }}
                                            onClick={() => this.selectColorInline(color)}
                                            title={color}
                                        >
                                            {selectedColor === color && (
                                                <svg className="SkColor__checkmark" viewBox="0 0 24 24">
                                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="white"/>
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Custom color section */}
                    <div className="SkColor__custom-section">
                        <label htmlFor="custom-color-inline" className="SkSpPanelTitle">Custom Color:</label>
                        <div className="SkColor__custom-row">
                            <input
                                type="color"
                                id="custom-color-inline"
                                value={customColor}
                                onChange={this.handleCustomColorChange}
                                className="SkColor__custom-input"
                            />
                            <input
                                type="text"
                                value={customColor}
                                onChange={this.handleCustomColorChange}
                                placeholder="#000000"
                                className="SkColor__custom-text"
                            />
                        </div>
                    </div>
                </div>
            );
        }

        // Normal mode with button and dropdown
        return (
            <div className={`SkColor ${className} SkColor--${size}`} ref={this.dropdownRef}>
                {/* Color preview button */}
                <button
                    ref={this.buttonRef}
                    className="SkColor__preview"
                    onClick={this.toggleDropdown}
                    disabled={disabled}
                    style={{ backgroundColor: selectedColor }}
                    title={selectedColor}
                >
                    <div className="SkColor__preview-inner" />
                </button>

                {/* Dropdown menu - rendered via portal to body */}
                {isOpen && createPortal(
                    <div 
                        ref={this.dropdownElementRef}
                        className="SkColor__dropdown SkColor__dropdown--fixed"
                        style={{
                            position: 'fixed',
                            top: `${this.state.dropdownPosition.top}px`,
                            left: `${this.state.dropdownPosition.left}px`,
                            zIndex: 2000
                        }}
                    >
                        {/* Predefined colors */}
                        <div className="SkColor__palette">
                            {colorPalette.map((color, index) => (
                                <button
                                    key={index}
                                    className="SkColor__color-option"
                                    style={{ backgroundColor: color }}
                                    onClick={() => this.selectColor(color)}
                                    title={color}
                                >
                                    {selectedColor === color && (
                                        <svg className="SkColor__checkmark" viewBox="0 0 24 24">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="white"/>
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Divider */}
                        <div className="SkColor__divider" />

                        {/* Custom color section */}
                        <div className="SkColor__custom-section">
                            <button
                                className="SkColor__custom-toggle"
                                onClick={this.toggleCustomPicker}
                            >
                                {showCustomPicker ? 'Hide' : 'Custom Color'}
                            </button>
                            
                            {showCustomPicker && (
                                <div className="SkColor__custom-picker">
                                    <input
                                        type="color"
                                        value={customColor}
                                        onChange={this.handleCustomColorChange}
                                        className="SkColor__color-input"
                                    />
                                    <input
                                        type="text"
                                        value={customColor}
                                        onChange={this.handleCustomColorChange}
                                        className="SkColor__color-text"
                                        placeholder="#000000"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Recent colors (if any) */}
                        {this.props.recentColors && this.props.recentColors.length > 0 && (
                            <>
                                <div className="SkColor__divider" />
                                <div className="SkColor__recent-section">
                                    <div className="SkColor__section-title SkSpPanelTitle">Recent Colors</div>
                                    <div className="SkColor__palette">
                                        {this.props.recentColors.map((color, index) => (
                                            <button
                                                key={`recent-${index}`}
                                                className="SkColor__color-option"
                                                style={{ backgroundColor: color }}
                                                onClick={() => this.selectColor(color)}
                                                title={color}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>,
                    document.body
                )}
            </div>
        );
    }
}

SkColor.propTypes = {
    defaultColor: PropTypes.string,
    onColorChange: PropTypes.func,
    className: PropTypes.string,
    disabled: PropTypes.bool,
    size: PropTypes.oneOf(['small', 'medium', 'large']),
    recentColors: PropTypes.arrayOf(PropTypes.string),
    inline: PropTypes.bool
};

SkColor.defaultProps = {
    defaultColor: '#000000',
    onColorChange: undefined,
    className: '',
    disabled: false,
    size: 'medium',
    recentColors: [],
    inline: false
};

export default SkColor;
