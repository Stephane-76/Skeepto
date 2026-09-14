import React from 'react';
import './SkLoadingSpinner.css';

/** Centered loading indicator; spinner animation is CSS-only (no setInterval). */
class SkLoadingSpinner extends React.Component {
  render() {
    const {
      size = 'medium',
      text = 'Loading',
      showText = true,
      showProgress = false,
      progress = 0,
    } = this.props;
    const wPct = Math.max(0, Math.min(100, Math.round(progress)));

    return (
      <div
        className={`SkLoadingSpinner SkLoadingSpinner--${size}`}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="SkLoadingSpinner__card">
          <div className="SkLoadingSpinner__spinner" aria-hidden="true" />
          {showText ? (
            <p className="SkLoadingSpinner__text">{text}</p>
          ) : null}
          {showProgress ? (
            <div className="SkLoadingSpinner__progress-container">
              <div
                className="SkLoadingSpinner__progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={wPct}
              >
                <div
                  className="SkLoadingSpinner__progress-fill"
                  style={{ width: `${wPct}%` }}
                />
              </div>
              <div className="SkLoadingSpinner__progress-text">{wPct}%</div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}

export default SkLoadingSpinner;
