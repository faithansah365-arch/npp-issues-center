import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, type Collection, type Db } from 'mongodb';
import {
  DEFAULT_CATEGORIES,
  type AuditLogRecord,
  type CategoryRecord,
  type ConstituencyRecord,
  type InviteRecord,
  type IssueRecord,
  type NotificationRecord,
  type PasswordResetRecord,
  type PollingStationRecord,
  type RecurringDismissalRecord,
  type RecurringGroupRecord,
  type RegionRecord,
  type SessionRecord,
  type SystemSettingsRecord,
  type UserRecord,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import {
  EC_GHANA_CONSTITUENCIES,
  GHANA_REGIONS,
} from './ghanaGeo.ts';

interface DevDatabaseShape {
  users: UserRecord[];
  invites: InviteRecord[];
  passwordResets: PasswordResetRecord[];
  sessions: SessionRecord[];
  regions: RegionRecord[];
  constituencies: ConstituencyRecord[];
  pollingStations: PollingStationRecord[];
  categories: CategoryRecord[];
  issues: IssueRecord[];
  recurringGroups: RecurringGroupRecord[];
  recurringDismissals: RecurringDismissalRecord[];
  notifications: NotificationRecord[];
  auditLogs: AuditLogRecord[];
  settings: SystemSettingsRecord | null;
}

export interface BackupPayload {
  exportedAt: string;
  schemaVersion: number;
  storageMode: 'mongodb_atlas' | 'local_dev';
  data: {
    regions: RegionRecord[];
    constituencies: ConstituencyRecord[];
    pollingStations: PollingStationRecord[];
    categories: CategoryRecord[];
    users: UserRecord[];
    issues: IssueRecord[];
    recurringGroups: RecurringGroupRecord[];
    recurringDismissals: RecurringDismissalRecord[];
    notifications: NotificationRecord[];
    auditLogs: AuditLogRecord[];
    settings: SystemSettingsRecord | null;
  };
}

const DEFAULT_PRIVACY_BODY = `This internal portal processes party organizational concerns raised by authorized New Patriotic Party (NPP) executives strictly for issue resolution, escalation tracking, and internal administrative accountability.

1. Data Minimization: Do not enter full member lists, voter-targeting profiles, sensitive personal health details, or national ID numbers. Party member names are never required to submit a concern.
2. Lawful Internal Purpose: Access to records is restricted strictly by approved executive role and geographic jurisdiction.
3. Ghana Data Protection Act, 2012 (Act 843): Before entering live personal or contact details, the party Data Protection Supervisor must verify registration, officer confidentiality undertakings, and retention schedules with the Data Protection Commission of Ghana.`;

function createDefaultSettings(): SystemSettingsRecord {
  const now = new Date().toISOString();
  return {
    id: 'default',
    retentionDays: 730,
    sessionIdleMinutes: 45,
    sessionMaxHours: 12,
    maxAttachmentMb: 5,
    privacyNoticeTitle: 'NPP Internal Issue Portal Privacy & Data Protection Notice',
    privacyNoticeBody: DEFAULT_PRIVACY_BODY,
    ghanaDpaChecklist: {
      dpaRegistrationReviewed: false,
      lawfulBasisDocumented: false,
      retentionPolicyApproved: false,
      officerTrainingCompleted: false,
      breachResponsePlanActive: false,
    },
    updatedByUserId: null,
    updatedAt: now,
  };
}

function createInitialCategories(): CategoryRecord[] {
  const now = new Date().toISOString();
  return DEFAULT_CATEGORIES.map((name, idx) => ({
    id: `cat-${idx + 1}`,
    name,
    description: `${name} raised during party executive or polling-station meetings.`,
    active: true,
    sortOrder: idx + 1,
    createdAt: now,
  }));
}

class DataStore {
  private mongoClient: MongoClient | null = null;
  private mongoDb: Db | null = null;
  private mode: 'mongodb_atlas' | 'local_dev' = 'local_dev';
  private devDbPath = path.join(config.dataDir, 'dev-store.json');
  private devState: DevDatabaseShape = {
    users: [],
    invites: [],
    passwordResets: [],
    sessions: [],
    regions: [],
    constituencies: [],
    pollingStations: [],
    categories: [],
    issues: [],
    recurringGroups: [],
    recurringDismissals: [],
    notifications: [],
    auditLogs: [],
    settings: null,
  };

  async init(): Promise<void> {
    fs.mkdirSync(config.uploadsDir, { recursive: true });

    if (config.mongodbUri) {
      try {
        const client = new MongoClient(config.mongodbUri, {
          serverSelectionTimeoutMS: 8000,
          maxPoolSize: 20,
        });
        await client.connect();
        const db = client.db();
        await db.command({ ping: 1 });
        this.mongoClient = client;
        this.mongoDb = db;
        this.mode = 'mongodb_atlas';
        await this.ensureMongoIndexes();
        await this.ensureBaseReferenceData();
        console.log('[db] Connected to MongoDB Atlas.');
        return;
      } catch (err) {
        console.error('[db] MongoDB Atlas connection failed:', (err as Error).message);
        if (config.isProd) {
          throw new Error('Failed to connect to MongoDB Atlas in production mode.');
        }
        console.warn('[db] Falling back to local development store because NODE_ENV is not production.');
      }
    }

    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(this.devDbPath)) {
      const raw = fs.readFileSync(this.devDbPath, 'utf8');
      this.devState = JSON.parse(raw) as DevDatabaseShape;
    } else {
      this.persistDev();
    }
    this.mode = 'local_dev';
    await this.ensureBaseReferenceData();
    console.log('[db] Using local development JSON store at data/dev-store.json (configure MONGODB_URI for MongoDB Atlas).');
  }

  getStorageMode(): 'mongodb_atlas' | 'local_dev' {
    return this.mode;
  }

  private persistDev(): void {
    if (this.mode !== 'local_dev') return;
    const tmpPath = `${this.devDbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.devState, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.devDbPath);
  }

  private col<T extends { id: string }>(name: string): Collection<T> {
    if (!this.mongoDb) throw new Error('MongoDB is not initialized');
    return this.mongoDb.collection<T>(name);
  }

  private async ensureMongoIndexes(): Promise<void> {
    if (!this.mongoDb) return;
    await Promise.all([
      this.col<UserRecord>('users').createIndex({ email: 1 }, { unique: true }),
      this.col<UserRecord>('users').createIndex({ role: 1, regionId: 1, constituencyId: 1 }),
      this.col<SessionRecord>('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
      this.col<SessionRecord>('sessions').createIndex({ userId: 1 }),
      this.col<InviteRecord>('invites').createIndex({ tokenHash: 1 }, { unique: true }),
      this.col<PasswordResetRecord>('passwordResets').createIndex({ tokenHash: 1 }, { unique: true }),
      this.col<IssueRecord>('issues').createIndex({ referenceCode: 1 }, { unique: true }),
      this.col<IssueRecord>('issues').createIndex({ regionId: 1, constituencyId: 1, pollingStationId: 1, currentLevel: 1, status: 1 }),
      this.col<NotificationRecord>('notifications').createIndex({ recipientUserId: 1, createdAt: -1 }),
      this.col<AuditLogRecord>('auditLogs').createIndex({ createdAt: -1 }),
    ]);
  }

  private async ensureBaseReferenceData(): Promise<void> {
    const existingRegions = await this.listRegions();
    const regionIds = new Set(existingRegions.map((r) => r.id));
    const missingRegions = GHANA_REGIONS.filter((r) => !regionIds.has(r.id));
    if (missingRegions.length > 0) {
      if (this.mode === 'mongodb_atlas') {
        await this.col<RegionRecord>('regions').insertMany(missingRegions);
      } else {
        this.devState.regions.push(...missingRegions);
      }
    }

    const existingCons = await this.listConstituencies();
    const conById = new Map(existingCons.map((c) => [c.id, c]));
    const conByName = new Map(existingCons.map((c) => [c.name.toLowerCase(), c]));
    const missingCons = EC_GHANA_CONSTITUENCIES.filter(
      (c) => !conById.has(c.id) && !conByName.has(c.name.toLowerCase()),
    );
    if (missingCons.length > 0) {
      if (this.mode === 'mongodb_atlas') {
        await this.col<ConstituencyRecord>('constituencies').insertMany(missingCons);
      } else {
        this.devState.constituencies.push(...missingCons);
      }
    }

    // Automatically remove any legacy mock/sample records if present from earlier dev runs
    await this.stripLegacySampleData();

    const categories = await this.listCategories();
    if (categories.length === 0) {
      const defaults = createInitialCategories();
      if (this.mode === 'mongodb_atlas') {
        await this.col<CategoryRecord>('categories').insertMany(defaults);
      } else {
        this.devState.categories = defaults;
      }
    }

    const settings = await this.getSettings();
    if (!settings) {
      await this.saveSettings(createDefaultSettings());
    }
    this.persistDev();
  }

  // Users
  async listUsers(): Promise<UserRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<UserRecord>('users').find({}, { projection: { _id: 0 } }).toArray();
    }
    return [...this.devState.users];
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<UserRecord>('users').findOne({ id }, { projection: { _id: 0 } });
    }
    return this.devState.users.find((u) => u.id === id) || null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    if (this.mode === 'mongodb_atlas') {
      return this.col<UserRecord>('users').findOne({ email: normalized }, { projection: { _id: 0 } });
    }
    return this.devState.users.find((u) => u.email.toLowerCase() === normalized) || null;
  }

  async saveUser(user: UserRecord): Promise<void> {
    const normalized = { ...user, email: user.email.trim().toLowerCase() };
    if (this.mode === 'mongodb_atlas') {
      await this.col<UserRecord>('users').replaceOne({ id: normalized.id }, normalized, { upsert: true });
      return;
    }
    const idx = this.devState.users.findIndex((u) => u.id === normalized.id);
    if (idx >= 0) this.devState.users[idx] = normalized;
    else this.devState.users.push(normalized);
    this.persistDev();
  }

  // Invites
  async saveInvite(invite: InviteRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<InviteRecord>('invites').replaceOne({ id: invite.id }, invite, { upsert: true });
      return;
    }
    const idx = this.devState.invites.findIndex((i) => i.id === invite.id);
    if (idx >= 0) this.devState.invites[idx] = invite;
    else this.devState.invites.push(invite);
    this.persistDev();
  }

  async getInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<InviteRecord>('invites').findOne({ tokenHash }, { projection: { _id: 0 } });
    }
    return this.devState.invites.find((i) => i.tokenHash === tokenHash) || null;
  }

  // Password Resets
  async savePasswordReset(reset: PasswordResetRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<PasswordResetRecord>('passwordResets').replaceOne({ id: reset.id }, reset, { upsert: true });
      return;
    }
    const idx = this.devState.passwordResets.findIndex((r) => r.id === reset.id);
    if (idx >= 0) this.devState.passwordResets[idx] = reset;
    else this.devState.passwordResets.push(reset);
    this.persistDev();
  }

  async getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<PasswordResetRecord>('passwordResets').findOne({ tokenHash }, { projection: { _id: 0 } });
    }
    return this.devState.passwordResets.find((r) => r.tokenHash === tokenHash) || null;
  }

  // Sessions
  async saveSession(session: SessionRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<SessionRecord>('sessions').replaceOne({ id: session.id }, session, { upsert: true });
      return;
    }
    const idx = this.devState.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) this.devState.sessions[idx] = session;
    else this.devState.sessions.push(session);
    this.persistDev();
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<SessionRecord>('sessions').findOne({ tokenHash }, { projection: { _id: 0 } });
    }
    return this.devState.sessions.find((s) => s.tokenHash === tokenHash) || null;
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.mode === 'mongodb_atlas') {
      await this.col<SessionRecord>('sessions').updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: now } },
      );
      return;
    }
    for (const s of this.devState.sessions) {
      if (s.userId === userId && !s.revokedAt) {
        s.revokedAt = now;
      }
    }
    this.persistDev();
  }

  // Geography
  async listRegions(): Promise<RegionRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<RegionRecord>('regions').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    }
    return [...this.devState.regions].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listConstituencies(): Promise<ConstituencyRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<ConstituencyRecord>('constituencies').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    }
    return [...this.devState.constituencies].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveConstituency(record: ConstituencyRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<ConstituencyRecord>('constituencies').replaceOne({ id: record.id }, record, { upsert: true });
      return;
    }
    const idx = this.devState.constituencies.findIndex((c) => c.id === record.id);
    if (idx >= 0) this.devState.constituencies[idx] = record;
    else this.devState.constituencies.push(record);
    this.persistDev();
  }

  async listPollingStations(): Promise<PollingStationRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<PollingStationRecord>('pollingStations').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    }
    return [...this.devState.pollingStations].sort((a, b) => a.name.localeCompare(b.name));
  }

  async savePollingStation(record: PollingStationRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<PollingStationRecord>('pollingStations').replaceOne({ id: record.id }, record, { upsert: true });
      return;
    }
    const idx = this.devState.pollingStations.findIndex((p) => p.id === record.id);
    if (idx >= 0) this.devState.pollingStations[idx] = record;
    else this.devState.pollingStations.push(record);
    this.persistDev();
  }

  // Categories
  async listCategories(): Promise<CategoryRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<CategoryRecord>('categories').find({}, { projection: { _id: 0 } }).sort({ sortOrder: 1 }).toArray();
    }
    return [...this.devState.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async saveCategory(category: CategoryRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<CategoryRecord>('categories').replaceOne({ id: category.id }, category, { upsert: true });
      return;
    }
    const idx = this.devState.categories.findIndex((c) => c.id === category.id);
    if (idx >= 0) this.devState.categories[idx] = category;
    else this.devState.categories.push(category);
    this.persistDev();
  }

  // Issues
  async listIssues(): Promise<IssueRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<IssueRecord>('issues').find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
    }
    return [...this.devState.issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getIssueById(id: string): Promise<IssueRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<IssueRecord>('issues').findOne({ id }, { projection: { _id: 0 } });
    }
    return this.devState.issues.find((i) => i.id === id) || null;
  }

  async saveIssue(issue: IssueRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<IssueRecord>('issues').replaceOne({ id: issue.id }, issue, { upsert: true });
      return;
    }
    const idx = this.devState.issues.findIndex((i) => i.id === issue.id);
    if (idx >= 0) this.devState.issues[idx] = issue;
    else this.devState.issues.push(issue);
    this.persistDev();
  }

  // Recurring Groups & Dismissals
  async listRecurringGroups(): Promise<RecurringGroupRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<RecurringGroupRecord>('recurringGroups').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    }
    return [...this.devState.recurringGroups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveRecurringGroup(group: RecurringGroupRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<RecurringGroupRecord>('recurringGroups').replaceOne({ id: group.id }, group, { upsert: true });
      return;
    }
    const idx = this.devState.recurringGroups.findIndex((g) => g.id === group.id);
    if (idx >= 0) this.devState.recurringGroups[idx] = group;
    else this.devState.recurringGroups.push(group);
    this.persistDev();
  }

  async listRecurringDismissals(): Promise<RecurringDismissalRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<RecurringDismissalRecord>('recurringDismissals').find({}, { projection: { _id: 0 } }).toArray();
    }
    return [...this.devState.recurringDismissals];
  }

  async saveRecurringDismissal(dismissal: RecurringDismissalRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<RecurringDismissalRecord>('recurringDismissals').replaceOne({ id: dismissal.id }, dismissal, { upsert: true });
      return;
    }
    this.devState.recurringDismissals.push(dismissal);
    this.persistDev();
  }

  // Notifications
  async listNotificationsForUser(userId: string): Promise<NotificationRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<NotificationRecord>('notifications')
        .find({ recipientUserId: userId }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
    }
    return this.devState.notifications
      .filter((n) => n.recipientUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }

  async saveNotification(notification: NotificationRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<NotificationRecord>('notifications').replaceOne({ id: notification.id }, notification, { upsert: true });
      return;
    }
    const idx = this.devState.notifications.findIndex((n) => n.id === notification.id);
    if (idx >= 0) this.devState.notifications[idx] = notification;
    else this.devState.notifications.push(notification);
    this.persistDev();
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.mode === 'mongodb_atlas') {
      await this.col<NotificationRecord>('notifications').updateMany(
        { recipientUserId: userId, readAt: null },
        { $set: { readAt: now } },
      );
      return;
    }
    for (const n of this.devState.notifications) {
      if (n.recipientUserId === userId && !n.readAt) n.readAt = now;
    }
    this.persistDev();
  }

  // Audit Logs
  async appendAuditLog(entry: AuditLogRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<AuditLogRecord>('auditLogs').insertOne(entry);
      return;
    }
    this.devState.auditLogs.unshift(entry);
    if (this.devState.auditLogs.length > 5000) {
      this.devState.auditLogs = this.devState.auditLogs.slice(0, 5000);
    }
    this.persistDev();
  }

  async listAuditLogs(limit = 200): Promise<AuditLogRecord[]> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<AuditLogRecord>('auditLogs')
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    }
    return [...this.devState.auditLogs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // Settings
  async getSettings(): Promise<SystemSettingsRecord | null> {
    if (this.mode === 'mongodb_atlas') {
      return this.col<SystemSettingsRecord>('settings').findOne({ id: 'default' }, { projection: { _id: 0 } });
    }
    return this.devState.settings ? { ...this.devState.settings } : null;
  }

  async saveSettings(settings: SystemSettingsRecord): Promise<void> {
    if (this.mode === 'mongodb_atlas') {
      await this.col<SystemSettingsRecord>('settings').replaceOne({ id: 'default' }, settings, { upsert: true });
      return;
    }
    this.devState.settings = settings;
    this.persistDev();
  }

  private async stripLegacySampleData(): Promise<void> {
    const legacyMockStationIds = [
      'ps-bantama-presby-a',
      'ps-bantama-market',
      'ps-abreproso-jhs',
      'ps-subin-kejetia',
      'ps-suame-magazine',
      'ps-manhyia-palace-annex',
      'ps-dzorwulu-jhs',
      'ps-legon-staff-club',
      'ps-tesano-police-depot',
      'ps-sakumono-estate',
      'ps-dansoman-sahara',
      'ps-koforidua-jackson',
      'ps-akropong-salem',
      'ps-cape-abura',
      'ps-winneba-junction',
      'ps-takoradi-market-circle',
      'ps-tamale-kalpohin',
      'ps-sunyani-berlin',
      'ps-ho-bankoe',
      'ps-bolga-tindonsobligo',
      'ps-wa-kabanye',
    ];

    if (this.mode === 'mongodb_atlas') {
      const sampleUsers = await this.col<UserRecord>('users').find({ isSample: true } as any).toArray();
      const sampleUserIds = sampleUsers.map((u) => u.id);
      await this.col<IssueRecord>('issues').deleteMany({ isSample: true } as any);
      await this.col<RecurringGroupRecord>('recurringGroups').deleteMany({ isSample: true } as any);
      await this.col<UserRecord>('users').deleteMany({ isSample: true } as any);
      if (sampleUserIds.length > 0) {
        await this.col<SessionRecord>('sessions').deleteMany({ userId: { $in: sampleUserIds } });
        await this.col<InviteRecord>('invites').deleteMany({ userId: { $in: sampleUserIds } });
        await this.col<NotificationRecord>('notifications').deleteMany({ recipientUserId: { $in: sampleUserIds } });
      }
      const [remainingUsers, remainingIssues] = await Promise.all([
        this.listUsers(),
        this.listIssues(),
      ]);
      const referencedStations = new Set([
        ...remainingUsers.map((u) => u.pollingStationId).filter(Boolean),
        ...remainingIssues.map((i) => i.pollingStationId).filter(Boolean),
      ]);
      const removableStationIds = legacyMockStationIds.filter((id) => !referencedStations.has(id));
      if (removableStationIds.length > 0) {
        await this.col<PollingStationRecord>('pollingStations').deleteMany({
          id: { $in: removableStationIds },
        });
      }
      return;
    }

    const hasLegacySample = (rec: unknown) => Boolean((rec as { isSample?: boolean }).isSample);
    const sampleUserIds = new Set(this.devState.users.filter(hasLegacySample).map((u) => u.id));
    const nonSampleUsers = this.devState.users.filter((u) => !hasLegacySample(u));
    const nonSampleIssues = this.devState.issues.filter((i) => !hasLegacySample(i));
    const referencedStations = new Set([
      ...nonSampleUsers.map((u) => u.pollingStationId).filter(Boolean),
      ...nonSampleIssues.map((i) => i.pollingStationId).filter(Boolean),
    ]);
    const legacyStationSet = new Set(
      legacyMockStationIds.filter((id) => !referencedStations.has(id)),
    );
    const hasLegacyStations = this.devState.pollingStations.some((p) => legacyStationSet.has(p.id));

    if (
      sampleUserIds.size > 0 ||
      this.devState.issues.some(hasLegacySample) ||
      this.devState.recurringGroups.some(hasLegacySample) ||
      hasLegacyStations
    ) {
      this.devState.users = nonSampleUsers;
      this.devState.issues = nonSampleIssues;
      this.devState.recurringGroups = this.devState.recurringGroups.filter((g) => !hasLegacySample(g));
      this.devState.pollingStations = this.devState.pollingStations.filter(
        (p) => !legacyStationSet.has(p.id),
      );
      this.devState.sessions = this.devState.sessions.filter((s) => !sampleUserIds.has(s.userId));
      this.devState.invites = this.devState.invites.filter((i) => !sampleUserIds.has(i.userId));
      this.devState.notifications = this.devState.notifications.filter((n) => !sampleUserIds.has(n.recipientUserId));
      this.persistDev();
    }
  }

  // Backup & Restore
  async exportBackup(): Promise<BackupPayload> {
    const [
      regions,
      constituencies,
      pollingStations,
      categories,
      users,
      issues,
      recurringGroups,
      recurringDismissals,
      auditLogs,
      settings,
    ] = await Promise.all([
      this.listRegions(),
      this.listConstituencies(),
      this.listPollingStations(),
      this.listCategories(),
      this.listUsers(),
      this.listIssues(),
      this.listRecurringGroups(),
      this.listRecurringDismissals(),
      this.listAuditLogs(2000),
      this.getSettings(),
    ]);

    const notifications =
      this.mode === 'mongodb_atlas'
        ? await this.col<NotificationRecord>('notifications').find({}, { projection: { _id: 0 } }).toArray()
        : [...this.devState.notifications];

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      storageMode: this.mode,
      data: {
        regions,
        constituencies,
        pollingStations,
        categories,
        users,
        issues,
        recurringGroups,
        recurringDismissals,
        notifications,
        auditLogs,
        settings,
      },
    };
  }

  async restoreBackup(payload: BackupPayload): Promise<void> {
    const d = payload.data;
    if (this.mode === 'mongodb_atlas') {
      const replaceCollection = async <T extends { id: string }>(name: string, rows: T[]) => {
        const col = this.col<T>(name);
        await col.deleteMany({});
        if (rows.length > 0) {
          await col.insertMany(rows as unknown as Parameters<typeof col.insertMany>[0]);
        }
      };
      await replaceCollection('regions', d.regions);
      await replaceCollection('constituencies', d.constituencies);
      await replaceCollection('pollingStations', d.pollingStations);
      await replaceCollection('categories', d.categories);
      await replaceCollection('users', d.users);
      await replaceCollection('issues', d.issues);
      await replaceCollection('recurringGroups', d.recurringGroups);
      await replaceCollection('recurringDismissals', d.recurringDismissals);
      await replaceCollection('notifications', d.notifications);
      await replaceCollection('auditLogs', d.auditLogs);
      if (d.settings) await this.saveSettings(d.settings);
      return;
    }

    this.devState = {
      ...this.devState,
      regions: d.regions,
      constituencies: d.constituencies,
      pollingStations: d.pollingStations,
      categories: d.categories,
      users: d.users,
      issues: d.issues,
      recurringGroups: d.recurringGroups,
      recurringDismissals: d.recurringDismissals,
      notifications: d.notifications,
      auditLogs: d.auditLogs,
      settings: d.settings,
    };
    this.persistDev();
  }
}

export const store = new DataStore();
