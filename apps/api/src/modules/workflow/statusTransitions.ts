export type WorkflowItemStatus = 'PENDING' | 'ASSIGNED' | 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED';
export type FinalItemStatus = 'PICKED' | 'NOT_FOUND' | 'SKIPPED';

const allowedTransitions: Record<WorkflowItemStatus, WorkflowItemStatus[]> = {
  PENDING: [],
  ASSIGNED: ['ACTIVE'],
  ACTIVE: ['PICKED', 'NOT_FOUND', 'SKIPPED'],
  PICKED: [],
  NOT_FOUND: [],
  SKIPPED: [],
};

export function isFinalItemStatus(status: WorkflowItemStatus): status is FinalItemStatus {
  return status === 'PICKED' || status === 'NOT_FOUND' || status === 'SKIPPED';
}

export function assertItemTransition(current: WorkflowItemStatus, next: WorkflowItemStatus): void {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`Недопустимый переход позиции: ${current} -> ${next}`);
  }
}

export function previousStatusForUndo(current: WorkflowItemStatus): WorkflowItemStatus {
  if (isFinalItemStatus(current)) return 'ACTIVE';
  if (current === 'ACTIVE') return 'ASSIGNED';
  throw new Error(`Статус ${current} нельзя отменить`);
}
