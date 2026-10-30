import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';

function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const map = [
    { label: '', color: 'bg-surface-container-high' },
    { label: 'Weak', color: 'bg-error' },
    { label: 'Fair', color: 'bg-secondary-container' },
    { label: 'Good', color: 'bg-tertiary-container' },
    { label: 'Strong', color: 'bg-primary' },
  ];
  return { score, ...map[score] };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', company: '', password: '', confirmPassword: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const pwdStrength = getPasswordStrength(form.password);

  function setField(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErr((e) => ({ ...e, [field]: '' }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Full name is required';
    if (!form.email) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Minimum 8 characters';
    else if (!/(?=.*[A-Z])(?=.*[0-9])/.test(form.password)) e.password = 'Must contain uppercase letter and number';
    if (form.confirmPassword && form.confirmPassword !== form.password) e.confirmPassword = 'Passwords do not match';
    return e;
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setFieldErr(errs); return; }
    setFieldErr({});
    setLoading(true);
    try {
      await api.post('/auth/register', {
        name: form.name.trim(),
        email: form.email.toLowerCase().trim(),
        password: form.password,
        company: form.company.trim() || undefined,
      });
      toast.success('Account created! Check your email to verify.');
      navigate('/verify-email', { state: { email: form.email } });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Registration failed. Please try again.';
      setFieldErr({ general: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const inputBase =
    'w-full h-12 pl-10 pr-4 rounded-xl border bg-white text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-[3px] transition-all shadow-inset-highlight';
  const inputOk  = 'border-outline-variant focus:border-primary focus:ring-primary/15';
  const inputErr = 'border-error focus:border-error focus:ring-error/15';

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[34px] lg:text-[40px] leading-[1.1] tracking-[-0.02em] font-bold text-on-surface mb-2">
          Create your workspace
        </h1>
        <p className="text-body-md text-on-surface-variant">
          Start managing your global workforce with effortless precision.
        </p>
      </div>

      {/* General error */}
      {fieldErr.general && (
        <div className="flex items-center gap-3 p-3.5 rounded-lg bg-error-container border border-error/20 mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="text-body-sm text-on-error-container">{fieldErr.general}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Full Name */}
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="text-label-md text-on-surface block">Full Name</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">person</span>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Jane Doe"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              className={`${inputBase} ${fieldErr.name ? inputErr : inputOk}`}
            />
          </div>
          {fieldErr.name && <p className="text-body-sm text-error">⚠ {fieldErr.name}</p>}
        </div>

        {/* Work Email */}
        <div className="space-y-1.5">
          <label htmlFor="workEmail" className="text-label-md text-on-surface block">Work Email</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">mail</span>
            <input
              id="workEmail"
              type="email"
              autoComplete="email"
              placeholder="jane@company.com"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              className={`${inputBase} ${fieldErr.email ? inputErr : inputOk}`}
            />
          </div>
          {fieldErr.email && <p className="text-body-sm text-error">⚠ {fieldErr.email}</p>}
        </div>

        {/* Company */}
        <div className="space-y-1.5">
          <label htmlFor="companyName" className="text-label-md text-on-surface block">Company Name</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">domain</span>
            <input
              id="companyName"
              type="text"
              autoComplete="organization"
              placeholder="Acme Corp"
              value={form.company}
              onChange={(e) => setField('company', e.target.value)}
              className={`${inputBase} ${inputOk}`}
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-label-md text-on-surface block">Password</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">lock</span>
            <input
              id="password"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setField('password', e.target.value)}
              className={`${inputBase} pr-10 ${fieldErr.password ? inputErr : inputOk}`}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-outline hover:text-on-surface transition-colors"
              aria-label={showPass ? 'Hide password' : 'Show password'}
            >
              <span className="material-symbols-outlined text-[20px]">
                {showPass ? 'visibility' : 'visibility_off'}
              </span>
            </button>
          </div>

          {form.password ? (
            <div className="mt-2 space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      i <= pwdStrength.score ? pwdStrength.color : 'bg-surface-container-high'
                    }`}
                  />
                ))}
              </div>
              {pwdStrength.label && (
                <p className="text-body-sm text-on-surface-variant">{pwdStrength.label} password</p>
              )}
            </div>
          ) : (
            <p className="text-body-sm text-outline mt-1">Must be at least 8 characters long.</p>
          )}
          {fieldErr.password && <p className="text-body-sm text-error">⚠ {fieldErr.password}</p>}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-label-md text-on-surface block">Confirm Password</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">lock</span>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={(e) => setField('confirmPassword', e.target.value)}
              className={`${inputBase} ${fieldErr.confirmPassword ? inputErr : inputOk}`}
            />
          </div>
          {fieldErr.confirmPassword && <p className="text-body-sm text-error">⚠ {fieldErr.confirmPassword}</p>}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="group relative w-full h-12 mt-2 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md shadow-glow-primary hover:shadow-glow-primary-lg transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden"
        >
          <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/15 to-transparent opacity-60 pointer-events-none" />
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin relative" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="relative">Creating account…</span>
            </>
          ) : (
            <>
              <span className="relative tracking-wide">Create Account</span>
              <span className="material-symbols-outlined text-[18px] relative transition-transform group-hover:translate-x-0.5">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      {/* Footer */}
      <div className="mt-8 text-center text-body-sm text-on-surface-variant">
        Already have an account?
        <Link to="/login" className="text-primary hover:text-primary-container text-label-md transition-colors ml-1">
          Sign in
        </Link>
      </div>

      <div className="mt-8 text-center">
        <p className="text-body-sm text-outline max-w-xs mx-auto">
          By creating an account, you agree to our{' '}
          <a className="underline hover:text-on-surface transition-colors" href="#">Terms of Service</a> and{' '}
          <a className="underline hover:text-on-surface transition-colors" href="#">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
