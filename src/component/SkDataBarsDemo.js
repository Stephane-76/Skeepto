//=============================================================================
// SkDataBarsDemo
// Simple demo: button draws several DataBars on a canvas using drawDataBars
//=============================================================================
import React, { Component, createRef } from 'react';
import SkButton from './SkButton';
import { drawDataBars, normalizeHexColor } from '../utility/SkUtility';

class SkDataBarsDemo extends Component {
  constructor(props) {
    super(props);
    this.canvasRef = createRef();
  }

  componentDidMount() {
    // Optional: pre-draw on mount
    // this.handleDraw();
  }

  getContext() {
    const canvas = this.canvasRef.current;
    if (!canvas) return null;
    // Ensure backing store size matches CSS size
    const desiredWidth = (this.props.width ?? canvas.clientWidth) || 100;
    const desiredHeight = (this.props.height ?? canvas.clientHeight) || 160;
    if (canvas.width !== desiredWidth) canvas.width = desiredWidth;
    if (canvas.height !== desiredHeight) canvas.height = desiredHeight;
    return canvas.getContext('2d');
  }

  handleDraw = () => {
    const ctx = this.getContext();
    if (!ctx) return;

    const canvas = this.canvasRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Example configuration
    const itemCF = {
      type: 'DataBars',
      color: normalizeHexColor('4A90E2'),
      colorNegative: normalizeHexColor('E24A4A'),
      style: 'gradient', // or 'solid'
      minValue: -100,
      maxValue: 100,
    };

    // Example rows with various values
    const rows = [
      { label: 'Value -80', value: -80 },
      { label: 'Value -30', value: -30 },
      { label: 'Value  0', value: 0 },
      { label: 'Value  35', value: 35 },
      { label: 'Value  90', value: 90 },
    ];

    const startX = 10;
    const startY = 10;
    const rowHeight = 28;
    const barRectWidth = canvas.width - 140; // leave space for labels
    const barRectHeight = 18;

    ctx.font = '12px Roboto';
    ctx.fillStyle = '#222';
    ctx.textBaseline = 'middle';

    rows.forEach((row, index) => {
      const y = startY + index * rowHeight;

      // Draw label
      ctx.fillText(row.label, startX, y + barRectHeight / 2);

      // Compute bar rectangle area
      const cellRect = {
        x: startX + 120,
        y: y,
        width: barRectWidth,
        height: barRectHeight,
      };

      // Cell object with padding and numeric value
      const sCell = {
        c_v: row.value,
        f_p: 4,
      };

      drawDataBars(itemCF, ctx, cellRect, sCell);

      // Outline for clarity
      ctx.save();
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellRect.x, cellRect.y, cellRect.width, cellRect.height);
      ctx.restore();
    });
  };

  render() {
    const { className = '', style, width = 200, height = 160 } = this.props;
    return (
      <div className={`SkDataBarsDemo ${className}`} style={style}>
        <SkButton onClick={this.handleDraw} style={{ marginBottom: 8 }}>
          Draw the DataBars
        </SkButton>
        <canvas ref={this.canvasRef} width={width} height={height} style={{ border: '1px solid #e0e0e0' }} />
      </div>
    );
  }
}

export default SkDataBarsDemo;


