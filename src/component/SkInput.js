import React from 'react';

import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkComponent.css'; 


export class SkInput extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            value: props.value,
            name: props.name,
            id: props.id,
            enabled: true
        };
    }

    componentDidUpdate(prevProps) {
        if (prevProps.value !== this.props.value) {
            this.setState({ value: this.props.value });
        }
    }

    componentDidMount() {
        //console.log( "SkInput::componentDidMount()");
    }

    handleInputChange = (event) => {
        const newValue = event.target.value;
        this.setState({ value: newValue });
        if (this.props.onChange) {
            // Create a new event with the properties we need
            const customEvent = {
                target: {
                    id: this.props.id,
                    name: this.props.name,
                    value: newValue
                }
            };
            this.props.onChange(customEvent);
        }
    };

    handleKeyDown = (event) => {
        if (this.props.onKeyDown) {
            this.props.onKeyDown(event);
        }
    };

    // Setter getter
    value() {
        return(this.m_Ref.current.value);
    }
    
    setValue(value) {
        this.m_Ref.current.value = value;
    }
    
    id() {  
        return(this.m_Ref.current.id);
    }

    name() {
        return(this.m_Ref.current.name);
    }

    setEnabled = (enabled) => {
        this.setState({ enabled });
    }

    render() {
        const { type = 'text', placeholder, style, disabled, title, onBlur } = this.props;
        const { enabled } = this.state;

        // The internal `enabled` state keeps backward compatibility with
        // setEnabled(); the external `disabled` prop (when set) overrides
        // it so parents can drive the disabled state declaratively without
        // reaching for a ref.
        const wDisabled = disabled === true || !enabled;

        return (
            <input
                ref={this.m_Ref}
                id={this.state.id}
                name={this.state.name}
                type={type}
                value={this.state.value}
                onChange={this.handleInputChange}
                onKeyDown={this.handleKeyDown}
                onBlur={onBlur}
                placeholder={placeholder}
                className="SkInput"
                style={style}
                disabled={wDisabled}
                title={title}
            />
        );
    }
}

SkInput.propTypes = {
    onChange: PropTypes.func,  // Make onChange optional
    onKeyDown: PropTypes.func, // Add onKeyDown prop type
    type: PropTypes.string, 
    placeholder: PropTypes.string,
    style: PropTypes.object,
    disabled: PropTypes.bool,
    title: PropTypes.string,
    onBlur: PropTypes.func,
};

SkInput.defaultProps = {
    onChange: undefined,  // Set default value to undefined
    onKeyDown: undefined, // Set default value to undefined
    type: 'text',
    placeholder: ''
};

export default SkInput;