import * as d2 from '../services/d2Service.js';
import * as lookups from '../services/lookupService.js';
import { ok, created, requestContext } from '../utils/http.js';

const who = (req) => ({ user: req.user, permissions: req.permissions, context: requestContext(req) });

export const start = async (req, res) => ok(res, await d2.start(req.params.id, req.body, who(req)));
export const update = async (req, res) => ok(res, await d2.update(req.params.id, req.body, who(req)));
export const assignFrp = async (req, res) => ok(res, await d2.assignFrp(req.params.id, req.body, who(req)));
export const assignments = async (req, res) => ok(res, await d2.assignmentHistory(req.params.id, req.user, req.permissions));
export const complete = async (req, res) => ok(res, await d2.complete(req.params.id, req.body, who(req)));
export const requestSlaExtension = async (req, res) => ok(res, await d2.requestSlaExtension(req.params.id, req.body, who(req)));
export const frpAcknowledge = async (req, res) => ok(res, await d2.frpAcknowledge(req.params.id, req.body, who(req)));
export const candidates = async (req, res) => ok(res, await d2.frpCandidates({ search: req.query.search ? String(req.query.search).slice(0, 100) : undefined }));

export const listLookups = async (req, res) => ok(res, await lookups.all({ includeInactive: req.query.includeInactive === 'true' }));
export const createLookup = async (req, res) => created(res, await lookups.create(req.body, req.user, requestContext(req)));
export const updateLookup = async (req, res) => ok(res, await lookups.update(req.params.id, req.body, req.user, requestContext(req)));
