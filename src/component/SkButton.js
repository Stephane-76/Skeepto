import React from 'react';
import SkComponent from './SkComponent';
import PropTypes from 'prop-types';

import './SkComponent.css'

export class SkButton extends SkComponent {
    onClick = (event) => {
        if (this.props.disabled) {
            return;
        }
        if (this.props.onClick) {
            this.props.onClick(event);
        }
    }
    render() {
        const { className = '', disabled = false, type } = this.props;
        return (
            <button 
                type={type !== undefined ? type : 'button'}
                className={`SkButton ${disabled ? 'SkButtonDisabled ' : ''}${className}`}
                id={this.props.id} 
                onClick={this.onClick}
                style={this.props.style}
                disabled={disabled}
                title={this.props.title}
            >
                {this.props.children}
            </button>
        );
    }
}

SkButton.propTypes = {
    onClick: PropTypes.func,
    className: PropTypes.string,
    style: PropTypes.object,
    disabled: PropTypes.bool,
    title: PropTypes.string,
    type: PropTypes.string,
};

SkButton.defaultProps = {
    onClick: undefined,
    className: '',
    style: undefined,
    disabled: false,
    title: undefined,
};

export default SkButton;