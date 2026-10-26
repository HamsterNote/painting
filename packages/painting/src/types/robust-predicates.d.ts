// robust-predicates@2.0.4 references an index.d.ts that is absent from its package.
declare module 'robust-predicates' {
  export function orient2d(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number
  ): number;
}
