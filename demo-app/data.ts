/**
 * Demo data: a small securities-holdings platform with two tenants.
 * Deterministic (seeded) so the demo gives the same results every run.
 * Trade dates are relative to today, like real data loaded by a business team.
 */

export interface Position {
  id: number;
  tenant: string;
  isin: string;
  issuer: string;
  quantity: number;
  marketValue: number;
  tradeDate: string;
  status: 'NEW' | 'INVESTIGATING' | 'CLOSED';
}

export interface DocumentPackage {
  id: string;
  tenant: string;
  fileName: string;
  formCode: string;
  issuerName: string | null;
  status: 'Generated' | 'Failed';
  createdAt: string;
}

export interface Comment {
  id: number;
  tenant: string;
  positionId: number;
  text: string;
  author: string;
  createdAt: string;
  /** Read-model lag: not visible before this time. */
  visibleAt: number;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function businessDaysBack(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

const ISSUERS = ['Aster Holdings', 'Borealis Energy', 'Cobalt Mining', 'Delta Shipping', 'Ember Foods', 'Fjord Telecom', 'Granite Bank', 'Harbour REIT', 'Ion Semiconductors', 'Juniper Pharma', 'Kestrel Air', 'Lumen Media'];
const COUNTRIES = ['GB', 'US', 'DE', 'FR', 'NL', 'CA'];

export function makePositions(): Position[] {
  const r = rng(42);
  const out: Position[] = [];
  let id = 1000;
  for (const [tenant, count] of [['alpha', 57], ['beta', 12]] as const) {
    for (let i = 0; i < count; i++) {
      const issuer = ISSUERS[Math.floor(r() * ISSUERS.length)];
      const qty = Math.floor(r() * 990_000) + 100;
      const price = Math.round((r() * 300 + 1) * 100) / 100;
      out.push({
        id: id++,
        tenant,
        isin: `${COUNTRIES[Math.floor(r() * COUNTRIES.length)]}${String(Math.floor(r() * 1e9)).padStart(9, '0')}${Math.floor(r() * 10)}`,
        issuer,
        quantity: qty,
        marketValue: Math.round(qty * price * 100) / 100,
        tradeDate: businessDaysBack(Math.floor(r() * 4)),
        status: (['NEW', 'NEW', 'NEW', 'INVESTIGATING', 'CLOSED'] as const)[Math.floor(r() * 5)],
      });
    }
  }
  return out;
}

export function makeDocuments(): DocumentPackage[] {
  const r = rng(7);
  const forms = ['CA-LONG-INITIAL', 'CA-LONG-SUBSEQUENT', 'UK-TR1', 'DE-SHORT', 'US-13G'];
  const out: DocumentPackage[] = [];
  for (let i = 0; i < 23; i++) {
    const form = forms[Math.floor(r() * forms.length)];
    const failed = i % 6 === 5;
    out.push({
      id: `doc-${String(i + 1).padStart(3, '0')}`,
      tenant: 'alpha',
      fileName: `${form}_${businessDaysBack(i % 5).replace(/-/g, '')}_${i + 1}.pdf`,
      formCode: form,
      issuerName: ISSUERS[Math.floor(r() * ISSUERS.length)],
      status: failed ? 'Failed' : 'Generated',
      createdAt: `${businessDaysBack(i % 5)}T0${(i % 9) + 1}:15:00Z`,
    });
  }
  return out;
}
