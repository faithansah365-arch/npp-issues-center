import React, { useEffect, useState } from 'react';
import {
  Database,
  Download,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  USER_ROLE_LABELS,
  type AuditLogRecord,
  type CategoryRecord,
  type ConstituencyRecord,
  type IssueLevel,
  type IssueRecord,
  type PollingStationRecord,
  type PublicUser,
  type RegionRecord,
  type SystemSettingsRecord,
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

interface AdminOverview {
  storageMode: 'mongodb_atlas' | 'local_dev';
  nodeEnv: string;
  smtpConfigured: boolean;
  securityReadiness: {
    mongodbAtlasConfigured: boolean;
    persistentSessionSecret: boolean;
    persistentEncryptionKey: boolean;
    bootstrapSecretRemoved: boolean;
    smtpConfigured: boolean;
    dpaChecklistComplete: boolean;
  };
  counts: {
    totalUsers: number;
    activeUsers: number;
    pendingInvites: number;
    suspendedUsers: number;
    activeCategories: number;
    regions: number;
    constituencies: number;
    pollingStations: number;
  };
}

type AdminTab = 'overview' | 'users' | 'taxonomy' | 'settings' | 'audit';

export function PlatformAdminPortal({
  onSwitchWorkspace,
}: {
  onSwitchWorkspace?: (workspace: 'admin' | IssueLevel) => void;
} = {}) {
  const { user, loading: authLoading, refreshSession, logout } = useAuth();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Bootstrap state
  const [bootSecret, setBootSecret] = useState('');
  const [bootName, setBootName] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootStep2, setBootStep2] = useState<{
    setupToken: string;
    qrDataUrl: string;
    manualSecret: string;
  } | null>(null);
  const [bootTotp, setBootTotp] = useState('');
  const [bootBackupCodes, setBootBackupCodes] = useState<string[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootSubmitting, setBootSubmitting] = useState(false);

  // Admin Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTotp, setLoginTotp] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Authenticated Super Admin console state
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [constituencies, setConstituencies] = useState<ConstituencyRecord[]>([]);
  const [stations, setStations] = useState<PollingStationRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettingsRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminFeedback, setAdminFeedback] = useState<string | null>(null);

  // Invite form
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invTitle, setInvTitle] = useState('');
  const [invRole, setInvRole] = useState<UserRole>('POLLING_STATION');
  const [invRegionId, setInvRegionId] = useState('');
  const [invConstituencyId, setInvConstituencyId] = useState('');
  const [invStationId, setInvStationId] = useState('');
  const [lastIssuedLink, setLastIssuedLink] = useState<{
    label: string;
    url: string;
    emailSent: boolean;
    note: string;
  } | null>(null);

  // Inline polling station quick-register for invites
  const [quickPsName, setQuickPsName] = useState('');
  const [quickPsCode, setQuickPsCode] = useState('');
  const [quickPsCreating, setQuickPsCreating] = useState(false);

  // Geography directory filter
  const [geoFilterRegionId, setGeoFilterRegionId] = useState('');
  const [geoSearch, setGeoSearch] = useState('');

  // Taxonomy creation
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newConRegionId, setNewConRegionId] = useState('');
  const [newConName, setNewConName] = useState('');
  const [newConCode, setNewConCode] = useState('');
  const [newPsRegionId, setNewPsRegionId] = useState('');
  const [newPsConId, setNewPsConId] = useState('');
  const [newPsName, setNewPsName] = useState('');
  const [newPsCode, setNewPsCode] = useState('');

  // Break-glass inspection
  const [bgIssueId, setBgIssueId] = useState('');
  const [bgReason, setBgReason] = useState('');
  const [bgResult, setBgResult] = useState<IssueRecord | null>(null);

  const loadSetupStatus = () => {
    setStatusLoading(true);
    apiRequest<SetupStatus>('/api/setup/status')
      .then(setSetupStatus)
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  };

  useEffect(() => {
    loadSetupStatus();
  }, []);

  async function loadAdminData() {
    setAdminError(null);
    try {
      const [ov, usr, cats, geo, sets, logs] = await Promise.all([
        apiRequest<AdminOverview>('/api/admin/overview'),
        apiRequest<{ users: PublicUser[] }>('/api/admin/users'),
        apiRequest<{ categories: CategoryRecord[] }>('/api/admin/categories'),
        apiRequest<{
          regions: RegionRecord[];
          constituencies: ConstituencyRecord[];
          pollingStations: PollingStationRecord[];
        }>('/api/meta/geography'),
        apiRequest<{ settings: SystemSettingsRecord }>('/api/admin/settings'),
        apiRequest<{ logs: AuditLogRecord[] }>('/api/admin/audit-logs?limit=200'),
      ]);
      setOverview(ov);
      setUsers(usr.users);
      setCategories(cats.categories);
      setRegions(geo.regions);
      setConstituencies(geo.constituencies);
      setStations(geo.pollingStations);
      setSettings(sets.settings);
      setAuditLogs(logs.logs);
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      void loadAdminData();
    }
  }, [user]);

  async function handleBootstrapStep1(e: React.FormEvent) {
    e.preventDefault();
    setBootError(null);
    setBootSubmitting(true);
    try {
      const res = await apiRequest<{
        setupToken: string;
        qrDataUrl: string;
        manualSecret: string;
      }>('/api/setup/first-admin/initiate', {
        method: 'POST',
        body: {
          bootstrapSecret: bootSecret,
          fullName: bootName,
          email: bootEmail,
          password: bootPassword,
        },
      });
      setBootStep2(res);
    } catch (err) {
      setBootError((err as Error).message);
    } finally {
      setBootSubmitting(false);
    }
  }

  async function handleBootstrapStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!bootStep2) return;
    setBootError(null);
    setBootSubmitting(true);
    try {
      const res = await apiRequest<{ backupCodes: string[] }>('/api/setup/first-admin/complete', {
        method: 'POST',
        body: {
          setupToken: bootStep2.setupToken,
          totpCode: bootTotp,
        },
      });
      setBootBackupCodes(res.backupCodes);
    } catch (err) {
      setBootError((err as Error).message);
    } finally {
      setBootSubmitting(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: {
          email: loginEmail,
          password: loginPassword,
          totpCode: loginTotp,
        },
      });
      await refreshSession();
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    setAdminFeedback(null);
    setLastIssuedLink(null);
    try {
      const res = await apiRequest<{
        user: PublicUser;
        inviteUrl: string;
        emailSent: boolean;
        emailStatusNote: string;
      }>('/api/admin/users/invite', {
        method: 'POST',
        body: {
          fullName: invName,
          email: invEmail,
          titleOrOffice: invTitle,
          role: invRole,
          regionId: invRegionId || null,
          constituencyId: invConstituencyId || null,
          pollingStationId: invStationId || null,
        },
      });
      setLastIssuedLink({
        label: `Invitation link for ${res.user.email}`,
        url: res.inviteUrl,
        emailSent: res.emailSent,
        note: res.emailStatusNote,
      });
      setInvName('');
      setInvEmail('');
      setInvTitle('');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleUserStatusChange(targetId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED') {
    setAdminError(null);
    try {
      await apiRequest(`/api/admin/users/${targetId}`, {
        method: 'PATCH',
        body: { status },
      });
      setAdminFeedback(`Account status updated to ${status}.`);
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleReissueLink(target: PublicUser) {
    setAdminError(null);
    try {
      const res = await apiRequest<{
        actionType: string;
        url: string;
        emailSent: boolean;
        emailStatusNote: string;
      }>(`/api/admin/users/${target.id}/reinvite`, { method: 'POST' });
      setLastIssuedLink({
        label:
          res.actionType === 'INVITE'
            ? `Activation link for ${target.email}`
            : `Password reset link for ${target.email}`,
        url: res.url,
        emailSent: res.emailSent,
        note: res.emailStatusNote,
      });
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleUnlockUser(targetId: string) {
    await apiRequest(`/api/admin/users/${targetId}`, {
      method: 'PATCH',
      body: { unlockAccount: true },
    });
    setAdminFeedback('Account login lockout cleared.');
    await loadAdminData();
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    try {
      await apiRequest('/api/admin/categories', {
        method: 'POST',
        body: { name: newCatName, description: newCatDesc },
      });
      setNewCatName('');
      setNewCatDesc('');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleToggleCategory(cat: CategoryRecord) {
    await apiRequest(`/api/admin/categories/${cat.id}`, {
      method: 'PATCH',
      body: { active: !cat.active },
    });
    await loadAdminData();
  }

  async function handleAddConstituency(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    try {
      await apiRequest('/api/admin/geography/constituency', {
        method: 'POST',
        body: { regionId: newConRegionId, name: newConName, code: newConCode },
      });
      setNewConName('');
      setNewConCode('');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleAddStation(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    try {
      await apiRequest('/api/admin/geography/polling-station', {
        method: 'POST',
        body: {
          regionId: newPsRegionId,
          constituencyId: newPsConId,
          name: newPsName,
          code: newPsCode,
        },
      });
      setNewPsName('');
      setNewPsCode('');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setAdminError(null);
    setAdminFeedback(null);
    try {
      const res = await apiRequest<{ settings: SystemSettingsRecord }>('/api/admin/settings', {
        method: 'PATCH',
        body: settings,
      });
      setSettings(res.settings);
      setAdminFeedback('System retention, security timeouts, and DPA settings saved.');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleQuickCreateStation() {
    if (!invRegionId || !invConstituencyId || quickPsName.trim().length < 2) return;
    setAdminError(null);
    setQuickPsCreating(true);
    try {
      const res = await apiRequest<{ pollingStation: PollingStationRecord }>(
        '/api/admin/geography/polling-station',
        {
          method: 'POST',
          body: {
            regionId: invRegionId,
            constituencyId: invConstituencyId,
            name: quickPsName.trim(),
            code: quickPsCode.trim(),
          },
        },
      );
      setQuickPsName('');
      setQuickPsCode('');
      await loadAdminData();
      setInvStationId(res.pollingStation.id);
      setAdminFeedback(`Polling station "${res.pollingStation.name}" registered and selected.`);
    } catch (err) {
      setAdminError((err as Error).message);
    } finally {
      setQuickPsCreating(false);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAdminError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await apiRequest('/api/admin/backup/restore', { method: 'POST', body: parsed });
      setAdminFeedback('Backup archive restored successfully.');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleBreakGlass(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    setBgResult(null);
    try {
      const res = await apiRequest<{ issue: IssueRecord }>(
        `/api/admin/break-glass/issue/${encodeURIComponent(bgIssueId.trim())}`,
        {
          method: 'POST',
          body: { reason: bgReason },
        },
      );
      setBgResult(res.issue);
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  if (authLoading || statusLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm text-slate-600">
        Verifying platform administration state…
      </div>
    );
  }

  // Case 1: Zero Super Admins exist -> Secure First-Admin Bootstrap
  if (setupStatus && !setupStatus.hasSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <div>
              <h1 className="font-display text-lg font-semibold text-white">
                First Super Admin Setup
              </h1>
              <p className="text-xs text-slate-400">
                Protected initial platform provisioning
              </p>
            </div>
          </div>

          {!setupStatus.bootstrapConfigured ? (
            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-200 space-y-2">
                <p className="font-semibold">Server Bootstrap Secret Required</p>
                <p>
                  No default passwords or tokens are shipped in code. To create the first Super Admin account, choose one of these two methods on the server:
                </p>
              </div>
              <ol className="list-decimal pl-5 space-y-2">
                <li>
                  <strong>Environment Variable:</strong> Set{' '}
                  <code className="font-mono text-white bg-slate-800 px-1.5 py-0.5 rounded">
                    BOOTSTRAP_ADMIN_SECRET
                  </code>{' '}
                  in your server environment (or Secrets panel), restart the server, then refresh this page to complete web setup with TOTP MFA.
                </li>
                <li>
                  <strong>Server CLI:</strong> Run{' '}
                  <code className="font-mono text-white bg-slate-800 px-1.5 py-0.5 rounded">
                    npm run bootstrap-admin
                  </code>{' '}
                  directly in the server shell.
                </li>
              </ol>
              <button
                type="button"
                onClick={loadSetupStatus}
                className="min-h-[42px] px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white inline-flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-check Server Status</span>
              </button>
            </div>
          ) : bootBackupCodes ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-4 space-y-2 text-xs text-emerald-100">
                <p className="font-semibold text-sm">Super Admin Activated</p>
                <p>
                  Save these single-use recovery backup codes offline, and remove{' '}
                  <code className="font-mono">BOOTSTRAP_ADMIN_SECRET</code> from your server environment.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {bootBackupCodes.map((c) => (
                    <code
                      key={c}
                      className="bg-slate-950 border border-emerald-700/50 rounded px-2 py-1.5 text-center font-mono text-white"
                    >
                      {c}
                    </code>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  loadSetupStatus();
                  void refreshSession();
                }}
                className="w-full min-h-[46px] rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
              >
                Enter Platform Admin Console
              </button>
            </div>
          ) : !bootStep2 ? (
            <form onSubmit={handleBootstrapStep1} className="space-y-4">
              {bootError && (
                <div className="rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-200">
                  {bootError}
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Server BOOTSTRAP_ADMIN_SECRET
                </label>
                <input
                  type="password"
                  required
                  value={bootSecret}
                  onChange={(e) => setBootSecret(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={bootName}
                  onChange={(e) => setBootName(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Administrator Email</label>
                <input
                  type="email"
                  required
                  value={bootEmail}
                  onChange={(e) => setBootEmail(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Strong Password (min 12 chars, upper, lower, digit, symbol)
                </label>
                <input
                  type="password"
                  required
                  value={bootPassword}
                  onChange={(e) => setBootPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                disabled={bootSubmitting}
                className="w-full min-h-[46px] rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
              >
                {bootSubmitting ? 'Preparing MFA…' : 'Continue to Mandatory MFA Setup'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleBootstrapStep2} className="space-y-4">
              {bootError && (
                <div className="rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-200">
                  {bootError}
                </div>
              )}
              <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <img
                  src={bootStep2.qrDataUrl}
                  alt="Super Admin MFA QR Code"
                  className="w-44 h-44 bg-white p-2 rounded-lg"
                />
                <p className="text-xs text-slate-400 text-center">
                  Scan in your authenticator app or enter key:{' '}
                  <span className="font-mono text-white break-all">{bootStep2.manualSecret}</span>
                </p>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  6-Digit Authenticator Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={bootTotp}
                  onChange={(e) => setBootTotp(e.target.value.replace(/\D/g, ''))}
                  className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm tracking-widest text-white"
                />
              </div>
              <button
                type="submit"
                disabled={bootSubmitting}
                className="w-full min-h-[46px] rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
              >
                {bootSubmitting ? 'Activating…' : 'Verify & Create Super Admin'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Case 2: Not signed in -> Dedicated Platform Admin Sign In
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-blue-400" />
            <div>
              <h1 className="font-display text-lg font-semibold text-white">
                Platform Administration Sign In
              </h1>
              <p className="text-xs text-slate-400">
                Restricted to authorized Super Administrators with MFA
              </p>
            </div>
          </div>

          {loginError && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-200">
              {loginError}
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                6-Digit Authenticator Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={loginTotp}
                onChange={(e) => setLoginTotp(e.target.value.replace(/\D/g, ''))}
                className="w-full min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm tracking-widest text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full min-h-[46px] rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
            >
              {loginSubmitting ? 'Verifying…' : 'Sign In to Platform Admin'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Case 3: Signed in as Executive (NOT SUPER_ADMIN) -> Backend & Frontend 403 Deny
  if (user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 text-center space-y-4">
          <ShieldAlert className="w-8 h-8 text-red-700 mx-auto" />
          <h1 className="font-display text-lg font-semibold text-slate-900">
            403 — Access Restricted
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your signed-in account ({USER_ROLE_LABELS[user.role]}) is not authorized to access Platform Administration. All administrative endpoints verify the Super Admin role on the server.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-slate-900 text-white text-sm font-medium"
          >
            Return to Executive Portal
          </a>
        </div>
      </div>
    );
  }

  const filteredInvConstituencies = invRegionId
    ? constituencies.filter((c) => c.regionId === invRegionId)
    : [];
  const filteredInvStations = invConstituencyId
    ? stations.filter((s) => s.constituencyId === invConstituencyId)
    : [];
  const filteredPsSetupCons = newPsRegionId
    ? constituencies.filter((c) => c.regionId === newPsRegionId)
    : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 whitespace-nowrap min-w-0">
            <BrandMark size={26} />
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-semibold truncate">
                Platform Administration Console
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {user.fullName} · Super Admin (Full Portal Access)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-[40px] px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Direct Access to All Four Executive Portals */}
        <div className="bg-slate-900 border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5 text-blue-400" />
              <span>Open Executive Dashboard:</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'POLLING_STATION', label: 'Polling Station' },
                  { id: 'CONSTITUENCY', label: 'Constituency' },
                  { id: 'REGIONAL', label: 'Regional' },
                  { id: 'NATIONAL', label: 'National' },
                ] as Array<{ id: IssueLevel; label: string }>
              ).map((portal) => (
                <button
                  key={portal.id}
                  type="button"
                  onClick={() => {
                    if (onSwitchWorkspace) {
                      onSwitchWorkspace(portal.id);
                    } else {
                      window.location.href = '/';
                    }
                  }}
                  className="min-h-[34px] px-3 rounded-lg bg-slate-800 hover:bg-blue-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap"
                >
                  {portal.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Sub-Navigation */}
        <nav className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl overflow-x-auto">
          {[
            { id: 'overview', label: 'Readiness & Backups' },
            { id: 'users', label: 'Accounts & Scopes' },
            { id: 'taxonomy', label: 'Categories & Geography' },
            { id: 'settings', label: 'Privacy & Retention' },
            { id: 'audit', label: 'Security & Audit Logs' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as AdminTab)}
              className={`min-h-[40px] px-4 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {adminError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            {adminError}
          </div>
        )}
        {adminFeedback && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
            {adminFeedback}
          </div>
        )}

        {lastIssuedLink && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs space-y-2">
            <p className="font-semibold text-blue-950">{lastIssuedLink.label}</p>
            <p className="text-blue-900">
              Email delivery: {lastIssuedLink.emailSent ? 'Sent via SMTP.' : `Not emailed — ${lastIssuedLink.note}`}
            </p>
            <p className="font-mono bg-white border border-blue-200 rounded p-2 break-all text-slate-900">
              {lastIssuedLink.url}
            </p>
          </div>
        )}

        {/* TAB 1: OVERVIEW & BACKUPS */}
        {activeTab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Active Accounts</p>
                <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                  {overview.counts.activeUsers}
                </p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {overview.counts.pendingInvites} invited · {overview.counts.suspendedUsers} suspended
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Database Mode</p>
                <p className="font-display text-lg font-semibold text-slate-900 mt-1">
                  {overview.storageMode === 'mongodb_atlas' ? 'MongoDB Atlas' : 'Local Dev Store'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {overview.storageMode === 'mongodb_atlas'
                    ? 'Connected via server URI'
                    : 'Set MONGODB_URI for Atlas'}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">EC Ghana Geography</p>
                <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                  {overview.counts.constituencies} Constituencies
                </p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {overview.counts.regions} regions · {overview.counts.pollingStations} stations
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Issue Categories</p>
                <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                  {overview.counts.activeCategories}
                </p>
                <p className="text-xs text-slate-500 mt-1">Active reporting taxonomy</p>
              </div>
            </div>

            {/* Production Security Readiness Checklist */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-800" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Pre-Production Security Configuration Status
                </h2>
              </div>
              <p className="text-xs text-slate-600">
                Do not treat this deployment as production-ready until all infrastructure checks below are configured.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                {[
                  {
                    label: 'MongoDB Atlas (MONGODB_URI)',
                    ok: overview.securityReadiness.mongodbAtlasConfigured,
                    hint: 'Configure TLS MongoDB Atlas URI in server environment.',
                  },
                  {
                    label: 'Persistent SESSION_SECRET',
                    ok: overview.securityReadiness.persistentSessionSecret,
                    hint: 'Set 64-char hex SESSION_SECRET in server env.',
                  },
                  {
                    label: 'Persistent ENCRYPTION_KEY',
                    ok: overview.securityReadiness.persistentEncryptionKey,
                    hint: 'Required so TOTP secrets survive server restarts.',
                  },
                  {
                    label: 'BOOTSTRAP_ADMIN_SECRET Cleared',
                    ok: overview.securityReadiness.bootstrapSecretRemoved,
                    hint: 'Unset BOOTSTRAP_ADMIN_SECRET after first-admin setup.',
                  },
                  {
                    label: 'SMTP Email Provider',
                    ok: overview.securityReadiness.smtpConfigured,
                    hint: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS for email alerts.',
                  },
                  {
                    label: 'Ghana DPA (Act 843) Review',
                    ok: overview.securityReadiness.dpaChecklistComplete,
                    hint: 'Complete all 5 compliance items in Privacy & Retention.',
                  },
                ].map((chk) => (
                  <div
                    key={chk.label}
                    className={`rounded-lg border p-3 ${
                      chk.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">
                      {chk.label}: {chk.ok ? 'Configured' : 'Action Needed'}
                    </p>
                    <p className="text-slate-600 mt-0.5">{chk.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Backups & Restore */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Backups & System Recovery
                </h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                Download a complete JSON archive of users, encrypted MFA keys, taxonomy, issues, history, and audit logs. For production MongoDB Atlas deployments, also enable automated Atlas continuous backups and snapshot retention.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="/api/admin/backup/export"
                  className="min-h-[42px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium inline-flex items-center gap-2 hover:bg-slate-800"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Backup JSON</span>
                </a>
                <label className="min-h-[42px] px-4 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 inline-flex items-center gap-2 cursor-pointer hover:bg-slate-50">
                  <Upload className="w-4 h-4" />
                  <span>Restore from Archive</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleRestoreFile}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ACCOUNTS & SCOPES */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <form
              onSubmit={handleInviteUser}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-800" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Invite & Approve Executive or Admin Account
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <input
                  type="text"
                  required
                  placeholder="Full Name"
                  value={invName}
                  onChange={(e) => setInvName(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  type="email"
                  required
                  placeholder="Email Address"
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <input
                  type="text"
                  placeholder="Party Office / Title (e.g. Constituency Secretary)"
                  value={invTitle}
                  onChange={(e) => setInvTitle(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                />
                <select
                  value={invRole}
                  onChange={(e) => {
                    const role = e.target.value as UserRole;
                    setInvRole(role);
                    setInvRegionId('');
                    setInvConstituencyId('');
                    setInvStationId('');
                  }}
                  className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>

                {['POLLING_STATION', 'CONSTITUENCY', 'REGIONAL'].includes(invRole) && (
                  <select
                    required
                    value={invRegionId}
                    onChange={(e) => {
                      setInvRegionId(e.target.value);
                      setInvConstituencyId('');
                      setInvStationId('');
                    }}
                    className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Select Region</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}

                {['POLLING_STATION', 'CONSTITUENCY'].includes(invRole) && (
                  <select
                    required
                    value={invConstituencyId}
                    onChange={(e) => {
                      setInvConstituencyId(e.target.value);
                      setInvStationId('');
                    }}
                    className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Select Constituency</option>
                    {filteredInvConstituencies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}

                {invRole === 'POLLING_STATION' && (
                  <select
                    required
                    value={invStationId}
                    onChange={(e) => setInvStationId(e.target.value)}
                    className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Select Polling Station</option>
                    {filteredInvStations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {invRole === 'POLLING_STATION' && invConstituencyId && filteredInvStations.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                  <p className="text-xs font-medium text-slate-800">
                    No polling stations registered yet for this constituency. Register one to assign this executive:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      placeholder="Polling station name"
                      value={quickPsName}
                      onChange={(e) => setQuickPsName(e.target.value)}
                      className="flex-1 min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="EC Code (optional)"
                      value={quickPsCode}
                      onChange={(e) => setQuickPsCode(e.target.value)}
                      className="sm:w-40 min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                    />
                    <button
                      type="button"
                      disabled={quickPsCreating || quickPsName.trim().length < 2}
                      onClick={() => void handleQuickCreateStation()}
                      className="min-h-[38px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium disabled:opacity-50"
                    >
                      {quickPsCreating ? 'Saving…' : 'Register Station'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-lg bg-blue-800 text-white text-xs font-medium hover:bg-blue-900"
                >
                  Create Approved Invitation
                </button>
              </div>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                      <th className="py-3 px-4">Executive / Admin</th>
                      <th className="py-3 px-4">Role & Jurisdiction</th>
                      <th className="py-3 px-4">Status & MFA</th>
                      <th className="py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900">{u.fullName}</p>
                          <p className="text-slate-500">{u.email}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-800">{USER_ROLE_LABELS[u.role]}</p>
                          <p className="text-slate-500">
                            {[u.pollingStationName, u.constituencyName, u.regionName]
                              .filter(Boolean)
                              .join(', ') || 'All Regions / Platform'}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-800">
                            {u.status} · MFA {u.mfaEnabled ? 'Enabled' : 'Pending'}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleReissueLink(u)}
                              className="px-2.5 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700"
                            >
                              {u.status === 'INVITED' ? 'Invite Link' : 'Reset Link'}
                            </button>
                            {u.status === 'ACTIVE' && u.id !== user.id && (
                              <button
                                type="button"
                                onClick={() => void handleUserStatusChange(u.id, 'SUSPENDED')}
                                className="px-2.5 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-900"
                              >
                                Suspend
                              </button>
                            )}
                            {u.status === 'SUSPENDED' && (
                              <button
                                type="button"
                                onClick={() => void handleUserStatusChange(u.id, 'ACTIVE')}
                                className="px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-900"
                              >
                                Reactivate
                              </button>
                            )}
                            {u.status !== 'DEACTIVATED' && u.id !== user.id && (
                              <button
                                type="button"
                                onClick={() => void handleUserStatusChange(u.id, 'DEACTIVATED')}
                                className="px-2.5 py-1.5 rounded border border-red-300 bg-red-50 text-red-800"
                              >
                                Deactivate
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleUnlockUser(u.id)}
                              className="px-2.5 py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                            >
                              Unlock
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CATEGORIES & GEOGRAPHY */}
        {activeTab === 'taxonomy' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Issue Categories</h2>
              <form onSubmit={handleCreateCategory} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  placeholder="New category name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
                />
                <button
                  type="submit"
                  className="min-h-[40px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </form>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {categories.map((c) => (
                  <div key={c.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-slate-900">{c.name}</p>
                      <p className="text-slate-500">{c.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleCategory(c)}
                      className="px-3 py-1 rounded border border-slate-300 text-slate-700"
                    >
                      {c.active ? 'Active' : 'Disabled'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Ghana Constituencies & Polling Stations
              </h2>
              <form onSubmit={handleAddConstituency} className="space-y-2.5 border-b border-slate-200 pb-4">
                <p className="text-xs font-medium text-slate-700">Add Constituency</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    required
                    value={newConRegionId}
                    onChange={(e) => setNewConRegionId(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    <option value="">Region</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="Constituency name"
                    value={newConName}
                    onChange={(e) => setNewConName(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Code (e.g. ASH-OKW)"
                    value={newConCode}
                    onChange={(e) => setNewConCode(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium"
                >
                  Save Constituency
                </button>
              </form>

              <form onSubmit={handleAddStation} className="space-y-2.5">
                <p className="text-xs font-medium text-slate-700">Add Polling Station</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    required
                    value={newPsRegionId}
                    onChange={(e) => {
                      setNewPsRegionId(e.target.value);
                      setNewPsConId('');
                    }}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    <option value="">Region</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={newPsConId}
                    onChange={(e) => setNewPsConId(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    <option value="">Constituency</option>
                    {filteredPsSetupCons.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="Polling station name"
                    value={newPsName}
                    onChange={(e) => setNewPsName(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="EC Station Code"
                    value={newPsCode}
                    onChange={(e) => setNewPsCode(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium"
                >
                  Save Polling Station
                </button>
              </form>
            </div>

            {/* Complete Electoral Commission of Ghana Constituency Directory */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Electoral Commission of Ghana — Constituency Directory ({constituencies.length} across {regions.length} Regions)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Official parliamentary constituencies loaded into the platform database.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Filter constituencies by region"
                    value={geoFilterRegionId}
                    onChange={(e) => setGeoFilterRegionId(e.target.value)}
                    className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                  >
                    <option value="">All 16 Regions</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="search"
                    value={geoSearch}
                    onChange={(e) => setGeoSearch(e.target.value)}
                    placeholder="Search constituency…"
                    className="min-h-[38px] rounded-lg border border-slate-300 px-3 text-xs"
                  />
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                {constituencies
                  .filter((c) => !geoFilterRegionId || c.regionId === geoFilterRegionId)
                  .filter(
                    (c) =>
                      !geoSearch.trim() ||
                      c.name.toLowerCase().includes(geoSearch.trim().toLowerCase()) ||
                      c.code.toLowerCase().includes(geoSearch.trim().toLowerCase()),
                  )
                  .map((c) => {
                    const reg = regions.find((r) => r.id === c.regionId);
                    const stationCount = stations.filter((s) => s.constituencyId === c.id).length;
                    return (
                      <div
                        key={c.id}
                        className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-medium text-slate-900">{c.name}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="text-slate-600">{reg?.name || c.regionId}</span>
                        </div>
                        <div className="font-mono text-slate-500 tabular-nums">
                          {c.code} · {stationCount} station{stationCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PRIVACY, RETENTION & GHANA DPA SETTINGS */}
        {activeTab === 'settings' && settings && (
          <form
            onSubmit={handleSaveSettings}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
          >
            <h2 className="text-base font-semibold text-slate-900">
              Retention, Session Security & Ghana Data Protection Act (Act 843)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Record Retention (Days)
                </label>
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={settings.retentionDays}
                  onChange={(e) =>
                    setSettings({ ...settings, retentionDays: Number(e.target.value) })
                  }
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Idle Timeout (Minutes)
                </label>
                <input
                  type="number"
                  min={10}
                  max={240}
                  value={settings.sessionIdleMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, sessionIdleMinutes: Number(e.target.value) })
                  }
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Max Session (Hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={settings.sessionMaxHours}
                  onChange={(e) =>
                    setSettings({ ...settings, sessionMaxHours: Number(e.target.value) })
                  }
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Max Attachment (MB)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxAttachmentMb}
                  onChange={(e) =>
                    setSettings({ ...settings, maxAttachmentMb: Number(e.target.value) })
                  }
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">
                Privacy Notice Title
              </label>
              <input
                type="text"
                value={settings.privacyNoticeTitle}
                onChange={(e) => setSettings({ ...settings, privacyNoticeTitle: e.target.value })}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
              />
              <label className="block text-xs font-medium text-slate-700 pt-2">
                Privacy Notice Body
              </label>
              <textarea
                rows={5}
                value={settings.privacyNoticeBody}
                onChange={(e) => setSettings({ ...settings, privacyNoticeBody: e.target.value })}
                className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-2.5">
              <p className="text-xs font-semibold text-slate-900">
                Pre-Launch Ghana Data Protection Act, 2012 (Act 843) Review Checklist
              </p>
              {[
                {
                  key: 'dpaRegistrationReviewed',
                  label: 'Data Protection Commission of Ghana registration verified for internal party records',
                },
                {
                  key: 'lawfulBasisDocumented',
                  label: 'Internal party operational lawful basis & minimum-data rules documented',
                },
                {
                  key: 'retentionPolicyApproved',
                  label: 'Retention & secure disposal schedule approved by party Data Protection Supervisor',
                },
                {
                  key: 'officerTrainingCompleted',
                  label: 'Authorized executives briefed not to enter unnecessary member personal details',
                },
                {
                  key: 'breachResponsePlanActive',
                  label: '72-hour incident response & Data Protection Commission notification plan active',
                },
              ].map((item) => {
                const k = item.key as keyof SystemSettingsRecord['ghanaDpaChecklist'];
                return (
                  <label key={k} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.ghanaDpaChecklist[k]}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          ghanaDpaChecklist: {
                            ...settings.ghanaDpaChecklist,
                            [k]: e.target.checked,
                          },
                        })
                      }
                      className="w-4 h-4 accent-blue-800"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="min-h-[44px] px-6 rounded-lg bg-blue-800 text-white text-sm font-medium hover:bg-blue-900"
              >
                Save Policy & Security Settings
              </button>
            </div>
          </form>
        )}

        {/* TAB 5: SECURITY LOGS & BREAK-GLASS AUDIT */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Security & Administrative Audit Log
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">
                  Latest {auditLogs.length} events
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Severity</th>
                      <th className="py-2.5 px-4">Actor</th>
                      <th className="py-2.5 px-4">Action</th>
                      <th className="py-2.5 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-semibold whitespace-nowrap ${
                            log.severity === 'CRITICAL'
                              ? 'text-red-700'
                              : log.severity === 'WARNING'
                                ? 'text-amber-800'
                                : 'text-slate-600'
                          }`}
                        >
                          {log.severity}
                        </td>
                        <td className="py-2.5 px-4 text-slate-800 whitespace-nowrap">
                          {log.actorName} ({log.actorRole})
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-900 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audited Break-Glass Report Diagnostic Access */}
            <form
              onSubmit={handleBreakGlass}
              className="bg-white border border-amber-300 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-800" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Authorized Break-Glass Report Inspection
                </h3>
              </div>
              <p className="text-xs text-slate-600">
                Audited diagnostic lookup by Issue UUID. Generates a critical audit trail and notifies National executives.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Issue UUID"
                  value={bgIssueId}
                  onChange={(e) => setBgIssueId(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs font-mono"
                />
                <input
                  type="text"
                  required
                  minLength={15}
                  placeholder="Authorization reason (min 15 chars)"
                  value={bgReason}
                  onChange={(e) => setBgReason(e.target.value)}
                  className="sm:col-span-2 min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-lg bg-amber-800 text-white text-xs font-medium"
              >
                Log Break-Glass Access & Inspect
              </button>
              {bgResult && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                  <p className="font-semibold text-slate-900">
                    {bgResult.referenceCode} — {bgResult.title}
                  </p>
                  <p className="text-slate-700">{bgResult.description}</p>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
