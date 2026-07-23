/**
 * Builds a genuinely valid one-page PDF.
 *
 * The seed could have written arbitrary bytes and set a mime type, but then every
 * download in the demo would hand the reviewer a file their viewer refuses to open —
 * and the upload path's own magic-byte check would reject the same content. A real
 * (if plain) document keeps the whole flow honest end to end.
 */

/**
 * PDF string literals and the cross-reference table are byte-oriented, and the offsets
 * below are computed on the assumption that one character is one byte. Folding to ASCII
 * keeps that true for supplier names carrying diacritics.
 */
function toAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '');
}

function escapePdfText(value: string): string {
  return toAscii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildCertificatePdf(title: string, lines: readonly string[]): Buffer {
  const drawn = [
    `BT /F1 18 Tf 60 770 Td (${escapePdfText(title)}) Tj ET`,
    ...lines.map(
      (line, index) =>
        `BT /F1 11 Tf 60 ${String(730 - index * 22)} Td (${escapePdfText(line)}) Tj ET`,
    ),
  ].join('\n');

  const content = `${drawn}\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const header = '%PDF-1.4\n';
  const offsets: number[] = [];
  let body = '';

  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const startXref = header.length + body.length;
  const xref = [
    `xref`,
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `),
    '',
  ].join('\n');

  const trailer =
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(startXref)}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}
