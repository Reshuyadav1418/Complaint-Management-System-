import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import { useDatabase, makeUser, signIn, makeComplaint, models } from './helpers.js';

useDatabase();
afterAll(() => fs.rm(process.env.STORAGE_DIR, { recursive: true, force: true }));

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = Buffer.from('MZ\x90\x00 this is not a picture');

async function setup() {
  const qc = await makeUser({ roles: ['quality_coordinator'] });
  const complaint = await makeComplaint(qc);
  return { qc, complaint, agent: await signIn(qc) };
}

describe('attachments', () => {
  it('uploads, lists and downloads with the original name and a SHA-256', async () => {
    const { complaint, agent } = await setup();
    const up = await agent
      .post(`/api/complaints/${complaint._id}/attachments`)
      .field('stage', 'D1')
      .attach('files', PDF, { filename: 'invoice.pdf', contentType: 'application/pdf' })
      .attach('files', PNG, { filename: 'seal photo.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.data.map((a) => a.originalName)).toEqual(['invoice.pdf', 'seal photo.png']);
    expect(up.body.data[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    const list = await agent.get(`/api/complaints/${complaint._id}/attachments`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].storageKey).toBeUndefined(); // storage location never leaves the server

    const pdf = list.body.data.find((a) => a.originalName === 'invoice.pdf');
    const dl = await agent.get(`/api/complaints/${complaint._id}/attachments/${pdf._id}/download`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain("filename*=UTF-8''invoice.pdf");
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(dl.body, PDF)).toBe(0);

    const hist = await agent.get(`/api/complaints/${complaint._id}/history`);
    expect(hist.body.data[0]).toMatchObject({ action: 'complaint.attachment.upload', summary: 'Uploaded 2 files to D1' });
  });

  it('rejects a disguised file and stores nothing from that request', async () => {
    const { complaint, agent } = await setup();
    const res = await agent
      .post(`/api/complaints/${complaint._id}/attachments`)
      .attach('files', PDF, { filename: 'ok.pdf', contentType: 'application/pdf' })
      .attach('files', EXE, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].message).toMatch(/photo\.jpg/);
    expect(await models.ComplaintAttachment.countDocuments()).toBe(0);
  });

  it('rejects disallowed types, oversized files and too many files', async () => {
    const { complaint, agent } = await setup();
    const url = `/api/complaints/${complaint._id}/attachments`;
    expect((await agent.post(url).attach('files', EXE, { filename: 'tool.exe', contentType: 'application/octet-stream' })).status).toBe(422);
    const big = Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024)]);
    const tooBig = await agent.post(url).attach('files', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.details[0].message).toMatch(/1 MB/);
    let req = agent.post(url);
    for (let i = 0; i < 4; i += 1) req = req.attach('files', PDF, { filename: `f${i}.pdf`, contentType: 'application/pdf' });
    expect((await req).status).toBe(422);
  });

  it('only people who can see the complaint can list or download its files', async () => {
    const { complaint, agent } = await setup();
    const up = await agent.post(`/api/complaints/${complaint._id}/attachments`).attach('files', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    const fileId = up.body.data[0]._id;

    const outsider = await signIn(await makeUser({ roles: ['frp'] }));
    expect((await outsider.get(`/api/complaints/${complaint._id}/attachments`)).status).toBe(404);
    expect((await outsider.get(`/api/complaints/${complaint._id}/attachments/${fileId}/download`)).status).toBe(404);

    // A file id from one complaint cannot be fetched through another complaint the user can see.
    const other = await makeComplaint(await makeUser({ roles: ['quality_coordinator'] }));
    expect((await agent.get(`/api/complaints/${other._id}/attachments/${fileId}/download`)).status).toBe(404);
  });

  it('requires the upload permission', async () => {
    const { complaint } = await setup();
    const reviewer = await signIn(await makeUser({ roles: ['reviewer'] }));
    const res = await reviewer.post(`/api/complaints/${complaint._id}/attachments`).attach('files', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });
});
