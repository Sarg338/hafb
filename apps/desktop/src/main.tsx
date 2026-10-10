import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { session } from './shell/session.ts';
import './app.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('index.html is missing #root');
}

// Ask for the launch plan first: loading it overlaps React's first render (S8.1).
session.openAtLaunch();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
