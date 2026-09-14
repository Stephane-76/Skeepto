//=============================================================================
// SkSpZoomControl
// Excel-like zoom control for the sheet tab bar: [−] [slider] [+] [NN %].
// Drives the same engine zoom as the View > Zoom menu (m_Zoom, applyZoom),
// covering 10%–400%. Fully theme-aware (light & dark) via CSS variables.
//=============================================================================
import React from "react";

export const SK_ZOOM_MIN = 10;
export const SK_ZOOM_MAX = 400;
export const SK_ZOOM_STEP = 10;

function clampZoom(percent) {
  const wValue = Math.round(Number(percent) || 100);
  return Math.min(SK_ZOOM_MAX, Math.max(SK_ZOOM_MIN, wValue));
}

class SkSpZoomControl extends React.Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.state = { percent: this.readEnginePercent() };
  }

  componentDidMount() {
    // The View > Zoom menu presets also change m_Zoom; keep our value in sync.
    this.handleViewRefresh = () => {
      const wPercent = this.readEnginePercent();
      if (wPercent !== this.state.percent) {
        this.setState({ percent: wPercent });
      }
    };
    window.addEventListener("skViewMenuRefresh", this.handleViewRefresh);
  }

  componentWillUnmount() {
    if (this.handleViewRefresh) {
      window.removeEventListener("skViewMenuRefresh", this.handleViewRefresh);
    }
  }

  readEnginePercent() {
    const wZoom = Number(this.m_SpInterface?.m_Zoom);
    return clampZoom((Number.isFinite(wZoom) && wZoom > 0 ? wZoom : 1) * 100);
  }

  // Apply a new zoom to the engine and refresh the View menu label/checks.
  applyPercent = (percent) => {
    const wPercent = clampZoom(percent);
    if (!this.m_SpInterface) {
      this.setState({ percent: wPercent });
      return;
    }
    this.m_SpInterface.m_Zoom = wPercent / 100;
    this.m_SpInterface.applyZoom();
    this.m_SpInterface.reloadView();
    this.setState({ percent: wPercent });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("skViewMenuRefresh"));
    }
  };

  stepZoom = (direction) => {
    // Snap to the next multiple of STEP so the slider stops line up (Excel-like).
    const wCurrent = this.state.percent;
    const wSnapped =
      direction > 0
        ? Math.floor(wCurrent / SK_ZOOM_STEP) * SK_ZOOM_STEP + SK_ZOOM_STEP
        : Math.ceil(wCurrent / SK_ZOOM_STEP) * SK_ZOOM_STEP - SK_ZOOM_STEP;
    this.applyPercent(wSnapped);
  };

  handleSlider = (event) => {
    this.applyPercent(event.target.value);
  };

  handleReset = () => {
    this.applyPercent(100);
  };

  render() {
    const { percent } = this.state;
    return (
      <div className="SkSpZoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="SkSpZoom-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => this.stepZoom(-1)}
          disabled={percent <= SK_ZOOM_MIN}
        >
          −
        </button>
        <input
          type="range"
          className="SkSpZoom-slider"
          min={SK_ZOOM_MIN}
          max={SK_ZOOM_MAX}
          step={SK_ZOOM_STEP}
          value={percent}
          onChange={this.handleSlider}
          title={`Zoom: ${percent}%`}
          aria-label="Zoom level"
        />
        <button
          type="button"
          className="SkSpZoom-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => this.stepZoom(1)}
          disabled={percent >= SK_ZOOM_MAX}
        >
          +
        </button>
        <button
          type="button"
          className="SkSpZoom-value"
          title="Reset to 100%"
          aria-label={`Zoom ${percent}%, click to reset to 100%`}
          onClick={this.handleReset}
        >
          {percent} %
        </button>
      </div>
    );
  }
}

export default SkSpZoomControl;
