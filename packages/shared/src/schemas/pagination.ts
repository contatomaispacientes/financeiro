/** Formato das listas da API (stack.md): `{ data, meta: { page, pageSize, total } }`. */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}
