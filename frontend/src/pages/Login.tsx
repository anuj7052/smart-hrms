import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { msalLoginRequest, msalConfigured } from '../lib/msal';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';

export default function LoginPage() {
  const { instance: msalInstance } = useMsal();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [msLoading, setMsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [microsoftError, setMicrosoftError] = useState(() => sessionStorage.getItem('sphere.microsoftLoginError'));

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error('Enter email and password'); return; }
    setPwLoading(true);
    setLoginError(null);
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const data = axios.isAxiosError(err) ? err.response?.data : undefined;
      const msg = data?.message || data?.error || data?.errors?.[0]?.msg
        || (axios.isAxiosError(err) && !err.response ? 'Unable to connect to the server. Please try again.' : undefined)
        || (err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setLoginError(msg);
      toast.error(msg);
    } finally {
      setPwLoading(false);
    }
  }

  async function handleMicrosoftLogin() {
    setMicrosoftError(null);
    sessionStorage.removeItem('sphere.microsoftLoginError');
    if (!msalConfigured) {
      toast.error('Microsoft login is not configured. Set VITE_AZURE_AD_CLIENT_ID in frontend/.env');
      return;
    }
    setMsLoading(true);
    try {
      // Clear stale MSAL interaction state from interrupted redirects.
      Object.keys(localStorage).forEach((key) => {
        if (key.includes('interaction.status')) localStorage.removeItem(key);
      });

      await msalInstance.loginRedirect({
        ...msalLoginRequest,
        prompt: 'select_account',
      });
    } catch (err: unknown) {
      const e = err as { errorCode?: string; message?: string };
      if (e?.errorCode === 'interaction_in_progress') {
        toast.error('A sign-in is already in progress. Please wait or refresh the page.');
      } else {
        toast.error(e?.message || 'Microsoft sign-in failed');
      }
      setMsLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-[34px] lg:text-[40px] leading-[1.1] tracking-[-0.02em] font-bold text-on-surface mb-2">
          Welcome back
        </h2>
        <p className="text-body-md text-on-surface-variant">
          Sign in to your account.
        </p>
      </div>

      {microsoftError && (
        <div role="alert" className="mb-5 rounded-xl border border-error/20 bg-error-container p-4 text-body-sm text-error">
          <p className="font-semibold mb-1">Microsoft sign-in could not be completed</p>
          <p>{microsoftError}</p>
        </div>
      )}

      {/* ── Email / Password form ── */}
      {loginError && (
        <div role="alert" className="mb-5 rounded-xl border border-error/20 bg-error-container p-4 text-body-sm text-error">
          {loginError}
        </div>
      )}
      <form onSubmit={handleEmailLogin} className="space-y-3 mb-5">
        <div>
          <label className="block text-sm font-medium text-on-surface-variant mb-1">Email</label>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/60 bg-surface px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
        <div className="relative">
          <label className="block text-sm font-medium text-on-surface-variant mb-1">Password</label>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/60 bg-surface px-4 py-3 pr-12 text-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-3 bottom-3 text-outline hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
          </button>
        </div>
        <button
          type="submit"
          disabled={pwLoading}
          className="w-full h-[52px] rounded-2xl bg-primary text-white font-semibold text-sm shadow-[0_8px_24px_rgba(2,76,128,0.3)] hover:bg-primary/90 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:translate-y-0 flex items-center justify-center gap-2"
        >
          {pwLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : null}
          {pwLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {/* ── Divider ── */}
      <div className="relative flex items-center gap-3 my-5">
        <span className="flex-1 h-px bg-outline-variant/40" />
        <span className="text-xs text-outline">or continue with</span>
        <span className="flex-1 h-px bg-outline-variant/40" />
      </div>

      <button
        type="button"
        onClick={handleMicrosoftLogin}
        disabled={msLoading}
        className="group relative w-full h-[52px] overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-b from-white to-surface-container-low text-on-surface shadow-[0_8px_24px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_16px_40px_rgba(2,76,128,0.14)] active:translate-y-0 disabled:opacity-60"
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/80 to-transparent" />
        <span className="relative flex items-center justify-center gap-3">
          {msLoading ? (
            <svg className="w-4 h-4 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white shadow-[0_4px_12px_rgba(15,23,42,0.10)] ring-1 ring-black/5 transition-transform group-hover:scale-105">
              <svg className="w-4 h-4" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1h9v9H1z" fill="#f25022" />
                <path d="M1 11h9v9H1z" fill="#00a4ef" />
                <path d="M11 1h9v9h-9z" fill="#7fba00" />
                <path d="M11 11h9v9h-9z" fill="#ffb900" />
              </svg>
            </span>
          )}
          <span className="text-sm font-medium text-on-surface">
            {msLoading ? 'Connecting to Microsoft…' : 'Microsoft Entra ID'}
          </span>
        </span>
      </button>

      <div className="mt-8 flex justify-center gap-6 text-body-sm text-outline">
        <a className="hover:text-on-surface transition-colors" href="#">Privacy</a>
        <a className="hover:text-on-surface transition-colors" href="#">Terms</a>
        <a className="hover:text-on-surface transition-colors" href="#">Support</a>
      </div>
    </div>
  );
}
