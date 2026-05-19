import { ObservabilityAdminPage } from './features/observability/components/ObservabilityAdminPage';
import { ResumeGeneratorPage } from './features/resume-generator/components/ResumeGeneratorPage';

function App() {
  return isObservabilityAdminRoute() ? <ObservabilityAdminPage /> : <ResumeGeneratorPage />;
}

export default App;

function isObservabilityAdminRoute() {
  if (typeof window === 'undefined') return false;

  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/admin/observability') {
    return true;
  }

  return window.location.hash.startsWith('#/admin/observability');
}