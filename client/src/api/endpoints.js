import { api } from './client.js';

const data = (p) => p.then((r) => r.data);

export const authApi = {
  me: () => data(api.get('/auth/me')),
  login: (body) => data(api.post('/auth/login', body)),
  logout: () => api.post('/auth/logout'),
  logoutAll: () => api.post('/auth/logout-all'),
  changePassword: (body) => data(api.post('/auth/change-password', body)),
};

export const userApi = {
  list: (params) => data(api.get('/users', { params })),
  create: (body) => data(api.post('/users', body)),
  update: (id, body) => data(api.patch(`/users/${id}`, body)),
  resetPassword: (id) => data(api.post(`/users/${id}/reset-password`)),
};

export const adminApi = {
  meta: () => data(api.get('/meta')),
  roles: () => data(api.get('/roles')),
  updateRole: (key, permissions) => data(api.put(`/roles/${key}/permissions`, { permissions })),
  departments: (includeInactive = false) => data(api.get('/departments', { params: { includeInactive } })),
  createDepartment: (body) => data(api.post('/departments', body)),
  updateDepartment: (id, body) => data(api.patch(`/departments/${id}`, body)),
  auditLogs: (params) => data(api.get('/audit-logs', { params })),
};

export const complaintApi = {
  list: (params) => data(api.get('/complaints', { params })),
  filters: () => data(api.get('/complaints/filters')),
  create: (body) => data(api.post('/complaints', body)),
  get: (id) => data(api.get(`/complaints/${id}`)),
  updateD1: (id, body) => data(api.patch(`/complaints/${id}/d1`, body)),
  history: (id) => data(api.get(`/complaints/${id}/history`)),
  attachments: (id) => data(api.get(`/complaints/${id}/attachments`)),
  upload: (id, files, stage) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (stage) form.append('stage', stage);
    return data(api.post(`/complaints/${id}/attachments`, form, { timeout: 120_000 }));
  },
  downloadUrl: (id, attachmentId, inline = false) =>
    `${api.defaults.baseURL}/complaints/${id}/attachments/${attachmentId}/download${inline ? '?inline=1' : ''}`,
  dashboard: () => data(api.get('/dashboard/summary')),
  acknowledgementPreview: (id) => data(api.get(`/complaints/${id}/acknowledgement-preview`)),
  acknowledge: (id, body) => data(api.post(`/complaints/${id}/acknowledge`, body)),
  notifications: (id) => data(api.get(`/complaints/${id}/notifications`)),
  startD2: (id, body) => data(api.post(`/complaints/${id}/start-d2`, body)),
  updateD2: (id, body) => data(api.patch(`/complaints/${id}/d2`, body)),
  completeD2: (id, body) => data(api.post(`/complaints/${id}/complete-d2`, body)),
  assignFrp: (id, body) => data(api.post(`/complaints/${id}/frp`, body)),
  assignments: (id) => data(api.get(`/complaints/${id}/assignments`)),
  frpCandidates: () => data(api.get('/complaints/frp-candidates')),
  startD3: (id, body) => data(api.post(`/complaints/${id}/start-d3`, body)),
  requestSlaExtension: (id, body) => data(api.post(`/complaints/${id}/d2/sla-extension`, body)),
  frpAcknowledge: (id, body) => data(api.post(`/complaints/${id}/d2/frp-acknowledge`, body)),
  updateCopq: (id, body) => data(api.patch(`/complaints/${id}/d4/copq`, body)),
  updateCapaImplementation: (id, capaId, body) => data(api.patch(`/complaints/${id}/capa/${capaId}/implementation`, body)),
  decideImplementationApproval: (id, capaId, body) => data(api.post(`/complaints/${id}/capa/${capaId}/implementation-decision`, body)),
  assignErp: (id, capaId, body) => data(api.post(`/complaints/${id}/capa/${capaId}/erp`, body)),
  closeCapa: (id, capaId, body) => data(api.post(`/complaints/${id}/capa/${capaId}/close`, body)),
};

export const d3Api = {
  get: (id) => data(api.get(`/complaints/${id}/d3`)),
  updateAnalysis: (id, body) => data(api.patch(`/complaints/${id}/d3/analysis`, body)),
  addCause: (id, body) => data(api.post(`/complaints/${id}/d3/causes`, body)),
  updateCause: (id, causeId, body) => data(api.patch(`/complaints/${id}/d3/causes/${causeId}`, body)),
  deleteCause: (id, causeId) => data(api.delete(`/complaints/${id}/d3/causes/${causeId}`)),
  addRootCause: (id, body) => data(api.post(`/complaints/${id}/d3/root-causes`, body)),
  updateRootCause: (id, rcId, body) => data(api.patch(`/complaints/${id}/d3/root-causes/${rcId}`, body)),
  deleteRootCause: (id, rcId) => data(api.delete(`/complaints/${id}/d3/root-causes/${rcId}`)),
  addCapa: (id, rcId, body) => data(api.post(`/complaints/${id}/d3/root-causes/${rcId}/capa`, body)),
  updateCapa: (id, capaId, body) => data(api.patch(`/complaints/${id}/d3/capa/${capaId}`, body)),
  deleteCapa: (id, capaId) => data(api.delete(`/complaints/${id}/d3/capa/${capaId}`)),
  people: () => data(api.get('/users/directory')),
  readiness: (id) => data(api.get(`/complaints/${id}/d3/readiness`)),
  reviewerCandidates: () => data(api.get('/complaints/reviewer-candidates')),
  submit: (id, body) => data(api.post(`/complaints/${id}/d3/submit`, body)),
  approve: (id, body) => data(api.post(`/complaints/${id}/d3/approve`, body)),
  reject: (id, body) => data(api.post(`/complaints/${id}/d3/reject`, body)),
  reviews: (id) => data(api.get(`/complaints/${id}/d3/reviews`)),
};

export const lookupApi = {
  all: (includeInactive = false) => data(api.get('/lookups', { params: { includeInactive } })),
  create: (body) => data(api.post('/lookups', body)),
  update: (id, body) => data(api.patch(`/lookups/${id}`, body)),
};

export const notificationApi = {
  list: (params) => data(api.get('/notifications', { params })),
  get: (id) => data(api.get(`/notifications/${id}`)),
  retry: (id) => data(api.post(`/notifications/${id}/retry`)),
};

export const inAppApi = {
  list: () => data(api.get('/notifications/in-app')),
  markAllRead: () => data(api.post('/notifications/in-app/mark-all-read')),
  markRead: (id) => data(api.post(`/notifications/in-app/${id}/read`)),
};

export const reportApi = {
  summary: (params) => data(api.get('/reports/summary', { params })),
  csvUrl: (params) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return `${api.defaults.baseURL}/reports/complaints.csv${q ? `?${q}` : ''}`;
  },
};

export const simulatorApi = {
  send: (body) => data(api.post('/dev/whatsapp/messages', body)),
  conversation: (waId) => data(api.get('/dev/whatsapp/messages', { params: { waId } })),
  clear: (waId) => data(api.delete('/dev/whatsapp/messages', { params: { waId } })),
};
