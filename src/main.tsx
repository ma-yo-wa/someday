import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

/* Older iOS reports home-screen apps via navigator.standalone, not
   display-mode. Drop the browser chrome offset so the dock sits tight. */
const nav = window.navigator as Navigator & { standalone?: boolean };
if (nav.standalone) {
  document.documentElement.style.setProperty('--chrome-b', '0px');
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
