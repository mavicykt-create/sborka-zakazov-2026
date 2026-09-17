import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { countAssignments, distributeItems } from '../src/modules/workflow/distribution.js';
import {
  assertItemTransition,
  isFinalItemStatus,
  previousStatusForUndo,
} from '../src/modules/workflow/statusTransitions.js';

describe('distributeItems', () => {
  const items = Array.from({ length: 48 }, (_, index) => `item-${index + 1}`);

  it.each([
    [2, [24, 24]],
    [3, [16, 16, 16]],
    [5, [10, 10, 10, 9, 9]],
  ])('distributes 48 positions between %i workers', (workerCount, expected) => {
    const workers = Array.from({ length: workerCount }, (_, index) => `worker-${index + 1}`);
    const assignments = distributeItems(items, workers);
    const counts = countAssignments(assignments);

    expect(assignments).toHaveLength(48);
    expect(new Set(assignments.map((assignment) => assignment.itemId)).size).toBe(48);
    expect(workers.map((worker) => counts[worker])).toEqual(expected);
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  });

  it('rejects an empty worker list', () => {
    expect(() => distributeItems(items, [])).toThrow('хотя бы одного сборщика');
  });
});

describe('item status transitions', () => {
  it('accepts the warehouse happy path', () => {
    expect(() => assertItemTransition('ASSIGNED', 'ACTIVE')).not.toThrow();
    expect(() => assertItemTransition('ACTIVE', 'PICKED')).not.toThrow();
    expect(isFinalItemStatus('PICKED')).toBe(true);
  });

  it('rejects skipped steps and supports one-step undo', () => {
    expect(() => assertItemTransition('ASSIGNED', 'PICKED')).toThrow('Недопустимый переход');
    expect(previousStatusForUndo('NOT_FOUND')).toBe('ACTIVE');
    expect(previousStatusForUndo('ACTIVE')).toBe('ASSIGNED');
    expect(() => previousStatusForUndo('PENDING')).toThrow('нельзя отменить');
  });
});

describe('password hashing', () => {
  it('stores a salted scrypt hash instead of plaintext', async () => {
    const encoded = await hashPassword('warehouse-secret');
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain('warehouse-secret');
    expect(await verifyPassword('warehouse-secret', encoded)).toBe(true);
    expect(await verifyPassword('wrong-password', encoded)).toBe(false);
  });
});
