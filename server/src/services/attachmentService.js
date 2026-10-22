import crypto from 'node:crypto';
import path from 'node:path';
import { ComplaintAttachment } from '../models/index.js';
import { STATUSES as S } from '../config/workflow.js';
import { AppError } from '../utils/AppError.js';
import { storage } from '../storage/index.js';
import { findVisible } from './complaintService.js';
import * as audit from './auditService.js';

/**
 * Allowed file types. The extension, the browser-declared type AND the file's
 * first bytes must agree, so a renamed executable is rejected even if it is
 * called "photo.jpg". Text types have no signature; they are rejected if they
 * contain NUL bytes (a binary file in disguise).
 */
const TYPES = [
  { ext: ['.pdf'], mime: ['application/pdf'], magic: [[0x25, 0x50, 0x44, 0x46]] },
  { ext: ['.png'], mime: ['image/png'], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  { ext: ['.jpg', '.jpeg'], mime: ['image/jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  { ext: ['.webp'], mime: ['image/webp'], magic: [[0x52, 0x49, 0x46, 0x46]] },
  {
    ext: ['.docx'],
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  {
    ext: ['.xlsx'],
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  { ext: ['.csv'], mime: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], text: true },
  { ext: ['.txt'], mime: ['text/plain'], text: true },
];

export const ALLOWED_EXTENSIONS = TYPES.flatMap((t) => t.ext);

function detect(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const type = TYPES.find((t) => t.ext.includes(ext));
  if (!type) return `"${file.originalname}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  if (!type.mime.includes(file.mimetype)) return `"${file.originalname}" does not look like a ${ext} file.`;
  if (file.size === 0) return `"${file.originalname}" is empty.`;
  if (type.text) {
    if (file.buffer.includes(0)) return `"${file.originalname}" does not look like a ${ext} file.`;
  } else if (!type.magic.some((sig) => sig.every((b, i) => file.buffer[i] === b))) {
    return `"${file.originalname}" does not look like a ${ext} file.`;
  }
  return null;
}

/** Strip path parts and control characters from a user-supplied filename. */
function safeName(name) {
  // eslint-disable-next-line no-control-regex
  return path.basename(name).replace(/[\u0000-\u001f\u007f"\\]/g, '').slice(0, 200) || 'file';
}

export async function list(complaintId, user, permissions) {
  const complaint = await findVisible(complaintId, user, permissions, { lean: true });
  return ComplaintAttachment.find({ complaint: complaint._id, deletedAt: null })
    .sort({ createdAt: -1 })
    .select('stage originalName mimeType sizeBytes source uploadedBy createdAt')
    .populate('uploadedBy', 'name')
    .lean();
}

/**
 * Validate every file first, then store them. If anything fails part-way,
 * files already written are removed, so a failed upload leaves nothing behind
 * and never touches the complaint record itself.
 */
export async function upload(complaintId, files, { stage, user, permissions, context }) {
  const complaint = await findVisible(complaintId, user, permissions, { lean: true });
  if (complaint.status === S.CLOSED) throw AppError.conflict('Files cannot be added to a closed complaint.');
  if (!files?.length) throw AppError.validation([{ field: 'files', message: 'Choose at least one file.' }]);

  const problems = files.map(detect).filter(Boolean);
  if (problems.length) throw AppError.validation(problems.map((message) => ({ field: 'files', message })));

  const targetStage = stage || (complaint.stage === 'CLOSED' ? 'D4' : complaint.stage);
  const written = [];
  try {
    const docs = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `complaints/${complaint._id}/${crypto.randomUUID()}${ext}`;
      await storage().put(key, file.buffer, { contentType: file.mimetype });
      written.push(key);
      docs.push({
        complaint: complaint._id,
        stage: targetStage,
        linkedTo: { kind: 'Complaint', id: complaint._id },
        storageKey: key,
        originalName: safeName(file.originalname),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        uploadedBy: user._id,
      });
    }
    const created = await ComplaintAttachment.insertMany(docs);
    await audit.record({
      actor: user,
      action: 'complaint.attachment.upload',
      entityType: 'Complaint',
      entityId: complaint._id,
      complaint: complaint._id,
      summary: `Uploaded ${created.length === 1 ? created[0].originalName : `${created.length} files`} to ${targetStage}`,
      after: { files: created.map((a) => a.originalName) },
      context,
    });
    return created.map((a) => a.toJSON());
  } catch (err) {
    await Promise.all(written.map((key) => storage().remove(key).catch(() => {})));
    throw err;
  }
}

/** Permission-checked download. Returns metadata and a stream. */
export async function open(complaintId, attachmentId, user, permissions) {
  const complaint = await findVisible(complaintId, user, permissions, { lean: true });
  const att = await ComplaintAttachment.findOne({ _id: attachmentId, complaint: complaint._id, deletedAt: null }).lean();
  if (!att) throw AppError.notFound('File');
  try {
    return { attachment: att, stream: await storage().stream(att.storageKey) };
  } catch {
    throw new AppError(410, 'FILE_MISSING', 'This file is recorded but no longer in storage. Contact an administrator.');
  }
}

/**
 * Store files that arrive without a signed-in user (WhatsApp). Same type
 * checks as uploads; invalid files are skipped and reported, never fatal.
 */
export async function storeSystemAttachments(complaint, files, source) {
  const rejected = [];
  let stored = 0;
  for (const file of files) {
    const problem = detect(file);
    if (problem) {
      rejected.push(problem);
      continue;
    }
    const ext = path.extname(file.originalname).toLowerCase() || ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[file.mimetype] ?? '');
    const key = `complaints/${complaint._id}/${crypto.randomUUID()}${ext}`;
    try {
      await storage().put(key, file.buffer, { contentType: file.mimetype });
      await ComplaintAttachment.create({
        complaint: complaint._id,
        stage: 'SYNCED',
        linkedTo: { kind: 'Complaint', id: complaint._id },
        storageKey: key,
        originalName: safeName(file.originalname),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        source,
      });
      stored += 1;
    } catch (err) {
      await storage().remove(key).catch(() => {});
      rejected.push(`${file.originalname}: ${err.message}`);
    }
  }
  if (stored) {
    await audit.record({
      action: 'complaint.attachment.upload',
      entityType: 'Complaint',
      entityId: complaint._id,
      complaint: complaint._id,
      summary: `Received ${stored} file${stored > 1 ? 's' : ''} from ${source === 'whatsapp' ? 'WhatsApp' : source}`,
    });
  }
  return { stored, rejected };
}
