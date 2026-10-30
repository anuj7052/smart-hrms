import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/* ─── Custom Sphere wireframe logomark ─────────────────────────────────── */
function SphereMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sphereStroke" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" stroke="url(#sphereStroke)" strokeWidth="1.5" />
      <ellipse cx="16" cy="16" rx="13" ry="5"  stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.2" />
      <ellipse cx="16" cy="16" rx="5"  ry="13" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
      <line x1="3"  y1="16" x2="29" y2="16" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
      <circle cx="29" cy="16" r="1.4" fill="currentColor" />
      <circle cx="16" cy="3"  r="1.1" fill="currentColor" opacity="0.85" />
      <circle cx="16" cy="29" r="1.1" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen flex bg-surface text-on-surface antialiased selection:bg-primary-container selection:text-on-primary-container">
      {/* ── Left Cosmic Hero Panel (desktop) ─────────────────────────── */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden flex-col justify-between p-14 bg-cosmic-hero">
        {/* Animated aurora orbs */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-20 w-[32rem] h-[32rem] rounded-full bg-[#1e6fa3]/40 blur-[120px] animate-aurora" />
          <div className="absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-[#89ceff]/25 blur-[110px] animate-aurora-slow" />
          <div className="absolute -bottom-32 left-1/4 w-[26rem] h-[26rem] rounded-full bg-[#fd761a]/15 blur-[120px] animate-aurora [animation-delay:-9s]" />

          {/* Constellation rings */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.18]" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <radialGradient id="ring" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="white" stopOpacity="0" />
                <stop offset="70%" stopColor="white" stopOpacity="0.0" />
                <stop offset="100%" stopColor="white" stopOpacity="1" />
              </radialGradient>
            </defs>
            <g transform="translate(400 420)" className="animate-spin-slow origin-center">
              <circle r="180" fill="none" stroke="url(#ring)" strokeWidth="1" />
              <circle r="260" fill="none" stroke="url(#ring)" strokeWidth="1" strokeDasharray="2 6" />
              <circle r="340" fill="none" stroke="url(#ring)" strokeWidth="0.5" />
              <circle r="420" fill="none" stroke="url(#ring)" strokeWidth="0.5" strokeDasharray="1 8" />
            </g>
          </svg>

          {/* Subtle noise grain */}
          <div className="absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
          {/* Bottom fade */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#00263d] to-transparent" />
        </div>

        {/* Top: Logo */}
        <div className="relative z-10 flex items-center gap-3 animate-rise">
          <div className="w-11 h-11 rounded-xl bg-white/95 text-primary flex items-center justify-center shadow-glow-primary">
            <SphereMark size={24} />
          </div>
          <div>
            <span className="text-headline-md text-white font-bold tracking-tight leading-none block">Sphere</span>
            <span className="text-[11px] text-white/55 tracking-[0.2em] uppercase">Enterprise HR</span>
          </div>
        </div>

        {/* Middle: Headline */}
        <div className="relative z-10 max-w-md animate-rise [animation-delay:120ms]">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-[11px] tracking-[0.18em] uppercase text-white/75 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim animate-pulse" />
            New · v2.5 Released
          </span>
          <h1 className="text-[44px] leading-[1.08] tracking-tight font-bold text-white mb-5">
            Effortless control over your <span className="bg-gradient-to-r from-white via-tertiary-fixed-dim to-secondary-fixed-dim bg-clip-text text-transparent">global</span> workforce.
          </h1>
          <p className="text-body-lg text-white/65 max-w-sm leading-relaxed">
            A modern HR platform built for clarity. Attendance, payroll, leave, compliance &mdash; one calm surface.
          </p>
        </div>

        {/* Bottom: stat strip */}
        <div className="relative z-10 grid grid-cols-3 gap-6 animate-rise [animation-delay:240ms]">
          {[
            { v: '50K+', l: 'Employees Managed' },
            { v: '4.9★', l: 'Customer Rating' },
            { v: 'ISO 27001', l: 'Certified Secure' },
          ].map((s) => (
            <div key={s.l} className="border-l border-white/15 pl-4">
              <p className="text-white text-xl font-bold tracking-tight">{s.v}</p>
              <p className="text-[11px] text-white/55 mt-0.5 leading-tight">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right Form Panel ───────────────────────────────────────────── */}
      <div className="w-full lg:w-[52%] flex items-center justify-center p-6 sm:p-12 lg:p-16 relative overflow-hidden bg-gradient-to-br from-[#fafcff] via-surface to-[#eef4fb]">
        {/* Decorative blurred orbs */}
        <div className="absolute -top-40 right-0 w-[600px] h-[600px] bg-primary-container/[0.07] rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-40 -left-20 w-[500px] h-[500px] bg-tertiary-container/[0.08] rounded-full blur-[110px] pointer-events-none" />

        <div className="w-full max-w-[440px] relative z-10 animate-rise">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-2.5 mb-10">
            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shadow-glow-primary">
              <SphereMark size={22} />
            </div>
            <span className="text-headline-md text-primary font-bold tracking-tight">Sphere</span>
          </div>

          <Outlet />
        </div>
      </div>
    </div>
  );
}
