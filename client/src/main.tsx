import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { installRuntimeStorageGuards } from './security/storageGuard.ts';
import './styles/index.css';

// Initialize Constraint C1 Runtime Storage Guards immediately before any components render
installRuntimeStorageGuards();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Fatal: Failed to locate DOM root element #root');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
