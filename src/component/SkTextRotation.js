// =============================================================================
// SkTextRotation
// Interactive dial to configure text rotation between -90deg and +90deg,
// with an optional "vertical stacked" mode (Excel-like). The user can drag
// the dial, click one of the tick marks, type the angle, or toggle the
// vertical mode.
//
// Props:
//   angle        : current rotation angle in degrees (-90..90). Default: 0
//   vertical     : boolean. When true the text is displayed vertically
//                  (letters stacked); angle is ignored visually. Default: false
//   onChange     : function({ angle, vertical }) called on every change
//   previewText  : short text shown inside the dial. Default: "Text"
//   size         : diameter of the dial in pixels. Default: 140
//   disabled     : boolean. When true user interaction is disabled
// =============================================================================
import React from 'react';
import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkTextRotation.css';

const MIN_ANGLE = -90;
const MAX_ANGLE = 90;

// Preset ticks displayed around the dial (in degrees)
const TICKS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];

class SkTextRotation extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            angle: SkTextRotation.clampAngle(props.angle ?? 0),
            vertical: !!props.vertical,
            dragging: false,
        };
        this.m_DialRef = React.createRef();
    }

    componentWillUnmount() {
        this.detachDragListeners();
    }

    static getDerivedStateFromProps(sNextProps, sPrevState) {
        // Keep the component controllable from the outside (same pattern as
        // other Sk components that sync their state with props).
        if (sPrevState.dragging) return null;
        const wClamped = SkTextRotation.clampAngle(sNextProps.angle ?? sPrevState.angle);
        const wVertical = sNextProps.vertical !== undefined
            ? !!sNextProps.vertical
            : sPrevState.vertical;
        if (wClamped === sPrevState.angle && wVertical === sPrevState.vertical) {
            return null;
        }
        return { angle: wClamped, vertical: wVertical };
    }

    static clampAngle(sAngle) {
        const wValue = Number(sAngle);
        if (Number.isNaN(wValue)) return 0;
        if (wValue < MIN_ANGLE) return MIN_ANGLE;
        if (wValue > MAX_ANGLE) return MAX_ANGLE;
        return Math.round(wValue);
    }

    emitChange(sState) {
        if (typeof this.props.onChange === 'function') {
            this.props.onChange({
                angle: sState.angle,
                vertical: sState.vertical,
            });
        }
    }

    setAngle(sAngle, sExtra = {}) {
        if (this.props.disabled) return;
        const wAngle = SkTextRotation.clampAngle(sAngle);
        const wNext = { angle: wAngle, vertical: false, ...sExtra };
        // When a drag is in progress, only update local state; the change
        // will be emitted to the parent on mouseup to avoid flooding the
        // backend with format() calls.
        const wEmit = !this.state.dragging && sExtra.emit !== false;
        this.setState(wNext, () => {
            if (wEmit) this.emitChange({ ...this.state, ...wNext });
        });
    }

    toggleVertical = () => {
        if (this.props.disabled) return;
        const wVertical = !this.state.vertical;
        this.setState({ vertical: wVertical }, () => {
            this.emitChange({ angle: this.state.angle, vertical: wVertical });
        });
    };

    // -- Dial geometry helpers -------------------------------------------------
    computeAngleFromEvent(sEvent) {
        const wNode = this.m_DialRef.current;
        if (!wNode) return this.state.angle;
        const wRect = wNode.getBoundingClientRect();
        const wCenterY = wRect.top + wRect.height / 2;
        // The dial pivot is on the left edge of the circle (like Excel). We
        // compute the angle between the horizontal axis and the line going
        // from that pivot to the mouse cursor.
        const wPivotX = wRect.left + wRect.width * 0.18;
        const wDeltaX = sEvent.clientX - wPivotX;
        const wDeltaY = sEvent.clientY - wCenterY;
        // Invert Y because screen Y grows downwards but we want positive
        // angles to point upwards.
        const wRad = Math.atan2(-wDeltaY, Math.max(wDeltaX, 0.0001));
        const wDeg = (wRad * 180) / Math.PI;
        return SkTextRotation.clampAngle(wDeg);
    }

    // -- Drag handling ---------------------------------------------------------
    attachDragListeners() {
        window.addEventListener('mousemove', this.handleDragMove);
        window.addEventListener('mouseup', this.handleDragEnd);
    }

    detachDragListeners() {
        window.removeEventListener('mousemove', this.handleDragMove);
        window.removeEventListener('mouseup', this.handleDragEnd);
    }

    handleDialMouseDown = (sEvent) => {
        if (this.props.disabled) return;
        sEvent.preventDefault();
        // Compute the angle before React recycles the synthetic event.
        const wAngle = this.computeAngleFromEvent(sEvent);
        this.setState({ dragging: true, angle: wAngle, vertical: false });
        this.attachDragListeners();
    };

    handleDragMove = (sEvent) => {
        if (!this.state.dragging) return;
        const wAngle = this.computeAngleFromEvent(sEvent);
        this.setAngle(wAngle);
    };

    handleDragEnd = () => {
        this.detachDragListeners();
        const wAngle = this.state.angle;
        const wVertical = this.state.vertical;
        // Exit drag mode first, then emit the final value once.
        this.setState({ dragging: false }, () => {
            this.emitChange({ angle: wAngle, vertical: wVertical });
        });
    };

    // -- Input handling --------------------------------------------------------
    handleInputChange = (sEvent) => {
        const wRaw = sEvent.target.value;
        if (wRaw === '' || wRaw === '-') {
            this.setState({ angle: 0 });
            return;
        }
        const wValue = Number(wRaw);
        if (Number.isNaN(wValue)) return;
        this.setAngle(wValue);
    };

    handleTickClick = (sValue) => {
        this.setAngle(sValue);
    };

    // -- Rendering -------------------------------------------------------------
    renderTicks() {
        const wSize = this.props.size;
        const wRadius = wSize / 2;
        const wPivotX = wSize * 0.18;
        const wHandleLen = wSize * 0.44;
        return TICKS.map((wTick) => {
            const wRad = (wTick * Math.PI) / 180;
            const wX = wPivotX + Math.cos(wRad) * wHandleLen;
            const wY = wRadius - Math.sin(wRad) * wHandleLen;
            const wSelected = wTick === this.state.angle && !this.state.vertical;
            return (
                <div
                    key={wTick}
                    className={`SkTextRotation-tick${wSelected ? ' selected' : ''}`}
                    style={{ left: wX, top: wY }}
                    onMouseDown={(e) => { e.stopPropagation(); this.handleTickClick(wTick); }}
                    title={`${wTick}°`}
                />
            );
        });
    }

    renderVerticalText() {
        const wText = this.props.previewText || 'Text';
        return (
            <div className="SkTextRotation-vertical-preview">
                {wText.split('').map((wChar, wIdx) => (
                    <span key={wIdx}>{wChar}</span>
                ))}
            </div>
        );
    }

    render() {
        const { size, previewText, disabled, className } = this.props;
        const { angle, vertical } = this.state;

        const wDialStyle = {
            width: size,
            height: size,
        };
        const wHandleStyle = {
            transform: `rotate(${-angle}deg)`,
        };
        const wPreviewStyle = vertical
            ? {}
            : { transform: `rotate(${-angle}deg)` };

        return (
            <div
                className={`SkTextRotation${disabled ? ' disabled' : ''}${className ? ' ' + className : ''}`}
                ref={this.m_Ref}
            >
                <div className="SkTextRotation-dial-wrap">
                    <div
                        className="SkTextRotation-dial"
                        ref={this.m_DialRef}
                        style={wDialStyle}
                        onMouseDown={this.handleDialMouseDown}
                    >
                        <div className="SkTextRotation-handle" style={wHandleStyle} />
                        <div className="SkTextRotation-center" />
                        {!vertical && this.renderTicks()}
                        <div className="SkTextRotation-preview" style={wPreviewStyle}>
                            {vertical ? this.renderVerticalText() : (previewText || 'Text')}
                        </div>
                    </div>
                </div>

                <div className="SkTextRotation-controls">
                    <button
                        type="button"
                        className={`SkTextRotation-vertical-btn${vertical ? ' active' : ''}`}
                        onClick={this.toggleVertical}
                        disabled={disabled}
                        title="Vertical text"
                    >
                        <span className="SkTextRotation-vertical-label">
                            <span>T</span><span>e</span><span>x</span><span>t</span>
                        </span>
                    </button>

                    <div className="SkTextRotation-input-row">
                        <label htmlFor="sk-text-rotation-angle">Degrees</label>
                        <input
                            id="sk-text-rotation-angle"
                            type="number"
                            min={MIN_ANGLE}
                            max={MAX_ANGLE}
                            step={1}
                            value={vertical ? 0 : angle}
                            onChange={this.handleInputChange}
                            disabled={disabled || vertical}
                            className="SkTextRotation-input"
                        />
                        <span className="SkTextRotation-input-unit">°</span>
                    </div>
                </div>
            </div>
        );
    }
}

SkTextRotation.propTypes = {
    angle: PropTypes.number,
    vertical: PropTypes.bool,
    onChange: PropTypes.func,
    previewText: PropTypes.string,
    size: PropTypes.number,
    disabled: PropTypes.bool,
    className: PropTypes.string,
};

SkTextRotation.defaultProps = {
    angle: 0,
    vertical: false,
    previewText: 'Text',
    size: 140,
    disabled: false,
};

export default SkTextRotation;
