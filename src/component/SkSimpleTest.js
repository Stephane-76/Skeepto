import React from 'react';
import './SkLoadingSpinner.css';

class SkSimpleTest extends React.Component {
  render() {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        backgroundColor: '#f5f5f5'
      }}>
        <div className="SkLoadingSpinner SkLoadingSpinner--medium">
          <div className="SkLoadingSpinner__card">
            <div className="SkLoadingSpinner__spinner" aria-hidden="true" />
            <p className="SkLoadingSpinner__text">Test simple du CSS</p>
          </div>
        </div>
      </div>
    );
  }
}

export default SkSimpleTest;
