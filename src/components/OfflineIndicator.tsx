import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-50 flex items-center justify-center sm:justify-start gap-2 rounded-xl bg-[#071A4D] border border-white/15 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="w-4 h-4 text-[#F5C6C8] shrink-0" />
      <span>Offline Mode — Cached screens remain available; reconnect to submit updates.</span>
    </div>
  );
};
