export interface R<T> {
  code: number;
  key: string | null;
  msg: string | null;
  data: T | null;
}