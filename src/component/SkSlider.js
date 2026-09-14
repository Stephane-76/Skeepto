import React from 'react';
import PropTypes from 'prop-types';
import SkInput from './SkInput';
import './SkComponent.css'; // Ensure CSS includes styling for the slider input

class SkSlider extends SkInput {
    constructor(props) {
        super(props);
        // Ensure the initial value is suitable for a slider
        this.state = {
            value: this.props.value || this.props.min || 0
        };
    }

    handleChange = (event) => {
        const newValue = event.target.value;
        this.setState({ value: newValue });
        if (this.props.onChange) {
            this.props.onChange(event);
        }
    }

    render() {
        // Extract slider specific props, in addition to those in SkInput
        const { min = 0, max = 100, step = 1 } = this.props;
        
        return (
            <input
                ref={this.m_Ref}
                type="range"
                value={this.state.value}
                onChange={this.handleChange}
                min={min}
                max={max}
                step={step}
                className="SkSlider" // You might need to add some CSS for the slider specifically
            />
        );
    }
}

SkSlider.propTypes = {
    ...SkInput.propTypes,
    min: PropTypes.number,
    max: PropTypes.number,
    step: PropTypes.number
};

export default SkSlider;