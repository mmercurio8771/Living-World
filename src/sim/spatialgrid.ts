import { Organism } from './organism';

/** Uniform hash grid for neighbour queries. Rebuilt every tick; cheap at our scale. */
export class SpatialGrid {
  private cols: number;
  private cells: Organism[][];
  constructor(private size: number, private cellSize: number) {
    this.cols = Math.ceil(size / cellSize);
    this.cells = [];
    for (let i = 0; i < this.cols * this.cols; i++) this.cells.push([]);
  }

  clear(): void {
    for (const c of this.cells) c.length = 0;
  }

  insert(o: Organism): void {
    const i = this.cellCoord(o.x), j = this.cellCoord(o.y);
    this.cells[j * this.cols + i].push(o);
  }

  private cellCoord(v: number): number {
    const c = (v / this.cellSize) | 0;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  /** Fill `out` with organisms within `radius` (squared distances in `outD2`). Returns the count. No allocations. */
  collect(x: number, y: number, radius: number, out: Organism[], outD2: Float64Array): number {
    const i0 = this.cellCoord(x - radius), i1 = this.cellCoord(x + radius);
    const j0 = this.cellCoord(y - radius), j1 = this.cellCoord(y + radius);
    const r2 = radius * radius;
    let n = 0;
    const max = out.length;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.cells[j * this.cols + i];
        for (let k = 0; k < cell.length; k++) {
          const o = cell[k];
          const dx = o.x - x, dy = o.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            if (n >= max) return n;
            out[n] = o;
            outD2[n] = d2;
            n++;
          }
        }
      }
    }
    return n;
  }

  /** Visit every organism within `radius` of (x, y). Callback returns true to stop early. */
  query(x: number, y: number, radius: number, visit: (o: Organism, d2: number) => boolean | void): void {
    const i0 = this.cellCoord(x - radius), i1 = this.cellCoord(x + radius);
    const j0 = this.cellCoord(y - radius), j1 = this.cellCoord(y + radius);
    const r2 = radius * radius;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.cells[j * this.cols + i];
        for (let k = 0; k < cell.length; k++) {
          const o = cell[k];
          const dx = o.x - x, dy = o.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            if (visit(o, d2) === true) return;
          }
        }
      }
    }
  }
}
