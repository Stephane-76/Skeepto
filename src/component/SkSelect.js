import React, { Component } from 'react';
import PropTypes from 'prop-types';
import './SkComponent.css';  // Import CSS

class SkSelect extends Component {
    render() {
        const { options = [], selectedValue, multiple, onChange, className = '', style, size } = this.props;
        
        // Convert multiple to boolean if it's a string
        const isMultiple = typeof multiple === 'string' ? multiple === 'true' : Boolean(multiple);

        return (
            <select
                value={selectedValue}
                multiple={isMultiple}
                onChange={onChange}
                className={`SkSelect ${className}`}
                style={style}
                size={size}
            >
                {options.map((option, index) => (
                    <option key={index} value={option.value}>
                        {option.label}
                    </option>
                ))}
                {this.props.children}
            </select>
        );
    }
}

SkSelect.propTypes = {
    options: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string.isRequired, // Option label
            value: PropTypes.string.isRequired  // Option value
        })
    ),  // Make options optional
    style: PropTypes.object,
    className: PropTypes.string,
    selectedValue: PropTypes.any,
    multiple: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.string
    ]),  // Accept both boolean and string
    onChange: PropTypes.func
};

SkSelect.defaultProps = {
    options: [],  // Default empty array
    multiple: false,
    className: '',
    style: {}
};

export default SkSelect;