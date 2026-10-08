// Display-only fake rows for the grid performance spike. This is NOT the HAFB transaction
// model (that is Phase 1); it only has the column shape of a register so rendering cost is realistic.

export interface SpikeGridRow {
  id: string;
  date: string;
  account: string;
  payee: string;
  category: string;
  memo: string;
  /** Integer cents; negative = outflow. */
  amountCents: number;
  cleared: 'C' | 'U' | 'R';
}

const ACCOUNTS = ['Checking', 'Savings', 'Visa', 'Amex', 'Cash'];
const PAYEES = [
  'Kroger', 'Shell', 'Amazon', 'Netflix', 'Costco', 'Target', 'Starbucks', 'Electric Co',
  'Water Utility', 'Landlord', 'Employer Payroll', 'Chipotle', 'Home Depot', 'CVS', 'Spotify',
];
const CATEGORIES = [
  'Groceries', 'Fuel', 'Dining Out', 'Rent', 'Electric', 'Water', 'Subscriptions', 'Household',
  'Medical', 'Gifts', 'Ready to Assign', 'Home Maintenance', 'Clothing', 'Entertainment',
];
const MEMOS = ['', '', '', 'weekly shop', 'split with roommate', 'refund pending', 'annual renewal', 'reimbursable'];

/** mulberry32: small deterministic PRNG so every run renders identical data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], r: number, fallback: T): T {
  return items[Math.floor(r * items.length)] ?? fallback;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function generateRows(count: number, seed = 20261008): SpikeGridRow[] {
  const random = mulberry32(seed);
  const rows: SpikeGridRow[] = [];
  for (let i = 0; i < count; i += 1) {
    // Newest first, ~27 rows per day across ~5 years.
    const dayIndex = Math.floor((count - i) / 27);
    const year = 2021 + Math.floor(dayIndex / 336);
    const month = 1 + (Math.floor(dayIndex / 28) % 12);
    const day = 1 + (dayIndex % 28);
    const isInflow = random() < 0.08;
    const cents = Math.floor(random() * (isInflow ? 400_000 : 25_000)) + 1;
    const clearedRoll = random();
    rows.push({
      id: String(i),
      date: `${String(year)}-${pad2(month)}-${pad2(day)}`,
      account: pick(ACCOUNTS, random(), 'Checking'),
      payee: pick(PAYEES, random(), 'Payee'),
      category: isInflow ? 'Ready to Assign' : pick(CATEGORIES, random(), 'Groceries'),
      memo: pick(MEMOS, random(), ''),
      amountCents: isInflow ? cents : -cents,
      cleared: clearedRoll < 0.6 ? 'R' : clearedRoll < 0.9 ? 'C' : 'U',
    });
  }
  return rows;
}

const grouping = new Intl.NumberFormat('en-US');

/** Integer-only formatting: no float division of money. */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = (abs - (abs % 100)) / 100;
  return `${cents < 0 ? '-' : ''}$${grouping.format(whole)}.${pad2(abs % 100)}`;
}
