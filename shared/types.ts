export type UserRole =
  | 'POLLING_STATION'
  | 'CONSTITUENCY'
  | 'REGIONAL'
  | 'NATIONAL'
  | 'SUPER_ADMIN';

export type AccountStatus =
  | 'PENDING_APPROVAL'
  | 'INVITED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED';

export type IssueLevel =
  | 'POLLING_STATION'
  | 'CONSTITUENCY'
  | 'REGIONAL'
  | 'NATIONAL';

export type IssueStatus =
  | 'New'
  | 'Under review'
  | 'Assigned'
  | 'Awaiting update'
  | 'Escalated'
  | 'Resolved'
  | 'Closed with reason';

export type IssuePriority = 'Urgent' | 'High' | 'Normal' | 'Low';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  POLLING_STATION: 'Polling-Station Executive',
  CONSTITUENCY: 'Constituency Executive',
  REGIONAL: 'Regional Executive',
  NATIONAL: 'National Executive',
  SUPER_ADMIN: 'Platform Super Admin',
};

export const ISSUE_LEVEL_LABELS: Record<IssueLevel, string> = {
  POLLING_STATION: 'Polling Station',
  CONSTITUENCY: 'Constituency',
  REGIONAL: 'Region',
  NATIONAL: 'National',
};

export const ISSUE_STATUSES: IssueStatus[] = [
  'New',
  'Under review',
  'Assigned',
  'Awaiting update',
  'Escalated',
  'Resolved',
  'Closed with reason',
];

export const ISSUE_PRIORITIES: IssuePriority[] = [
  'Urgent',
  'High',
  'Normal',
  'Low',
];

export const DEFAULT_CATEGORIES = [
  'Member concerns',
  'Local organization',
  'Communication',
  'Resources',
  'Community issue',
  'Other',
];

export interface RegionRecord {
  id: string;
  name: string;
  code: string;
}

export interface ConstituencyRecord {
  id: string;
  regionId: string;
  name: string;
  code: string;
}

export interface PollingStationRecord {
  id: string;
  regionId: string;
  constituencyId: string;
  name: string;
  code: string;
}

export interface CategoryRecord {
  id: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  titleOrOffice: string;
  role: UserRole;
  status: AccountStatus;
  regionId: string | null;
  constituencyId: string | null;
  pollingStationId: string | null;
  passwordHash: string | null;
  mfaEnabled: boolean;
  mfaSecretEncrypted: string | null;
  mfaBackupCodeHashes: string[];
  lastTotpStepUsed: number | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  invitedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  titleOrOffice: string;
  role: UserRole;
  status: AccountStatus;
  regionId: string | null;
  constituencyId: string | null;
  pollingStationId: string | null;
  regionName?: string | null;
  constituencyName?: string | null;
  pollingStationName?: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InviteRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  mfaVerified: boolean;
  expiresAt: string;
  idleExpiresAt: string;
  revokedAt: string | null;
  ipHash: string;
  userAgentSummary: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface AttachmentMeta {
  id: string;
  issueId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  dataBase64?: string | null;
  uploadedByUserId: string;
  uploadedByName: string;
  createdAt: string;
}

export interface IssueNote {
  id: string;
  authorUserId: string;
  authorName: string;
  authorRole: UserRole;
  level: IssueLevel;
  noteType: 'NOTE' | 'ACTION_TAKEN' | 'ESCALATION' | 'RESOLUTION' | 'CLOSURE';
  content: string;
  createdAt: string;
}

export interface IssueHistoryEntry {
  id: string;
  actorUserId: string;
  actorName: string;
  actorRole: UserRole;
  action:
    | 'SUBMITTED'
    | 'VIEWED'
    | 'ASSIGNED'
    | 'STATUS_CHANGED'
    | 'PRIORITY_CHANGED'
    | 'ESSENTIAL_CHANGED'
    | 'FOLLOW_UP_UPDATED'
    | 'NOTE_ADDED'
    | 'ESCALATED'
    | 'RESOLVED'
    | 'CLOSED'
    | 'RECURRING_CONFIRMED';
  summary: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: string;
}

export interface IssueRecord {
  id: string;
  referenceCode: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  meetingDate: string;
  requestedAction: string;
  regionId: string;
  regionName: string;
  constituencyId: string;
  constituencyName: string;
  pollingStationId: string;
  pollingStationName: string;
  originLevel: IssueLevel;
  currentLevel: IssueLevel;
  status: IssueStatus;
  priority: IssuePriority;
  isEssential: boolean;
  submittedByUserId: string;
  submittedByName: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  assignedToRole: UserRole | null;
  followUpDate: string | null;
  followUpOverdueNotifiedAt: string | null;
  optionalFollowUpContact: string | null;
  resolutionSummary: string | null;
  closureReason: string | null;
  escalationCount: number;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  recurringGroupId: string | null;
  attachments: AttachmentMeta[];
  notes: IssueNote[];
  history: IssueHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface RecurringGroupRecord {
  id: string;
  title: string;
  summary: string;
  categoryId: string;
  categoryName: string;
  scopeLevel: IssueLevel;
  regionId: string | null;
  constituencyId: string | null;
  issueIds: string[];
  confirmedByUserId: string;
  confirmedByName: string;
  confirmedAt: string;
  createdAt: string;
}

export interface RecurringDismissalRecord {
  id: string;
  issueIdA: string;
  issueIdB: string;
  dismissedByUserId: string;
  createdAt: string;
}

export interface RecurringSuggestion {
  primaryIssueId: string;
  relatedIssueId: string;
  relatedReferenceCode: string;
  relatedTitle: string;
  relatedCategoryName: string;
  relatedLocation: string;
  relatedStatus: IssueStatus;
  relatedCreatedAt: string;
  similarityScore: number;
  matchedTerms: string[];
  isSuggestion: true;
  requiresConfirmation: true;
}

export interface NotificationRecord {
  id: string;
  recipientUserId: string;
  issueId: string | null;
  issueReferenceCode: string | null;
  eventType:
    | 'SUBMITTED'
    | 'ASSIGNED'
    | 'UPDATED'
    | 'ESCALATED'
    | 'OVERDUE'
    | 'RESOLVED'
    | 'CLOSED'
    | 'SECURITY_ALERT';
  title: string;
  message: string;
  readAt: string | null;
  emailSent: boolean;
  emailStatusNote: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: UserRole | 'SYSTEM' | 'ANONYMOUS';
  action: string;
  targetType: string;
  targetId: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  details: string;
  ipHash: string | null;
  createdAt: string;
}

export interface SystemSettingsRecord {
  id: string;
  retentionDays: number;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  maxAttachmentMb: number;
  privacyNoticeTitle: string;
  privacyNoticeBody: string;
  ghanaDpaChecklist: {
    dpaRegistrationReviewed: boolean;
    lawfulBasisDocumented: boolean;
    retentionPolicyApproved: boolean;
    officerTrainingCompleted: boolean;
    breachResponsePlanActive: boolean;
  };
  updatedByUserId: string | null;
  updatedAt: string;
}

export interface DashboardAnalytics {
  totalInScope: number;
  openIssues: number;
  urgentIssues: number;
  essentialIssues: number;
  overdueFollowUps: number;
  escalatedIssues: number;
  resolvedIssues: number;
  closedIssues: number;
  avgFirstResponseHours: number | null;
  escalationRatePercent: number;
  resolutionRatePercent: number;
  recurringClustersCount: number;
  byStatus: Array<{ label: string; count: number }>;
  byCategory: Array<{ label: string; count: number }>;
  byOwner: Array<{ label: string; count: number }>;
  byLocation: Array<{ label: string; count: number }>;
  recentActivity: Array<{
    issueId: string;
    referenceCode: string;
    title: string;
    actorName: string;
    action: string;
    summary: string;
    createdAt: string;
  }>;
}

export interface HomepageSlideRecord {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
  storageKey?: string | null;
  mimeType?: string | null;
  imageDataBase64?: string | null;
  sortOrder: number;
  active: boolean;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

