import React from "react";
import SkComponent from './SkComponent';

class SkPopUp extends SkComponent {
    constructor(props) {
        super(props);
        this.m_Label = props.Label;
        this.m_Parent = props.Parent;
        this.state = {
            width: 420,
            height: 560,
            posX: null,
            posY: null,
            isDragging: false,
            startX: 0,
            startY: 0,
        };
    }

    componentDidMount() {
        //this.CalculatePosition();
        /*
        window.addEventListener('mousedown', this.mouseDown);
        window.addEventListener('mousemove', this.mouseMove);
        window.addEventListener('mouseup', this.mouseUp);

        // Add touch events for mobile support
        window.addEventListener('touchstart', this.touchStart);
        window.addEventListener('touchmove', this.touchMove);
        window.addEventListener('touchend', this.touchEnd);
        */
    }

    componentWillUnmount() {
        /*
        console.log("SkPopUp::componentWillUnmount()");
        window.removeEventListener('mousedown', this.mouseDown);
        window.removeEventListener('mousemove', this.mouseMove);
        window.removeEventListener('mouseup', this.mouseUp);

        window.removeEventListener('touchstart', this.touchStart);
        window.removeEventListener('touchmove', this.touchMove);
        window.removeEventListener('touchend', this.touchEnd);
        */
    }

    componentDidUpdate() {
       
    }

    GetPosition () {
        const wRect = this.m_Ref.current.getBoundingClientRect();
        
        const wTop=wRect.top;
        const wLeft=wRect.left;
        const wHeight = wRect.height; 
        const wWidth = wRect.width;
        
        this.setState({ posX : wLeft, posY : wTop, width : wWidth, height : wHeight });
    };

    mouseDown = (event) => {
        if (event.target.className.includes('draggable-label')) {
            if (this.state.posX===null) {
                this.GetPosition();
            }
            event.preventDefault();
            this.setState({
                isDragging: true,
                startX: event.clientX,
                startY: event.clientY,
            });
        }
    }

    mouseMove = (event) => {
        const { isDragging, startX, startY } = this.state;
        if (isDragging) {
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;
            
            this.setState(prevState => ({
                posX: prevState.posX + deltaX,
                posY: prevState.posY + deltaY,
                startX: event.clientX,
                startY: event.clientY,
            }));
        }
    }

    mouseUp = () => {
        this.setState({ isDragging: false });
    }

    touchStart = (event) => {
        const touch = event.touches[0];
        if (event.target.className.includes('draggable-label')) {
            if (this.state.posX===null) {
                this.GetPosition();
            }
            event.stopPropagation();
            this.setState({
                isDragging: true,
                startX: touch.clientX,
                startY: touch.clientY,
            });
        }
    }

    touchMove = (event) => {
        event.stopPropagation();
        const { isDragging, startX, startY } = this.state;
        if (isDragging) {
            const touch = event.touches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            this.setState(prevState => ({
                posX: prevState.posX + deltaX,
                posY: prevState.posY + deltaY,
                startX: touch.clientX,
                startY: touch.clientY,
            }));
        }
    }

    touchEnd = (event) => {
        event.stopPropagation();
        this.setState({ isDragging: false });
    }

    handleResizeMouseDown = (event) => {
        event.stopPropagation();

        if (this.state.posX===null) {
            this.GetPosition();
        }
        const initialWidth = this.state.width;
        const initialHeight = this.state.height;
        const initialMouseX = event.clientX;
        const initialMouseY = event.clientY;

        const resizeMouseMove = (event) => {
            const newWidth = Math.max(100, initialWidth + (event.clientX - initialMouseX));
            const newHeight = Math.max(100, initialHeight + (event.clientY - initialMouseY));
            this.setState({ width: newWidth, height: newHeight });
        };

        const resizeMouseUp = () => {
            document.removeEventListener('mousemove', resizeMouseMove);
            document.removeEventListener('mouseup', resizeMouseUp);
        };

        document.addEventListener('mousemove', resizeMouseMove);
        document.addEventListener('mouseup', resizeMouseUp);
    };

    render() {
        const { width, height, posX, posY } = this.state;

        return (
        <div className="SkPopUp"
            ref={this.m_Ref}
            style={{
                transform: 'scale(1)',
                ...(posX!=null ? { left: posX } : { right: '0' }),
                ...(posY!=null ? { top: posY } : { top: '0' }),
                width: `${width}px`,
                height: `${height}px`,
            }}
            onMouseDown={this.mouseDown}
            onMouseMove={this.mouseMove}
            onMouseUp={this.mouseUp}
            onMouseLeave={this.mouseUp}
            onTouchStart={this.touchStart}
            onTouchMove={this.touchMove}
            onTouchEnd={this.touchEnd}
        >
            <div 
                className="draggable-label"
                onMouseDown={this.mouseDown}
                onTouchStart={this.touchStart}
                style={{
                    width: '100%',
                    height: '30px',
                    padding: '5px 10px',
                    cursor: 'move',
                }}
            >
                {this.m_Label}
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {this.props.children}
            </div>
            <div
                onMouseDown={this.handleResizeMouseDown}
                style={{
                    width: '100%',
                    height: '8px',
                    borderTop: '1px solid var(--sk-dialog-border)',
                    backgroundColor: 'transparent',
                    cursor: 'nwse-resize',
                }}
            />
        </div>
        );
    }
}

export default SkPopUp;