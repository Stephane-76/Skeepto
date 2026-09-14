import React from "react";

import SkComponent from './SkComponent';
import Editor from '@monaco-editor/react';

class SkMonacoEditor extends SkComponent {
  constructor(props) {
    super(props);
    this.state = {
      Code: props.Code
    };
    this.m_Error = "";
    this.editor = null;
    this.monaco = null;
  }

  // Prevent default touch behavior
  preventDefaultTouch = (e) => {
    e.preventDefault();
  };

  componentDidMount() {
    // Add touch event listeners
    const editorContainer = document.querySelector('.monaco-editor');
    if (editorContainer) {
      editorContainer.addEventListener('touchmove', this.preventDefaultTouch, { passive: false });
    }
  }

  componentWillUnmount() {
    // Clean up event listeners
    const editorContainer = document.querySelector('.monaco-editor');
    if (editorContainer) {
      editorContainer.removeEventListener('touchmove', this.preventDefaultTouch);
    }
  }

  handleEditorChange = (value) => {
    this.setState({ code: value });
  };

  getCode = () => {
    if (this.editor) {
      return this.editor.getValue();
    }
    return this.state.Code || "";
  };

  clearMarkers = () => {
    if (this.editor && this.monaco) {
      this.monaco.editor.setModelMarkers(this.editor.getModel(), 'owner', []);
    }
    this.m_Error = "";
  };

  reportError = (error) => {
    const wMessage = error?.message || String(error || "Unknown error");
    this.m_Error = wMessage;
    this.setState({ Error: wMessage });
    this.reportErrorInEditor(error);
  };

  reportErrorInEditor = (error) => {
    const wStack = error?.stack || "";
    const wLineMatch = wStack.match(/<anonymous>:(\d+):\d+/);
    if (wLineMatch && this.editor && this.monaco) {
      const lineNumber = parseInt(wLineMatch[1], 10);
      const marker = {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: 1,
        message: error.message,
        severity: this.monaco.MarkerSeverity.Error,
      };
      this.monaco.editor.setModelMarkers(this.editor.getModel(), 'owner', [marker]);
    }
  };

  handleEditorDidMount = (editor, monaco) => {
    this.editor = editor;
    this.monaco = monaco;
  };

  render() {
    return (
        <div style={{ 
          height: '100%',
          width: '100%',
          touchAction: 'none',
          WebkitOverflowScrolling: 'touch',
          overflow: 'hidden'
        }}>
          <Editor
            defaultLanguage="javascript"
            value={this.state.Code}
            onChange={this.handleEditorChange}
            onMount={this.handleEditorDidMount}
            options={{
              scrollBeyondLastLine: false,
              minimap: { enabled: false }
            }}
          />
        </div>
    );
  }
}

export default SkMonacoEditor;
