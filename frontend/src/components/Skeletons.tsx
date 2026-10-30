/**
 * Reusable skeleton loading components for consistent loading states across the app.
 * Uses the `.skeleton` CSS class (animate-skeleton with pulse effect).
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`skeleton h-4 rounded-lg ${className}`} />;
}

export function SkeletonCircle({ size = 'w-10 h-10' }: { size?: string }) {
  return <div className={`skeleton rounded-full ${size}`} />;
}

export function SkeletonBlock({ className = 'h-24' }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

// ─── Composites ───────────────────────────────────────────────────────────────

/** KPI stat card skeleton (matches Dashboard KpiCard) */
export function SkeletonKpiCard() {
  return (
    <div className="bg-white border border-primary/10 rounded-2xl shadow-premium-card p-6">
      <div className="flex justify-between items-start mb-4">
        <div className="space-y-2 flex-1">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-8 w-24 rounded-lg" />
        </div>
        <div className="skeleton w-11 h-11 rounded-xl" />
      </div>
      <div className="skeleton h-3 w-32 rounded" />
    </div>
  );
}

/** Card-based content skeleton (for feed sections, action panels, etc.) */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
      <div className="skeleton h-5 w-40 rounded-lg mb-2" />
      <div className="skeleton h-3 w-56 rounded mb-6" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="skeleton w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 rounded w-3/4" />
              <div className="skeleton h-3 rounded w-1/2" />
            </div>
            <div className="skeleton h-6 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Table row skeleton */
export function SkeletonTableRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-6 py-4">
              <div className="skeleton h-4 rounded w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Leave balance card skeleton */
export function SkeletonBalanceCard() {
  return (
    <div className="bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="skeleton w-12 h-12 rounded-xl" />
        <div className="skeleton h-3 w-16 rounded" />
      </div>
      <div className="skeleton h-8 w-12 rounded-lg mb-2" />
      <div className="skeleton h-3 w-24 rounded mb-3" />
      <div className="skeleton h-1.5 w-full rounded-full mb-2" />
      <div className="skeleton h-3 w-28 rounded" />
    </div>
  );
}

/** Calendar grid skeleton */
export function SkeletonCalendarGrid() {
  return (
    <div className="grid grid-cols-7 gap-px bg-gray-100">
      {Array.from({ length: 35 }).map((_, i) => (
        <div key={i} className="bg-white min-h-[80px] p-2">
          <div className="skeleton h-5 w-5 rounded-full mb-2" />
          {i % 3 === 0 && <div className="skeleton h-3 w-full rounded mt-1" />}
          {i % 5 === 0 && <div className="skeleton h-3 w-2/3 rounded mt-1" />}
        </div>
      ))}
    </div>
  );
}

/** Profile page hero skeleton */
export function SkeletonProfileHero() {
  return (
    <div className="hero-header rounded-[28px] p-8 mb-6">
      <div className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-[22px] bg-white/10 animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-48 rounded-lg bg-white/10 animate-pulse" />
          <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded-full bg-white/10 animate-pulse" />
            <div className="h-5 w-20 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Info tile skeleton (for profile info grid) */
export function SkeletonInfoTile() {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="skeleton w-10 h-10 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-4 w-32 rounded" />
      </div>
    </div>
  );
}

/** Action tile skeleton (square quick-action buttons) */
export function SkeletonActionTile() {
  return (
    <div className="flex flex-col items-start gap-2 p-3 rounded-xl border border-primary/10">
      <div className="skeleton w-9 h-9 rounded-lg" />
      <div className="skeleton h-3 w-14 rounded" />
    </div>
  );
}

/** Full page loading skeleton with header + content */
export function SkeletonPage() {
  return (
    <div className="animate-in fade-in duration-200">
      <div className="mb-8">
        <div className="skeleton h-10 w-56 rounded-xl mb-2" />
        <div className="skeleton h-4 w-80 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <SkeletonKpiCard />
        <SkeletonKpiCard />
        <SkeletonKpiCard />
      </div>
      <SkeletonCard lines={5} />
    </div>
  );
}

/** Punch feed row skeleton */
export function SkeletonPunchFeed({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="py-3 flex items-center gap-4 px-2">
          <div className="skeleton w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 rounded w-2/3" />
            <div className="skeleton h-3 rounded w-1/3" />
          </div>
          <div className="skeleton h-4 w-14 rounded" />
          <div className="skeleton h-6 w-10 rounded-full" />
        </div>
      ))}
    </div>
  );
}
