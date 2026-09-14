import React, { useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { initTheme } from './SkTheme';
import App from './App';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import reportWebVitals from './reportWebVitals';
import { isDesktop } from './desktop/SkDesktopMode.js';

initTheme();

// Registers SPA navigation before deep trees mount so JWT expiry never triggers GET /login on the API.
function SkerNavigationBridge() {
  const navigate = useNavigate();
  useLayoutEffect(() => {
    window.__skerNavigateLogin = () => navigate('/login', { replace: true });
    window.__skerNavigate = (path, options) => navigate(path, options || {});
    return () => {
      delete window.__skerNavigateLogin;
      delete window.__skerNavigate;
    };
  }, [navigate]);
  return null;
}

const root = ReactDOM.createRoot(document.getElementById('root'));

const appTree = (
  <BrowserRouter>
    <>
      <SkerNavigationBridge />
      <App />
    </>
  </BrowserRouter>
);

// Desktop mounts the spreadsheet as the boot route; StrictMode's dev-only
// double mount/unmount leaves orphaned window listeners that dereference the
// (now nulled) interface. Keep StrictMode for the web build, skip it on desktop.
root.render(isDesktop ? appTree : <React.StrictMode>{appTree}</React.StrictMode>);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
