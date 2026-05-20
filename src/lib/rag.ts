import { create, insertMultiple, search, type Orama } from '@orama/orama';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import Tesseract from 'tesseract.js';
import { generateCompletion, type LLMConfig } from './llm';

// Initialize PDF.js worker using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface DocumentChunk {
  id: string;
  source: string;
  content: string;
}

export type VectorDB = Orama<any>;

// Local OCR Extraction using Tesseract
async function extractImageTextLocally(base64Image: string, pageIndex: number | string): Promise<string> {
  try {
    const result = await Tesseract.recognize(base64Image, 'eng');
    const text = result.data.text.trim();
    if (text.length < 50) {
      return `[AI_ACTION_REQUIRED: Analyze the visual flowchart on original page ${pageIndex}]`;
    }
    return `--- Local OCR Extracted Page ${pageIndex} ---\n${text}\n------------------`;
  } catch (err) {
    console.error("Local OCR Failed:", err);
    return `[AI_ACTION_REQUIRED: Analyze the visual flowchart on original page ${pageIndex}]`;
  }
}

// Text extraction utilities
async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    
    // If the page has very little text, it's likely a scanned image or complex visual diagram
    if (pageText.trim().length < 50) {
      console.log(`Triggering Local OCR for Page ${i}...`);
      const viewport = page.getViewport({ scale: 2.0 });
      let canvas: any;
      let context: any;
      let base64Image = '';

      if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvasContext: context, viewport } as any).promise;
        }
        base64Image = canvas.toDataURL('image/jpeg', 0.85);
      } else if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(viewport.width, viewport.height);
        context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvasContext: context, viewport } as any).promise;
        }
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        base64Image = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      if (base64Image) {
        const ocrText = await extractImageTextLocally(base64Image, i);
        text += ocrText + '\n\n';
      }
    } else {
      text += pageText + '\n\n';
    }
  }
  return text;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractTextFromExcel(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = xlsx.read(arrayBuffer, { type: 'buffer' });
  let text = '';
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    text += `Sheet: ${sheetName}\n`;
    text += xlsx.utils.sheet_to_csv(sheet);
    text += '\n\n';
  });
  return text;
}

export async function extractText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  if (ext === 'txt' || ext === 'csv' || ext === 'md' || ext === 'srt') {
    return await file.text();
  } else if (ext === 'pdf') {
    return await extractTextFromPDF(file);
  } else if (ext === 'docx' || ext === 'doc') {
    return await extractTextFromDocx(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    return await extractTextFromExcel(file);
  } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    // Process image locally using Tesseract
    let base64Image = '';
    
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((resolve) => img.onload = resolve);
      
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
      
      base64Image = canvas.toDataURL('image/jpeg', 0.85);
    } else if (typeof OffscreenCanvas !== 'undefined') {
      const bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        base64Image = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    }

    if (base64Image) {
      const ocrText = await extractImageTextLocally(base64Image, 'Image');
      return ocrText;
    }
    return `[Image skipped: Environment does not support image processing]`;
  } else {
    // For audio, fallback message
    return `[Audio skipped: Local parsing currently handling text/vision files for ${file.name}]`;
  }
}

async function dynamicSummarize(text: string, llmConfig: LLMConfig): Promise<string> {
  // Use chunks to summarize since text might be huge
  const chunks = chunkText(text, "compiler", 20000, 1000);
  let condensedText = '';

  for (let i = 0; i < chunks.length; i++) {
    const prompt = `Condense the following text by removing repetitive information, while keeping all key facts, requirements, structural elements, and [AI_ACTION_REQUIRED: ...] markers intact.
     
TEXT TO CONDENSE:
${chunks[i].content}`;

    try {
      const summary = await generateCompletion(llmConfig, [
        { role: 'system', content: 'You are an expert Document Summarizer.' },
        { role: 'user', content: prompt }
      ], 0.3);
      condensedText += summary + '\n\n';
    } catch (err) {
      console.error("Summarization failed for chunk", i, err);
      condensedText += chunks[i].content + '\n\n'; // fallback to original
    }
  }
  return `# Compiled & Condensed Project Data\n\n${condensedText}`;
}

export async function compileFilesToMarkdown(files: File[], llmConfig: LLMConfig, onProgress?: (p: number, s: string) => void): Promise<string> {
  let compiledMarkdown = `# Compiled Project Data\n\n`;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) onProgress(10 + Math.floor((i / files.length) * 15), `Extracting ${file.name}...`);
    try {
      const text = await extractText(file);
      compiledMarkdown += `## Source File: ${file.name}\n\n${text}\n\n`;
    } catch (err) {
      console.warn(`Failed to parse file ${file.name}:`, err);
    }
  }

  // If the file is too large (e.g. > 30,000 characters), condense it
  if (compiledMarkdown.length > 30000) {
    if (onProgress) onProgress(25, 'Condensing compiled data...');
    compiledMarkdown = await dynamicSummarize(compiledMarkdown, llmConfig);
  }

  return compiledMarkdown;
}

// Chunking: 1000 characters with 200 character overlap
export function chunkText(text: string, source: string, chunkSize = 1000, overlap = 200): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let i = 0;
  let chunkId = 0;
  
  while (i < text.length) {
    const chunk = text.slice(i, i + chunkSize);
    chunks.push({
      id: `${source}_${chunkId++}`,
      source,
      content: chunk
    });
    i += (chunkSize - overlap);
  }
  
  return chunks;
}

// Vector DB Initialization
export async function createVectorDB(): Promise<VectorDB> {
  return await create({
    schema: {
      id: 'string',
      source: 'string',
      content: 'string'
    }
  });
}

// Parse all files into compiled markdown, chunk, and index
export async function processFilesToDB(files: File[], llmConfig: LLMConfig, onProgress?: (p: number, s: string) => void): Promise<{ db: VectorDB, chunks: DocumentChunk[], compiledMarkdown: string }> {
  const compiledMarkdown = await compileFilesToMarkdown(files, llmConfig, onProgress);
  const db = await createVectorDB();
  const allChunks = chunkText(compiledMarkdown, 'compiled_data');
  
  // Insert into Orama
  if (allChunks.length > 0) {
    await insertMultiple(db, allChunks);
  }
  
  return { db, chunks: allChunks, compiledMarkdown };
}

// RAG Search
export async function searchContext(db: VectorDB, query: string, limit = 5): Promise<string> {
  const results = await search(db, {
    term: query,
    properties: ['content'],
    limit
  });
  
  return results.hits.map(hit => hit.document.content).join('\n\n---\n\n');
}
