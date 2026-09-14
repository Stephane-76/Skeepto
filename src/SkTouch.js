import React, { Component } from 'react';
import SkComponent from './component/SkComponent';

class SkTouch extends SkComponent {
    constructor(props) {
        super(props);
        this.canvasRef = React.createRef();
        this.textAreaRef = React.createRef();
        this.isDrawing = false;
    }

    componentDidMount() {
        const canvas = this.canvasRef.current;
        this.context = canvas.getContext('2d');
        this.context.lineJoin = 'round';
        this.context.lineCap = 'round';
        this.context.lineWidth = 3; // Stroke thickness
        this.context.fillStyle = "white";
        this.context.strokeStyle = "black";
        this.clearCanvas(); // Initialize the canvas
        let wCanvas=this.canvasRef.current;
        let wWidth= wCanvas.offsetWidth;
        let wHeight= wCanvas.offsetHeight;
        let wRatio=4

        wCanvas.width = wWidth * wRatio;
        wCanvas.height = wHeight * wRatio;
        this.context.scale(wRatio, wRatio);
        this.clearCanvas()
        this.textAreaRef.current.focus();
    }
    
    // Get the mouse coordinates
    getCanvasCoordinates(e) {
        const canvas = this.canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left); // X position relative to the canvas
        const y = (e.clientY - rect.top);  // Y position relative to the canvas
        return { x, y };
    }

    // Start drawing
    handleTouchStart = (e) => {
        const touch = e.touches[0];
        this.context.beginPath();
        const { x, y } = this.getCanvasCoordinates(touch);
        this.context.moveTo(x, y);
        this.isDrawing = true;
    };

    // Draw on the canvas
    handleTouchMove = (e) => {
        if (!this.isDrawing) return;
        const touch = e.touches[0];
        const { x, y } = this.getCanvasCoordinates(touch);
        this.context.lineTo(x, y);
        this.context.stroke();
    };

    // Stop drawing
    handleTouchEnd = () => {
        this.isDrawing = false;
        this.context.closePath();
    };

    // Mouse event handlers
    MouseDown = (event) => {
        this.context.beginPath();
        const { x, y } = this.getCanvasCoordinates(event);
        this.context.moveTo(x, y);
        this.isDrawing = true;
    };

    MouseMove = (event) => {
        if (!this.isDrawing) return;
        const { x, y } = this.getCanvasCoordinates(event);
        this.context.lineTo(x, y);
        this.context.stroke();
    };

    MouseUp = (event) => {
        this.isDrawing = false;
        this.context.closePath();
    };

    handleKeyDown = (e) => {
        // Handle keyboard events
        const key = e.key;
        console.log(`Key pressed: ${key}`);

        // Example: draw something based on key presses
        if (key === "d") {
            // Example: draw a dot when "d" is pressed
            this.context.beginPath();
            this.context.arc(100, 100, 5, 0, Math.PI * 2, true);
            this.context.fill();
        }
    };
    // Reset the screen
    clearCanvas = () => {
        const canvas = this.canvasRef.current;
        this.context.clearRect(0, 0, canvas.width, canvas.height);
        this.context.fillStyle = 'white'; 
        this.context.fillRect(0, 0, canvas.width, canvas.height); 
    };


    toggleKeyboard = () => {
        if (this.textAreaRef.current) {
            if (document.activeElement === this.textAreaRef.current) {
                this.textAreaRef.current.blur(); // Hide the keyboard
            } else {
                this.textAreaRef.current.focus(); // Show the keyboard
            }
        }
    };

    render() {
        return (
            <div ref={this.m_Ref} className="Space Width50" style={{ width: '100%', height: '100%' }}>
                <canvas
                    ref={this.canvasRef}
                    style={{ border: '1px solid black', width: '100%', height: '90%' }} // Set CSS styles
                    onTouchStart={this.handleTouchStart}
                    onTouchMove={this.handleTouchMove}
                    onTouchEnd={this.handleTouchEnd}
                    onMouseDown={this.MouseDown}
                    onMouseMove={this.MouseMove}
                    onMouseUp={this.MouseUp}
                />
                <textarea
                    ref={this.textAreaRef} // Hidden text field
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                    onKeyDown={this.handleKeyDown} // Listen for key events
                />
                 <div>
                    <button onClick={this.clearCanvas}>Clear Canvas</button>
                    <button onClick={this.toggleKeyboard}>Toggle Keyboard</button>
                </div>
            </div>
        );
    }
}

export default SkTouch;
