import React from 'react';
import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkComponent.css'; 

export class SkError extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            id: this.props.id,
            enabled: true
        };
    }
   
    
    id() {  
        return(this.m_Ref.current.id);
    }

    setEnabled = (enabled) => {
        this.setState({ enabled });
    }

    render() {
        const { enabled } = this.state;

        return (
            <div
                className="SkError"
                ref={this.m_Ref}
                id={this.props.id}
                disabled={!enabled}
            />
        );
    }
}

SkError.propTypes = {
    onChange:  PropTypes.func.isRequired, 
    type: PropTypes.string, 
    placeholder: PropTypes.string
};

export default SkError;