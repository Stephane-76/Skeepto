import React from 'react';
import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkComponent.css';

class SkCirclePicker extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            selectedColor: this.props.color || '#000000'
        };
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        if (
            nextProps.color &&
            typeof nextProps.color === 'string' &&
            nextProps.color.toUpperCase() !== (prevState.selectedColor || '').toUpperCase()
        ) {
            return { selectedColor: nextProps.color };
        }
        return null;
    }

    handleColorClick = (color) => {
        this.setState({ selectedColor: color });
        if (this.props.onChange) {
            this.props.onChange({ hex: color });
        }
    }

    render() {
        const { colors, circleSize, circleSpacing } = this.props;
        
        const containerStyle = {
            display: 'flex',
            flexWrap: 'wrap',
            width: this.props.width,
            gap: `${circleSpacing}px`
        };

        const circleStyle = {
            width: `${circleSize}px`,
            height: `${circleSize}px`,
            borderRadius: '50%',
            cursor: 'pointer',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
            transition: 'transform 0.2s ease'
        };

        return (
            <div className="SkCirclePicker" ref={this.m_Ref}>
                <div style={containerStyle}>
                    {colors.map((color, index) => (
                        <div
                            key={index}
                            style={{
                                ...circleStyle,
                                backgroundColor: color,
                                transform: this.state.selectedColor === color ? 'scale(1.2)' : 'scale(1)',
                                boxShadow: this.state.selectedColor === color 
                                    ? '0 0 0 2px var(--sk-button-color-background)'
                                    : '0 0 0 1px rgba(0,0,0,0.2)'
                            }}
                            onClick={() => this.handleColorClick(color)}
                            title={color}
                        />
                    ))}
                </div>
            </div>
        );
    }
}

SkCirclePicker.propTypes = {
    onChange: PropTypes.func.isRequired,
    colors: PropTypes.arrayOf(PropTypes.string),
    color: PropTypes.string,
    width: PropTypes.string,
    circleSize: PropTypes.number,
    circleSpacing: PropTypes.number
};

SkCirclePicker.defaultProps = {
    colors: [
        '#f44336', '#e91e63', '#9c27b0', '#673ab7',
        '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
        '#009688', '#4caf50', '#8bc34a', '#cddc39',
        '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
        '#795548', '#607d8b'
    ],
    width: '252px',
    circleSize: 28,
    circleSpacing: 14
};

export default SkCirclePicker; 