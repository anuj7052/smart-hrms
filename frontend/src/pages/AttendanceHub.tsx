import { useEffect, useRef, useState } from 'react';
import HubTabs from '../components/HubTabs';
import AttendancePage from './Attendance';
import AttendanceCalendarPage from './AttendanceCalendar';
import VirtualPunchWidget from '../components/VirtualPunchWidget';

/**
 * Unified Attendance workspace. Merges the old "Attendance" and "Calendar"
 * sidebar items into one tabbed page (they show the same data, just two
 * different lenses).
 *
 * ESSL Live is intentionally NOT included here — it lives as its own
 * sidebar item (HR/Admin only) because it's a real-time device-direct
 * feed and behaves quite differently from the DB-backed views below.
 */
export default function AttendanceHub() {
  const [punchOpen, setPunchOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!punchOpen) return;
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPunchOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setPunchOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [punchOpen]);

  const virtualPunchTrigger = (
    <div className="relative z-[60]" ref={popRef}>
      <button
        type="button"
        onClick={() => setPunchOpen((v) => !v)}
        aria-expanded={punchOpen}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-bold tracking-[0.01em] transition-all ${
          punchOpen
            ? 'bg-primary text-on-primary shadow-[0_10px_24px_rgba(2,76,128,0.25)]'
            : 'bg-primary/10 text-primary hover:bg-primary/15'
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">touch_app</span>
        <span>Virtual punch</span>
      </button>

      {punchOpen && (
        <div
          role="dialog"
          aria-label="Virtual punch"
          className="isolate absolute right-0 top-[calc(100%+12px)] z-[999] w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_28px_70px_rgba(15,23,42,0.20)] backdrop-blur-none"
          style={{ background: '#ffffff' }}
        >
          <div className="absolute -top-1.5 right-7 h-3 w-3 rotate-45 border-l border-t border-gray-200 bg-white" style={{ background: '#ffffff' }} />
          <VirtualPunchWidget />
        </div>
      )}
    </div>
  );

  return (
    <HubTabs
      tabs={[
        { key: 'today',    label: 'Today',    icon: 'schedule',       render: () => <AttendancePage /> },
        { key: 'calendar', label: 'Calendar', icon: 'calendar_month', render: () => <AttendanceCalendarPage /> },
      ]}
      defaultTab="today"
      rightSlot={virtualPunchTrigger}
    />
  );
}
