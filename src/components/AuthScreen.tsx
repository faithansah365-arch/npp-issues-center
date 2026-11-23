import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LogIn,
  UserPlus,
  X,
} from 'lucide-react';
import {
  USER_ROLE_LABELS,
  type ConstituencyRecord,
  type HomepageSlideRecord,
  type PollingStationRecord,
  type PublicUser,
  type RegionRecord,
  type UserRole,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { BrandMark } from './BrandMark';
import { PWAInstallButton } from './PWAInstallButton';
import { ThemeToggle } from './ThemeToggle';

interface SetupStatus {
  hasSuperAdmin: boolean;
  bootstrapConfigured: boolean;
  storageMode: 'mongodb_atlas' | 'local_dev';
  smtpConfigured: boolean;
}

const DEFAULT_FALLBACK_SLIDES: HomepageSlideRecord[] = [
  {
    id: 'slide-default-1',
    title: 'Development in Freedom',
    caption:
      'New Patriotic Party delegates, organizers, and leadership working together across all 16 regions of Ghana.',
    imageUrl: '/assets/slides/npp_civic_assembly_1795358498204.jpg',
    mimeType: 'image/jpeg',
    sortOrder: 1,
    active: true,
    uploadedByUserId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'slide-default-2',
    title: 'Coordinated Executive Leadership',
    caption:
      'Polling-station, constituency, regional, and national executives reviewing community priorities and action plans.',
    imageUrl: '/assets/slides/npp_executive_forum_1795358497409.jpg',
    mimeType: 'image/jpeg',
    sortOrder: 2,
    active: true,
    uploadedByUserId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'slide-default-3',
    title: 'Rooted in Every Constituency',
    caption:
      'Listening to citizens across all 276 parliamentary constituencies and turning local concerns into timely action.',
    imageUrl: '/assets/slides/npp_community_outreach_1795358498035.jpg',
    mimeType: 'image/jpeg',
    sortOrder: 3,
    active: true,
    uploadedByUserId: null,
    createdAt: '',
    updatedAt: '',
  },
];

const PARTY_LEVELS = [
  { num: '01', name: 'Polling Station', detail: 'Community & branch-level meeting concerns' },
  { num: '02', name: 'Constituency', detail: '276 constituencies coordinating local resolution' },
  { num: '03', name: 'Regional', detail: '16 regional committees handling escalated matters' },
  { num: '04', name: 'National', detail: 'National executive oversight across Ghana' },
];

const GRID_COLS = 6;
const GRID_ROWS = 4;
const MOSAIC_CELLS = Array.from({ length: GRID_COLS * GRID_ROWS }, (_, index) => {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const centerCol = (GRID_COLS - 1) / 2;
  const centerRow = (GRID_ROWS - 1) / 2;
  const dx = col - centerCol;
  const dy = row - centerRow;
  const dist = Math.hypot(dx, dy);
  return {
    id: `${row}-${col}`,
    row,
    col,
    tileX: `${Math.round(dx * 18)}px`,
    tileY: `${Math.round(dy * 14)}px`,
    delayMs: Math.round((col * 0.032 + row * 0.042 + dist * 0.02) * 1000),
  };
});

function MosaicHeroImage({
  slide,
  broken,
  onError,
}: {
  slide: HomepageSlideRecord;
  broken: boolean;
  onError: () => void;
}) {
  if (broken) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#071A4D] via-[#0B2B7E] to-[#7F0B10] flex items-center justify-center">
        <ImageIcon className="w-12 h-12 text-white/40" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-gradient-to-br from-[#071A4D] via-[#0B2B7E] to-[#7F0B10]">
      {/* Primary fitted hero image settles after mosaic tiles finish assembling */}
      <img
        key={`base-${slide.id}`}
        src={slide.imageUrl}
        alt={slide.title}
        onError={onError}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="relative w-full h-full object-cover object-center npp-base-fade"
      />

      {/* GPU-composited mosaic tile assembly (auto-fits any uploaded image aspect ratio) */}
      <div
        className="absolute inset-0 grid pointer-events-none"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
        }}
        aria-hidden="true"
      >
        {MOSAIC_CELLS.map((cell) => (
          <div
            key={`${slide.id}-${cell.id}`}
            className="relative w-full h-full overflow-hidden npp-tile-assemble"
            style={
              {
                '--tile-x': cell.tileX,
                '--tile-y': cell.tileY,
                animationDelay: `${cell.delayMs}ms`,
              } as React.CSSProperties
            }
          >
            <img
              src={slide.imageUrl}
              alt=""
              loading="eager"
              decoding="async"
              className="absolute max-w-none object-cover object-center"
              style={{
                width: `${GRID_COLS * 100}%`,
                height: `${GRID_ROWS * 100}%`,
                left: `-${cell.col * 100}%`,
                top: `-${cell.row * 100}%`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthScreen() {
  const { refreshSession } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite');
  const resetToken = params.get('reset');

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'invite' | 'reset'>(
    inviteToken ? 'invite' : resetToken ? 'reset' : 'login',
  );
  const [authModalOpen, setAuthModalOpen] = useState(Boolean(inviteToken || resetToken));
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  // Public slider state (start with fallback slides so hero images render immediately)
  const [slides, setSlides] = useState<HomepageSlideRecord[]>(DEFAULT_FALLBACK_SLIDES);
  const [slideIndex, setSlideIndex] = useState(0);
  const [sliderPaused, setSliderPaused] = useState(false);
  const [brokenSlideIds, setBrokenSlideIds] = useState<Record<string, boolean>>({});

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<UserRole | ''>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sign-Up (Admin-Approved Registration) state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regTitle, setRegTitle] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('POLLING_STATION');
  const [regRegionId, setRegRegionId] = useState('');
  const [regConstituencyId, setRegConstituencyId] = useState('');
  const [regStationId, setRegStationId] = useState('');
  const [regCustomStationName, setRegCustomStationName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [constituencies, setConstituencies] = useState<ConstituencyRecord[]>([]);
  const [pollingStations, setPollingStations] = useState<PollingStationRecord[]>([]);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

  // Invite activation state
  const [invitedUser, setInvitedUser] = useState<PublicUser | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirm, setInviteConfirm] = useState('');

  // Reset confirm state
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<SetupStatus>('/api/setup/status')
      .then(setSetupStatus)
      .catch(() => {});

    apiRequest<{ slides: HomepageSlideRecord[] }>('/api/meta/slides')
      .then((res) => {
        if (Array.isArray(res.slides)) {
          setSlides(res.slides);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'signup' || regions.length > 0) return;
    apiRequest<{
      regions: RegionRecord[];
      constituencies: ConstituencyRecord[];
      pollingStations: PollingStationRecord[];
    }>('/api/meta/public-geography')
      .then((geo) => {
        setRegions(geo.regions);
        setConstituencies(geo.constituencies);
        setPollingStations(geo.pollingStations);
      })
      .catch(() => {});
  }, [mode, regions.length]);

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
    if (slides.length <= 1) return;
    const nextIdx = (slideIndex + 1) % slides.length;
    const nextUrl = slides[nextIdx]?.imageUrl;
    if (nextUrl) {
      const preloader = new window.Image();
      preloader.decoding = 'async';
      preloader.src = nextUrl;
    }
  }, [slides, slideIndex]);

  useEffect(() => {
    if (slideIndex >= slides.length && slides.length > 0) {
      setSlideIndex(0);
    }
  }, [slides.length, slideIndex]);

  const activeSlide = slides[slideIndex] || null;
  const filteredSignupCons = regRegionId
    ? constituencies.filter((c) => c.regionId === regRegionId)
    : [];
  const filteredSignupStations = regConstituencyId
    ? pollingStations.filter((s) => s.constituencyId === regConstituencyId)
    : [];

  function openAuthDialog(nextMode: 'login' | 'signup' | 'forgot' = 'login') {
    setMode(nextMode);
    setLoginError(null);
    setLoginNotice(null);
    setRegSuccess(null);
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
            selectedLevel: selectedLevel || undefined,
          },
        },
      );
      if (res.roleMismatchNotice) {
        setLoginNotice(res.roleMismatchNotice);
      }
      const me = await refreshSession();
      if (!me) {
        setLoginError(
          'Your credentials were verified, but your browser blocked the session cookie inside this preview frame. Please open the app directly in a new browser tab or allow cookies for this site.',
        );
      }
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setRegSuccess(null);
    if (regPassword !== regConfirmPassword) {
      setLoginError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: regName,
          email: regEmail,
          titleOrOffice: regTitle,
          role: regRole,
          regionId: regRegionId || null,
          constituencyId: regConstituencyId || null,
          pollingStationId: regStationId || null,
          customPollingStationName: regCustomStationName.trim() || undefined,
          password: regPassword,
        },
      });
      setRegSuccess(res.message);
      setRegName('');
      setRegEmail('');
      setRegTitle('');
      setRegPassword('');
      setRegConfirmPassword('');
      setRegCustomStationName('');
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

  async function handleInviteActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteToken) return;
    setInviteError(null);
    if (invitePassword !== inviteConfirm) {
      setInviteError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest<{ user: PublicUser }>(
        `/api/auth/invite/${encodeURIComponent(inviteToken)}/activate`,
        {
          method: 'POST',
          body: { password: invitePassword },
        },
      );
      window.history.replaceState({}, '', '/');
      const me = await refreshSession();
      if (!me) {
        setInviteError(
          'Your account was activated, but your browser blocked the session cookie inside this preview frame. Open the app directly in a new tab to sign in.',
        );
      }
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
    <div className="min-h-dvh bg-[#F7F9FC] flex flex-col justify-between">
      {/* Clean 3-Zone Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs safe-pt">
        <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white border-b border-slate-200/70" />
          <div className="bg-[#0B2B7E]" />
        </div>
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-6">
          <a href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
            <BrandMark size={28} />
            <span className="font-display text-sm sm:text-lg font-semibold text-[#071A4D] tracking-tight truncate">
              <span className="sm:hidden">NPP Portal</span>
              <span className="hidden sm:inline">New Patriotic Party</span>
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

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <ThemeToggle variant="light" />
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={() => openAuthDialog('signup')}
              aria-label="Sign Up"
              className="min-h-[38px] sm:min-h-[42px] px-2.5 sm:px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#071A4D] text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Sign Up</span>
            </button>
            <button
              type="button"
              onClick={() => openAuthDialog('login')}
              className="min-h-[38px] sm:min-h-[42px] px-3 sm:px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>Sign In</span>
            </button>
          </div>
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

        {/* Animated NPP Hero Image Slider with Mosaic Box Assembly */}
        <section
          id="gallery"
          className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8"
          onMouseEnter={() => setSliderPaused(true)}
          onMouseLeave={() => setSliderPaused(false)}
        >
          <div className="relative aspect-[4/3] sm:aspect-[16/8.2] w-full rounded-2xl overflow-hidden bg-[#071A4D] border border-slate-200">
            {activeSlide ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSlide.id}
                  initial={{ opacity: 0.35 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0.25 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0"
                >
                  <MosaicHeroImage
                    slide={activeSlide}
                    broken={Boolean(brokenSlideIds[activeSlide.id])}
                    onError={() =>
                      setBrokenSlideIds((prev) => ({ ...prev, [activeSlide.id]: true }))
                    }
                  />

                  {/* Measured Contrast Scrim */}
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-[#071A4D]/90 via-[#071A4D]/35 to-black/15 pointer-events-none"
                    aria-hidden="true"
                  />

                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-x-0 bottom-0 p-4 sm:p-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6"
                  >
                    <div className="max-w-2xl space-y-1.5 sm:space-y-2.5 min-w-0">
                      <p className="text-[10px] sm:text-xs font-semibold text-[#F5C6C8] tracking-wide uppercase">
                        New Patriotic Party · Ghana
                      </p>
                      <h1 className="font-display text-xl sm:text-4xl lg:text-5xl font-semibold text-white tracking-tight text-balance">
                        {activeSlide.title}
                      </h1>
                      {activeSlide.caption && (
                        <p className="hidden sm:block text-sm sm:text-base text-white/90 leading-relaxed max-w-xl">
                          {activeSlide.caption}
                        </p>
                      )}
                    </div>

                    {slides.length > 1 && (
                      <div className="flex items-center gap-2 shrink-0">
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

            {/* Subtle Bottom Slide Indicator Bar */}
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
          className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start"
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
            <div className="pt-2 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => openAuthDialog('login')}
                className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Executive Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => openAuthDialog('signup')}
                className="min-h-[44px] px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#071A4D] text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Request Access / Sign Up</span>
              </button>
              <PWAInstallButton variant="cta" className="justify-center" />
            </div>
          </div>

          <div
            id="structure"
            className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 divide-y divide-slate-100"
          >
            <div className="pb-3">
              <h3 className="text-sm font-semibold text-[#071A4D]">Party Executive Structure</h3>
            </div>
            {PARTY_LEVELS.map((lvl) => (
              <div
                key={lvl.num}
                className="py-3.5 first:pt-0 last:pb-0 flex items-baseline gap-4"
              >
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

      <footer className="border-t border-slate-200 bg-white safe-pb">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span className="font-medium text-[#071A4D]">New Patriotic Party · Ghana</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => openAuthDialog('signup')}
              className="font-medium text-slate-700 hover:underline"
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => openAuthDialog('login')}
              className="font-medium text-[#0B2B7E] hover:underline"
            >
              Executive Sign In
            </button>
          </div>
        </div>
      </footer>

      {/* Sign-In / Sign-Up / Invite / Password Reset Modal */}
      <AnimatePresence>
        {authModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Executive Portal Authentication"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl max-h-[92dvh] overflow-y-auto ios-scroll pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-0 sm:my-auto"
            >
              <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
                <div className="bg-[#D41118]" />
                <div className="bg-white border-b border-slate-200/70" />
                <div className="bg-[#0B2B7E]" />
              </div>

              <div className="p-5 sm:p-8">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-[11px] font-semibold text-[#B30E14] tracking-wide uppercase">
                      New Patriotic Party · Ghana
                    </p>
                    <h2 className="font-display text-xl font-semibold text-[#071A4D] mt-0.5">
                      {mode === 'login'
                        ? 'Executive Sign In'
                        : mode === 'signup'
                          ? 'Executive Sign Up'
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
                    aria-label="Close dialog"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {(mode === 'login' || mode === 'signup') && (
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl mb-5">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setLoginError(null);
                      }}
                      className={`min-h-[42px] sm:min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                        mode === 'login'
                          ? 'bg-white text-[#071A4D] shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signup');
                        setLoginError(null);
                      }}
                      className={`min-h-[42px] sm:min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
                        mode === 'signup'
                          ? 'bg-white text-[#071A4D] shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sign Up
                    </button>
                  </div>
                )}

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

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[48px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60 transition-colors"
                    >
                      {submitting ? 'Signing in…' : 'Sign In'}
                    </button>
                  </form>
                )}

                {mode === 'signup' && (
                  <form onSubmit={handleSignUp} className="space-y-3.5">
                    <p className="text-xs text-slate-600">
                      New registrations require administrator approval before access is granted.
                    </p>

                    {loginError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
                      >
                        {loginError}
                      </div>
                    )}
                    {regSuccess && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                        {regSuccess}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">Full Name</label>
                      <input
                        type="text"
                        required
                        minLength={3}
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Kwame Mensah"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">Email Address</label>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="executive@party-office.org"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700">
                          Office / Title
                        </label>
                        <input
                          type="text"
                          value={regTitle}
                          onChange={(e) => setRegTitle(e.target.value)}
                          placeholder="e.g. Secretary"
                          className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700">
                          Executive Level
                        </label>
                        <select
                          value={regRole}
                          onChange={(e) => {
                            setRegRole(e.target.value as UserRole);
                            setRegRegionId('');
                            setRegConstituencyId('');
                            setRegStationId('');
                            setRegCustomStationName('');
                          }}
                          className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                        >
                          <option value="POLLING_STATION">Polling-Station Executive</option>
                          <option value="CONSTITUENCY">Constituency Executive</option>
                          <option value="REGIONAL">Regional Executive</option>
                          <option value="NATIONAL">National Executive</option>
                        </select>
                      </div>
                    </div>

                    {regRole !== 'NATIONAL' && (
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700">Region</label>
                        <select
                          required
                          value={regRegionId}
                          onChange={(e) => {
                            setRegRegionId(e.target.value);
                            setRegConstituencyId('');
                            setRegStationId('');
                          }}
                          className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                        >
                          <option value="">Select Region</option>
                          {regions.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(regRole === 'CONSTITUENCY' || regRole === 'POLLING_STATION') && (
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700">
                          Constituency
                        </label>
                        <select
                          required
                          value={regConstituencyId}
                          onChange={(e) => {
                            setRegConstituencyId(e.target.value);
                            setRegStationId('');
                          }}
                          className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                        >
                          <option value="">Select Constituency</option>
                          {filteredSignupCons.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {regRole === 'POLLING_STATION' && regConstituencyId && (
                      <div className="space-y-2">
                        {filteredSignupStations.length > 0 && (
                          <div className="space-y-1">
                            <label className="block text-xs font-medium text-slate-700">
                              Polling Station
                            </label>
                            <select
                              value={regStationId}
                              onChange={(e) => {
                                setRegStationId(e.target.value);
                                if (e.target.value) setRegCustomStationName('');
                              }}
                              className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            >
                              <option value="">Select Registered Station (or type below)</option>
                              {filteredSignupStations.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.code})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {!regStationId && (
                          <div className="space-y-1">
                            <label className="block text-xs font-medium text-slate-700">
                              Polling Station Name
                            </label>
                            <input
                              type="text"
                              required={!regStationId}
                              minLength={2}
                              value={regCustomStationName}
                              onChange={(e) => setRegCustomStationName(e.target.value)}
                              placeholder="Enter your polling station name"
                              className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Password (min 8 chars, upper, lower, digit, symbol)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        required
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[46px] rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60 transition-colors"
                    >
                      {submitting ? 'Submitting Request…' : 'Submit Registration for Approval'}
                    </button>
                  </form>
                )}

                {mode === 'forgot' && (
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    <p className="text-xs text-slate-500">
                      Enter your approved executive email address to request a password reset link.
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
                      Set a strong password to activate your approved executive account.
                    </p>

                    {inviteError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                        {inviteError}
                      </div>
                    )}

                    {invitedUser && (
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

                    {invitedUser && (
                      <form onSubmit={handleInviteActivate} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700">
                            New Password (min 8 chars, upper, lower, digit, symbol)
                          </label>
                          <input
                            type="password"
                            required
                            minLength={8}
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
                          {submitting ? 'Activating Account…' : 'Activate Account & Sign In'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {mode === 'reset' && (
                  <form onSubmit={handleResetConfirm} className="space-y-4">
                    <p className="text-xs text-slate-500">
                      Set a new strong password for your executive account.
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
                        New Password (min 8 chars, upper, lower, digit, symbol)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={resetNewPwd}
                        onChange={(e) => setResetNewPwd(e.target.value)}
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
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
