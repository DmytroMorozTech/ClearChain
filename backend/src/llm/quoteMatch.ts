/**
 * Decides whether a quote the model claims to have copied really is in the document.
 *
 * PDF text extraction is lossy about layout — line breaks become spaces, spaces between
 * text runs disappear, typographic dashes and quotes vary — so the comparison is done on
 * a normalised form, and once more with all whitespace removed. What it will not do is
 * fuzzy-match: a quote with a different digit is a different quote.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“-‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const withoutSpaces = (value: string): string => value.replace(/ /g, '');

export function quoteAppearsIn(quote: string, text: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return false;
  const haystack = normalizeForMatch(text);
  return haystack.includes(needle) || withoutSpaces(haystack).includes(withoutSpaces(needle));
}
