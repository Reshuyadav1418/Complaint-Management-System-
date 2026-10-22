import env from '../config/env.js';

/**
 * Email templates. Each returns { subject, text, html }. Every value from a
 * complaint is HTML-escaped, so a requester who types markup into WhatsApp
 * cannot inject it into an email.
 *
 * Wording of the D1 acknowledgement follows the brief exactly. Templates for
 * later stages are added in the phase that sends them.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function complaintLink(complaintId) {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/complaints/${complaintId}`;
}

/** Shared HTML frame: plain, readable in every mail client, no images. */
function layout({ title, bodyHtml, footnote }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dcdfe4;border-radius:6px;">
<tr><td style="border-top:4px solid #1d5bb8;border-radius:6px 6px 0 0;padding:24px 28px 8px;font:600 16px/1.4 Arial,Helvetica,sans-serif;color:#1f2328;">${escapeHtml(title)}</td></tr>
<tr><td style="padding:8px 28px 24px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#1f2328;">${bodyHtml}</td></tr>
${footnote ? `<tr><td style="padding:14px 28px;border-top:1px solid #dcdfe4;font:12px/1.5 Arial,Helvetica,sans-serif;color:#5b6470;">${footnote}</td></tr>` : ''}
</table>
</td></tr></table>
</body></html>`;
}

/** Brief, section 8: sent to the requester when D1 acknowledgement is approved. */
export function d1Acknowledgement(complaint) {
  const number = complaint.complaintNumber;
  const subject = `Complaint Acknowledgement for D1 Stage – ${number}`;
  const text = [
    'Dear Sir/Madam,',
    '',
    'Thank you for bringing this matter to our attention.',
    '',
    `We have received your complaint ${number}, and our team is reviewing it.`,
    '',
    'We will update you on the progress shortly.',
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
    '',
    'Note: This is an automatically generated email. Please do not reply to this email.',
  ].join('\n');

  const n = escapeHtml(number);
  const html = layout({
    title: `Complaint acknowledgement: ${number}`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear Sir/Madam,</p>
<p style="margin:0 0 14px;">Thank you for bringing this matter to our attention.</p>
<p style="margin:0 0 14px;">We have received your complaint <strong>${n}</strong>, and our team is reviewing it.</p>
<p style="margin:0 0 14px;">We will update you on the progress shortly.</p>
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email. Please do not reply to this email.',
  });
  return { subject, text, html };
}

/* ---------------- Internal emails with complaint details ---------------- */

const STAGE_LABEL = { D1: 'D1 Define the Problem', D2: 'D2 Grasp the Situation', D3: 'D3 RCA & CAPA', D4: 'D4', CLOSED: 'Closed' };

function productName(c) {
  return c.d2?.verifiedProduct?.productName || c.reportedProduct?.name || '';
}
function batchNumber(c) {
  return c.d2?.verifiedProduct?.batchNumber || c.reportedProduct?.batchNumber || '';
}

/** Two-column details table, plus the same rows as plain text. */
function detailsBlock(rows) {
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 18px;border:1px solid #dcdfe4;">
${rows
  .map(
    ([k, v], i) => `<tr style="background:${i % 2 ? '#ffffff' : '#f7f8fa'};"><td style="padding:8px 12px;width:42%;color:#5b6470;border-bottom:1px solid #dcdfe4;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #dcdfe4;vertical-align:top;">${v ? escapeHtml(v) : '<span style="color:#8a929c;">Not recorded</span>'}</td></tr>`,
  )
  .join('\n')}
</table>`;
  const text = rows.map(([k, v]) => `- ${k}: ${v || 'Not recorded'}`).join('\n');
  return { html, text };
}

function button(href, label) {
  return `<p style="margin:0 0 6px;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1d5bb8;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:4px;">${escapeHtml(label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#5b6470;">You will be asked to sign in. The link works only for people allowed to see this complaint.</p>`;
}

const URGENT = new Set(['High', 'Critical']);

/**
 * Brief, section 9: sent to the employee assigned as First Responsible Person.
 * The urgency line appears only when the complaint's priority is High or
 * Critical (the rule is configurable once the business confirms it).
 */
export function d2FrpAssigned(complaint, frp) {
  const number = complaint.complaintNumber;
  const subject = `First Responsible Person Assigned – ${number}`;
  const link = complaintLink(complaint._id);
  const urgent = URGENT.has(complaint.priority);
  const details = detailsBlock([
    ['Complaint Number', number],
    ['Current Stage', STAGE_LABEL[complaint.stage] || complaint.stage],
    ['Type of Failure', complaint.d2?.investigation?.typeOfFailure],
    ['Manufacturing Location', complaint.d2?.investigation?.manufacturingLocation],
    ['Product Name', productName(complaint)],
    ['Batch Number', batchNumber(complaint)],
    ['Short Description', complaint.shortDescription],
  ]);
  const urgency = `This complaint is marked ${complaint.priority} priority. Please review it and start the investigation as soon as possible.`;

  const text = [
    `Dear ${frp.name},`,
    '',
    'You have been assigned as the First Responsible Person (FRP) for the following complaint. Please review the details and take the necessary action.',
    '',
    ...(urgent ? [urgency, ''] : []),
    'Complaint Details:',
    details.text,
    '',
    `View Complaint Record: ${link}`,
    '',
    'Best Regards,',
    'Quality Management Team',
    '',
    'Note: This is an automatically generated email. Please do not reply to this email.',
  ].join('\n');

  const html = layout({
    title: `FRP assigned: ${number}`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(frp.name)},</p>
<p style="margin:0 0 14px;">You have been assigned as the First Responsible Person (FRP) for the following complaint. Please review the details and take the necessary action.</p>
${urgent ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fbeae9;border-left:3px solid #b3261e;color:#7a1a14;">${escapeHtml(urgency)}</p>` : ''}
<p style="margin:0 0 6px;font-weight:600;">Complaint Details</p>
${details.html}
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Quality Management Team</p>`,
    footnote: 'Note: This is an automatically generated email. Please do not reply to this email.',
  });
  return { subject, text, html };
}

/** Brief, section 9: D2 completion notice to the configured next-stage stakeholder. */
export function d2Completed(complaint, { recipientName, frpName }) {
  const number = complaint.complaintNumber;
  const subject = `D2 Completed – Process Mapping & Assignment – ${number}`;
  const link = complaintLink(complaint._id);
  const details = detailsBlock([
    ['Complaint Number', number],
    ['First Responsible Person', frpName],
    ['Product', productName(complaint)],
    ['Batch Number', batchNumber(complaint)],
    ['Country', complaint.country],
    ['Distributor / Retailer', complaint.customer?.name],
    ['Complaint Description', complaint.shortDescription],
  ]);
  const greeting = recipientName ? `Dear ${recipientName},` : 'Dear Team,';
  const text = [
    greeting,
    '',
    `Stage D2 – Process Mapping & Assignment has been completed for complaint ${number}. The complaint now moves to D3 – Root Cause Analysis and CAPA.`,
    '',
    details.text,
    '',
    `View Complaint Record: ${link}`,
    '',
    'Best Regards,',
    'Quality Management Team',
    '',
    'Note: This is an automatically generated email. Please do not reply to this email.',
  ].join('\n');
  const html = layout({
    title: `D2 completed: ${number}`,
    bodyHtml: `<p style="margin:0 0 14px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 14px;">Stage D2 – Process Mapping &amp; Assignment has been completed for complaint <strong>${escapeHtml(number)}</strong>. The complaint now moves to D3 – Root Cause Analysis and CAPA.</p>
${details.html}
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Quality Management Team</p>`,
    footnote: 'Note: This is an automatically generated email. Please do not reply to this email.',
  });
  return { subject, text, html };
}

/** Brief, section 13: tells the chosen reviewer a D3 analysis is waiting. */
export function d3ApprovalRequest(complaint, { reviewerName, submitterName, version, rootCauses, capas, remarks }) {
  const number = complaint.complaintNumber;
  const subject = `D3 Approval Requested – ${number}${version > 1 ? ` (resubmission ${version})` : ''}`;
  const link = complaintLink(complaint._id);
  const details = detailsBlock([
    ['Complaint Number', number],
    ['Submitted By', submitterName],
    ['Submission', version > 1 ? `Resubmission ${version} after rework` : 'First submission'],
    ['Product', productName(complaint)],
    ['Batch Number', batchNumber(complaint)],
    ['Root Causes', String(rootCauses)],
    ['CAPA Records', String(capas)],
    ['Submitter Remarks', remarks],
  ]);
  const text = [
    `Dear ${reviewerName},`,
    '',
    `The root cause analysis and CAPA for complaint ${number} have been submitted for your approval. Please review them and approve, or reject with remarks.`,
    '',
    details.text,
    '',
    `Review the analysis: ${link}`,
    '',
    'Best Regards,',
    'Quality Management Team',
    '',
    'Note: This is an automatically generated email. Please do not reply to this email.',
  ].join('\n');
  const html = layout({
    title: `D3 approval requested: ${number}`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(reviewerName)},</p>
<p style="margin:0 0 14px;">The root cause analysis and CAPA for complaint <strong>${escapeHtml(number)}</strong> have been submitted for your approval. Please review them and approve, or reject with remarks.</p>
${details.html}
${button(link, 'Review the analysis')}
<p style="margin:0;">Best Regards,<br>Quality Management Team</p>`,
    footnote: 'Note: This is an automatically generated email. Please do not reply to this email.',
  });
  return { subject, text, html };
}

const REVIEW_LABEL = { NOT_SUBMITTED: 'Not submitted', SUBMITTED: 'Submitted', REVIEWED: 'Reviewed' };
const APPROVAL_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

/** Brief, section 10: "CAPA Rejected – Action Required – [CAPA Number]", one per CAPA record. */
export function d3CapaRejected(complaint, capa, rootCause, { recipientName, rejectedBy, remarks }) {
  const subject = `CAPA Rejected – Action Required – ${capa.capaNumber}`;
  const link = complaintLink(complaint._id);
  const capaDescription = capa.capaRequired
    ? [capa.description, capa.correctiveAction && `Corrective: ${capa.correctiveAction}`, capa.preventiveAction && `Preventive: ${capa.preventiveAction}`].filter(Boolean).join(' | ')
    : `CAPA not required: ${capa.description || ''}`;
  const details = detailsBlock([
    ['CAPA Number', capa.capaNumber],
    ['Complaint Number', complaint.complaintNumber],
    ['Rejected By', rejectedBy],
    ['Rejected At Stage', 'D3 – RCA & CAPA'],
    ['Root Cause Category', rootCause?.category],
    ['Root Cause Description', rootCause?.description],
    ['CAPA Category', capa.category],
    ['CAPA Description', capaDescription],
    ['Current Review Status', REVIEW_LABEL[capa.reviewStatus] || capa.reviewStatus],
    ['Current Approval Status', APPROVAL_LABEL[capa.approvalStatus] || capa.approvalStatus],
    ['Rejection Remarks', remarks],
  ]);
  const greeting = recipientName ? `Dear ${recipientName},` : 'Dear Team,';
  const text = [
    greeting,
    '',
    `The submission for ${capa.capaNumber} has been rejected and requires correction and resubmission. Please review the remarks, update the root cause analysis and CAPA, and submit again.`,
    '',
    details.text,
    '',
    `View Complaint Record: ${link}`,
    '',
    'Best Regards,',
    'Quality Management Team',
    '',
    'Note: This is an automatically generated email. Please do not reply to this email.',
  ].join('\n');
  const html = layout({
    title: `CAPA rejected: ${capa.capaNumber}`,
    bodyHtml: `<p style="margin:0 0 14px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 14px;padding:10px 12px;background:#fbeae9;border-left:3px solid #b3261e;color:#7a1a14;">The submission for <strong>${escapeHtml(capa.capaNumber)}</strong> has been <strong>rejected</strong> and requires correction and resubmission.</p>
<p style="margin:0 0 14px;">Please review the remarks, update the root cause analysis and CAPA, and submit again.</p>
${details.html}
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Quality Management Team</p>`,
    footnote: 'Note: This is an automatically generated email. Please do not reply to this email.',
  });
  return { subject, text, html };
}

export function d2SlaExtensionRequest(complaint, { managerName, frpName, hours, reason }) {
  const number = complaint.complaintNumber;
  const subject = `D2 SLA Extension Request for Complaint ${number}`;
  const link = complaintLink(complaint._id);
  const details = detailsBlock([
    ['Complaint Number', number],
    ['Current Stage', 'D2'],
    ['Extension Hours Requested', `${hours} hours`],
    ['Reason for Extension', reason || 'None provided'],
    ['First Responsible Person Assigned', frpName || 'Assigned FRP'],
  ]);
  const text = [
    `Dear ${managerName || 'Manager'},`,
    '',
    `A request has been submitted to extend the D2 stage SLA for complaint ${number}.`,
    '',
    details.text,
    '',
    `Please review and approve/reject this extension request: ${link}`,
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
  ].join('\n');
  const html = layout({
    title: `D2 SLA Extension Request`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(managerName || 'Manager')},</p>
<p style="margin:0 0 14px;">A request has been submitted to extend the D2 stage SLA for the following complaint:</p>
${details.html}
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email.',
  });
  return { subject, text, html };
}

export function rootCauseApprovalRequest(complaint, { managerName, frpName, count }) {
  const number = complaint.complaintNumber;
  const subject = `Root Cause Approval Required From FRP Manager - Complaint ${number}`;
  const link = complaintLink(complaint._id);
  const text = [
    `Dear ${managerName || 'FRP Manager'},`,
    '',
    `Your team member ${frpName} has submitted root causes for complaint ${number} that require your approval.`,
    `Total Root Causes Submitted: ${count || 1}`,
    '',
    `View Complaint Record: ${link}`,
    '',
    'Please review and approve the identified root causes.',
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
  ].join('\n');
  const html = layout({
    title: `Root Cause Approval Request`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(managerName || 'FRP Manager')},</p>
<p style="margin:0 0 14px;">Your team member <strong>${escapeHtml(frpName)}</strong> has submitted root causes for complaint <strong>${escapeHtml(number)}</strong> that require your approval.</p>
<p style="margin:0 0 14px;"><strong>Total Root Causes Submitted:</strong> ${count || 1}</p>
${button(link, 'View Complaint Record')}
<p style="margin:0 0 14px;">Please review and approve the identified root causes.</p>
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email.',
  });
  return { subject, text, html };
}

export function capaImplementationAssignment(complaint, capa, { rpName }) {
  const number = complaint.complaintNumber;
  const subject = `CAPA Implementation Assignment - ${capa.capaNumber}`;
  const link = complaintLink(complaint._id);
  const details = detailsBlock([
    ['CAPA Number', capa.capaNumber],
    ['Complaint Number', number],
    ['Root Cause Category', capa.rcCategory || 'General'],
    ['Root Cause Description', capa.rcDescription || capa.description],
    ['CAPA Category', capa.category || 'CA'],
    ['CAPA Description', capa.description],
  ]);
  const text = [
    `Dear ${rpName || 'Responsible Person'},`,
    '',
    `You have been assigned as Responsible Person to implement the following CAPA for complaint ${number}:`,
    '',
    details.text,
    '',
    `View CAPA Record: ${link}`,
    '',
    'Action Required: Please implement the CAPA and update the implementation details in the system once completed.',
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
  ].join('\n');
  const html = layout({
    title: `CAPA Implementation Assignment`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(rpName || 'Responsible Person')},</p>
<p style="margin:0 0 14px;">You have been assigned as Responsible Person to implement the following CAPA for complaint <strong>${escapeHtml(number)}</strong>:</p>
${details.html}
${button(link, 'View CAPA Record')}
<p style="margin:0 0 14px;color:#b3261e;font-weight:600;">Action Required: Please implement the CAPA and update the implementation details in the system once completed.</p>
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email.',
  });
  return { subject, text, html };
}

export function movedToD4Stage(complaint, { recipientName }) {
  const number = complaint.complaintNumber;
  const subject = `Complaint ${number} - Moved to D4 Stage`;
  const link = complaintLink(complaint._id);
  const details = detailsBlock([
    ['Complaint Number', number],
    ['Product Name', productName(complaint)],
    ['Batch Number', batchNumber(complaint)],
    ['Type of Failure', complaint.d2?.investigation?.typeOfFailure],
  ]);
  const text = [
    `Dear ${recipientName || 'Team'},`,
    '',
    `The complaint ${number} has moved to the D4 (Effectiveness Review & Closure) stage.`,
    '',
    details.text,
    '',
    `View Complaint Record: ${link}`,
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
  ].join('\n');
  const html = layout({
    title: `✓ Complaint Moved to D4 Stage`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(recipientName || 'Team')},</p>
<p style="margin:0 0 14px;color:#137333;font-weight:600;">The complaint ${escapeHtml(number)} has moved to the D4 (Effectiveness Review &amp; Closure) stage.</p>
${details.html}
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email.',
  });
  return { subject, text, html };
}

export function complaintSuccessfullyClosed(complaint, { recipientName, isRequester }) {
  const number = complaint.complaintNumber;
  const subject = `Complaint ${number} Closed`;
  const link = complaintLink(complaint._id);
  const text = [
    `Dear ${recipientName || 'Customer'},`,
    '',
    `We are pleased to inform you that complaint ${number} has been successfully completed and closed upon completion of the D4 stage.`,
    '',
    `View Complaint: ${link}`,
    '',
    'Best Regards,',
    'Customer Relationship Management Team',
  ].join('\n');
  const html = layout({
    title: `✓ Complaint Successfully Closed`,
    bodyHtml: `<p style="margin:0 0 14px;">Dear ${escapeHtml(recipientName || 'Customer')},</p>
<p style="margin:0 0 14px;color:#137333;font-weight:600;">We are pleased to inform you that complaint <strong>${escapeHtml(number)}</strong> has been successfully completed and closed upon completion of the D4 stage.</p>
${button(link, 'View Complaint Record')}
<p style="margin:0;">Best Regards,<br>Customer Relationship Management Team</p>`,
    footnote: 'Note: This is an automatically generated email.',
  });
  return { subject, text, html };
}

export const TEMPLATES = Object.freeze({
  D1_ACKNOWLEDGEMENT: d1Acknowledgement,
  D2_FRP_ASSIGNED: d2FrpAssigned,
  D2_COMPLETED: d2Completed,
  D3_APPROVAL_REQUEST: d3ApprovalRequest,
  D3_REJECTED: d3CapaRejected,
  D2_SLA_EXTENSION: d2SlaExtensionRequest,
  ROOT_CAUSE_APPROVAL_REQUEST: rootCauseApprovalRequest,
  CAPA_IMPLEMENTATION_ASSIGNMENT: capaImplementationAssignment,
  MOVED_TO_D4: movedToD4Stage,
  COMPLAINT_CLOSED: complaintSuccessfullyClosed,
});
