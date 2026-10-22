import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Paperclip, RotateCcw } from 'lucide-react';
import { simulatorApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';

/** WhatsApp's *bold* → <strong>, keeping everything else as plain text. */
function Formatted({ text }) {
  return (text || '').split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>,
  );
}

const time = (at) => new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export function SimulatorPage() {
  const [waId, setWaId] = useState('919812345678');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const scroller = useRef(null);
  const fileInput = useRef(null);
  const valid = /^\d{8,15}$/.test(waId);

  const load = async () => {
    if (!valid) return;
    try {
      const res = await simulatorApi.conversation(waId);
      setMessages(res.data);
    } catch (err) {
      if (err.response?.status === 404) setUnavailable(true);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 2000); // picks up messages sent later by the queue
    return () => clearInterval(t);
  }, [waId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const send = async (body) => {
    setBusy(true);
    setError(null);
    try {
      await simulatorApi.send({ waId, name: 'Simulator user', ...body });
      await load();
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const sendText = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    send({ text });
    setText('');
  };

  const attach = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => send({ file: { base64: String(reader.result).split(',')[1], mimeType: file.type || 'application/octet-stream', filename: file.name } });
    reader.readAsDataURL(file);
  };

  if (unavailable) {
    return (
      <>
        <PageHeader title="WhatsApp simulator" />
        <div className="panel px-5 py-6 text-ink-muted">The simulator is available only when the server runs with <code>WHATSAPP_DRIVER=mock</code>. Real WhatsApp messages arrive through the Meta webhook.</div>
      </>
    );
  }

  const lastOptions = [...messages].reverse().find((m) => m.direction === 'outbound');

  return (
    <>
      <PageHeader title="WhatsApp simulator" description="Talk to the complaint chatbot as a customer would. It runs the same code as the real WhatsApp webhook." />
      <div className="grid gap-5 lg:grid-cols-[26rem_1fr]">
        <section className="panel flex h-[38rem] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <label className="text-sm text-ink-muted" htmlFor="wa">Phone</label>
            <input id="wa" className="field-input py-1" value={waId} onChange={(e) => setWaId(e.target.value.replace(/\D/g, ''))} aria-invalid={!valid} />
            <button type="button" title="Clear this conversation" aria-label="Clear conversation" className="rounded p-1.5 text-ink-muted hover:bg-page"
              onClick={async () => { await send({ text: 'cancel' }); await simulatorApi.clear(waId); setMessages([]); }}>
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto bg-page px-3 py-3" aria-live="polite">
            {messages.length === 0 && <p className="mt-10 text-center text-ink-muted">Type <strong>Hi</strong> to start a complaint.</p>}
            {messages.map((m) => (
              <div key={m._id} className={`flex ${m.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 shadow-panel ${m.direction === 'inbound' ? 'bg-brand-soft' : 'bg-surface'} ${m.failed ? 'border border-bad/40' : ''}`}>
                  <p className="whitespace-pre-wrap break-words text-base"><Formatted text={m.text} /></p>
                  {m.options && (
                    <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                      {m.label && <span className="text-xs text-ink-muted">{m.label}</span>}
                      {m.options.map((o) => (
                        <button key={o.id} type="button" disabled={busy || m !== lastOptions} onClick={() => send({ reply: { id: o.id, title: o.title } })}
                          className="rounded border border-line px-2 py-1 text-center text-sm font-medium text-brand hover:bg-brand-soft disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent">
                          {o.title}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-right text-[11px] text-ink-faint">
                    {m.failed ? 'not delivered · ' : ''}{time(m.at)}
                    {m.complaint && <> · <Link className="text-brand hover:underline" to={`/complaints/${m.complaint._id}`}>{m.complaint.complaintNumber}</Link></>}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {error && <p className="border-t border-bad/20 bg-bad-soft px-3 py-1.5 text-sm text-bad">{error}</p>}
          <form onSubmit={sendText} className="flex items-center gap-2 border-t border-line px-2 py-2">
            <input ref={fileInput} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { attach(e.target.files[0]); e.target.value = ''; }} />
            <button type="button" aria-label="Attach a photo or PDF" className="rounded p-2 text-ink-muted hover:bg-page" onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /></button>
            <input className="field-input" placeholder="Type a message" aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} disabled={!valid} />
            <Button type="submit" variant="primary" icon={Send} loading={busy} disabled={!valid || !text.trim()} aria-label="Send">{''}</Button>
          </form>
        </section>
        <section className="panel h-fit px-5 py-4 text-ink-muted">
          <h2 className="mb-2 font-semibold text-ink">How it works</h2>
          <p>Each message is turned into the payload Meta sends to the webhook and processed by the same chatbot code, including duplicate protection, validation, file checks and the notification queue.</p>
          <p className="mt-2">Type <strong>Hi</strong> at any time to start over, or <strong>cancel</strong> to stop. Use a different phone number to run a second conversation in parallel.</p>
          <p className="mt-2">When the complaint is submitted, the reply with its number arrives a moment later through the notification queue, and a link to the new complaint appears beside it.</p>
        </section>
      </div>
    </>
  );
}
