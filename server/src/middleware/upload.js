import multer from 'multer';
import env from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * Files are held in memory only long enough to validate and hand them to
 * storage. The limits keep that bounded: UPLOAD_MAX_FILES × UPLOAD_MAX_MB.
 */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: env.UPLOAD_MAX_FILES, fields: 5 },
}).array('files');

export function uploadFiles(req, res, next) {
  parser(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(AppError.validation([{ field: 'files', message: `Each file must be ${env.UPLOAD_MAX_MB} MB or smaller.` }]));
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(AppError.validation([{ field: 'files', message: `Upload at most ${env.UPLOAD_MAX_FILES} files at a time, in the "files" field.` }]));
    }
    return next(AppError.badRequest('The upload could not be read. Try again.'));
  });
}
