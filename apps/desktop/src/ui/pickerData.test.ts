import { READY_TO_ASSIGN } from '@hafb/engine';
import { describe, expect, it } from 'vitest';
import { buildSamplePlan } from '../design/sample.ts';
import { categoryPickerData, payeeGroups, SPLIT_ID, TRANSFER_GROUP_ID } from './pickerData.ts';

const { plan, today } = buildSamplePlan();

describe('payeeGroups', () => {
  it('lists transfer payees first, then saved payees alphabetically', () => {
    const groups = payeeGroups(plan);
    expect(groups.map((g) => g.label)).toEqual(['Payments & Transfers', 'Saved Payees']);
    expect(groups[0]?.id).toBe(TRANSFER_GROUP_ID);
    const transfers = groups[0]?.options.map((o) => o.label) ?? [];
    expect(transfers).toContain('Transfer : Everyday Checking');
    expect(transfers.every((l) => l.startsWith('Transfer : '))).toBe(true);
    const saved = groups[1]?.options.map((o) => o.label) ?? [];
    expect(saved).toEqual([...saved].sort((a, b) => a.localeCompare(b)));
    expect(saved).toContain('Fresh Market');
    expect(saved.some((l) => l.startsWith('Transfer : '))).toBe(false);
  });

  it("leaves out the register's own account from the transfer list", () => {
    const checking = plan.accounts.find((a) => a.name === 'Everyday Checking');
    if (!checking) throw new Error('fixture');
    const transfers = payeeGroups(plan, { excludeAccountId: checking.id })[0]?.options.map((o) => o.label) ?? [];
    expect(transfers).not.toContain('Transfer : Everyday Checking');
    expect(transfers).toContain('Transfer : Visa Rewards');
  });

  it('can search transfers by account name alone', () => {
    const option = payeeGroups(plan)[0]?.options.find((o) => o.label === 'Transfer : Rainy Day Savings');
    expect(option?.keywords).toContain('Rainy Day Savings');
  });
});

describe('categoryPickerData', () => {
  const data = categoryPickerData(plan, '2026-10', today);

  it('starts with Inflow: Ready to Assign, then plan groups in order', () => {
    expect(data.groups[0]?.label).toBe('Inflow');
    expect(data.groups[0]?.options[0]).toMatchObject({ id: READY_TO_ASSIGN, label: 'Ready to Assign' });
    expect(data.groups.slice(1).map((g) => g.label)).toEqual(['Bills', 'Everyday', 'True Expenses', 'Goals', 'Fun']);
  });

  it('leaves out credit card payment categories and hidden groups', () => {
    const labels = data.groups.flatMap((g) => g.options.map((o) => o.label));
    expect(labels).not.toContain('Visa Rewards');
    expect(data.groups.map((g) => g.label)).not.toContain('Hidden Categories');
  });

  it('carries each category’s Available amount, and Ready to Assign’s', () => {
    const dining = data.groups.flatMap((g) => g.options).find((o) => o.label === 'Dining Out');
    if (!dining) throw new Error('fixture');
    expect(data.available.get(dining.id)).toBe(-8621);
    expect(data.available.get(READY_TO_ASSIGN)).toBe(87801);
  });

  it('adds a Split option when asked', () => {
    const withSplit = categoryPickerData(plan, '2026-10', today, { allowSplit: true });
    const last = withSplit.groups[withSplit.groups.length - 1];
    expect(last?.options.map((o) => o.id)).toEqual([SPLIT_ID]);
  });
});
