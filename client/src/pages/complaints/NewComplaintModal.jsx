import { useEffect, useState } from 'react';
import { complaintApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { Modal } from '../../components/Modal.jsx';
import { Button } from '../../components/Button.jsx';
import { useToast } from '../../components/Toast.jsx';
import { D1Form, toForm, toBody } from './D1Form.jsx';

export function NewComplaintModal({ open, onClose, onCreated }) {
  const notify = useToast();
  const [form, setForm] = useState(toForm());
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm());
      setErrors({});
      setMessage(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await complaintApi.create(toBody(form, { includeOrigin: true }));
      notify(`Complaint ${res.data.complaintNumber} registered.`);
      onCreated(res.data);
    } catch (err) {
      const e = readError(err);
      setErrors(e.fields);
      setMessage(Object.keys(e.fields).length ? 'Some fields need attention.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title="Register complaint"
      description="For complaints received by phone, email or in person. WhatsApp complaints are registered automatically."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Register complaint</Button>
        </>
      }
    >
      {message && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{message}</p>}
      <D1Form value={form} onChange={setForm} errors={errors} showOrigin />
    </Modal>
  );
}
