import * as d4 from '../services/d4Service.js';
import { ok, requestContext } from '../utils/http.js';

const who = (req) => ({ user: req.user, permissions: req.permissions, context: requestContext(req) });

export const updateCopq = async (req, res) => ok(res, await d4.updateCopq(req.params.id, req.body, who(req)));
export const updateCapaImplementation = async (req, res) => ok(res, await d4.updateCapaImplementation(req.params.capaId, req.body, who(req)));
export const decideImplementationApproval = async (req, res) => ok(res, await d4.decideImplementationApproval(req.params.capaId, req.body, who(req)));
export const assignErp = async (req, res) => ok(res, await d4.assignErp(req.params.capaId, req.body, who(req)));
export const closeCapa = async (req, res) => ok(res, await d4.closeCapa(req.params.capaId, req.body, who(req)));
