import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import './index.css';
import { msalInstance } from './lib/msal';
import api from './services/api';
import { readSession } from './services/session';
import axios from 'axios';

// Initialize MSAL before rendering (required by MSAL v3+)
msalInstance.initialize().then(async () => {
  // Process redirect response if returning from Microsoft login
  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response?.idToken) {
      console.log('[MSAL] Redirect response received, exchanging token with backend...');
      const res = await api.post('/auth/microsoft', { idToken: response.idToken });
      const session = readSession(res.data);
      localStorage.setItem('accessToken', session.accessToken);
      sessionStorage.removeItem('sphere.microsoftLoginError');
      // Render the authenticated route without reloading the entire app and
      // running the Microsoft redirect/bootstrap flow a second time.
      window.history.replaceState(null, '', '/dashboard');
    }
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
    sessionStorage.setItem('sphere.microsoftLoginError', message || (err instanceof Error ? err.message : 'Microsoft sign-in could not be completed. Please try again.'));
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            background: '#fff',
            color: '#111',
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            borderRadius: '10px',
            fontSize: '14px',
          },
        }}
      />
    </React.StrictMode>
  );
});
