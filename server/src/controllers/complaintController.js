import * as complaints from '../services/complaintService.js';
import * as attachments from '../services/attachmentService.js';
import { ok, created, pagination, requestContext } from '../utils/http.js';

const who = (req) => ({ user: req.user, permissions: req.permissions, context: requestContext(req) });

export async function create(req, res) {
  const { origin, ...input } = req.body;
  const complaint = await complaints.createComplaint(input, { actor: req.user, origin, context: requestContext(req) });
  return created(res, complaint.toJSON());
}

export async function list(req, res) {
  const q = req.validQuery;
  const { items, meta } = await complaints.listComplaints(q, req.user, req.permissions, pagination(q));
  return ok(res, items, meta);
}

export async function filters(req, res) {
  return ok(res, await complaints.filterOptions(req.user, req.permissions));
}

export async function detail(req, res) {
  return ok(res, await complaints.getDetail(req.params.id, req.user, req.permissions));
}

export async function updateD1(req, res) {
  return ok(res, await complaints.updateD1(req.params.id, req.body, who(req)));
}

export async function history(req, res) {
  return ok(res, await complaints.history(req.params.id, req.user, req.permissions));
}

export async function dashboard(req, res) {
  return ok(res, await complaints.dashboardSummary(req.user, req.permissions));
}

export async function listAttachments(req, res) {
  return ok(res, await attachments.list(req.params.id, req.user, req.permissions));
}

export async function uploadAttachments(req, res) {
  const result = await attachments.upload(req.params.id, req.files, { stage: req.body.stage, ...who(req) });
  return created(res, result);
}

export async function downloadAttachment(req, res) {
  const { attachment, stream } = await attachments.open(req.params.id, req.params.attachmentId, req.user, req.permissions);
  const inline = req.query.inline === '1' && /^(image\/|application\/pdf$)/.test(attachment.mimeType);
  res.set({
    'Content-Type': attachment.mimeType,
    'Content-Length': attachment.sizeBytes,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
