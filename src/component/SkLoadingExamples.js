import React from 'react';
import SkLoadingSpinner from './SkLoadingSpinner.js';
import SkFileLoadingSpinner from './SkFileLoadingSpinner.js';

class SkLoadingExamples extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showExamples: false,
      fileProgress: 0
    };
  }

  componentDidMount() {
    // Simulate file loading progress
    this.progressInterval = setInterval(() => {
      this.setState(prevState => {
        if (prevState.fileProgress >= 100) {
          clearInterval(this.progressInterval);
          return prevState;
        }
        return { fileProgress: prevState.fileProgress + Math.random() * 15 };
      });
    }, 500);
  }

  componentWillUnmount() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  toggleExamples = () => {
    this.setState(prevState => ({ showExamples: !prevState.showExamples }));
  }

  render() {
    const { showExamples, fileProgress } = this.state;

    if (!showExamples) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <button 
            onClick={this.toggleExamples}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Show loading examples
          </button>
        </div>
      );
    }

    return (
      <div style={{ padding: '20px' }}>
        <button 
          onClick={this.toggleExamples}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            marginBottom: '20px'
          }}
        >
          Hide examples
        </button>

        <h2>Loading component examples</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          
          {/* Basic Loading Spinner */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>Basic spinner</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkLoadingSpinner 
                size="medium" 
                text="Loading" 
                showText={true}
              />
            </div>
          </div>

          {/* Small Loading Spinner */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>Small spinner</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkLoadingSpinner 
                size="small" 
                text="Loading..." 
                showText={true}
              />
            </div>
          </div>

          {/* Large Loading Spinner */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>Large spinner</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkLoadingSpinner 
                size="large" 
                text="Initializing the system" 
                showText={true}
              />
            </div>
          </div>

          {/* File Loading Spinner with Progress */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>File loading with progress</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkFileLoadingSpinner 
                fileName="document.xlsx"
                size="medium"
                progress={fileProgress}
                showProgress={true}
                showText={true}
              />
            </div>
          </div>

          {/* File Loading Spinner without Progress */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>File loading without progress</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkFileLoadingSpinner 
                fileName="image.jpg"
                size="small"
                showProgress={false}
                showText={true}
              />
            </div>
          </div>

          {/* File Loading Spinner with Simulated Progress */}
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h3>Loading with simulated progress</h3>
            <div style={{ height: '200px', position: 'relative' }}>
              <SkFileLoadingSpinner 
                fileName="video.mp4"
                size="large"
                simulateProgress={true}
                showProgress={true}
                showText={true}
              />
            </div>
          </div>

        </div>

        <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <h3>Usage in code:</h3>
          <pre style={{ backgroundColor: '#e9ecef', padding: '15px', borderRadius: '5px', overflow: 'auto' }}>
{`// Basic spinner
<SkLoadingSpinner 
  size="medium" 
  text="Loading" 
  showText={true}
/>

// File spinner with progress
<SkFileLoadingSpinner 
  fileName="document.xlsx"
  size="medium"
  progress={75}
  showProgress={true}
  showText={true}
/>

// Spinner with simulated progress
<SkFileLoadingSpinner 
  fileName="video.mp4"
  size="large"
  simulateProgress={true}
  showProgress={true}
  showText={true}
/>`}
          </pre>
        </div>
      </div>
    );
  }
}

export default SkLoadingExamples;
