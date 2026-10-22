import * as userService from '../services/userService.js';
import { ok, created, pagination, requestContext } from '../utils/http.js';

export async function list(req, res) {
  const q = req.validQuery;
  const { items, meta } = await userService.listUsers(q, pagination(q));
  return ok(res, items, meta);
}

export async function directory(req, res) {
  return ok(res, await userService.directory(req.validQuery));
}

export async function get(req, res) {
  return ok(res, await userService.getUser(req.params.id));
}

export async function create(req, res) {
  return created(res, await userService.createUser(req.body, req.user, requestContext(req)));
}

export async function update(req, res) {
  return ok(res, await userService.updateUser(req.params.id, req.body, req.user, requestContext(req)));
}

export async function resetPassword(req, res) {
  return ok(res, await userService.resetPassword(req.params.id, req.user, requestContext(req)));
}
