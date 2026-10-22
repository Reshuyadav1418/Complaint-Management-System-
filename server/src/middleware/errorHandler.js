import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import logger from '../config/logger.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No endpoint for ${req.method} ${req.path}.`));
}

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof mongoose.Error.ValidationError) {
    return AppError.validation(Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })));
  }
  if (err instanceof mongoose.Error.CastError) return AppError.badRequest(`Invalid value for ${err.path}.`);
  if (err instanceof mongoose.Error.VersionError) {
    return AppError.conflict('Someone else changed this record. Reload it and try again.');
  }
  if (err?.code === 11000) return AppError.conflict('This record already exists.');
  if (err?.type === 'entity.parse.failed') return AppError.badRequest('Request body is not valid JSON.');
  if (err?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  if (!known) {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. Try again; if it keeps happening, contact support.' } });
  }
  const body = { error: { code: known.code, message: known.message } };
  if (known.details) body.error.details = known.details;
  return res.status(known.status).json(body);
}
