import React, { useState } from 'react';
import { Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../lib/usePWAInstall';

export const PWAInstallButton: React.FC<{
  variant?: 'header' | 'cta' | 'sidebar' | 'dark-header';
  className?: string;
}> = ({ variant = 'header', className = '' }) => {
  const { isInstallable, isInstalled, isIOS, isMobileDevice, install } = usePWAInstall();
  const [guideOpen, setGuideOpen] = useState<'ios' | 'manual' | null>(null);

  if (isInstalled) {
    return null;
  }

  // Show when browser offers native install prompt, on iOS Safari, or on mobile browsers
  if (!isInstallable && !isIOS && !isMobileDevice) {
    return null;
  }

  async function handleClick() {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setGuideOpen(isIOS ? 'ios' : 'manual');
  }

  const buttonClasses =
    variant === 'sidebar'
      ? 'w-full min-h-[44px] px-3.5 rounded-lg flex items-center gap-3 text-xs font-semibold text-[#0B2B7E] bg-[#EEF3FC] hover:bg-[#dfe9fa] transition-colors whitespace-nowrap'
      : variant === 'dark-header'
        ? 'min-h-[40px] px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors'
        : variant === 'cta'
          ? 'min-h-[44px] px-5 rounded-lg border border-[#0B2B7E]/30 bg-[#EEF3FC] hover:bg-[#dfe9fa] text-[#071A4D] text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap'
          : 'min-h-[42px] px-3 sm:px-3.5 rounded-lg border border-[#0B2B7E]/25 bg-[#EEF3FC] hover:bg-[#dfe9fa] text-[#071A4D] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors';

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`${buttonClasses} ${className}`}
        aria-label="Install NPP Portal mobile app"
      >
        {variant === 'sidebar' ? (
          <Smartphone className="w-4 h-4 shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        <span
          className={
            variant === 'header' || variant === 'dark-header' ? 'hidden sm:inline' : ''
          }
        >
          {variant === 'sidebar' ? 'Install Mobile App' : 'Install App'}
        </span>
      </button>

      {guideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install Mobile App Instructions"
        >
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]">
            <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
              <div className="bg-[#D41118]" />
              <div className="bg-white border-b border-slate-200/70" />
              <div className="bg-[#0B2B7E]" />
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-[#B30E14] uppercase tracking-wider">
                    Mobile App Installation
                  </p>
                  <h3 className="font-display text-lg font-semibold text-[#071A4D] mt-0.5">
                    {guideOpen === 'ios' ? 'Install on iPhone / iPad' : 'Install on Your Phone'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setGuideOpen(null)}
                  className="min-h-[40px] min-w-[40px] -mr-2 -mt-1 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Close installation guide"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {guideOpen === 'ios' ? (
                <ol className="space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="font-mono text-xs font-semibold text-[#0B2B7E] pt-0.5">1.</span>
                    <span>
                      Open this portal in <strong>Safari</strong> and tap the{' '}
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 font-medium text-xs">
                        <Share className="w-3.5 h-3.5" /> Share
                      </span>{' '}
                      button in the toolbar.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="font-mono text-xs font-semibold text-[#0B2B7E] pt-0.5">2.</span>
                    <span>
                      Scroll down and tap <strong>Add to Home Screen</strong>, then tap{' '}
                      <strong>Add</strong>.
                    </span>
                  </li>
                </ol>
              ) : (
                <ol className="space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="font-mono text-xs font-semibold text-[#0B2B7E] pt-0.5">1.</span>
                    <span>
                      Open your mobile browser menu{' '}
                      <span className="inline-flex items-center px-1 py-0.5 rounded bg-slate-100 text-slate-900">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </span>{' '}
                      (top-right in Chrome or Edge).
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="font-mono text-xs font-semibold text-[#0B2B7E] pt-0.5">2.</span>
                    <span>
                      Tap <strong>Install app</strong> or <strong>Add to Home screen</strong> to launch the NPP Portal as a standalone mobile app.
                    </span>
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setGuideOpen(null)}
                className="w-full min-h-[44px] rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium transition-colors"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
