/**
 * Permission catalogue.
 *
 * Every protected route checks one of these keys on the server. The UI uses
 * the same keys only to decide what to show; it is never the enforcement point.
 *
 * Keys marked "pending" belong to stages whose business rules are not yet
 * confirmed (see docs/OPEN_QUESTIONS.md). They exist so roles can be
 * configured ahead of time, but no route uses them yet.
 */
export const PERMISSIONS = Object.freeze({
  // Complaints
  COMPLAINT_VIEW_ALL: 'complaint.view.all',
  COMPLAINT_VIEW_ASSIGNED: 'complaint.view.assigned',
  COMPLAINT_CREATE_MANUAL: 'complaint.create.manual',
  COMPLAINT_D1_ACKNOWLEDGE: 'complaint.d1.acknowledge',
  COMPLAINT_D2_EDIT: 'complaint.d2.edit',
  COMPLAINT_ASSIGN: 'complaint.assign',
  COMPLAINT_D3_EDIT: 'complaint.d3.edit',
  COMPLAINT_D3_REVIEW: 'complaint.d3.review',
  COMPLAINT_D4_EDIT: 'complaint.d4.edit', // pending
  COMPLAINT_D4_APPROVE: 'complaint.d4.approve', // pending
  COMPLAINT_CLOSE: 'complaint.close', // pending
  ATTACHMENT_UPLOAD: 'attachment.upload',

  // Oversight
  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_RETRY: 'notifications.retry',

  // Administration
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  SETTINGS_MANAGE: 'settings.manage',
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/** Human-readable labels, served to the UI for the roles matrix. */
export const PERMISSION_LABELS = Object.freeze({
  'complaint.view.all': 'View all complaints',
  'complaint.view.assigned': 'View complaints assigned to me',
  'complaint.create.manual': 'Register a complaint manually',
  'complaint.d1.acknowledge': 'Approve D1 acknowledgement',
  'complaint.d2.edit': 'Edit D2 product information and investigation',
  'complaint.assign': 'Assign or reassign the First Responsible Person',
  'complaint.d3.edit': 'Record D3 root cause analysis and CAPA',
  'complaint.d3.review': 'Approve or reject D3 submissions',
  'complaint.d4.edit': 'Work on D4 (rules pending)',
  'complaint.d4.approve': 'Approve D4 (rules pending)',
  'complaint.close': 'Close complaints (rules pending)',
  'attachment.upload': 'Upload evidence and attachments',
  'reports.view': 'View reports',
  'audit.view': 'View audit history',
  'notifications.view': 'View notification logs',
  'notifications.retry': 'Retry failed notifications',
  'users.manage': 'Manage users',
  'roles.manage': 'Manage role permissions',
  'departments.manage': 'Manage departments',
  'settings.manage': 'Manage settings',
});

const P = PERMISSIONS;

/**
 * Default roles, created by the seed script. These are proposals based on the
 * responsibilities in the brief; an administrator can change the permissions
 * of any role through the API without a code change.
 */
export const DEFAULT_ROLES = Object.freeze([
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Manages users, roles and settings. Has full oversight of complaints.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'quality_coordinator',
    name: 'Quality Coordinator',
    description: 'Reviews new complaints, approves acknowledgement and assigns the FRP.',
    permissions: [
      P.COMPLAINT_VIEW_ALL,
      P.COMPLAINT_CREATE_MANUAL,
      P.COMPLAINT_D1_ACKNOWLEDGE,
      P.COMPLAINT_D2_EDIT,
      P.COMPLAINT_ASSIGN,
      P.ATTACHMENT_UPLOAD,
      P.REPORTS_VIEW,
      P.AUDIT_VIEW,
    ],
  },
  {
    key: 'frp',
    name: 'First Responsible Person',
    description: 'Investigates assigned complaints and records root cause and CAPA.',
    permissions: [P.COMPLAINT_VIEW_ASSIGNED, P.COMPLAINT_D3_EDIT, P.ATTACHMENT_UPLOAD],
  },
  {
    key: 'reviewer',
    name: 'Reviewer / FRP Manager',
    description: 'Approves or rejects root cause analysis and CAPA submissions.',
    permissions: [P.COMPLAINT_VIEW_ALL, P.COMPLAINT_D3_REVIEW, P.REPORTS_VIEW, P.AUDIT_VIEW],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Sees only complaints and actions assigned to them.',
    permissions: [P.COMPLAINT_VIEW_ASSIGNED],
  },
]);
