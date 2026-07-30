import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const rootEl = document.documentElement;
const nav = window.navigator as Navigator & { standalone?: boolean };

function isStandalone() {
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

/* Safari’s toolbar sometimes overlays the layout viewport and sometimes
   already shrinks it. Measure the covered strip so the dock isn’t left
   floating above an empty gap (the old fixed 56px did that). */
function syncChromeBottom() {
  if (isStandalone()) {
    rootEl.style.setProperty('--chrome-b', '0px');
    return;
  }
  const vv = window.visualViewport;
  if (!vv) {
    rootEl.style.setProperty('--chrome-b', '0px');
    return;
  }
  const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  /* Cap so a software keyboard doesn’t shove chrome into the middle. */
  rootEl.style.setProperty('--chrome-b', `${Math.round(Math.min(covered, 72))}px`);
}

syncChromeBottom();
window.visualViewport?.addEventListener('resize', syncChromeBottom);
window.visualViewport?.addEventListener('scroll', syncChromeBottom);
window.addEventListener('resize', syncChromeBottom);

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
