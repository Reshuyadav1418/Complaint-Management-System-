import { AppError } from '../utils/AppError.js';

/**
 * Validate and coerce req.body / req.query / req.params with zod schemas.
 * Parsed values replace the originals so handlers only see clean data.
 * Express 5 makes req.query a getter, so parsed query goes to req.validQuery.
 */
export function validate({ body, query, params }) {
  return (req, _res, next) => {
    const issues = [];
    const run = (schema, value, apply) => {
      if (!schema) return;
      const result = schema.safeParse(value ?? {});
      if (result.success) apply(result.data);
      else
        for (const i of result.error.issues) {
          issues.push({ field: i.path.join('.') || null, message: i.message });
        }
    };
    run(params, req.params, (v) => {
      req.params = v;
    });
    run(query, req.query, (v) => {
      req.validQuery = v;
    });
    run(body, req.body, (v) => {
      req.body = v;
    });
    if (issues.length) return next(AppError.validation(issues));
    return next();
  };
}
