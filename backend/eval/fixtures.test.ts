import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readPdf } from '../src/llm/pdfInfo.ts';
import { buildFixturePdf, groundTruth } from './buildFixtures.ts';
import { FIXTURES } from './fixtureSpecs.ts';

/**
 * The eval set is committed as generated files so results stay comparable run to run.
 * This keeps those files honest: change a spec without running `npm run eval:fixtures`
 * and this fails. It compares content — page count and text — rather than bytes, so a
 * line-ending conversion on checkout cannot fail it for no real reason.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('committed eval fixtures', () => {
  it('ground-truth.json matches the specs', async () => {
    const committed: unknown = JSON.parse(
      await readFile(path.join(here, 'ground-truth.json'), 'utf8'),
    );
    expect(committed).toEqual(groundTruth());
  });

  it.each(FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    '%s.pdf matches its spec',
    async (id, fixture) => {
      const committed = await readPdf(await readFile(path.join(here, 'fixtures', `${id}.pdf`)));
      const fresh = await readPdf(Buffer.from(await buildFixturePdf(fixture)));
      expect(committed.pageCount).toBe(fresh.pageCount);
      expect(committed.text).toBe(fresh.text);
    },
  );
});
