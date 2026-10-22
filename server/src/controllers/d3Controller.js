import * as d3 from '../services/d3Service.js';
import * as review from '../services/d3ReviewService.js';
import { ok, requestContext } from '../utils/http.js';

const who = (req) => ({ user: req.user, permissions: req.permissions, context: requestContext(req) });
const p = (req) => req.params;

export const start = async (req, res) => ok(res, await d3.start(p(req).id, req.body, who(req)));
export const get = async (req, res) => ok(res, await d3.getD3(p(req).id, req.user, req.permissions));
export const updateAnalysis = async (req, res) => ok(res, await d3.updateAnalysis(p(req).id, req.body, who(req)));
export const addCause = async (req, res) => ok(res, await d3.addCause(p(req).id, req.body, who(req)));
export const updateCause = async (req, res) => ok(res, await d3.updateCause(p(req).id, p(req).causeId, req.body, who(req)));
export const deleteCause = async (req, res) => ok(res, await d3.deleteCause(p(req).id, p(req).causeId, who(req)));
export const addRootCause = async (req, res) => ok(res, await d3.addRootCause(p(req).id, req.body, who(req)));
export const updateRootCause = async (req, res) => ok(res, await d3.updateRootCause(p(req).id, p(req).rootCauseId, req.body, who(req)));
export const deleteRootCause = async (req, res) => ok(res, await d3.deleteRootCause(p(req).id, p(req).rootCauseId, who(req)));
export const addCapa = async (req, res) => ok(res, await d3.addCapa(p(req).id, p(req).rootCauseId, req.body, who(req)));
export const updateCapa = async (req, res) => ok(res, await d3.updateCapa(p(req).id, p(req).capaId, req.body, who(req)));
export const deleteCapa = async (req, res) => ok(res, await d3.deleteCapa(p(req).id, p(req).capaId, who(req)));

export const readiness = async (req, res) => ok(res, await review.readiness(p(req).id, req.user, req.permissions));
export const reviewerCandidates = async (req, res) => ok(res, await review.reviewerCandidates(req.user._id));
export const submit = async (req, res) => ok(res, await review.submit(p(req).id, req.body, who(req)));
export const approve = async (req, res) => ok(res, await review.decide(p(req).id, 'approve', req.body, who(req)));
export const reject = async (req, res) => ok(res, await review.decide(p(req).id, 'reject', req.body, who(req)));
export const reviews = async (req, res) => ok(res, await review.history(p(req).id, req.user, req.permissions));
