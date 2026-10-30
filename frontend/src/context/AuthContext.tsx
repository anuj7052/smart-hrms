import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import api, { refreshAccessToken } from '../services/api';
import { readSession } from '../services/session';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithMicrosoftToken: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const authVersion = useRef(0);

  const logout = useCallback(async () => {
    authVersion.current += 1;
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    localStorage.removeItem('accessToken');
    setUser(null);
  }, []);

  // Restore session on mount
  useEffect(() => {
    let active = true;
    const version = authVersion.current;
    const isCurrent = () => active && version === authVersion.current;
    const restore = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          await refreshAccessToken();
        }
        if (!isCurrent()) return;
        const meRes = await api.get('/auth/me');
        if (isCurrent()) {
          const session = readSession({ accessToken: localStorage.getItem('accessToken'), user: meRes.data });
          setUser(session.user);
        }
      } catch (error) {
        if (!isCurrent()) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401 || status === 403 || status === 404) {
          localStorage.removeItem('accessToken');
          setUser(null);
        } else {
          // A temporary API failure is not an expired session. Allow a retry
          // instead of silently sending a successfully signed-in user to login.
          setSessionError(true);
        }
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    };
    restore();
    return () => { active = false; };
  }, [restoreAttempt]);

  // Listen for forced logout event (token refresh failed)
  useEffect(() => {
    const handler = () => {
      setUser(null);
      localStorage.removeItem('accessToken');
    };
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email: email.trim(), password });
    const session = readSession(res.data);
    authVersion.current += 1;
    localStorage.setItem('accessToken', session.accessToken);
    setUser(session.user);
  };

  const loginWithMicrosoftToken = async (idToken: string) => {
    const res = await api.post('/auth/microsoft', { idToken });
    const session = readSession(res.data);
    authVersion.current += 1;
    localStorage.setItem('accessToken', session.accessToken);
    setUser(session.user);
  };

  if (sessionError) {
    return (
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p>Unable to connect to the server to restore your session. Please try again.</p>
        <button className="btn-primary" onClick={() => {
          setSessionError(false);
          setIsLoading(true);
          setRestoreAttempt((attempt) => attempt + 1);
        }}>Try again</button>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithMicrosoftToken, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
