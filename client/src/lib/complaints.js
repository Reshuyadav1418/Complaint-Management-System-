/** Display helpers shared by complaint screens. */

export const STAGE_ORDER = ['D1', 'D2', 'D3', 'D4', 'CLOSED'];

export const STAGE_NAMES = {
  D1: 'Define the problem',
  D2: 'Grasp the situation',
  D3: 'RCA and CAPA',
  D4: 'Verification and closure',
  CLOSED: 'Closed',
};

export const STATUS_TONE = {
  SUBMITTED: 'neutral',
  D1_ACK_PENDING: 'warn',
  D1_ACKNOWLEDGED: 'brand',
  D2_IN_PROGRESS: 'brand',
  D2_COMPLETED: 'brand',
  D3_IN_PROGRESS: 'brand',
  D3_PENDING_APPROVAL: 'warn',
  D3_REWORK: 'bad',
  D3_APPROVED: 'ok',
  D4_IN_PROGRESS: 'brand',
  CLOSED: 'ok',
};

export const ORIGINS = ['Phone', 'Email', 'Web'];
export const REPORTER_TYPES = ['Customer', 'Retailer', 'Distributor'];

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
