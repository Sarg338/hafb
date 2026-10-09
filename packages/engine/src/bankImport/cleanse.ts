// Payee cleanup on import (S6.5). YNAB "cleanses" imported payee names before they reach the
// register and keeps the bank's text (https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo).
// It doesn't publish the rules. ASSUMPTION (budget-math §8.6): strip card-processor prefixes
// (SQ *, TST*, PAYPAL *, POS PURCHASE, DEBIT CARD PURCHASE…), store numbers (#0423 and what
// follows, trailing ids when at least two words remain), reference codes after "*", trailing
// dates; then title-case words written in capitals (3+ letters). The bank's original text is
// stored on the transaction (imported payee) either way.

const PROCESSOR = /^(?:SQ|TST|SP|PAYPAL|PP|DD|IN|IC|WPY|PY)\s*\*\s*/i;
const CHANNEL = /^(?:(?:POS|DEBIT CARD|CHECK CARD|VISA DEBIT|ACH|ONLINE|RECURRING|PREAUTHORIZED|PURCHASE)\s+(?:PURCHASE|DEBIT|PAYMENT|WITHDRAWAL|AUTHORIZED ON)?\s*(?:-\s*)?)+/i;

export function cleansePayee(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (s === '') return '';
  s = s.replace(CHANNEL, '');
  s = s.replace(PROCESSOR, '');
  s = s.replace(/\*[A-Z0-9]*\d[A-Z0-9]*\s*$/i, '');
  s = s.replace(/\s*#\s*\d+.*$/, '');
  s = s.replace(/\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/, '');
  while (/\s\d{3,}$/.test(s) && s.split(' ').length > 2) s = s.replace(/\s\d{3,}$/, '');
  s = s.replace(/[\s,–-]+$/, '').trim();
  if (s === '') return raw.trim();
  // A name in capitals throughout is title-cased word by word (acronyms stay); a mixed-case name
  // only loses the capitals of its long all-caps words.
  const allCaps = !/[a-z]/.test(s);
  return s
    .split(' ')
    .map((w) => {
      if (ACRONYMS.has(w)) return w;
      const caps = allCaps ? /^[A-Z][A-Z'&.]+$/.test(w) : /^[A-Z][A-Z'&.]{2,}$/.test(w);
      return caps ? w.charAt(0) + w.slice(1).toLowerCase() : w;
    })
    .join(' ');
}

const ACRONYMS = new Set(['US', 'USA', 'UK', 'ATM', 'ACH', 'LLC', 'TV', 'IRS', 'DMV', 'CVS', 'BP', 'H&M', 'AT&T']);
