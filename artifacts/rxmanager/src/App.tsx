import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import NewPrescriptionPage from '@/pages/doctor/NewPrescriptionPage';
import PrescriptionManagementPage from '@/pages/doctor/PrescriptionManagementPage';
import LoginPage from '@/pages/auth/LoginPage';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/doctor/prescriptions" component={PrescriptionManagementPage} />
        <Route path="/" component={NewPrescriptionPage} />
        <Route path="/doctor/new-prescription" component={NewPrescriptionPage} />
        {/* The published artifact can be reached with a deployment-prefixed pathname. */}
        <Route component={NewPrescriptionPage} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ThemeProvider>
            <LanguageProvider>
              <AuthProvider>
                <Router />
              </AuthProvider>
            </LanguageProvider>
          </ThemeProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
