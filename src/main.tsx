import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/atlasOnly.css';
import { DESKTOP_ATLAS_RUNTIME } from './config/atlasOnlyRuntime';
import { installPublicCollaborationPolicyTransport } from './utils/publicCollaborationPolicyTransport';

if (!DESKTOP_ATLAS_RUNTIME) installPublicCollaborationPolicyTransport();

const CollaborationWorkspace = DESKTOP_ATLAS_RUNTIME
  ? (() => null)
  : lazy(() => import('./components/CollaborationWorkspace'));

const rootView = !DESKTOP_ATLAS_RUNTIME && window.location.pathname.startsWith('/collab')
  ? <Suspense fallback={<div className="grid h-screen place-items-center">正在加载协作画布…</div>}><CollaborationWorkspace /></Suspense>
  : <App />;

const app = import.meta.env.DEV && import.meta.env.VITE_T8_STRICT_MODE !== '1'
  ? rootView
  : (
    <StrictMode>
      {rootView}
    </StrictMode>
  );

createRoot(document.getElementById('root')!).render(app);
