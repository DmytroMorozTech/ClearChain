import { PDFDocument, StandardFonts } from 'pdf-lib';

import type { FixtureSpec } from './fixtureSpecs.ts';
import { FIXTURES } from './fixtureSpecs.ts';

/**
 * Renders one eval document. Deterministic — fixed metadata dates, no random IDs — so
 * the same spec always yields the same file. Helvetica's WinAnsi encoding covers the
 * German characters (ä ö ü ß) and the ® and – the documents use.
 */
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

export async function buildFixturePdf(fixture: FixtureSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('ClearChain eval fixtures');
  doc.setCreator('ClearChain eval fixtures');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const lines of fixture.pages) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    for (const line of lines) {
      const heading = line.startsWith('## ');
      page.drawText(heading ? line.slice(3) : line, {
        x: 50,
        y,
        size: heading ? 18 : 10.5,
        font: heading ? bold : regular,
        maxWidth: 495,
      });
      y -= heading ? 34 : 20;
    }
  }

  return doc.save();
}

/** The expected answers, keyed by fixture id — the content of ground-truth.json. */
export function groundTruth(): Record<string, Pick<FixtureSpec, 'description' | 'truth'>> {
  return Object.fromEntries(
    FIXTURES.map((fixture) => [
      fixture.id,
      { description: fixture.description, truth: fixture.truth },
    ]),
  );
}
