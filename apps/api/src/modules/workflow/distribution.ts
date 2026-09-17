export interface ItemAssignment {
  itemId: string;
  workerId: string;
}

export function distributeItems(itemIds: string[], workerIds: string[]): ItemAssignment[] {
  if (workerIds.length === 0) throw new Error('Нужно выбрать хотя бы одного сборщика');

  return itemIds.map((itemId, index) => ({
    itemId,
    workerId: workerIds[index % workerIds.length],
  }));
}

export function countAssignments(assignments: ItemAssignment[]): Record<string, number> {
  return assignments.reduce<Record<string, number>>((counts, assignment) => {
    counts[assignment.workerId] = (counts[assignment.workerId] ?? 0) + 1;
    return counts;
  }, {});
}
