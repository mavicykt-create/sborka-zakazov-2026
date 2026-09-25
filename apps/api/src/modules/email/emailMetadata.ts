function money(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[\s\u00a0]/gu, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseEmailOrderMetadata(subject: string, text: string, filename = '') {
  const source = `${subject} ${text} ${filename}`;
  const number =
    source.match(/заказ\s*№\s*(?:НФ-)?(\d+)/iu)?.[1] ??
    source.match(/№\s*(?:НФ-)?(\d+)/iu)?.[1] ??
    filename.match(/НФ-(\d+)/iu)?.[1] ??
    null;
  const amount = money(source.match(/сумма\s*[:—-]?\s*([\d\s\u00a0]+(?:[,.]\d{1,2})?)/iu)?.[1]);
  return { orderNumber: number, orderTotal: amount };
}
