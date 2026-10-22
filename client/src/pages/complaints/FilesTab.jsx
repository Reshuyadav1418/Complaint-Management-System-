import { useRef, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, Download } from 'lucide-react';
import { complaintApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { formatBytes } from '../../lib/complaints.js';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt';

export function FilesTab({ complaint, canUpload, onChange }) {
  const notify = useToast();
  const files = useAsync(() => complaintApi.attachments(complaint._id), [complaint._id]);
  const input = useRef(null);
  const [stage, setStage] = useState(complaint.stage === 'CLOSED' ? 'D4' : complaint.stage);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [dragging, setDragging] = useState(false);
  const closed = complaint.status === 'CLOSED';

  const send = async (list) => {
    if (!list.length) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await complaintApi.upload(complaint._id, [...list], stage);
      notify(res.data.length === 1 ? `${res.data[0].originalName} uploaded.` : `${res.data.length} files uploaded.`);
      files.reload();
      onChange?.();
    } catch (err) {
      const e = readError(err);
      const details = err.response?.data?.error?.details?.map((d) => d.message);
      setErrors(details?.length ? details : [e.message]);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {canUpload && !closed && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            send(e.dataTransfer.files);
          }}
          className={`flex flex-wrap items-center justify-between gap-3 rounded border border-dashed px-4 py-3 ${dragging ? 'border-brand bg-brand-soft' : 'border-line-strong'}`}
        >
          <div>
            <p className="font-medium">Add evidence or supporting documents</p>
            <p className="text-sm text-ink-muted">Drop files here or choose them. PDF, images, Word, Excel, CSV or text; up to 5 files of 10 MB each.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="upload-stage">Attach to stage</label>
            <select id="upload-stage" className="field-input w-auto" value={stage} onChange={(e) => setStage(e.target.value)}>
              {['SYNCED', 'D1', 'D2', 'D3', 'D4'].map((s) => (
                <option key={s} value={s}>{s === 'SYNCED' ? 'General' : s}</option>
              ))}
            </select>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => send(e.target.files)} />
            <Button icon={Upload} loading={busy} onClick={() => input.current?.click()}>Choose files</Button>
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <ul className="rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
          {errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}

      {files.loading && !files.data ? (
        <Loading label="Loading files" />
      ) : files.error ? (
        <ErrorState message={files.error} onRetry={files.reload} />
      ) : files.data.length === 0 ? (
        <EmptyState title="No files yet">
          {canUpload && !closed ? 'Photos of the product, invoices and test reports help the investigation.' : 'Files added to this complaint will appear here.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {files.data.map((f) => {
            const Icon = f.mimeType.startsWith('image/') ? ImageIcon : FileText;
            const viewable = /^(image\/|application\/pdf$)/.test(f.mimeType);
            return (
              <li key={f._id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Icon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  {viewable ? (
                    <a className="block truncate font-medium text-brand hover:underline" href={complaintApi.downloadUrl(complaint._id, f._id, true)} target="_blank" rel="noreferrer">
                      {f.originalName}
                    </a>
                  ) : (
                    <span className="block truncate font-medium">{f.originalName}</span>
                  )}
                  <span className="text-sm text-ink-muted">
                    {formatBytes(f.sizeBytes)}, {f.source === 'whatsapp' ? 'from WhatsApp' : `by ${f.uploadedBy?.name || 'unknown'}`}, {formatDateTime(f.createdAt)}
                  </span>
                </div>
                <Badge>{f.stage === 'SYNCED' ? 'General' : f.stage}</Badge>
                <a
                  href={complaintApi.downloadUrl(complaint._id, f._id)}
                  className="rounded p-1.5 text-ink-muted hover:bg-page hover:text-ink"
                  aria-label={`Download ${f.originalName}`}
                >
                  <Download className="h-4 w-4" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
