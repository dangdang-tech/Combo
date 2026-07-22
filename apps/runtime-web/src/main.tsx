import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { installGlobalClientErrorHandlers } from './api/telemetry.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { createRuntimeQueryClient } from './queryClient.js';
import './styles.css';
import './design-claude.css';

installGlobalClientErrorHandlers();

const queryClient = createRuntimeQueryClient();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
