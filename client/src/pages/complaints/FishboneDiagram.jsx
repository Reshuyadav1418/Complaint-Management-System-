import { useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../components/Button.jsx';

/*
 * Ishikawa (fishbone) diagram, generated from the saved D3 causes.
 *
 * Layout: a horizontal spine ending in the problem ("head") on the right.
 * Three category branches slant up from the spine and three slant down.
 * Each cause is a horizontal "bone" meeting its branch; sub-causes are
 * indented beneath their cause. The diagram grows taller as causes are
 * added so labels never overlap, and long text is shortened with the full
 * text available on hover and in the cause list below.
 *
 * Colours are literal values (not CSS variables) so the exported image
 * looks the same as the screen.
 */

const C = {
  ink: '#1F2328',
  muted: '#5B6470',
  faint: '#8A929C',
  line: '#C3C8D0',
  brand: '#1D5BB8',
  brandSoft: '#E8F0FB',
  brandLine: '#9DBCE9',
  bg: '#FFFFFF',
};
const FONT = "'IBM Plex Sans', Arial, Helvetica, sans-serif";
const W = 1120;
const MARGIN = 28;
const HEAD_W = 210;
const ROW = 22;
const LABEL_SPACE = 34;
const CHAR_W = 6.3; // average width of a 12px character, for truncation

function truncate(text, maxChars) {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function wrap(text, maxChars, maxLines) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = truncate(`${lines[maxLines - 1]}…`, maxChars);
  }
  return lines;
}

/** Pure layout: categories + tree + problem → shapes to draw. */
export function layoutFishbone(categories, tree, problem) {
  const rowsOf = (cat) => (tree[cat] || []).reduce((n, c) => n + 1 + c.children.length, 0);
  const top = categories.slice(0, 3);
  const bottom = categories.slice(3, 6);
  const maxRows = Math.max(2, ...categories.map(rowsOf));
  const H = maxRows * ROW + LABEL_SPACE + 26; // height of one half
  const height = 2 * H + 2 * MARGIN;
  const spineY = MARGIN + H;
  const x0 = MARGIN;
  const x1 = W - MARGIN - HEAD_W;
  const slot = (x1 - x0) / 3;

  const headLines = wrap(problem || 'Problem statement not entered', 26, 5);
  const headH = Math.max(64, headLines.length * 17 + 26);

  const branches = [];
  [top, bottom].forEach((cats, half) => {
    const dir = half === 0 ? -1 : 1; // -1 up, +1 down
    cats.forEach((cat, i) => {
      const xs = x0 + slot * (i + 1) - 8; // where the branch meets the spine
      const yEnd = spineY + dir * (H - LABEL_SPACE + 6);
      const xEnd = xs - (H - LABEL_SPACE) * 0.42;
      const at = (y) => xEnd + ((y - yEnd) / (spineY - yEnd)) * (xs - xEnd);
      const boneLen = slot * 0.78;
      const bones = [];
      let k = 0;
      for (const cause of tree[cat] || []) {
        const items = [{ node: cause, sub: false }, ...cause.children.map((c) => ({ node: c, sub: true }))];
        for (const it of items) {
          const y = yEnd - dir * (18 + k * ROW);
          const bx = at(y);
          const indent = it.sub ? 16 : 0;
          const startX = bx - boneLen + indent;
          bones.push({
            id: String(it.node._id),
            sub: it.sub,
            full: it.node.text,
            label: truncate(it.node.text, Math.floor((boneLen - indent - 8) / (it.sub ? CHAR_W * 0.92 : CHAR_W))),
            x1: startX,
            x2: bx,
            y,
          });
          k += 1;
        }
      }
      branches.push({ cat, xs, xEnd, yEnd, dir, bones, labelY: yEnd + dir * 16 });
    });
  });

  return { width: W, height, spineY, x0, x1, headH, headLines, branches };
}

/** Export the live SVG as PNG or PDF. */
async function exportDiagram(svg, kind, { fileBase, complaintNumber, problem, categories, tree }) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const { width, height } = svg.viewBox.baseVal;
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');

  if (kind === 'png') {
    const a = document.createElement('a');
    a.href = png;
    a.download = `${fileBase}.png`;
    a.click();
    return;
  }
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const m = 28;
  const ratio = Math.min((pw - 2 * m) / width, (ph - 2 * m - 24) / height);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(`Fishbone diagram, ${complaintNumber}`, m, m + 4);
  // JPEG keeps the PDF small enough to email (a PNG here is several MB).
  const jpeg = canvas.toDataURL('image/jpeg', 0.92);
  const imgH = height * ratio;
  pdf.addImage(jpeg, 'JPEG', m, m + 18, width * ratio, imgH);

  // Labels on the diagram are shortened to fit, so the PDF also lists every
  // cause in full, continuing on further pages if needed.
  let y = m + 18 + imgH + 24;
  const line = (text, { bold = false, size = 9.5, indent = 0, gap = 12 } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    for (const part of pdf.splitTextToSize(text, pw - 2 * m - indent)) {
      if (y > ph - m) {
        pdf.addPage();
        y = m;
      }
      pdf.text(part, m + indent, y);
      y += gap;
    }
  };
  line(`Problem: ${problem || 'not entered'}`, { bold: true, size: 10.5, gap: 16 });
  for (const cat of categories) {
    const causes = tree[cat] || [];
    if (!causes.length) continue;
    line(cat, { bold: true, size: 10, gap: 13 });
    for (const c of causes) {
      line(`•  ${c.text}`, { indent: 10 });
      for (const sub of c.children) line(`–  ${sub.text}`, { indent: 24 });
    }
    y += 4;
  }
  pdf.save(`${fileBase}.pdf`);
}

export function FishboneDiagram({ categories, tree, problem, complaintNumber, canExport = true }) {
  const svgRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const L = useMemo(() => layoutFishbone(categories, tree, problem), [categories, tree, problem]);
  const total = categories.reduce((n, c) => n + (tree[c]?.length || 0), 0);

  if (total === 0) {
    return (
      <div className="rounded border border-dashed border-line-strong px-6 py-10 text-center">
        <p className="font-medium">The diagram appears as you add causes</p>
        <p className="mx-auto mt-1 max-w-md text-ink-muted">
          Add possible causes under Manpower, Method, Machine, Material, Measurement and Mother Nature. Each one becomes a bone on its branch.
        </p>
      </div>
    );
  }

  const run = async (kind) => {
    setBusy(kind);
    try {
      await exportDiagram(svgRef.current, kind, { fileBase: `${complaintNumber}-fishbone`, complaintNumber, problem, categories, tree });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {canExport && (
        <div className="mb-2 flex justify-end gap-2">
          <Button size="sm" icon={Download} loading={busy === 'png'} onClick={() => run('png')}>PNG</Button>
          <Button size="sm" icon={Download} loading={busy === 'pdf'} onClick={() => run('pdf')}>PDF</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded border border-line bg-white">
        <svg ref={svgRef} viewBox={`0 0 ${L.width} ${L.height}`} className="block h-auto w-full min-w-[760px]" role="img"
          aria-label={`Fishbone diagram for ${complaintNumber} with ${total} causes`} fontFamily={FONT}>
          <rect x="0" y="0" width={L.width} height={L.height} fill={C.bg} />
          {/* spine */}
          <line x1={L.x0} y1={L.spineY} x2={L.x1} y2={L.spineY} stroke="#334155" strokeWidth="3" />
          <polygon points={`${L.x1 - 12},${L.spineY - 7} ${L.x1},${L.spineY} ${L.x1 - 12},${L.spineY + 7}`} fill="#334155" />
          
          {/* head: Red Oval / Ellipse as shown in PDF Page 9 */}
          <g>
            <ellipse
              cx={L.x1 + 60}
              cy={L.spineY}
              rx="55"
              ry="38"
              fill="#e11d48"
              stroke="#be123c"
              strokeWidth="2"
            />
            <text
              x={L.x1 + 60}
              y={L.spineY + 4}
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize="13"
              fontWeight="bold"
            >
              {L.headLines[0] || 'Root Cause'}
            </text>
          </g>

          {/* branches with Page 9 curated pill colors */}
          {L.branches.map((b) => {
            const catColors = {
              'Man Power': { bg: '#8b5cf6', border: '#7c3aed', text: '#ffffff' },
              'Manpower': { bg: '#8b5cf6', border: '#7c3aed', text: '#ffffff' },
              'Machine': { bg: '#db2777', border: '#be185d', text: '#ffffff' },
              'Material': { bg: '#a855f7', border: '#9333ea', text: '#ffffff' },
              'Method': { bg: '#6366f1', border: '#4f46e5', text: '#ffffff' },
              'Measurement': { bg: '#06b6d4', border: '#0891b2', text: '#ffffff' },
              'Environment': { bg: '#10b981', border: '#059669', text: '#ffffff' },
              'Mother Nature': { bg: '#10b981', border: '#059669', text: '#ffffff' },
            };
            const col = catColors[b.cat] || { bg: '#64748b', border: '#475569', text: '#ffffff' };
            return (
              <g key={b.cat}>
                <line x1={b.xEnd} y1={b.yEnd} x2={b.xs} y2={L.spineY} stroke="#64748b" strokeWidth="2" />
                <rect x={b.xEnd - 55} y={b.labelY - 12} width="110" height="24" rx="12" fill={col.bg} stroke={col.border} strokeWidth="1.5" />
                <text x={b.xEnd} y={b.labelY + 4} textAnchor="middle" fill={col.text} fontSize="11.5" fontWeight="bold">
                  {b.cat}
                </text>
                {b.bones.map((bone) => (
                  <g key={bone.id}>
                    <title>{bone.full}</title>
                    <line x1={bone.x1} y1={bone.y} x2={bone.x2} y2={bone.y} stroke="#94a3b8" strokeWidth="1.5" />
                    <circle cx={bone.x2} cy={bone.y} r={bone.sub ? 2 : 3} fill="#475569" />
                    <text x={bone.x1 + 2} y={bone.y - 4} fill="#1e293b" fontSize={bone.sub ? 11 : 12} fontWeight="500">
                      {bone.sub ? '– ' : ''}{bone.label}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
