export type PickType = 'PACKAGE' | 'PIECE' | 'REVIEW';

export interface ParsedOrderItem {
  sourceLine: number;
  barcode: string | null;
  name: string;
  groupKey: string;
  packageQuantity: number | null;
  pieceQuantity: number | null;
  pickType: PickType;
  pickQuantity: number;
  sortIndex: number;
}

export interface ParsedOrder {
  documentNumber: string;
  documentDate: string; // YYYY-MM-DD
  warehouse: string;
  items: ParsedOrderItem[];
  warnings: string[];
}
