import { Router } from 'express';
import * as c from '../controllers/complaintController.js';
import * as n from '../controllers/notificationController.js';
import * as d2 from '../controllers/d2Controller.js';
import * as d3 from '../controllers/d3Controller.js';
import { submitD3Body, analysisBody, causeBody, causePatch, rootCauseBody, rootCausePatch, capaBody, capaPatch, subIdParams } from '../validation/complaintSchemas.js';
import { updateD2Body, assignFrpBody, stageActionBody } from '../validation/complaintSchemas.js';
import { acknowledgeBody } from '../validation/complaintSchemas.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { uploadFiles } from '../middleware/upload.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParams } from '../validation/common.js';
import {
  createComplaintBody,
  updateD1Body,
  listComplaintsQuery,
  attachmentParams,
  uploadBody,
} from '../validation/complaintSchemas.js';

const r = Router();

// Reading needs one of the view permissions; the service then narrows to the
// complaints this user may see, so the check cannot be bypassed by id.
const canView = requireAnyPermission(P.COMPLAINT_VIEW_ALL, P.COMPLAINT_VIEW_ASSIGNED);

r.get('/', canView, validate({ query: listComplaintsQuery }), c.list);
// Must come before '/:id'. People who may be made FRP, with their open workload.
r.get('/frp-candidates', requirePermission(P.COMPLAINT_ASSIGN), d2.candidates);
r.get('/reviewer-candidates', requirePermission(P.COMPLAINT_D3_EDIT), d3.reviewerCandidates);
r.get('/filters', canView, c.filters);
r.post('/', requirePermission(P.COMPLAINT_CREATE_MANUAL), validate({ body: createComplaintBody }), c.create);

r.get('/:id', canView, validate({ params: idParams }), c.detail);
r.patch('/:id/d1', canView, validate({ params: idParams, body: updateD1Body }), c.updateD1);
r.get('/:id/history', canView, validate({ params: idParams }), c.history);

r.get('/:id/attachments', canView, validate({ params: idParams }), c.listAttachments);
r.post(
  '/:id/attachments',
  canView,
  requirePermission(P.ATTACHMENT_UPLOAD),
  validate({ params: idParams }),
  uploadFiles,
  validate({ body: uploadBody }),
  c.uploadAttachments,
);
r.get('/:id/attachments/:attachmentId/download', canView, validate({ params: attachmentParams }), c.downloadAttachment);

// D1 acknowledgement (Phase 4)
r.get('/:id/acknowledgement-preview', canView, validate({ params: idParams }), n.acknowledgementPreview);
r.post(
  '/:id/acknowledge',
  canView,
  requirePermission(P.COMPLAINT_D1_ACKNOWLEDGE),
  validate({ params: idParams, body: acknowledgeBody }),
  n.acknowledge,
);
r.get('/:id/notifications', canView, validate({ params: idParams }), n.forComplaint);

// D2 (Phase 5)
r.post('/:id/start-d2', canView, requirePermission(P.COMPLAINT_D2_EDIT), validate({ params: idParams, body: stageActionBody }), d2.start);
r.patch('/:id/d2', canView, requirePermission(P.COMPLAINT_D2_EDIT), validate({ params: idParams, body: updateD2Body }), d2.update);
r.post('/:id/frp', canView, requirePermission(P.COMPLAINT_ASSIGN), validate({ params: idParams, body: assignFrpBody }), d2.assignFrp);
r.get('/:id/assignments', canView, validate({ params: idParams }), d2.assignments);
r.post('/:id/complete-d2', canView, requirePermission(P.COMPLAINT_D2_EDIT), validate({ params: idParams, body: stageActionBody }), d2.complete);

// D3 (Phase 6). Every write also checks, in the service, that the user is
// this complaint's FRP and that the analysis is open for editing.
const canD3 = [canView, requirePermission(P.COMPLAINT_D3_EDIT)];
r.post('/:id/start-d3', ...canD3, validate({ params: idParams, body: stageActionBody }), d3.start);
r.get('/:id/d3', canView, validate({ params: idParams }), d3.get);
r.patch('/:id/d3/analysis', ...canD3, validate({ params: idParams, body: analysisBody }), d3.updateAnalysis);
r.post('/:id/d3/causes', ...canD3, validate({ params: idParams, body: causeBody }), d3.addCause);
r.patch('/:id/d3/causes/:causeId', ...canD3, validate({ params: subIdParams('causeId'), body: causePatch }), d3.updateCause);
r.delete('/:id/d3/causes/:causeId', ...canD3, validate({ params: subIdParams('causeId') }), d3.deleteCause);
r.post('/:id/d3/root-causes', ...canD3, validate({ params: idParams, body: rootCauseBody }), d3.addRootCause);
r.patch('/:id/d3/root-causes/:rootCauseId', ...canD3, validate({ params: subIdParams('rootCauseId'), body: rootCausePatch }), d3.updateRootCause);
r.delete('/:id/d3/root-causes/:rootCauseId', ...canD3, validate({ params: subIdParams('rootCauseId') }), d3.deleteRootCause);
r.post('/:id/d3/root-causes/:rootCauseId/capa', ...canD3, validate({ params: subIdParams('rootCauseId'), body: capaBody }), d3.addCapa);
r.patch('/:id/d3/capa/:capaId', ...canD3, validate({ params: subIdParams('capaId'), body: capaPatch }), d3.updateCapa);
r.delete('/:id/d3/capa/:capaId', ...canD3, validate({ params: subIdParams('capaId') }), d3.deleteCapa);

// D3 review (Phase 7)
r.get('/:id/d3/readiness', canView, validate({ params: idParams }), d3.readiness);
r.get('/:id/d3/reviews', canView, validate({ params: idParams }), d3.reviews);
r.post('/:id/d3/submit', ...canD3, validate({ params: idParams, body: submitD3Body }), d3.submit);
r.post('/:id/d3/approve', canView, requirePermission(P.COMPLAINT_D3_REVIEW), validate({ params: idParams, body: stageActionBody }), d3.approve);
r.post('/:id/d3/reject', canView, requirePermission(P.COMPLAINT_D3_REVIEW), validate({ params: idParams, body: stageActionBody }), d3.reject);

import * as d4 from '../controllers/d4Controller.js';

// D2 SLA Extension & FRP Acknowledgement
r.post('/:id/d2/sla-extension', canView, d2.requestSlaExtension);
r.post('/:id/d2/frp-acknowledge', canView, d2.frpAcknowledge);

// D4 COPQ and CAPA Lifecycle
r.patch('/:id/d4/copq', canView, d4.updateCopq);
r.patch('/:id/capa/:capaId/implementation', canView, d4.updateCapaImplementation);
r.post('/:id/capa/:capaId/implementation-decision', canView, d4.decideImplementationApproval);
r.post('/:id/capa/:capaId/erp', canView, d4.assignErp);
r.post('/:id/capa/:capaId/close', canView, d4.closeCapa);

export default r;
