import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Page count (to refuse long documents before paying for them) and the text layer (to
 * check the model's quotes against). A scanned PDF has pages but no text — that is
 * reported as "no usable text", not as an error.
 */
export interface PdfInfo {
  pageCount: number;
  text: string;
}

export const MIN_TEXT_CHARS = 20;

export async function readPdf(buffer: Buffer): Promise<PdfInfo> {
  // A copy: pdf.js may transfer the underlying ArrayBuffer, and the caller still needs it.
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pageCount: totalPages, text };
}

export function usableText(text: string): string | null {
  return text.replace(/\s+/g, '').length >= MIN_TEXT_CHARS ? text : null;
}
