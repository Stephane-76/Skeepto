import React from 'react';
import { SkComponent } from './SkComponent';
import SkColor from './SkColor';
import './SkColor.css';

export default class SkColorDemo extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            selectedColor: '#000000',
            textColor: '#000000',
            backgroundColor: '#ffffff',
            recentColors: ['#ff0000', '#00ff00', '#0000ff']
        };
    }

    handleColorChange = (color) => {
        this.setState(prevState => {
            const newRecentColors = prevState.recentColors.includes(color) 
                ? prevState.recentColors 
                : [color, ...prevState.recentColors.slice(0, 9)];
            
            return {
                selectedColor: color,
                recentColors: newRecentColors
            };
        });
    };

    handleTextColorChange = (color) => {
        this.setState({ textColor: color });
    };

    handleBackgroundColorChange = (color) => {
        this.setState({ backgroundColor: color });
    };

    render() {
        const { selectedColor, textColor, backgroundColor, recentColors } = this.state;

        return (
            <div ref={this.m_Ref} style={{ padding: '20px', fontFamily: 'var(--sk-font-family)', width :'100%' }}>
                <h1 style={{width:'100%'}}>SkColor component demo</h1>
                
                {/* Google Sheets style color buttons */}
                <div style={{ 
                    marginBottom: '30px',
                    padding: '20px',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    backgroundColor: '#f8f9fa'
                }}>
                    <h2 style={{ marginBottom: '15px', color: '#5f6368' }}>Google Sheets style color picker</h2>
                    
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '15px',
                        flexWrap: 'wrap'
                    }}>
                        {/* Text Color Button */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <label style={{ 
                                fontSize: '12px', 
                                color: '#5f6368', 
                                marginBottom: '5px',
                                fontWeight: '500'
                            }}>
                                Text color
                            </label>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                padding: '8px 12px',
                                border: '1px solid #dadce0',
                                borderRadius: '6px',
                                backgroundColor: '#ffffff',
                                cursor: 'pointer',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                            }}>
                                <div style={{
                                    width: '20px',
                                    height: '20px',
                                    backgroundColor: textColor,
                                    border: '2px solid #ffffff',
                                    borderRadius: '4px',
                                    boxShadow: '0 0 0 1px #dadce0'
                                }} />
                                <span style={{ fontSize: '14px', color: '#5f6368' }}>A</span>
                                <SkColor 
                                    defaultColor={textColor}
                                    onColorChange={this.handleTextColorChange}
                                    size="small"
                                />
                            </div>
                        </div>

                        {/* Background Color Button */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <label style={{ 
                                fontSize: '12px', 
                                color: '#5f6368', 
                                marginBottom: '5px',
                                fontWeight: '500'
                            }}>
                                Background color
                            </label>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                padding: '8px 12px',
                                border: '1px solid #dadce0',
                                borderRadius: '6px',
                                backgroundColor: '#ffffff',
                                cursor: 'pointer',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                            }}>
                                <div style={{
                                    width: '20px',
                                    height: '20px',
                                    backgroundColor: backgroundColor,
                                    border: '2px solid #ffffff',
                                    borderRadius: '4px',
                                    boxShadow: '0 0 0 1px #dadce0'
                                }} />
                                <svg width="20px" height="20px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                                <path d="M416,320s-64,48-64,99.84c0,33.28,28.67,60.16,64,60.16s64-27,64-60.16C480,368,416,320,416,320Z" fill={backgroundColor}/>
                                <path d="M144,32,68,108l70,70L32,280,208,464,360.8,315.7,416,304Zm24,116-39.6-41,15.88-15.89L184,132Z" fill="#000000"/>
                                </svg>
                                <SkColor 
                                    defaultColor={backgroundColor}
                                    onColorChange={this.handleBackgroundColorChange}
                                    size="small"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Preview of text with selected colors */}
                    <div style={{ 
                        marginTop: '20px',
                        padding: '15px',
                        backgroundColor: backgroundColor,
                        color: textColor,
                        borderRadius: '6px',
                        border: '1px solid #dadce0',
                        minHeight: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <span style={{ 
                            fontSize: '16px',
                            fontWeight: '500'
                        }}>
                            Preview of text with selected colors
                        </span>
                    </div>
                </div>

                <div style={{ marginBottom: '30px' }}>
                    <h2>Selected color:</h2>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '20px',
                        marginBottom: '20px'
                    }}>
                        <SkColor 
                            defaultColor={selectedColor}
                            onColorChange={this.handleColorChange}
                            recentColors={recentColors}
                        />
                        <div style={{ 
                            padding: '10px 20px',
                            backgroundColor: selectedColor,
                            color: this.getContrastColor(selectedColor),
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            minWidth: '100px',
                            textAlign: 'center'
                        }}>
                            {selectedColor}
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '30px' }}>
                    <h2>Available sizes:</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div>
                            <label>Small:</label>
                            <SkColor size="small" defaultColor="#ff0000" />
                        </div>
                        <div>
                            <label>Medium:</label>
                            <SkColor size="medium" defaultColor="#00ff00" />
                        </div>
                        <div>
                            <label>Large:</label>
                            <SkColor size="large" defaultColor="#0000ff" />
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '30px' }}>
                    <h2>Disabled component:</h2>
                    <SkColor disabled={true} defaultColor="#999999" />
                </div>

                <div style={{ marginBottom: '30px' }}>
                    <h2>Usage in a form:</h2>
                    <div style={{ 
                        border: '1px solid #ccc', 
                        padding: '20px', 
                        borderRadius: '8px',
                        maxWidth: '400px'
                    }}>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Background color:
                            </label>
                            <SkColor 
                                defaultColor="#ffffff"
                                onColorChange={(color) => console.log('Background color:', color)}
                            />
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Text color :
                            </label>
                            <SkColor 
                                defaultColor="#000000"
                                onColorChange={(color) => console.log('Text color:', color)}
                            />
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Accent color:
                            </label>
                            <SkColor 
                                defaultColor="#007bff"
                                onColorChange={(color) => console.log('Accent color:', color)}
                            />
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '30px' }}>
                    <h2>Color previews:</h2>
                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '20px'
                    }}>
                        {['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'].map((color) => (
                            <div key={color} style={{ 
                                border: '1px solid #ccc', 
                                borderRadius: '8px', 
                                padding: '15px',
                                textAlign: 'center'
                            }}>
                                <SkColor 
                                    defaultColor={color}
                                    onColorChange={(newColor) => console.log(`${color} → ${newColor}`)}
                                />
                                <div style={{ 
                                    marginTop: '10px',
                                    padding: '10px',
                                    backgroundColor: color,
                                    color: this.getContrastColor(color),
                                    borderRadius: '4px',
                                    fontWeight: 'bold'
                                }}>
                                    {color}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Helper function to determine text color based on background color
    getContrastColor(hexColor) {
        // Remove # if present
        const hex = hexColor.replace('#', '');
        
        // Convert to RGB
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Return black or white based on luminance
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }
}
