import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import './styles.css';
import { router } from './app/router';
import { AuthProvider } from './lib/auth';
import { configured } from './lib/supabase';
import { ConfirmProvider, ToastProvider } from './ui/feedback';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
    mutations: { retry: 0 },
  },
});

function Misconfigured() {
  return (
    <div className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-2xl">המערכת עוד לא מחוברת לשרת</h1>
      <p className="mt-2 text-muted">חסרים VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY בהגדרות הבנייה. ראו docs/05-operations.md.</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configured ? (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    ) : (
      <Misconfigured />
    )}
  </StrictMode>,
);
