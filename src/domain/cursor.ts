export interface Cursor {
  at: string; // ISO 측정 시각
  id: number;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

/** 잘못된 커서는 null. 호출 측이 400 으로 바꾼다. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at)) || !Number.isInteger(v.id)) return null;
    return { at: v.at, id: v.id as number };
  } catch {
    return null;
  }
}
