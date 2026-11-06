import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { App } from './App';
import { ErrorBoundary, GlobalErrors } from './ui/common/ErrorReporter';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <GlobalErrors />
  </StrictMode>,
);
