import React from 'react';
import SkLoadingSpinner from './SkLoadingSpinner.js';
import SkFileLoadingSpinner from './SkFileLoadingSpinner.js';

class SkLoadingTest extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showSpinner: true,
      showFileSpinner: false,
      progress: 0
    };
  }

  componentDidMount() {
    // Test the spinners
    setTimeout(() => {
      this.setState({ showSpinner: false, showFileSpinner: true });
      
      // Simulate progress
      const interval = setInterval(() => {
        this.setState(prevState => {
          if (prevState.progress >= 100) {
            clearInterval(interval);
            return prevState;
          }
          return { progress: prevState.progress + 10 };
        });
      }, 500);
    }, 3000);
  }

  render() {
    const { showSpinner, showFileSpinner, progress } = this.state;

    if (showSpinner) {
      return (
        <div style={{ 
          width: '100vw', 
          height: '100vh', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: '#f5f5f5'
        }}>
          <SkLoadingSpinner 
            size="large" 
            text="Loading spinner test" 
            showText={true}
          />
        </div>
      );
    }

    if (showFileSpinner) {
      return (
        <div style={{ 
          width: '100vw', 
          height: '100vh', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: '#f5f5f5'
        }}>
          <SkFileLoadingSpinner 
            fileName="test.xlsx"
            size="large"
            progress={progress}
            showProgress={true}
            showText={true}
          />
        </div>
      );
    }

    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        gap: '20px'
      }}>
        <h1>Loading components test completed!</h1>
        <p>The spinners work correctly.</p>
        <button 
          onClick={() => window.location.reload()}
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
          Restart the test
        </button>
      </div>
    );
  }
}

export default SkLoadingTest;
