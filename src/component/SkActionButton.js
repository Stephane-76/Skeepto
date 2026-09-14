import React from "react";

/**
 * SkActionButton - Colored "pill" action button matching the Virtual Disk
 * toolbar style (Upload / Download / Convert / Delete). Renders an optional
 * inline SVG icon followed by a text label.
 *
 * Props:
 *   component  - SVG component (e.g. imported via ReactComponent)
 *   label      - text label
 *   color      - background color (CSS color string)
 *   disabled   - greys out and blocks clicks
 *   onClick    - click handler (ignored when disabled)
 *   title      - optional tooltip; defaults to the label
 *   style      - optional style overrides (merged last so the caller wins)
 */
export const SkActionButton = ({
    component: SvgComponent,
    label,
    color,
    disabled,
    onClick,
    title,
    style,
}) => {
    const baseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 16px',
        backgroundColor: color,
        color: 'white',
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontWeight: 600,
        fontSize: '0.9rem',
        lineHeight: 1,
        transition: 'filter 0.15s ease, box-shadow 0.15s ease',
        ...(style || {}),
    };

    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title || label}
            style={baseStyle}
        >
            {SvgComponent && (
                <SvgComponent
                    width={16}
                    height={16}
                    style={{
                        display: 'block',
                        flexShrink: 0,
                        color: 'white',
                        fill: 'currentColor',
                    }}
                />
            )}
            {label && <span>{label}</span>}
        </button>
    );
};

export default SkActionButton;
