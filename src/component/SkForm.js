import React from "react";
import { LogMessage } from "./SkLogMessage";
import { SkComponent } from './SkComponent';


export class SkForm extends SkComponent {
    constructor(props) {
        super(props);
        this.m_Input = [];
        this.state = {
            isEnabled: true
        };

    }
    
    componentDidMount() {
        this.initializeFields();
    }

    initializeFields = () => {
        if (this.m_Ref.current) {
            const fieldDivs = this.m_Ref.current.querySelectorAll('div[id]');
            console.log( "InitializeFields " + fieldDivs);
            this.m_Input = Array.from(fieldDivs).map(div => {
                const skInput = div.querySelector('.SkInput, .SkCalendar');
                if (skInput) {
                    console.log( "Found SkInput " + div.id + " : " + skInput);
                    return {
                        name: div.id,
                        skInput: skInput,
                    };
                }
                return null;
            }).filter(Boolean);
        }
    };

    reset = () => {
        if (this.m_Ref.current) {
            this.m_Input.forEach(input => {
                if (input.skInput) {
                    switch(input.skInput.type) {
                        case 'checkbox':
                        case 'radio':
                            input.skInput.checked = input.skInput.defaultChecked;
                            break;
                        case 'select-one':
                        case 'select-multiple':
                            Array.from(input.options).forEach(option => {
                                option.selected = option.defaultSelected;
                            });
                            break;
                        default:
                            input.skInput.value = input.skInput.defaultValue;
                            break;
                    }
                }
            });
        }
    };

    setEnabled = (enabled = true) => {
        if (this.m_Ref.current) {
            this.m_Input.forEach(input => {
                input.skInput.disabled = !enabled;
            });
        }
    };

    setFocus = (fieldName) => {
        const input = this.m_Input.find(({name}) => name === fieldName);
        if ( input.skInput) {
            input.skInput.focus();
            console.log( `Focus set on field: ${fieldName}`);
        } else {
            LogMessage("warn", `Field not found: ${fieldName}`);
        }
    };

    handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (this.props.onSubmit) {
                this.props.onSubmit(event);
            }
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.props.onCancel) {
                this.props.onCancel(event);
            }
        }
    };

    render() {
        return (
        <div ref={this.m_Ref} onKeyDown={this.handleKeyDown} id="form" className='SkForm'>
            {this.props.children}
        </div>
        );
    }
}

export default SkForm;