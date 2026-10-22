import { jsPDF } from 'jspdf';
import { formatDate } from './format.js';

export function generateComplaintReport(complaint, d3Data = null) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const pageWidth = 210 - margin * 2;
  let y = 16;

  // Outer border
  doc.setDrawColor(40, 50, 70);
  doc.setLineWidth(0.3);

  // Formal Header Box (as shown in PDF Page 10 & 24)
  doc.rect(margin, y, pageWidth, 28);
  doc.line(margin + 90, y, margin + 90, y + 28);

  // Left header section: Company branding & QAD SOP title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 100, 50);
  doc.text('natural remedies', margin + 8, y + 8);
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text('QAD - QUALITY ASSURANCE DEPARTMENT', margin + 8, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.text('STANDARD OPERATING PROCEDURE', margin + 8, y + 19);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text('TITLE: COMPLAINT MANAGEMENT REPORT', margin + 8, y + 24);

  // Right header section: SOP metadata table
  const metaX = margin + 92;
  const valX = margin + 140;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  const metaRows = [
    ['FORMAT NO', 'NR/QAD/SOP/001-F01/04'],
    ['EFFECTIVE DATE', formatDate(complaint.complaintDate || complaint.createdAt)],
    ['EXPIRY DATE', 'N/A'],
    ['SUPERSEDES', '00'],
    ['STATUS', 'Published and Active'],
  ];

  let metaY = y + 5;
  metaRows.forEach(([k, v], idx) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}`, metaX, metaY);
    doc.text(':', metaX + 38, metaY);
    doc.setFont('helvetica', 'normal');
    doc.text(`${v}`, valX, metaY);
    if (idx < metaRows.length - 1) {
      doc.setDrawColor(220, 220, 220);
      doc.line(margin + 90, metaY + 1.5, margin + pageWidth, metaY + 1.5);
    }
    metaY += 4.8;
  });

  y += 32;

  // Complaint Core Information Table
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y, pageWidth, 6, 'F');
  doc.rect(margin, y, pageWidth, 38);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 40, 90);
  doc.text('COMPLAINT & PRODUCT INFORMATION', margin + 3, y + 4.5);

  const infoRows = [
    ['Date of Complaint Receipt', formatDate(complaint.complaintDate)],
    ['Customer Name & Location', `${complaint.requester?.name || 'Customer'} - ${complaint.country || ''}`],
    ['Product Name', complaint.d2?.verifiedProduct?.productName || complaint.reportedProduct?.name || 'N/A'],
    ['Batch No.', complaint.d2?.verifiedProduct?.batchNumber || complaint.reportedProduct?.batchNumber || 'N/A'],
    ['Is the complaint repetitive', complaint.d2?.investigation?.repeatComplaint ? 'true' : 'false'],
    ['Internal Complaint registration number', complaint.complaintNumber],
  ];

  let infoY = y + 10;
  doc.setFontSize(8);
  infoRows.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(k, margin + 4, infoY);
    doc.text(':', margin + 68, infoY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(10, 10, 10);
    doc.text(String(v), margin + 72, infoY);
    infoY += 5.2;
  });

  y += 42;

  // Description of Non-Conformity Section
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y, pageWidth, 6, 'F');
  doc.rect(margin, y, pageWidth, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 40, 90);
  doc.text('DESCRIPTION OF NON-CONFORMITY / COMPLAINT (PROBLEM)', margin + 3, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  const descLines = doc.splitTextToSize(
    complaint.shortDescription + (complaint.additionalRemarks ? `\nRemarks: ${complaint.additionalRemarks}` : ''),
    pageWidth - 8
  );
  doc.text(descLines, margin + 4, y + 11);

  y += 28;

  // Root Cause Analysis (D3)
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y, pageWidth, 6, 'F');
  doc.rect(margin, y, pageWidth, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 40, 90);
  doc.text('ROOT CAUSE ANALYSIS (D3)', margin + 3, y + 4.5);

  const rcAnalysis = d3Data?.analysis;
  const methods = rcAnalysis?.methods?.join(', ') || 'Fishbone / Why-Why';
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 50, 50);
  doc.text('Analysis Method Selected:', margin + 4, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(10, 10, 10);
  doc.text(methods, margin + 48, y + 12);

  doc.setFont('helvetica', 'bold');
  doc.text('Problem Statement:', margin + 4, y + 18);
  doc.setFont('helvetica', 'normal');
  const probStatement = rcAnalysis?.problemStatement || complaint.shortDescription;
  doc.text(doc.splitTextToSize(probStatement, pageWidth - 42), margin + 38, y + 18);

  y += 32;

  // CAPA Records Table
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y, pageWidth, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 40, 90);
  doc.text('CORRECTIVE AND PREVENTIVE ACTIONS (CAPA)', margin + 3, y + 4.5);

  y += 8;
  const colX = [margin, margin + 26, margin + 56, margin + 110, margin + 148, margin + pageWidth];
  doc.rect(margin, y, pageWidth, 6, 'F');
  doc.rect(margin, y, pageWidth, 6);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(40, 40, 40);
  doc.text('CAPA No.', colX[0] + 2, y + 4.2);
  doc.text('Category', colX[1] + 2, y + 4.2);
  doc.text('Description', colX[2] + 2, y + 4.2);
  doc.text('Action Implemented', colX[3] + 2, y + 4.2);
  doc.text('Status', colX[4] + 2, y + 4.2);

  y += 6;
  const capas = d3Data?.capas || [];
  if (capas.length === 0) {
    doc.rect(margin, y, pageWidth, 8);
    doc.setFont('helvetica', 'normal');
    doc.text('No CAPA records registered yet.', margin + 4, y + 5);
    y += 8;
  } else {
    capas.forEach((c) => {
      doc.rect(margin, y, pageWidth, 9);
      doc.setFont('helvetica', 'normal');
      doc.text(c.capaNumber, colX[0] + 2, y + 5.5);
      doc.text(c.category || 'CA', colX[1] + 2, y + 5.5);
      doc.text((c.description || '').slice(0, 30), colX[2] + 2, y + 5.5);
      doc.text((c.actionImplemented || c.correctiveAction || 'In Progress').slice(0, 24), colX[3] + 2, y + 5.5);
      doc.text(c.isClosed ? 'Closed' : (c.actionStatus || 'Pending'), colX[4] + 2, y + 5.5);
      y += 9;
    });
  }

  y += 6;

  // D4 Effectiveness & Cost of Poor Quality (COPQ)
  if (complaint.d4?.copq) {
    doc.setFillColor(245, 247, 250);
    doc.rect(margin, y, pageWidth, 6, 'F');
    doc.rect(margin, y, pageWidth, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(10, 40, 90);
    doc.text('COST OF POOR QUALITY (COPQ in INR)', margin + 3, y + 4.5);

    const copq = complaint.d4.copq;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(`Logistics Cost: INR ${Number(copq.logisticsCost || 0).toFixed(2)}`, margin + 4, y + 11);
    doc.text(`Testing Cost: INR ${Number(copq.testingCost || 0).toFixed(2)}`, margin + 65, y + 11);
    doc.text(`Reprocessing Cost: INR ${Number(copq.reprocessingCost || 0).toFixed(2)}`, margin + 120, y + 11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total COPQ: INR ${Number(copq.totalCost || 0).toFixed(2)}`, margin + 4, y + 16.5);
    y += 24;
  }

  // Sign-off Box
  doc.rect(margin, y, pageWidth, 16);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('First Responsible Person (FRP)', margin + 4, y + 4.5);
  doc.text('Complaint Handler', margin + 65, y + 4.5);
  doc.text('Quality Assurance (QA) Head', margin + 130, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.text(complaint.frp?.name || 'Assigned FRP', margin + 4, y + 12);
  doc.text('Customer Relationship Management', margin + 65, y + 12);
  doc.text('Approved & Verified', margin + 130, y + 12);

  doc.save(`Complaint-Report-${complaint.complaintNumber}.pdf`);
}
