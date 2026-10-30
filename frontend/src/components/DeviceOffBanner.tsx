import { MoonStar } from 'lucide-react';
import { isDeviceOnlineHours, DEVICE_OFF_MESSAGE } from '../lib/deviceHours';

/**
 * Banner shown on ESSL pages when the biometric devices are powered off
 * (outside ~9 AM–9 PM IST). Renders nothing during operating hours.
 */
export default function DeviceOffBanner({ className = '' }: { className?: string }) {
  if (isDeviceOnlineHours()) return null;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}
      role="status"
    >
      <MoonStar className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-900">Devices are off</p>
        <p className="text-sm text-amber-800">{DEVICE_OFF_MESSAGE}</p>
      </div>
    </div>
  );
}
