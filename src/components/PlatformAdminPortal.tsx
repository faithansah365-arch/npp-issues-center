import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Database,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  USER_ROLE_LABELS,
  type AuditLogRecord,
  type CategoryRecord,
  type ConstituencyRecord,
  type HomepageSlideRecord,
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
import { PWAInstallButton } from './PWAInstallButton';

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
    pendingApprovals: number;
    pendingInvites: number;
    suspendedUsers: number;
    activeCategories: number;
    regions: number;
    constituencies: number;
    pollingStations: number;
  };
}

type AdminTab = 'overview' | 'gallery' | 'users' | 'taxonomy' | 'settings' | 'audit';

export function PlatformAdminPortal({
  onSwitchWorkspace,
}: {
  onSwitchWorkspace?: (workspace: 'admin' | IssueLevel) => void;
} = {}) {
  const { user, loading: authLoading, refreshSession, logout } = useAuth();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Bootstrap state (direct Super Admin creation without MFA for now)
  const [bootSecret, setBootSecret] = useState('');
  const [bootName, setBootName] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootSubmitting, setBootSubmitting] = useState(false);

  // Admin Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
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
  const [slides, setSlides] = useState<HomepageSlideRecord[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminFeedback, setAdminFeedback] = useState<string | null>(null);

  // Homepage slider upload & edit state
  const [slideTitle, setSlideTitle] = useState('');
  const [slideCaption, setSlideCaption] = useState('');
  const [slideFile, setSlideFile] = useState<File | null>(null);
  const [slidePreviewUrl, setSlidePreviewUrl] = useState<string | null>(null);
  const [slideUploading, setSlideUploading] = useState(false);
  const [editingSlideId, setEditingSlideId] = useState<string | null>(null);
  const [editSlideTitle, setEditSlideTitle] = useState('');
  const [editSlideCaption, setEditSlideCaption] = useState('');

  // Enroll / Invite form
  const [enrollMode, setEnrollMode] = useState<'enroll' | 'invite'>('enroll');
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invPassword, setInvPassword] = useState('');
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
      const [ov, usr, cats, geo, sets, logs, slideRes] = await Promise.all([
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
        apiRequest<{ slides: HomepageSlideRecord[] }>('/api/admin/slides'),
      ]);
      setOverview(ov);
      setUsers(usr.users);
      setCategories(cats.categories);
      setRegions(geo.regions);
      setConstituencies(geo.constituencies);
      setStations(geo.pollingStations);
      setSettings(sets.settings);
      setAuditLogs(logs.logs);
      setSlides(slideRes.slides);
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      void loadAdminData();
    }
  }, [user]);

  async function handleBootstrapSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBootError(null);
    setBootSubmitting(true);
    try {
      await apiRequest('/api/setup/first-admin', {
        method: 'POST',
        body: {
          bootstrapSecret: bootSecret,
          fullName: bootName,
          email: bootEmail,
          password: bootPassword,
        },
      });
      loadSetupStatus();
      await refreshSession();
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
        },
      });
      await refreshSession();
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleEnrollOrInviteUser(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    setAdminFeedback(null);
    setLastIssuedLink(null);
    try {
      if (enrollMode === 'enroll') {
        const res = await apiRequest<{
          user: PublicUser;
          emailSent: boolean;
          emailStatusNote: string;
        }>('/api/admin/users/enroll', {
          method: 'POST',
          body: {
            fullName: invName,
            email: invEmail,
            password: invPassword,
            titleOrOffice: invTitle,
            role: invRole,
            regionId: invRegionId || null,
            constituencyId: invConstituencyId || null,
            pollingStationId: invStationId || null,
          },
        });
        setAdminFeedback(
          `Enrolled and activated ${res.user.fullName} (${res.user.email}) as ${USER_ROLE_LABELS[res.user.role]}.`,
        );
        setInvName('');
        setInvEmail('');
        setInvPassword('');
        setInvTitle('');
        await loadAdminData();
        return;
      }

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

  function handleSlideFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    if (slidePreviewUrl) {
      URL.revokeObjectURL(slidePreviewUrl);
    }
    setSlideFile(file);
    setSlidePreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function handleAddSlide(e: React.FormEvent) {
    e.preventDefault();
    if (!slideFile) {
      setAdminError('Please select a JPEG, PNG, or WEBP image file.');
      return;
    }
    setAdminError(null);
    setAdminFeedback(null);
    setSlideUploading(true);
    try {
      const fd = new FormData();
      fd.append('title', slideTitle.trim());
      fd.append('caption', slideCaption.trim());
      fd.append('image', slideFile);
      await apiRequest<{ slide: HomepageSlideRecord }>('/api/admin/slides', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setSlideTitle('');
      setSlideCaption('');
      if (slidePreviewUrl) URL.revokeObjectURL(slidePreviewUrl);
      setSlidePreviewUrl(null);
      setSlideFile(null);
      setAdminFeedback('Homepage slider image uploaded and published.');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    } finally {
      setSlideUploading(false);
    }
  }

  async function handleToggleSlide(slide: HomepageSlideRecord) {
    setAdminError(null);
    try {
      await apiRequest(`/api/admin/slides/${slide.id}`, {
        method: 'PATCH',
        body: { active: !slide.active },
      });
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleMoveSlide(index: number, direction: -1 | 1) {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const current = slides[index];
    const swapWith = slides[targetIdx];
    setAdminError(null);
    try {
      await Promise.all([
        apiRequest(`/api/admin/slides/${current.id}`, {
          method: 'PATCH',
          body: { sortOrder: targetIdx + 1 },
        }),
        apiRequest(`/api/admin/slides/${swapWith.id}`, {
          method: 'PATCH',
          body: { sortOrder: index + 1 },
        }),
      ]);
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleSaveSlideEdit(slideId: string) {
    setAdminError(null);
    try {
      await apiRequest(`/api/admin/slides/${slideId}`, {
        method: 'PATCH',
        body: {
          title: editSlideTitle.trim(),
          caption: editSlideCaption.trim(),
        },
      });
      setEditingSlideId(null);
      setAdminFeedback('Homepage slide details updated.');
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function handleDeleteSlide(slide: HomepageSlideRecord) {
    setAdminError(null);
    try {
      await apiRequest(`/api/admin/slides/${slide.id}`, { method: 'DELETE' });
      setAdminFeedback(`Removed "${slide.title}" from homepage gallery.`);
      await loadAdminData();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  if (authLoading || statusLoading) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center p-6 text-sm text-[#071A4D]">
        Verifying platform administration state…
      </div>
    );
  }

  // Case 1: Zero Super Admins exist -> Secure First-Admin Bootstrap
  if (setupStatus && !setupStatus.hasSuperAdmin) {
    return (
      <div className="min-h-screen bg-[#071A4D] text-slate-100 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-lg bg-[#09205E] border border-white/15 rounded-2xl overflow-hidden shadow-xl">
          <div className="grid grid-cols-3 h-1.5 w-full" aria-hidden="true">
            <div className="bg-[#D41118]" />
            <div className="bg-white" />
            <div className="bg-[#0B2B7E]" />
          </div>
          <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <div>
              <h1 className="font-display text-lg font-semibold text-white">
                First Super Admin Setup
              </h1>
              <p className="text-xs text-white/75">
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
                  in your server environment (or Secrets panel), restart the server, then refresh this page to create your Super Admin account.
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
                className="min-h-[42px] px-4 rounded-lg bg-[#D41118] hover:bg-[#B30E14] text-xs font-medium text-white inline-flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-check Server Status</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleBootstrapSubmit} className="space-y-4">
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
                  className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-white/85 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={bootName}
                  onChange={(e) => setBootName(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-white/85 mb-1">Administrator Email</label>
                <input
                  type="email"
                  required
                  value={bootEmail}
                  onChange={(e) => setBootEmail(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-white/85 mb-1">
                  Strong Password (min 12 chars, upper, lower, digit, symbol)
                </label>
                <input
                  type="password"
                  required
                  value={bootPassword}
                  onChange={(e) => setBootPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                disabled={bootSubmitting}
                className="w-full min-h-[46px] rounded-lg bg-[#D41118] hover:bg-[#B30E14] text-white text-sm font-medium"
              >
                {bootSubmitting ? 'Creating Super Admin…' : 'Create Super Admin & Sign In'}
              </button>
            </form>
          )}
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Not signed in -> Dedicated Platform Admin Sign In
  if (!user) {
    return (
      <div className="min-h-screen bg-[#071A4D] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#09205E] border border-white/15 rounded-2xl overflow-hidden shadow-xl">
          <div className="grid grid-cols-3 h-1.5 w-full" aria-hidden="true">
            <div className="bg-[#D41118]" />
            <div className="bg-white" />
            <div className="bg-[#0B2B7E]" />
          </div>
          <div className="p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-[#D41118]" />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold text-white">
                Platform Administration Sign In
              </h1>
              <p className="text-xs text-white/75">
                Restricted to authorized Platform Super Administrators
              </p>
            </div>
          </div>

          {loginError && (
            <div className="rounded-lg border border-[#F5C6C8]/40 bg-[#D41118]/25 p-3 text-xs text-red-100">
              {loginError}
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-white/85 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/85 mb-1">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-white/20 bg-[#06153F] px-3.5 text-sm text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full min-h-[46px] rounded-lg bg-[#D41118] hover:bg-[#B30E14] text-white text-sm font-medium"
            >
              {loginSubmitting ? 'Signing in…' : 'Sign In to Platform Admin'}
            </button>
          </form>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Signed in as Executive (NOT SUPER_ADMIN) -> Backend & Frontend 403 Deny
  if (user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-[#F5C6C8] rounded-2xl overflow-hidden text-center">
          <div className="grid grid-cols-3 h-1 w-full" aria-hidden="true">
            <div className="bg-[#D41118]" />
            <div className="bg-white border-b border-slate-200/70" />
            <div className="bg-[#0B2B7E]" />
          </div>
          <div className="p-6 space-y-4">
          <ShieldAlert className="w-8 h-8 text-[#D41118] mx-auto" />
          <h1 className="font-display text-lg font-semibold text-[#071A4D]">
            403 — Access Restricted
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your signed-in account ({USER_ROLE_LABELS[user.role]}) is not authorized to access Platform Administration. All administrative endpoints verify the Super Admin role on the server.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium"
          >
            Return to Executive Portal
          </a>
          </div>
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

  const pendingApprovalUsers = users.filter((u) => u.status === 'PENDING_APPROVAL');

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <header className="bg-[#071A4D] text-white border-b border-[#0B2B7E]">
        <div className="grid grid-cols-3 h-1.5 w-full" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white" />
          <div className="bg-[#0B2B7E]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 whitespace-nowrap min-w-0">
            <BrandMark size={28} />
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-semibold truncate">
                Platform Administration Console
              </p>
              <p className="text-[11px] text-white/75 truncate">
                {user.fullName} · Super Admin (Full Portal Access)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="dark-header" />
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[40px] px-3.5 rounded-lg bg-white/10 hover:bg-[#D41118] text-xs font-medium text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Direct Access to All Four Executive Portals */}
        <div className="bg-[#0B2B7E] border-t border-white/15">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-white/90 flex items-center gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5 text-white" />
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
                  className="min-h-[34px] px-3 rounded-lg bg-white/15 hover:bg-[#D41118] text-xs font-medium text-white transition-colors whitespace-nowrap"
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
        <nav className="flex items-center gap-1 p-1 bg-[#E6ECF7] rounded-xl overflow-x-auto">
          {[
            { id: 'overview', label: 'Readiness & Backups' },
            { id: 'gallery', label: 'Homepage Images' },
            {
              id: 'users',
              label:
                pendingApprovalUsers.length > 0
                  ? `Accounts & Approvals (${pendingApprovalUsers.length})`
                  : 'Accounts & Scopes',
            },
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
                  ? 'bg-white text-[#071A4D] font-semibold border-b-2 border-[#D41118] shadow-xs'
                  : 'text-[#071A4D]/75 hover:text-[#071A4D]'
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
          <div className="rounded-xl border border-[#C7D4F2] bg-[#EEF3FC] p-4 text-xs space-y-2">
            <p className="font-semibold text-[#071A4D]">{lastIssuedLink.label}</p>
            <p className="text-[#0B2B7E]">
              Email delivery: {lastIssuedLink.emailSent ? 'Sent via SMTP.' : `Not emailed — ${lastIssuedLink.note}`}
            </p>
            <p className="font-mono bg-white border border-[#C7D4F2] rounded p-2 break-all text-slate-900">
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
                  {overview.counts.pendingApprovals} awaiting approval · {overview.counts.pendingInvites} invited
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
                <ShieldCheck className="w-5 h-5 text-[#0B2B7E]" />
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
                  className="min-h-[42px] px-4 rounded-lg bg-[#071A4D] hover:bg-[#0B2B7E] text-white text-xs font-medium inline-flex items-center gap-2"
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

        {/* TAB: HOMEPAGE GALLERY SLIDER */}
        {activeTab === 'gallery' && (
          <div className="space-y-6">
            <form
              onSubmit={handleAddSlide}
              className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#0B2B7E]" />
                <h2 className="text-sm font-semibold text-[#071A4D]">
                  Add Image to Homepage Slider
                </h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-5 space-y-2">
                  <label
                    htmlFor="slide-file-input"
                    className="block aspect-[16/9] rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 overflow-hidden cursor-pointer relative"
                  >
                    {slidePreviewUrl ? (
                      <img
                        src={slidePreviewUrl}
                        alt="New slide preview"
                        className="w-full h-full object-cover object-center"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-xs text-slate-600 gap-2">
                        <Upload className="w-5 h-5 text-[#0B2B7E]" />
                        <span>Click to choose JPEG, PNG, or WEBP (auto-fits homepage frame)</span>
                      </div>
                    )}
                    <input
                      id="slide-file-input"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      onChange={handleSlideFileChange}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div className="lg:col-span-7 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Headline / Title
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="e.g. National Delegates Conference"
                      value={slideTitle}
                      onChange={(e) => setSlideTitle(e.target.value)}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Short Caption (Optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={260}
                      placeholder="Brief description shown over the homepage slider"
                      value={slideCaption}
                      onChange={(e) => setSlideCaption(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={slideUploading}
                      className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs sm:text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{slideUploading ? 'Uploading…' : 'Add to Homepage Slider'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#071A4D]">
                  Homepage Slider Images ({slides.length})
                </h2>
                <span className="text-xs text-slate-500">
                  Active slides animate automatically on the front page
                </span>
              </div>

              {slides.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  No homepage slider images saved yet. Upload an image above.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {slides.map((slide, idx) => (
                    <div
                      key={slide.id}
                      className="p-4 flex flex-col md:flex-row md:items-center gap-4"
                    >
                      <div className="w-full md:w-48 aspect-[16/9] rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                        <img
                          src={slide.imageUrl}
                          alt={slide.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        {editingSlideId === slide.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editSlideTitle}
                              onChange={(e) => setEditSlideTitle(e.target.value)}
                              className="w-full min-h-[38px] rounded-lg border border-slate-300 px-3 text-sm"
                            />
                            <input
                              type="text"
                              value={editSlideCaption}
                              onChange={(e) => setEditSlideCaption(e.target.value)}
                              placeholder="Caption"
                              className="w-full min-h-[38px] rounded-lg border border-slate-300 px-3 text-xs"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handleSaveSlideEdit(slide.id)}
                                className="min-h-[34px] px-3 rounded-lg bg-[#0B2B7E] text-white text-xs font-medium"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSlideId(null)}
                                className="min-h-[34px] px-3 rounded-lg border border-slate-300 text-xs text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-500">
                              Slide {idx + 1} ·{' '}
                              <span
                                className={
                                  slide.active
                                    ? 'text-emerald-700 font-semibold'
                                    : 'text-slate-500 font-medium'
                                }
                              >
                                {slide.active ? 'Visible on Homepage' : 'Hidden'}
                              </span>
                            </p>
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {slide.title}
                            </p>
                            {slide.caption && (
                              <p className="text-xs text-slate-600 line-clamp-2">{slide.caption}</p>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => void handleMoveSlide(idx, -1)}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          aria-label="Move slide up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === slides.length - 1}
                          onClick={() => void handleMoveSlide(idx, 1)}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          aria-label="Move slide down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSlideId(slide.id);
                            setEditSlideTitle(slide.title);
                            setEditSlideCaption(slide.caption);
                          }}
                          className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleSlide(slide)}
                          className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                        >
                          {slide.active ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Hide</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Show</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSlide(slide)}
                          className="min-h-[36px] px-3 rounded-lg border border-[#F5C6C8] bg-[#FDF2F2] text-[#A60D13] hover:bg-[#FCE5E6] text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACCOUNTS, APPROVALS & ENROLLMENT */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Pending Sign-Up Approvals Queue */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#071A4D]">
                    Pending Sign-Up Approvals ({pendingApprovalUsers.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Anyone who signs up must be approved here before they can enter the portal.
                  </p>
                </div>
              </div>
              {pendingApprovalUsers.length === 0 ? (
                <p className="p-5 text-xs text-slate-500">
                  No sign-up requests are currently awaiting approval.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pendingApprovalUsers.map((pending) => (
                    <div
                      key={pending.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5 text-xs">
                        <p className="font-semibold text-slate-900 text-sm">{pending.fullName}</p>
                        <p className="text-slate-600">
                          {pending.email} · {pending.titleOrOffice}
                        </p>
                        <p className="text-slate-700 font-medium">
                          Requested Level: {USER_ROLE_LABELS[pending.role]} ·{' '}
                          {[
                            pending.pollingStationName,
                            pending.constituencyName,
                            pending.regionName,
                          ]
                            .filter(Boolean)
                            .join(', ') || 'National'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleUserStatusChange(pending.id, 'ACTIVE')}
                          className="min-h-[38px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium"
                        >
                          Approve Access
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUserStatusChange(pending.id, 'DEACTIVATED')}
                          className="min-h-[38px] px-3.5 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-medium"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Direct Enrollment or Activation Invite */}
            <form
              onSubmit={handleEnrollOrInviteUser}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[#0B2B7E]" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Enroll or Invite Executive / Admin Account
                  </h2>
                </div>
                <div className="inline-flex p-1 rounded-lg bg-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setEnrollMode('enroll')}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                      enrollMode === 'enroll'
                        ? 'bg-white text-[#071A4D] shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Enroll Directly (Active Now)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnrollMode('invite')}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                      enrollMode === 'invite'
                        ? 'bg-white text-[#071A4D] shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Send Invite Link
                  </button>
                </div>
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
                {enrollMode === 'enroll' && (
                  <input
                    type="password"
                    required
                    placeholder="Initial Password (min 12 chars, Aa1!)"
                    value={invPassword}
                    onChange={(e) => setInvPassword(e.target.value)}
                    className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm"
                  />
                )}
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
                      className="min-h-[38px] px-4 rounded-lg bg-[#071A4D] hover:bg-[#0B2B7E] text-white text-xs font-medium disabled:opacity-50"
                    >
                      {quickPsCreating ? 'Saving…' : 'Register Station'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium"
                >
                  {enrollMode === 'enroll'
                    ? 'Enroll & Activate Account'
                    : 'Create Approved Invitation'}
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
                      <th className="py-3 px-4">Status</th>
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
                          <span
                            className={`inline-flex px-2 py-0.5 rounded font-medium ${
                              u.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-800'
                                : u.status === 'PENDING_APPROVAL'
                                  ? 'bg-amber-50 text-amber-900'
                                  : u.status === 'INVITED'
                                    ? 'bg-blue-50 text-blue-900'
                                    : 'bg-red-50 text-red-800'
                            }`}
                          >
                            {u.status === 'PENDING_APPROVAL' ? 'Awaiting Approval' : u.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-2">
                            {u.status === 'PENDING_APPROVAL' && (
                              <button
                                type="button"
                                onClick={() => void handleUserStatusChange(u.id, 'ACTIVE')}
                                className="px-2.5 py-1.5 rounded bg-[#0B2B7E] text-white font-medium hover:bg-[#071E5C]"
                              >
                                Approve
                              </button>
                            )}
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
                                {u.status === 'PENDING_APPROVAL' ? 'Decline' : 'Deactivate'}
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
                  className="min-h-[40px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium inline-flex items-center gap-1"
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
                  className="min-h-[38px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium"
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
                  className="min-h-[38px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium"
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
                      className="w-4 h-4 accent-[#0B2B7E]"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="min-h-[44px] px-6 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-sm font-medium"
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
                              ? 'text-[#D41118]'
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
                className="min-h-[40px] px-4 rounded-lg bg-[#D41118] hover:bg-[#B30E14] text-white text-xs font-medium"
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
