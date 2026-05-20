import { generateDocx, generatePdf, GeneratedData } from './src/lib/processor';
import * as fs from 'fs';

async function test() {
  const data: GeneratedData = {
    projectName: 'My Test Project',
    outputType: 'BRD',
    sections: [
      { header: 'Executive Summary', content: 'This is a test summary.' },
      { header: 'Requirements', content: 'This is a test requirement with [CLARIFICATION NEEDED: something].' }
    ]
  };

  try {
    const docxBlob = await generateDocx(data);
    const docxBuffer = Buffer.from(await docxBlob.arrayBuffer());
    fs.writeFileSync('test-out.docx', docxBuffer);
    console.log('Docx generated successfully, size:', docxBuffer.length);
  } catch (e) {
    console.error('Docx generation failed', e);
  }

  try {
    const pdfBlob = await generatePdf(data);
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
    fs.writeFileSync('test-out.pdf', pdfBuffer);
    console.log('Pdf generated successfully, size:', pdfBuffer.length);
  } catch (e) {
    console.error('Pdf generation failed', e);
  }
}

test();
