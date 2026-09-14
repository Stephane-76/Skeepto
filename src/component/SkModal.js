//=============================================================================
// SkModal
// Modal Window Component
//
// Optional `footer` prop: place actions in the bottom bar (use SkModal-toolbarBtn
// classes from SkComponent.css — same flat style as SkVirtualDisk toolbar).
//=============================================================================
import React from "react";
import SkComponent from "./SkComponent";
import './SkComponent.css';

class SkModal extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            closeButton: props.closeButton,
            show: props.show || false,
            width: props.width || 400,
            height: props.height || 300
        };
        this.m_Label = props.title || "Modal";
    }

    componentDidMount() {
        if (this.state.show) {
            document.body.style.overflow = 'hidden';
        }
        this.handleDocumentEscape = (event) => {
            if (event.key !== 'Escape' || !this.props.show) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.handleClose();
        };
        document.addEventListener('keydown', this.handleDocumentEscape, true);
    }

    componentDidUpdate(prevProps) {
        if (this.props.show !== prevProps.show) {
            this.setState({ show: this.props.show });
            document.body.style.overflow = this.props.show ? 'hidden' : 'unset';
        }
    }

    componentWillUnmount() {
        document.body.style.overflow = 'unset';
        document.removeEventListener('keydown', this.handleDocumentEscape, true);
    }

    handleClose = (event) => {
        if (event) {
            event.stopPropagation();
        }
        this.setState({ show: false });
        if (typeof this.props.onClose === 'function') {
            this.props.onClose();
        }
    }

    render() {
        if (!this.state.show) return null;

        const modalStyle = {
            width: this.state.width + 'px',
            height: this.state.height + 'px'
        };

        return (
            <div ref={this.m_Ref} className="SkModal-overlay">
                <div className="SkModal" style={modalStyle} onClick={(e) => e.stopPropagation()}>
                    <div className="SkModal-header">
                        <span>{this.m_Label}</span>
                        {this.state.closeButton && (
                            <button 
                                className="SkModal-close"
                                onClick={this.handleClose}
                        >
                            X
                        </button>
                        )}
                    </div>
                    <div className="SkModal-content">
                        {this.props.children}
                    </div>
                    <div className="SkModal-footer">
                        {this.props.footer}
                    </div>
                </div>
            </div>
        );
    }
}

export default SkModal; 