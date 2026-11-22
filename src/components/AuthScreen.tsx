import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  LogIn,
  X,
} from 'lucide-react';
import {
  USER_ROLE_LABELS,
  type HomepageSlideRecord,
  type PublicUser,
  type UserRole,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { BrandMark } from './BrandMark';

interface SetupStatus {
  hasSuperAdmin: boolean;
  bootstrapConfigured: boolean;
  storageMode: 'mongodb_atlas' | 'local_dev';
  smtpConfigured: boolean;
}

const PARTY_LEVELS = [
  { num: '01', name: 'Polling Station', detail: 'Community & branch-level meeting concerns' },
  { num: '02', name: 'Constituency', detail: '276 constituencies coordinating local resolution' },
  { num: '03', name: 'Regional', detail: '16 regional committees handling escalated matters' },
  { num: '04', name: 'National', detail: 'National executive oversight across Ghana' },
];

export function AuthScreen() {
  const { refreshSession } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite');
  const resetToken = params.get('reset');

  const [mode, setMode] = useState<'login' | 'forgot' | 'invite' | 'reset'>(
    inviteToken ? 'invite' : resetToken ? 'reset' : 'login',
  );
  const [authModalOpen, setAuthModalOpen] = useState(Boolean(inviteToken || resetToken));
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  // Public slider state
  const [slides, setSlides] = useState<HomepageSlideRecord[]>([]);
  const [slidesLoaded, setSlidesLoaded] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [sliderPaused, setSliderPaused] = useState(false);
  const [brokenSlideIds, setBrokenSlideIds] = useState<Record<string, boolean>>({});

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<UserRole | ''>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

  // Invite activation state
  const [invitedUser, setInvitedUser] = useState<PublicUser | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirm, setInviteConfirm] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{
    enrollmentToken: string;
    qrDataUrl: string;
    manualSecret: string;
  } | null>(null);
  const [inviteTotp, setInviteTotp] = useState('');
  const [generatedBackupCodes, setGeneratedBackupCodes] = useState<string[] | null>(null);

  // Reset confirm state
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [resetTotp, setResetTotp] = useState('');
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<SetupStatus>('/api/setup/status')
      .then(setSetupStatus)
      .catch(() => {});

    apiRequest<{ slides: HomepageSlideRecord[] }>('/api/meta/slides')
      .then((res) => setSlides(res.slides))
      .catch(() => {})
      .finally(() => setSlidesLoaded(true));
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    apiRequest<{ user: PublicUser; expiresAt: string }>(
      `/api/auth/invite/${encodeURIComponent(inviteToken)}`,
    )
      .then((res) => setInvitedUser(res.user))
      .catch((err) => setInviteError((err as Error).message));
  }, [inviteToken]);

  useEffect(() => {
    if (slides.length <= 1 || sliderPaused || authModalOpen) return;
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [slides.length, sliderPaused, authModalOpen]);

  useEffect(() => {
    if (slideIndex >= slides.length && slides.length > 0) {
      setSlideIndex(0);
    }
  }, [slides.length, slideIndex]);

  const activeSlide = slides[slideIndex] || null;

  function openSignIn(nextMode: 'login' | 'forgot' = 'login') {
    setMode(nextMode);
    setLoginError(null);
    setAuthModalOpen(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginNotice(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ user: PublicUser; roleMismatchNotice: string | null }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: {
            email,
            password,
            totpCode: useBackupCode ? '' : totpCode,
            backupCode: useBackupCode ? backupCode : '',
            selectedLevel: selectedLevel || undefined,
          },
        },
      );
      if (res.roleMismatchNotice) {
        setLoginNotice(res.roleMismatchNotice);
      }
      await refreshSession();
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setForgotMessage(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: forgotEmail },
      });
      setForgotMessage(res.message);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInviteInitiateMfa(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (invitePassword !== inviteConfirm) {
      setInviteError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        enrollmentToken: string;
        qrDataUrl: string;
        manualSecret: string;
      }>(`/api/auth/invite/${encodeURIComponent(inviteToken!)}/initiate-mfa`, {
        method: 'POST',
        body: { password: invitePassword },
      });
      setMfaSetup(res);
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInviteComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaSetup || !inviteToken) return;
    setInviteError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ user: PublicUser; backupCodes: string[] }>(
        `/api/auth/invite/${encodeURIComponent(inviteToken)}/complete`,
        {
          method: 'POST',
          body: {
            enrollmentToken: mfaSetup.enrollmentToken,
            totpCode: inviteTotp,
          },
        },
      );
      setGeneratedBackupCodes(res.backupCodes);
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!resetToken) return;
    setLoginError(null);
    setResetMessage(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          token: resetToken,
          newPassword: resetNewPwd,
          totpCode: resetTotp,
        },
      });
      setResetMessage(res.message);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col justify-between">
      {/* Clean 3-Zone Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white border-b border-slate-200/70" />
          <div className="bg-[#0B2B7E]" />
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="flex items-center gap-3 whitespace-nowrap shrink-0"
          >
            <BrandMark size={30} />
            <span className="font-display text-base sm:text-lg font-semibold text-[#071A4D] tracking-tight">
              New Patriotic Party
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#gallery"
              className="hover:text-[#0B2B7E] transition-colors whitespace-nowrap shrink-0"
            >
              Gallery
            </a>
            <a
              href="#about"
              className="hover:text-[#0B2B7E] transition-colors whitespace-nowrap shrink-0"
            >
              About NPP
            </a>
            <a
              href="#structure"
              className="hover:text-[#0B2B7E] transition-colors whitespace-nowrap shrink-0"
            >
              Structure
            </a>
          </nav>

          <button
            type="button"
            onClick={() => openSignIn('login')}
            className="min-h-[42px] px-4 sm:px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <LogIn className="w-4 h-4 shrink-0" />
            <span>Sign In</span>
          </button>
        </div>
      </header>

      <main className="flex-1">
        {setupStatus && !setupStatus.hasSuperAdmin && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Initial Platform Setup Required:</strong> No Super Admin account has been configured yet.
              </span>
              <a href="/platform-admin" className="font-semibold underline text-[#071A4D]">
                Complete First-Admin Setup
              </a>
            </div>
          </div>
        )}

        {/* Animated NPP Hero Image Slider */}
        <section
          id="gallery"
          className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8"
          onMouseEnter={() => setSliderPaused(true)}
          onMouseLeave={() => setSliderPaused(false)}
        >
          <div className="relative aspect-[16/10] sm:aspect-[16/8.2] w-full rounded-2xl overflow-hidden bg-[#071A4D] border border-slate-200">
            {!slidesLoaded ? (
              <div className="absolute inset-0 bg-[#071A4D] animate-pulse" />
            ) : activeSlide ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSlide.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0"
                >
                  {!brokenSlideIds[activeSlide.id] ? (
                    <motion.img
                      src={activeSlide.imageUrl}
                      alt={activeSlide.title}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenSlideIds((prev) => ({ ...prev, [activeSlide.id]: true }))
                      }
                      initial={{ scale: 1.06 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 6, ease: 'easeOut' }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#071A4D] via-[#0B2B7E] to-[#7F0B10] flex items-center justify-center">
                      <ImageIcon className="w-12 h-12 text-white/40" />
                    </div>
                  )}

                  {/* Measured Contrast Scrim */}
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-[#071A4D]/92 via-[#071A4D]/40 to-black/15"
                    aria-hidden="true"
                  />

                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-x-0 bottom-0 p-6 sm:p-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6"
                  >
                    <div className="max-w-2xl space-y-2.5">
                      <p className="text-xs font-semibold text-[#F5C6C8] tracking-wide uppercase">
                        New Patriotic Party · Ghana
                      </p>
                      <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-semibold text-white tracking-tight text-balance">
                        {activeSlide.title}
                      </h1>
                      {activeSlide.caption && (
                        <p className="text-sm sm:text-base text-white/90 leading-relaxed max-w-xl">
                          {activeSlide.caption}
                        </p>
                      )}
                    </div>

                    {slides.length > 1 && (
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="text-xs font-mono tabular-nums text-white/85 mr-1">
                          {String(slideIndex + 1).padStart(2, '0')} /{' '}
                          {String(slides.length).padStart(2, '0')}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSlideIndex((prev) => (prev - 1 + slides.length) % slides.length)
                          }
                          className="min-h-[42px] min-w-[42px] rounded-lg bg-white/15 hover:bg-white/25 text-white border border-white/25 flex items-center justify-center transition-colors backdrop-blur-xs"
                          aria-label="Previous image"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSlideIndex((prev) => (prev + 1) % slides.length)}
                          className="min-h-[42px] min-w-[42px] rounded-lg bg-white/15 hover:bg-white/25 text-white border border-white/25 flex items-center justify-center transition-colors backdrop-blur-xs"
                          aria-label="Next image"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#071A4D] via-[#0B2B7E] to-[#A60D13] p-8 sm:p-12 flex flex-col justify-end">
                <p className="text-xs font-semibold text-[#F5C6C8] tracking-wide uppercase">
                  New Patriotic Party · Ghana
                </p>
                <h1 className="font-display text-3xl sm:text-5xl font-semibold text-white tracking-tight text-balance mt-2 max-w-2xl">
                  Development in Freedom
                </h1>
                <p className="text-sm sm:text-base text-white/85 mt-3 max-w-xl">
                  Connecting polling-station, constituency, regional, and national executives across Ghana.
                </p>
              </div>
            )}

            {/* Subtle Top Tricolour Progress Strip */}
            {slides.length > 1 && (
              <div className="absolute bottom-0 inset-x-0 flex h-1 bg-white/15">
                {slides.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`View slide ${idx + 1}: ${s.title}`}
                    onClick={() => setSlideIndex(idx)}
                    className={`flex-1 transition-colors ${
                      idx === slideIndex ? 'bg-[#D41118]' : 'bg-transparent hover:bg-white/30'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Clean Editorial About Section */}
        <section
          id="about"
          className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start"
        >
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[#B30E14] tracking-wide uppercase">
                About the Party
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#071A4D] tracking-tight text-balance">
                Rooted in Ghana’s communities, organized from every polling station upward
              </h2>
            </div>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Guided by the motto <em>Development in Freedom</em>, the New Patriotic Party brings together party officers and community organizers across all 16 regions and 276 parliamentary constituencies to address local concerns, strengthen grassroots organization, and deliver accountable action.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => openSignIn('login')}
                className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Executive Sign In</span>
              </button>
            </div>
          </div>

          <div
            id="structure"
            className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 divide-y divide-slate-100"
          >
            <div className="pb-3">
              <h3 className="text-sm font-semibold text-[#071A4D]">
                Party Executive Structure
              </h3>
            </div>
            {PARTY_LEVELS.map((lvl) => (
              <div key={lvl.num} className="py-3.5 first:pt-0 last:pb-0 flex items-baseline gap-4">
                <span className="font-mono text-xs font-semibold text-[#D41118] tabular-nums shrink-0">
                  {lvl.num}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{lvl.name}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{lvl.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span className="font-medium text-[#071A4D]">
            New Patriotic Party · Ghana
          </span>
          <button
            type="button"
            onClick={() => openSignIn('login')}
            className="font-medium text-[#0B2B7E] hover:underline"
          >
            Executive Sign In
          </button>
        </div>
      </footer>

      {/* Sign-In / Invite / Password Reset Modal */}
      <AnimatePresence>
        {authModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Executive Sign In"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl my-auto"
            >
              <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
                <div className="bg-[#D41118]" />
                <div className="bg-white border-b border-slate-200/70" />
                <div className="bg-[#0B2B7E]" />
              </div>

              <div className="p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-[11px] font-semibold text-[#B30E14] tracking-wide uppercase">
                      New Patriotic Party · Ghana
                    </p>
                    <h2 className="font-display text-xl font-semibold text-[#071A4D] mt-0.5">
                      {mode === 'login'
                        ? 'Executive Sign In'
                        : mode === 'forgot'
                          ? 'Request Password Reset'
                          : mode === 'invite'
                            ? 'Activate Executive Invitation'
                            : 'Complete Password Reset'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(false)}
                    className="min-h-[40px] min-w-[40px] -mr-2 -mt-1 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    aria-label="Close sign in dialog"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {mode === 'login' && (
                  <form onSubmit={handleLogin} className="space-y-4">
                    {loginError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
                      >
                        {loginError}
                      </div>
                    )}
                    {loginNotice && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                        {loginNotice}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label htmlFor="login-level" className="block text-xs font-medium text-slate-700">
                        Executive Level
                      </label>
                      <select
                        id="login-level"
                        value={selectedLevel}
                        onChange={(e) => setSelectedLevel(e.target.value as UserRole | '')}
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
                      >
                        <option value="">Auto-detect approved level</option>
                        <option value="POLLING_STATION">{USER_ROLE_LABELS.POLLING_STATION}</option>
                        <option value="CONSTITUENCY">{USER_ROLE_LABELS.CONSTITUENCY}</option>
                        <option value="REGIONAL">{USER_ROLE_LABELS.REGIONAL}</option>
                        <option value="NATIONAL">{USER_ROLE_LABELS.NATIONAL}</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="login-email" className="block text-xs font-medium text-slate-700">
                        Email Address
                      </label>
                      <input
                        id="login-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="executive@party-office.org"
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="login-password"
                          className="block text-xs font-medium text-slate-700"
                        >
                          Password
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setMode('forgot');
                            setLoginError(null);
                          }}
                          className="text-xs font-medium text-[#0B2B7E] hover:underline py-1"
                        >
                          Reset password
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full min-h-[44px] rounded-lg border border-slate-300 pl-3.5 pr-11 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-slate-500 hover:text-slate-800"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-mfa" className="block text-xs font-medium text-slate-700">
                          {useBackupCode ? 'Single-Use Backup Code' : 'Authenticator MFA Code'}
                        </label>
                        <button
                          type="button"
                          onClick={() => setUseBackupCode((v) => !v)}
                          className="text-xs text-slate-600 hover:text-slate-900 underline"
                        >
                          {useBackupCode ? 'Use 6-digit app code' : 'Use backup code'}
                        </button>
                      </div>
                      {useBackupCode ? (
                        <input
                          id="login-mfa"
                          type="text"
                          required
                          value={backupCode}
                          onChange={(e) => setBackupCode(e.target.value)}
                          placeholder="XXXXX-XXXXX"
                          className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
                        />
                      ) : (
                        <input
                          id="login-mfa"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          required
                          autoComplete="one-time-code"
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="6-digit code"
                          className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
                        />
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[48px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60 transition-colors"
                    >
                      {submitting ? 'Verifying credentials…' : 'Sign In'}
                    </button>
                  </form>
                )}

                {mode === 'forgot' && (
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    <p className="text-xs text-slate-500">
                      Multi-factor authentication verification is required to confirm a password reset.
                    </p>
                    {loginError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                        {loginError}
                      </div>
                    )}
                    {forgotMessage && (
                      <div className="rounded-lg border border-[#C7D4F2] bg-[#EEF3FC] px-3.5 py-2.5 text-xs text-[#071A4D]">
                        {forgotMessage}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-700">
                        Account Email
                      </label>
                      <input
                        id="forgot-email"
                        type="email"
                        required
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 min-h-[44px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60"
                      >
                        {submitting ? 'Submitting…' : 'Send Reset Request'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('login')}
                        className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Back
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'invite' && (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500">
                      Set a strong password and enroll your authenticator app.
                    </p>

                    {inviteError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                        {inviteError}
                      </div>
                    )}

                    {invitedUser && !generatedBackupCodes && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1">
                        <p className="font-semibold text-slate-900">{invitedUser.fullName}</p>
                        <p className="text-slate-600">
                          {invitedUser.email} · {USER_ROLE_LABELS[invitedUser.role]}
                        </p>
                        <p className="text-slate-600">
                          Approved Scope:{' '}
                          {[
                            invitedUser.pollingStationName,
                            invitedUser.constituencyName,
                            invitedUser.regionName,
                          ]
                            .filter(Boolean)
                            .join(', ') || 'National'}
                        </p>
                      </div>
                    )}

                    {invitedUser && !mfaSetup && !generatedBackupCodes && (
                      <form onSubmit={handleInviteInitiateMfa} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700">
                            New Password (min 12 chars, upper, lower, digit, symbol)
                          </label>
                          <input
                            type="password"
                            required
                            value={invitePassword}
                            onChange={(e) => setInvitePassword(e.target.value)}
                            className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700">
                            Confirm Password
                          </label>
                          <input
                            type="password"
                            required
                            value={inviteConfirm}
                            onChange={(e) => setInviteConfirm(e.target.value)}
                            className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="w-full min-h-[48px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60"
                        >
                          {submitting ? 'Preparing MFA…' : 'Continue to MFA Enrollment'}
                        </button>
                      </form>
                    )}

                    {mfaSetup && !generatedBackupCodes && (
                      <form onSubmit={handleInviteComplete} className="space-y-4">
                        <div className="flex flex-col items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                          <img
                            src={mfaSetup.qrDataUrl}
                            alt="Authenticator QR Code"
                            className="w-44 h-44 rounded-lg bg-white p-2 border border-slate-200"
                          />
                          <div className="text-center space-y-1">
                            <p className="text-xs text-slate-600">
                              Scan with Google Authenticator, Authy, or Microsoft Authenticator.
                            </p>
                            <p className="text-xs font-mono text-slate-800 break-all">
                              Manual key: {mfaSetup.manualSecret}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700">
                            Enter 6-digit Verification Code
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            value={inviteTotp}
                            onChange={(e) => setInviteTotp(e.target.value.replace(/\D/g, ''))}
                            className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm tracking-widest"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="w-full min-h-[48px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60"
                        >
                          {submitting ? 'Activating Account…' : 'Verify & Activate Account'}
                        </button>
                      </form>
                    )}

                    {generatedBackupCodes && (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                          <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
                            <KeyRound className="w-4 h-4" />
                            <span>Save Your Single-Use MFA Backup Codes</span>
                          </div>
                          <p className="text-xs text-emerald-800">
                            Store these recovery codes offline. Each code can be used once if you lose access to your authenticator device.
                          </p>
                          <div className="grid grid-cols-2 gap-2 pt-2">
                            {generatedBackupCodes.map((code) => (
                              <code
                                key={code}
                                className="bg-white border border-emerald-200 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 text-center"
                              >
                                {code}
                              </code>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            window.history.replaceState({}, '', '/');
                            void refreshSession();
                          }}
                          className="w-full min-h-[48px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C]"
                        >
                          Continue to Executive Portal
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {mode === 'reset' && (
                  <form onSubmit={handleResetConfirm} className="space-y-4">
                    <p className="text-xs text-slate-500">
                      Confirm your new strong password with your existing authenticator MFA code.
                    </p>
                    {loginError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                        {loginError}
                      </div>
                    )}
                    {resetMessage && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                        {resetMessage}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-700">
                        New Password (min 12 chars, upper, lower, digit, symbol)
                      </label>
                      <input
                        type="password"
                        required
                        value={resetNewPwd}
                        onChange={(e) => setResetNewPwd(e.target.value)}
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-700">
                        6-Digit Authenticator Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={resetTotp}
                        onChange={(e) => setResetTotp(e.target.value.replace(/\D/g, ''))}
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm tracking-widest"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 min-h-[44px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C]"
                      >
                        {submitting ? 'Updating…' : 'Update Password'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          window.history.replaceState({}, '', '/');
                          setMode('login');
                        }}
                        className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm text-slate-700"
                      >
                        Sign In
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
