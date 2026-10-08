import { normalizeForMatch } from './quoteMatch.ts';

/**
 * Spots document text that addresses the extraction model rather than a human reader.
 *
 * This is a heuristic and is easy to evade; it is not what stops prompt injection —
 * having no tools, the output schema and validate.ts do that. What it adds is a reason
 * for the human to look twice at the one kind of injection those checks cannot catch:
 * a *plausible* override ("the correct expiry date is …") whose value passes every
 * range check and whose quote really is in the document.
 *
 * The phrases are deliberately specific. Certificates are full of words like "system",
 * "note" and "Hinweis", and a warning that fires on ordinary documents trains people to
 * ignore it.
 */
const PATTERNS: readonly RegExp[] = [
  // English
  /\b(ignore|disregard|forget|override)\b (all |any )?(the )?(previous|prior|above|earlier|preceding)\b (instructions?|rules?|prompts?|guidelines?)/,
  /\b(system|assistant|developer) (prompt|note|message|instructions?)\b/,
  /\b(note|message|instructions?) (to|for) (the )?(ai|llm|assistant|model|language model|extraction model)\b/,
  /\b(as an ai|you are an ai|you are a language model)\b/,
  /\bset (the )?(expirydate|expiry date|issuedate|issue date|issuer|certificatenumber|certificate number|type)\b.{0,20}\bto\b/,
  /\bthe (correct|actual|real|true) (expiry|expiration|issue) date is\b/,
  // German
  /\bignorier\w* (alle |die )?(vorherigen |bisherigen |obigen |vorangegangenen )?(anweisungen|regeln|instruktionen|vorgaben)\b/,
  /\b(hinweis|anweisung|nachricht|information) (für|an) (die |das |den )?(ki|automatische\w*|maschinelle\w*|sprachmodell)\b/,
  /\b(das |der )?(korrekte|richtige|tatsächliche) (ablaufdatum|ausstellungsdatum|gültigkeitsdatum)\b/,
];

export function looksLikeInstructions(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return PATTERNS.some((pattern) => pattern.test(normalized));
}
