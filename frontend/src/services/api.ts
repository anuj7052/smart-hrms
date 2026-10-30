import axios from 'axios';
import { readAccessToken } from './session';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Attach access token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_REFRESH_EXCLUDE = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/microsoft'];

function getRequestPath(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  return url;
}

// Share refresh requests between session restoration and API retries, including
// React StrictMode's repeated mount effects.
let refreshPromise: Promise<string> | null = null;

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    const previousToken = localStorage.getItem('accessToken');
    refreshPromise = axios
      .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((res) => {
        const token = readAccessToken(res.data);
        // A login/logout may have completed while this request was in flight.
        if (localStorage.getItem('accessToken') === previousToken) {
          localStorage.setItem('accessToken', token);
        }
        return token;
      })
      .catch((error) => {
        const status = error?.response?.status;
        if ((status === 401 || status === 403) && localStorage.getItem('accessToken') === previousToken) {
          localStorage.removeItem('accessToken');
          window.dispatchEvent(new Event('auth:logout'));
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestPath = getRequestPath(original?.url);
    const hasAccessToken = !!localStorage.getItem('accessToken');
    const shouldSkipRefresh = AUTH_REFRESH_EXCLUDE.some((path) => requestPath.includes(path));

    if (error.response?.status === 401 && original && !original._retry && hasAccessToken && !shouldSkipRefresh) {
      original._retry = true;
      try {
        // A late 401 for the old token must not refresh or invalidate a new login.
        if (original.headers?.Authorization === `Bearer ${localStorage.getItem('accessToken')}`) {
          await refreshAccessToken();
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }

      return api(original);
    }
    return Promise.reject(error);
  }
);

export default api;
