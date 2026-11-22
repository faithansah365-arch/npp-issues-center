import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { USER_ROLE_LABELS, type PublicUser, type UserRole } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { BrandMark } from './BrandMark';
import { PrivacyComplianceModal } from './PrivacyComplianceModal';

interface SetupStatus {
  hasSuperAdmin: boolean;
  bootstrapConfigured: boolean;
  storageMode: 'mongodb_atlas' | 'local_dev';
  smtpConfigured: boolean;
}

export function AuthScreen() {
  const { refreshSession } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite');
  const resetToken = params.get('reset');

  const [mode, setMode] = useState<'login' | 'forgot' | 'invite' | 'reset'>(
    inviteToken ? 'invite' : resetToken ? 'reset' : 'login',
  );
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

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
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    apiRequest<{ user: PublicUser; expiresAt: string }>(`/api/auth/invite/${encodeURIComponent(inviteToken)}`)
      .then((res) => setInvitedUser(res.user))
      .catch((err) => setInviteError((err as Error).message));
  }, [inviteToken]);

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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <BrandMark size={30} />
            <span className="font-display text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
              NPP Internal Issue Portal
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            className="min-h-[44px] px-3 text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-4 hover:underline whitespace-nowrap shrink-0"
          >
            Privacy Notice
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Context Column */}
          <div className="lg:col-span-6 space-y-6 pt-2">
            <div className="space-y-3">
              <p className="text-xs font-medium text-blue-800 tracking-wide">
                New Patriotic Party · Ghana Internal Operations
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight text-balance">
                Structured issue reporting and escalation across party executive levels
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
                Record concerns raised at polling-station and executive meetings, assign clear ownership, escalate unresolved matters through the party hierarchy, and return verified resolutions to the originating station.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-5 space-y-3 text-sm text-slate-600">
              <div className="flex items-start gap-3">
                <Lock className="w-4 h-4 text-blue-800 mt-1 shrink-0" />
                <div>
                  <p className="font-medium text-slate-900">Invite-only executive access</p>
                  <p className="text-xs text-slate-600">
                    Public sign-up is disabled. Every executive account requires an approved invitation, geographic jurisdiction, and multi-factor authentication.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-blue-800 mt-1 shrink-0" />
                <div>
                  <p className="font-medium text-slate-900">Strict server-side scope verification</p>
                  <p className="text-xs text-slate-600">
                    Access to reports is enforced by the server according to your approved Polling Station, Constituency, Regional, or National assignment.
                  </p>
                </div>
              </div>
            </div>

            {setupStatus && !setupStatus.hasSuperAdmin && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-1.5">
                <p className="font-semibold">Initial Platform Setup Required</p>
                <p>
                  No Super Admin account has been configured yet. An authorized system operator must complete the private first-admin setup before inviting party executives.
                </p>
              </div>
            )}
          </div>

          {/* Right Authentication Card */}
          <div className="lg:col-span-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
              {mode === 'login' && (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      Executive Sign In
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Enter your approved credentials and 6-digit authenticator code.
                    </p>
                  </div>

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
                      Executive Level (Optional label — access is enforced by server)
                    </label>
                    <select
                      id="login-level"
                      value={selectedLevel}
                      onChange={(e) => setSelectedLevel(e.target.value as UserRole | '')}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
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
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="login-password" className="block text-xs font-medium text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setLoginError(null);
                        }}
                        className="text-xs font-medium text-blue-800 hover:underline py-1"
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
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 pl-3.5 pr-11 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
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
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
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
                        className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 font-mono text-sm tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[48px] rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900 disabled:opacity-60 transition-colors"
                  >
                    {submitting ? 'Verifying credentials…' : 'Sign In Securely'}
                  </button>
                </form>
              )}

              {mode === 'forgot' && (
                <form onSubmit={handleForgotSubmit} className="space-y-5">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      Request Password Reset
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Multi-factor authentication verification is still required to confirm a password reset.
                    </p>
                  </div>
                  {loginError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                      {loginError}
                    </div>
                  )}
                  {forgotMessage && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900">
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
                      className="flex-1 min-h-[44px] rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900 disabled:opacity-60"
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
                <div className="space-y-5">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      Activate Executive Invitation
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Set a strong password and enroll your authenticator app for multi-factor protection.
                    </p>
                  </div>

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
                        className="w-full min-h-[48px] rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900 disabled:opacity-60"
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
                        className="w-full min-h-[48px] rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900 disabled:opacity-60"
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
                        className="w-full min-h-[48px] rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
                      >
                        Continue to Executive Portal
                      </button>
                    </div>
                  )}
                </div>
              )}

              {mode === 'reset' && (
                <form onSubmit={handleResetConfirm} className="space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      Complete Password Reset
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Confirm your new strong password with your existing authenticator MFA code.
                    </p>
                  </div>
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
                      className="flex-1 min-h-[44px] rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900"
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
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>New Patriotic Party · Internal Executive Issue Management</span>
          <span>Confidential · Invite-Only · MFA Required</span>
        </div>
      </footer>

      <PrivacyComplianceModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}
