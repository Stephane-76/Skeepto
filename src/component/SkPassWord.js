import React from "react";
import { SkComponent } from './SkComponent'
import { SkInput } from './SkInput';
import { SkButton } from './SkButton';
const ICONS_ASCII = {
    show: '[+]',    
    hide: '[-]'
};


export class SkPassWord extends SkComponent {
    constructor(props) {
        super(props);
        this.id=props.id;
        this.state = {
            showPassword: false
        };
    }

    togglePasswordVisibility = (e) => {
        e.preventDefault();
        this.setState(prevState => ({
            showPassword: !prevState.showPassword
        }));
    };

    // Setter getter
    value() {
        return(this.m_Ref.current.value());
    }

    setValue(value) {
        this.m_Ref.current.setValue(value);
    }

    render() {
        const { showPassword } = this.state;
        const { value, onChange, name, placeholder } = this.props;

        return (
            <div className="SkPassword-container">
                <SkInput
                    id={this.id}
                    ref={this.m_Ref}
                    type={showPassword ? "text" : "password"}
                    name={name}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    className="SkPassword-input"
                />
                <SkButton
                    type="button"
                    onClick={this.togglePasswordVisibility}
                    className="SkPassword-toggle"
                >
                {showPassword ? ICONS_ASCII.hide : ICONS_ASCII.show}
                </SkButton>
            </div>
        );
    }
}

export default SkPassWord;