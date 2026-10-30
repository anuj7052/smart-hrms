import { useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';

export type HubTab = {
  key: string;
  label: string;
  icon?: string;            // Material Symbols name (optional)
  badge?: string;
  visible?: boolean;        // default true
  render: () => ReactNode;
};

type Props = {
  tabs: HubTab[];
  /** Query-string key used to persist the active tab. Defaults to "tab". */
  paramKey?: string;
  /** Fallback tab key when no query param is present. Defaults to first visible tab. */
  defaultTab?: string;
  /** Optional node rendered on the right side of the tab bar (e.g. a quick-action button). */
  rightSlot?: ReactNode;
};

/**
 * Lightweight tab container for hub pages (Attendance, Time Off, Devices).
 * Stores the active tab in the URL so deep links and legacy-route redirects
 * (e.g. /approvals → /time-off?tab=approvals) work out of the box.
 */
export default function HubTabs({ tabs, paramKey = 'tab', defaultTab, rightSlot }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleTabs = tabs.filter((t) => t.visible !== false);
  const requested = searchParams.get(paramKey) ?? defaultTab ?? visibleTabs[0]?.key;
  const active =
    visibleTabs.find((t) => t.key === requested) ?? visibleTabs[0];

  if (!active) return null;

  function selectTab(key: string) {
    const next = new URLSearchParams(searchParams);
    next.set(paramKey, key);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Section tabs"
        className="relative z-[60] flex flex-wrap items-center gap-1 rounded-2xl border border-primary/10 bg-surface/80 p-1.5 shadow-[0_8px_24px_rgba(4,32,52,0.05)] backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-center gap-1">
        {visibleTabs.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.key)}
              className={`group flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold tracking-[0.01em] transition-all ${
                isActive
                  ? 'bg-primary text-on-primary shadow-[0_10px_24px_rgba(2,76,128,0.25)]'
                  : 'text-on-surface-variant hover:bg-primary/10 hover:text-on-surface'
              }`}
            >
              {tab.icon && (
                <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              )}
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                    isActive
                      ? 'bg-white/20 text-on-primary'
                      : 'bg-primary/10 text-primary'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
        </div>
        {rightSlot && <div className="ml-auto flex items-center gap-2">{rightSlot}</div>}
      </div>

      {/* Active panel */}
      <div role="tabpanel" key={active.key}>
        {active.render()}
      </div>
    </div>
  );
}
