import React from 'react';
import './SkFileLoadingSpinner.css';

class SkFileLoadingSpinner extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      progress: 0,
      dots: 0
    };
  }

  componentDidMount() {
    // Animate dots
    this.dotInterval = setInterval(() => {
      this.setState(prevState => ({
        dots: (prevState.dots + 1) % 4
      }));
    }, 500);

    // Simulate progress if no progress prop is provided
    if (!this.props.progress && this.props.simulateProgress) {
      this.progressInterval = setInterval(() => {
        this.setState(prevState => {
          if (prevState.progress >= 90) {
            clearInterval(this.progressInterval);
            return prevState;
          }
          return { progress: prevState.progress + Math.random() * 10 };
        });
      }, 200);
    }
  }

  componentWillUnmount() {
    if (this.dotInterval) {
      clearInterval(this.dotInterval);
    }
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.progress !== prevProps.progress) {
      this.setState({ progress: this.props.progress || 0 });
    }
  }

  render() {
    const { 
      fileName = 'Fichier', 
      size = 'medium', 
      showProgress = true,
      progress = this.state.progress,
      showText = true,
      verb = 'Loading',
    } = this.props;
    
    const { dots } = this.state;
    const dotText = '.'.repeat(dots);

    return (
      <div className={`SkFileLoadingSpinner SkFileLoadingSpinner--${size}`}>
        <div className="SkFileLoadingSpinner__container">
          <div className="SkFileLoadingSpinner__icon">
            <div className="SkFileLoadingSpinner__file-icon">📄</div>
            <div className="SkFileLoadingSpinner__spinner-ring"></div>
          </div>
          
          {showText && (
            <div className="SkFileLoadingSpinner__text">
              <span className="SkFileLoadingSpinner__label">
                {verb} {fileName}
              </span>
              <span className="SkFileLoadingSpinner__dots" aria-hidden="true">
                {dotText}
              </span>
            </div>
          )}
          
          {showProgress && (
            <div className="SkFileLoadingSpinner__progress-container">
              <div className="SkFileLoadingSpinner__progress-bar">
                <div 
                  className="SkFileLoadingSpinner__progress-fill"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                ></div>
              </div>
              <div className="SkFileLoadingSpinner__progress-text">
                {Math.round(progress)}%
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default SkFileLoadingSpinner;
