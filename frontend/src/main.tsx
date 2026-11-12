import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerPwa } from './pwa';
import { AppErrorBoundary } from '@/components/feedback/app-error-boundary';
import { registerChunkReload } from '@/utils/chunk-reload';
import './assets/styles/global.css';

registerPwa();
registerChunkReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
