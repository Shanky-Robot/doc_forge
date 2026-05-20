import { extractText, createVectorDB, chunkText } from './rag';
import { insertMultiple, search } from '@orama/orama';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, Header, Footer, AlignmentType, PageBreak, PageNumber, TabStopType } from 'docx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

let vectorDbInstance: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    if (type === 'EXTRACT_TEXT') {
      const text = await extractText(payload.file);
      self.postMessage({ type: 'SUCCESS', id, payload: text });
    } else if (type === 'INDEX_DB') {
      const { compiledContext } = payload;
      const chunks = chunkText(compiledContext, "compiled_context", 1000, 200);
      vectorDbInstance = await createVectorDB();
      await insertMultiple(vectorDbInstance, chunks);
      self.postMessage({ type: 'SUCCESS', id, payload: true });
    } else if (type === 'SEARCH_DB') {
      const { query, limit } = payload;
      if (!vectorDbInstance) throw new Error("DB not initialized");
      const results = await search(vectorDbInstance, {
        term: query,
        properties: ['content'],
        limit: limit || 5
      });
      const contextStr = results.hits.map(hit => hit.document.content).join('\n\n---\n\n');
      self.postMessage({ type: 'SUCCESS', id, payload: contextStr });
    } else if (type === 'GENERATE_DOCX') {
      const blob = await generateDocxWorker(payload.data);
      self.postMessage({ type: 'SUCCESS', id, payload: blob });
    } else if (type === 'GENERATE_PDF') {
      const blob = await generatePdfWorker(payload.data);
      self.postMessage({ type: 'SUCCESS', id, payload: blob });
    }
  } catch (err: any) {
    self.postMessage({ type: 'ERROR', id, payload: err.message });
  }
};

// --- Helper Functions Moved to Worker ---

function sanitizeLatex(text: string): string {
  return text
    .replace(/\$\rightarrow\$/g, '→')
    .replace(/\\rightarrow/g, '→')
    .replace(/\$\leftarrow\$/g, '←')
    .replace(/\\leftarrow/g, '←')
    .replace(/\$\Rightarrow\$/g, '⇒')
    .replace(/\\Rightarrow/g, '⇒')
    .replace(/\$/g, '');
}

function parseInlineToDocxTextRuns(text: string): TextRun[] {
  text = sanitizeLatex(text || "");
  const runs: TextRun[] = [];
  const tokenRegex = /(\*\*.*?\*\*|\*.*?\*|_.*?_|\[CLARIFICATION NEEDED:.*?\])/gi;
  let lastIndex = 0;
  
  let match;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.substring(lastIndex, match.index) }));
    }
    
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    } else if (token.startsWith('_') && token.endsWith('_')) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    } else if (token.toUpperCase().startsWith('[CLARIFICATION NEEDED:')) {
      runs.push(new TextRun({ text: token, color: "FF0000", bold: true }));
    }
    
    lastIndex = match.index + token.length;
  }
  
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.substring(lastIndex) }));
  }
  
  if (runs.length === 0) {
    runs.push(new TextRun({ text: "" }));
  }
  
  return runs;
}

// --- Table & Heading Helpers ---

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|');
}

function isSeparatorRow(line: string): boolean {
  return /^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|$/.test(line.trim());
}

function parseMarkdownTable(lines: string[]): { headers: string[], rows: string[][] } | null {
  if (lines.length < 3) return null;
  if (!isTableRow(lines[0]) || !isSeparatorRow(lines[1])) return null;
  const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);
  const rows = lines.slice(2)
    .filter(l => isTableRow(l))
    .map(l => l.split('|').map(c => c.trim()).filter(c => c));
  return { headers, rows };
}

function getHeadingLevel(header: string, outputType: string): 1 | 2 | 3 {
  if (/^\d+\.\d+/.test(header) || header.startsWith('###')) return 3;
  if (/^\d+\./.test(header)) return 2;
  if (header === outputType + ' Document') return 1;
  return 2;
}

async function generateDocxWorker(data: any): Promise<Blob> {
  const docChildren: any[] = [];

  // FIX 11.2 — Cover page
  const coverDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  docChildren.push(new Paragraph({
    children: [new TextRun({ text: `${data.outputType} Document`, bold: true, size: 48 })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 1440, after: 240 },
  }));
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: data.projectName || '', size: 32 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
  }));
  docChildren.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } },
    spacing: { after: 480 },
  }));
  docChildren.push(new Table({
    rows: [
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Created By', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ text: data.creatorName || 'DocForge User' })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Date', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ text: coverDate })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Version', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ text: 'v1.0' })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Status', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ text: 'Draft' })] }),
      ]}),
    ],
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
    },
  }));
  docChildren.push(new Paragraph({ spacing: { after: 480 } }));
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'CONFIDENTIAL — For internal use only', italics: true, size: 18, color: '666666' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }));
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // FIX 11.3 — Table of Contents
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Table of Contents', bold: true, size: 36 })],
    spacing: { after: 240 },
  }));
  const tocEntries = (data.sections || []).map((sec: any, i: number) => ({
    title: sec.header.replace(/^#+\s*/, ''),
    pageRef: i + 3,
  }));
  for (const entry of tocEntries) {
    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: entry.title }),
        new TextRun({ text: '\t' }),
        new TextRun({ text: String(entry.pageRef) }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: 9000, leader: 'dot' }],
      spacing: { after: 120 },
    }));
  }
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  for (const section of data.sections) {
    // FIX 11.5 — Section heading hierarchy
    const hLevel = getHeadingLevel(section.header.replace(/^#+\s*/, ''), data.outputType);
    const headingLevel = hLevel === 1 ? HeadingLevel.HEADING_1 : hLevel === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    const headingSize = hLevel === 1 ? 48 : hLevel === 2 ? 32 : 26;
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: section.header.replace(/^#+\s*/, ''), bold: true, size: headingSize, italics: hLevel === 3 })],
      heading: headingLevel,
      spacing: { before: 400, after: 200 }
    }));
    
    const lines = section.content.split('\n');
    let inTable = false;
    let inCodeBlock = false;
    let tableRows: string[][] = [];
    
    const finishTable = () => {
      if (tableRows.length > 0) {
        const rows = tableRows.filter(row => !row.join('').match(/^[-|: ]+$/)).map((row, rIdx) => {
          return new TableRow({
            children: row.map(cellText => new TableCell({
              children: [new Paragraph({ children: parseInlineToDocxTextRuns(cellText.trim()) })],
              shading: rIdx === 0 ? { fill: "f0f0f0" } : undefined,
              margins: { top: 100, bottom: 100, left: 100, right: 100 }
            }))
          });
        });
        
        if (rows.length > 0) {
          docChildren.push(new Table({
            rows: rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
            }
          }));
          docChildren.push(new Paragraph({ spacing: { after: 200 } }));
        }
        
        tableRows = [];
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inTable) finishTable();
        continue;
      }

      if (inCodeBlock) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: line, font: "Courier" })],
          shading: { fill: "f5f5f5" },
          spacing: { after: 0 }
        }));
        continue;
      }

      if (line === '') {
        if (inTable) finishTable();
        continue;
      }
      
      const isTableLine = line.includes('|') && !line.startsWith('#');
      
      if (isTableLine) {
        inTable = true;
        if (line.match(/^[|-\s:]+$/)) continue;
        
        const rowContent = line.replace(/^\|/, '').replace(/\|$/, '');
        let cells = rowContent.split('|').map(c => c.trim());
        if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        if (cells.length > 0 && cells[0] === '') cells.shift();
        
        tableRows.push(cells);
        continue;
      } else {
        if (inTable) finishTable();
      }
      
      if (line.startsWith('### ')) {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line.substring(4)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 120 }
        }));
      } else if (line.startsWith('## ')) {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line.substring(3)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 }
        }));
      } else if (line.startsWith('# ')) {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line.substring(2)),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 120 }
        }));
      } else if (line.startsWith('* ')) {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line.substring(2)),
          bullet: { level: 0 },
          spacing: { after: 100 }
        }));
      } else if (line.startsWith('- ')) {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line.substring(2)),
          bullet: { level: 0 },
          spacing: { after: 100 }
        }));
      } else {
        docChildren.push(new Paragraph({
          children: parseInlineToDocxTextRuns(line),
          spacing: { after: 200 }
        }));
      }
    }
    
    if (inTable) finishTable();
  }

  // FIX 11.4 — Headers and footers
  const doc = new Document({
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `${data.outputType} — ${data.projectName}` }),
                new TextRun({ text: '\t' }),
                new TextRun({ text: 'v1.0 | Draft' }),
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'CONFIDENTIAL' }),
                new TextRun({ text: '\t' }),
                new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] }),
                new TextRun({ text: '\t' }),
                new TextRun({ text: 'Generated by DocForge' }),
              ],
              tabStops: [
                { type: TabStopType.CENTER, position: 4680 },
                { type: TabStopType.RIGHT, position: 9360 },
              ],
            }),
          ],
        }),
      },
      children: docChildren,
    }],
  });

  return await Packer.toBlob(doc);
}

function renderPdfRichText(doc: jsPDF, text: string, startX: number, startY: number, maxWidth: number, isList: boolean = false): number {
  let x = startX;
  let y = startY;
  
  text = sanitizeLatex(text || "");
    
  const tokenRegex = /(\*\*.*?\*\*|\*.*?\*|_.*?_|\[CLARIFICATION NEEDED:.*?\]|\s+)/gi;
  const tokens = text.split(tokenRegex).filter(t => t.length > 0);
  
  if (isList) {
    doc.circle(x + 2, y - 1.5, 1, 'F');
    x += 6;
  }
  
  for (const token of tokens) {
    if (token.match(/^\s+$/)) {
      x += (doc.getStringUnitWidth(" ") * doc.getFontSize() / doc.internal.scaleFactor);
      continue;
    }
    
    let renderText = token;
    let newStyle = "normal";
    let newColor: [number, number, number] = [0, 0, 0];
    
    if (token.startsWith('**') && token.endsWith('**')) {
      renderText = token.slice(2, -2);
      newStyle = "bold";
    } else if (token.startsWith('*') && token.endsWith('*')) {
      renderText = token.slice(1, -1);
      newStyle = "italic";
    } else if (token.startsWith('_') && token.endsWith('_')) {
      renderText = token.slice(1, -1);
      newStyle = "italic";
    } else if (token.toUpperCase().startsWith('[CLARIFICATION NEEDED:')) {
      newStyle = "bold";
      newColor = [255, 0, 0];
    }
    
    doc.setFont("helvetica", newStyle);
    doc.setTextColor(newColor[0], newColor[1], newColor[2]);
    
    const wordWidth = doc.getStringUnitWidth(renderText) * doc.getFontSize() / doc.internal.scaleFactor;
    
    if (x + wordWidth > startX + maxWidth) {
      y += 6;
      x = isList ? startX + 6 : startX;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    }
    
    doc.text(renderText, x, y);
    x += wordWidth;
  }
  
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  
  return y;
}

async function generatePdfWorker(data: any): Promise<Blob> {
  const doc = new jsPDF();

  // FIX 11.2 — Cover page
  const coverDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(`${data.outputType} Document`, 105, 80, { align: 'center' });
  doc.setFontSize(18);
  doc.setFont('helvetica', 'normal');
  doc.text(data.projectName || '', 105, 98, { align: 'center' });
  doc.setLineWidth(0.5);
  doc.line(20, 110, 190, 110);
  autoTable(doc, {
    head: [],
    body: [
      ['Created By', data.creatorName || 'DocForge User'],
      ['Date', coverDate],
      ['Version', 'v1.0'],
      ['Status', 'Draft'],
    ],
    startY: 118,
    margin: { left: 55, right: 55 },
    styles: { fontSize: 11 },
    columnStyles: { 0: { fontStyle: 'bold' } },
    theme: 'plain',
  });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(120, 120, 120);
  doc.text('CONFIDENTIAL — For internal use only', 105, 272, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // FIX 11.3 — Table of Contents
  doc.addPage();
  let y = 25;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Table of Contents', 20, y);
  y += 12;
  const tocEntries = (data.sections || []).map((sec: any, i: number) => ({
    title: sec.header.replace(/^#+\s*/, ''),
    pageRef: i + 3,
  }));
  for (const entry of tocEntries) {
    if (y > 272) { doc.addPage(); y = 25; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(entry.title, 20, y);
    doc.text(String(entry.pageRef), 190, y, { align: 'right' });
    const titleWidth = doc.getTextWidth(entry.title);
    const pageWidth = doc.getTextWidth(String(entry.pageRef));
    const leaderStart = 20 + titleWidth + 2;
    const leaderEnd = 190 - pageWidth - 2;
    if (leaderEnd > leaderStart) {
      const dotW = doc.getTextWidth('.');
      const dots = '.'.repeat(Math.max(0, Math.floor((leaderEnd - leaderStart) / (dotW + 0.3))));
      doc.text(dots, leaderStart, y);
    }
    y += 7;
  }

  // Content pages
  doc.addPage();
  y = 25;
  
  for (const section of data.sections) {
    if (y > 265) {
      doc.addPage();
      y = 25;
    }

    // FIX 11.5 — Section heading hierarchy
    const hLevel = getHeadingLevel(section.header.replace(/^#+\s*/, ''), data.outputType);
    const headingFontSize = hLevel === 1 ? 24 : hLevel === 2 ? 16 : 13;
    doc.setFontSize(headingFontSize);
    doc.setFont('helvetica', hLevel === 3 ? 'bolditalic' : 'bold');
    doc.text(section.header.replace(/^#+\s*/, ''), 20, y);
    y += hLevel === 1 ? 12 : 10;
    
    const lines = section.content.split('\n');
    let inTable = false;
    let inCodeBlock = false;
    let tableRows: string[][] = [];
    
    const finishTablePdf = () => {
      if (tableRows.length > 0) {
        const bodyRows = tableRows.filter(row => !row.join('').match(/^[-|: ]+$/));
        if (bodyRows.length > 0) {
          const stripMd = (text: string) => text.trim().replace(/[*_~\\`]/g, '');
          autoTable(doc, {
            head: [bodyRows[0].map(stripMd)],
            body: bodyRows.slice(1).map(r => r.map(stripMd)),
            startY: y,
            margin: { left: 20, right: 20 },
            styles: { fontSize: 10, font: 'helvetica' },
            headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
            theme: 'grid'
          });
          y = (doc as any).lastAutoTable.finalY + 10;
        }
        tableRows = [];
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inTable) finishTablePdf();
        continue;
      }

      if (inCodeBlock) {
        if (y > 265) {
          doc.addPage();
          y = 25;
        }
        doc.setFillColor(245, 245, 245);
        doc.rect(15, y - 4, 180, 6, 'F');
        doc.setFont("courier", "normal");
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(line, 20, y);
        y += 6;
        continue;
      }

      if (line === '') {
        if (inTable) finishTablePdf();
        else y += 3;
        continue;
      }
      
      const isTableLine = line.includes('|') && !line.startsWith('#');
      
      if (isTableLine) {
        inTable = true;
        if (line.match(/^[|-\s:]+$/)) continue;
        
        const rowContent = line.replace(/^\|/, '').replace(/\|$/, '');
        let cells = rowContent.split('|').map(c => c.trim());
        if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        if (cells.length > 0 && cells[0] === '') cells.shift();
        
        tableRows.push(cells);
        continue;
      } else {
        if (inTable) finishTablePdf();
      }
      
      if (y > 265) {
        doc.addPage();
        y = 25;
      }

      if (line.startsWith('### ')) {
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        y = renderPdfRichText(doc, line.substring(4), 20, y, 170);
        y += 8;
      } else if (line.startsWith('## ')) {
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        y = renderPdfRichText(doc, line.substring(3), 20, y, 170);
        y += 8;
      } else if (line.startsWith('# ')) {
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        y = renderPdfRichText(doc, line.substring(2), 20, y, 170);
        y += 10;
      } else if (line.startsWith('* ')) {
        doc.setFontSize(12);
        y = renderPdfRichText(doc, line.substring(2), 20, y, 164, true);
        y += 6;
      } else if (line.startsWith('- ')) {
        doc.setFontSize(12);
        y = renderPdfRichText(doc, line.substring(2), 20, y, 164, true);
        y += 6;
      } else {
        doc.setFontSize(12);
        y = renderPdfRichText(doc, line, 20, y, 170);
        y += 6;
      }
    }
    
    if (inTable) finishTablePdf();
    y += 10;
  }

  // FIX 11.4 — Add headers and footers to all pages except the cover (page 1)
  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let p = 2; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.setLineWidth(0.3);
    // Header
    doc.text(`${data.outputType} — ${data.projectName}`, 20, 10);
    doc.text('v1.0 | Draft', 190, 10, { align: 'right' });
    doc.line(20, 13, 190, 13);
    // Footer
    doc.line(20, 284, 190, 284);
    doc.text('CONFIDENTIAL', 20, 289);
    doc.text(`Page ${p - 1} of ${pageCount - 1}`, 105, 289, { align: 'center' });
    doc.text('Generated by DocForge', 190, 289, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  return doc.output('blob');
}
