import { useState, useEffect } from 'react';
import { complaintApi, d3Api } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Button } from '../../components/Button.jsx';
import { Modal } from '../../components/Modal.jsx';
import { formatDate } from '../../lib/format.js';
import { Check, Edit, ChevronDown, DollarSign, Calendar, Clock } from 'lucide-react';

export function D4Tab({ complaint, onRefresh }) {
  const { user } = useAuth();
  const notify = useToast();

  const [capas, setCapas] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  // COPQ state
  const [copq, setCopq] = useState({
    logisticsCost: complaint.d4?.copq?.logisticsCost || 0,
    testingCost: complaint.d4?.copq?.testingCost || 0,
    reprocessingCost: complaint.d4?.copq?.reprocessingCost || 0,
  });
  const [savingCopq, setSavingCopq] = useState(false);

  // Edit / ERP Assignment Modal
  const [editingCapa, setEditingCapa] = useState(null);
  const [erpId, setErpId] = useState('');
  const [scheduleType, setScheduleType] = useState('Timeline');
  const [scheduleTimeline, setScheduleTimeline] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState('');
  const [savingErp, setSavingErp] = useState(false);

  // Close CAPA modal
  const [closingCapa, setClosingCapa] = useState(null);
  const [effectivenessReview, setEffectivenessReview] = useState('');
  const [isClosed, setIsClosed] = useState(false);
  const [savingClosure, setSavingClosure] = useState(false);

  const totalCopq = (Number(copq.logisticsCost) || 0) + (Number(copq.testingCost) || 0) + (Number(copq.reprocessingCost) || 0);

  const loadData = async () => {
    try {
      setLoading(true);
      const [d3Res, usersRes] = await Promise.all([
        d3Api.get(complaint._id),
        d3Api.people().catch(() => ({ data: [] })),
      ]);
      setCapas(d3Res.capas || []);
      setPeople(usersRes.data || []);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [complaint._id]);

  const handleSaveCopq = async (e) => {
    e.preventDefault();
    try {
      setSavingCopq(true);
      await complaintApi.updateCopq(complaint._id, copq);
      notify('Cost of Poor Quality (COPQ) saved successfully.', 'success');
      onRefresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingCopq(false);
    }
  };

  const handleOpenEdit = (capa) => {
    setEditingCapa(capa);
    setErpId(capa.erp?._id || capa.erp || '');
    setScheduleType(capa.scheduleType || 'Timeline');
    setScheduleTimeline(capa.scheduleTimeline ? capa.scheduleTimeline.slice(0, 10) : '');
    setScheduleFrequency(capa.scheduleFrequency || '');
  };

  const handleSaveErp = async () => {
    try {
      setSavingErp(true);
      await complaintApi.assignErp(complaint._id, editingCapa._id, {
        erpId: erpId || undefined,
        scheduleType,
        scheduleTimeline: scheduleType === 'Timeline' ? scheduleTimeline : undefined,
        scheduleFrequency: scheduleType === 'Frequency' ? scheduleFrequency : undefined,
      });
      notify('Effectiveness details updated successfully.', 'success');
      setEditingCapa(null);
      loadData();
      onRefresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingErp(false);
    }
  };

  const handleOpenClose = (capa) => {
    setClosingCapa(capa);
    setEffectivenessReview(capa.effectivenessReview || '');
    setIsClosed(capa.isClosed || false);
  };

  const handleSaveClose = async () => {
    try {
      setSavingClosure(true);
      await complaintApi.closeCapa(complaint._id, closingCapa._id, {
        effectivenessReview,
        isClosed,
      });
      notify(isClosed ? 'CAPA closed successfully.' : 'Effectiveness review saved.', 'success');
      setClosingCapa(null);
      loadData();
      onRefresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingClosure(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* CAPA Effectiveness Review Card */}
      <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-100 pb-3 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800">
            CAPA Effectiveness Review
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor and complete the post-implementation effectiveness verification for all approved actions.
          </p>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-4">Loading CAPA effectiveness records...</p>
        ) : capas.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">No CAPA records available for effectiveness review.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-200 divide-y divide-slate-200">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-3 py-2.5">CAPA Description</th>
                  <th className="px-3 py-2.5">Action Implemented</th>
                  <th className="px-3 py-2.5">Effectiveness Responsible (ERP)</th>
                  <th className="px-3 py-2.5">Frequency/Timeline</th>
                  <th className="px-3 py-2.5">Effectiveness Review</th>
                  <th className="px-3 py-2.5 text-center">CAPA Closed Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {capas.map((capa) => {
                  const erpUser = people.find((p) => String(p._id) === String(capa.erp?._id || capa.erp));
                  const isErpOrAdmin = erpUser?._id === user._id || user.roles?.includes('admin');
                  return (
                    <tr key={capa._id} className="hover:bg-slate-50/75">
                      <td className="px-3 py-2.5">
                        <strong className="block text-slate-900">{capa.capaNumber} ({capa.category || 'CA'})</strong>
                        <span className="text-slate-500 text-[11px] line-clamp-1">{capa.description}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {capa.actionImplemented || <span className="text-slate-400 italic">Pending implementation</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {erpUser ? erpUser.name : <span className="text-amber-600 font-medium">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {capa.scheduleType === 'Timeline' && capa.scheduleTimeline ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {formatDate(capa.scheduleTimeline)}
                          </span>
                        ) : capa.scheduleType === 'Frequency' && capa.scheduleFrequency ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-slate-400" />
                            {capa.scheduleFrequency}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {capa.effectivenessReview || <span className="text-slate-400 italic">Pending review</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {capa.isClosed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[11px]">
                            <Check className="h-3 w-3" /> Closed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium text-[11px]">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(capa)}
                          className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
                        >
                          Edit Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenClose(capa)}
                          className="px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded border border-slate-200"
                        >
                          Review & Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost of Poor Quality (COPQ in INR) Card (PDF Page 21) */}
      <section className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800">
              v Cost of Poor Quality (COPQ) in INR
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter financial impact figures associated with logistics, testing, and reprocessing.
            </p>
          </div>
          <div className="bg-slate-50 px-3 py-1.5 rounded border border-slate-200 text-right">
            <span className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total COPQ</span>
            <span className="text-sm font-bold text-slate-900">INR {totalCopq.toFixed(2)}</span>
          </div>
        </div>

        <form onSubmit={handleSaveCopq} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Logistics Cost (INR)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={copq.logisticsCost}
              onChange={(e) => setCopq({ ...copq, logisticsCost: e.target.value })}
              className="w-full text-xs rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Testing Cost (INR)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={copq.testingCost}
              onChange={(e) => setCopq({ ...copq, testingCost: e.target.value })}
              className="w-full text-xs rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reprocessing Cost (INR)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={copq.reprocessingCost}
              onChange={(e) => setCopq({ ...copq, reprocessingCost: e.target.value })}
              className="w-full text-xs rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="0.00"
            />
          </div>

          <div className="sm:col-span-3 flex justify-end pt-2">
            <Button type="submit" disabled={savingCopq}>
              {savingCopq ? 'Saving COPQ...' : 'Save COPQ Values'}
            </Button>
          </div>
        </form>
      </section>

      {/* Edit Details / ERP Assignment Modal (Page 21) */}
      {editingCapa && (
        <Modal open title="Edit CAPA Effectiveness Details" onClose={() => setEditingCapa(null)}>
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">CA/PA</label>
              <input
                type="text"
                disabled
                value={`${editingCapa.capaNumber} - ${editingCapa.category || 'CA'}`}
                className="w-full rounded border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Complaint</label>
              <input
                type="text"
                disabled
                value={complaint.complaintNumber}
                className="w-full rounded border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Action Implemented</label>
              <p className="rounded border border-slate-200 bg-slate-50 p-2 text-slate-800">
                {editingCapa.actionImplemented || 'No implementation text provided yet.'}
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Effectiveness Responsible Person (ERP)
              </label>
              <select
                value={erpId}
                onChange={(e) => setErpId(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value="">-- Search / Select People --</option>
                {people.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.department?.name || 'User'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Schedule Type</label>
              <select
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                <option value="Timeline">Timeline (Date Picker)</option>
                <option value="Frequency">Frequency (Dynamic text e.g. 2 weeks)</option>
              </select>
            </div>

            {scheduleType === 'Timeline' ? (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Effectiveness Timeline</label>
                <input
                  type="date"
                  value={scheduleTimeline}
                  onChange={(e) => setScheduleTimeline(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Effectiveness Frequency</label>
                <input
                  type="text"
                  placeholder="e.g. 2 weeks, monthly, quarterly"
                  value={scheduleFrequency}
                  onChange={(e) => setScheduleFrequency(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setEditingCapa(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveErp} disabled={savingErp}>
                {savingErp ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Close CAPA Modal (Page 22) */}
      {closingCapa && (
        <Modal open title={`Review & Close ${closingCapa.capaNumber}`} onClose={() => setClosingCapa(null)}>
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                CAPA Effective Review <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Enter effectiveness verification comments and results..."
                value={effectivenessReview}
                onChange={(e) => setEffectivenessReview(e.target.value)}
                className="w-full rounded border border-slate-300 p-2.5 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded border border-amber-200">
              <input
                type="checkbox"
                id="capaClosedCheckbox"
                checked={isClosed}
                onChange={(e) => setIsClosed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <label htmlFor="capaClosedCheckbox" className="font-semibold text-slate-800 cursor-pointer">
                CAPA Closed
                <span className="block font-normal text-slate-600 text-[11px] mt-0.5">
                  Check this box to confirm this CAPA is completely closed. If unchecked, the CAPA remains open.
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setClosingCapa(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveClose} disabled={savingClosure || !effectivenessReview.trim()}>
                {savingClosure ? 'Saving...' : 'Submit Closure'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
