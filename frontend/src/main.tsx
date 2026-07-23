import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import App from './App.tsx';
import { ApiError, shouldRecheckSession } from './api/client.ts';
import { theme } from './theme.ts';

const queryClient = new QueryClient({
  /**
   * A session can lapse between requests, so any query may come back 401 — including
   * one fired long after sign-in. Re-checking the session centrally means the app falls
   * back to the sign-in screen wherever that happens, instead of each screen having to
   * notice for itself.
   */
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (shouldRecheckSession(error, query.queryKey)) {
        void queryClient.invalidateQueries({ queryKey: ['session'] });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 4xx means the request was wrong; repeating it verbatim will not help.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status < 500 ? false : failureCount < 2,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
