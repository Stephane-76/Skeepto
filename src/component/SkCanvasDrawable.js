//=============================================================================
// SkCanvasDrawable
// Clickable/drawable canvas behaving like an SVG for click position
//=============================================================================
import React from "react";
import PropTypes from "prop-types";
import SkCanvas from "./SkCanvas";

class SkCanvasDrawable extends SkCanvas {
  constructor(props) {
    super(props);
    this.state = { isDrawing: false };
    this.paths = []; // array of { color, width, points: [{x,y}] }
  }

  componentDidMount(prevProps) {
    super.componentDidMount?.(prevProps);
    this.ctx = this.m_Ref?.current?.getContext("2d") || null;
    this.resize();
  }

  componentDidUpdate(prevProps) {
    super.componentDidUpdate?.(prevProps);
  }

  componentWillUnmount(prevProps) {
    super.componentWillUnmount?.(prevProps);
  }

  // Ensure canvas backing store matches CSS size
  resize() {
    const canvas = this.m_Ref?.current;
    if (!canvas) return;

    const desiredWidth = this.props.width ?? canvas.clientWidth;
    const desiredHeight = this.props.height ?? canvas.clientHeight;

    if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
      canvas.width = desiredWidth;
      canvas.height = desiredHeight;
    }

    super.resize?.();
  }

  // Drawing routine
  paint() {
    const canvas = this.m_Ref?.current;
    if (!canvas || !this.ctx) return;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const path of this.paths) {
      const { points, color, width } = path;
      if (!points || points.length === 0) continue;
      ctx.strokeStyle = color ?? this.props.strokeColor;
      ctx.lineWidth = width ?? this.props.strokeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
  }

  // Coordinate helper relative to canvas
  getLocalPos = (event) => {
    const canvas = this.m_Ref?.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  handleClick = (event) => {
    if (this.props.onClick) {
      const pos = this.getLocalPos(event);
      this.props.onClick({ event, x: pos.x, y: pos.y });
    }
  };

  handleMouseDown = (event) => {
    const pos = this.getLocalPos(event);
    this.currentPath = {
      color: this.props.strokeColor,
      width: this.props.strokeWidth,
      points: [pos],
    };
    this.paths.push(this.currentPath);
    this.setState({ isDrawing: true }, () => this.invalidate());
  };

  handleMouseMove = (event) => {
    if (!this.state.isDrawing) return;
    const pos = this.getLocalPos(event);
    if (this.currentPath) {
      this.currentPath.points.push(pos);
      this.invalidate();
    }
  };

  stopDrawing = () => {
    if (!this.state.isDrawing) return;
    this.setState({ isDrawing: false }, () => this.invalidate());
    this.currentPath = null;
  };

  clear = () => {
    this.paths = [];
    this.invalidate();
  };

  render() {
    const { className = "", style, width, height } = this.props;
    const mergedStyle = {
      display: "block",
      touchAction: "none",
      ...style,
    };
    return (
      <canvas
        ref={this.m_Ref}
        className={`SkCanvasDrawable ${className}`}
        width={width}
        height={height}
        style={mergedStyle}
        onClick={this.handleClick}
        onMouseDown={this.handleMouseDown}
        onMouseMove={this.handleMouseMove}
        onMouseUp={this.stopDrawing}
        onMouseLeave={this.stopDrawing}
      />
    );
  }
}

SkCanvasDrawable.propTypes = {
  onClick: PropTypes.func,
  width: PropTypes.number,
  height: PropTypes.number,
  strokeColor: PropTypes.string,
  strokeWidth: PropTypes.number,
  style: PropTypes.object,
  className: PropTypes.string,
};

SkCanvasDrawable.defaultProps = {
  onClick: undefined,
  width: undefined,
  height: undefined,
  strokeColor: "#222",
  strokeWidth: 2,
  style: undefined,
  className: "",
};

export default SkCanvasDrawable;


