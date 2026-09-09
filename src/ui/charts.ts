/** Tiny canvas charts drawn to match the glass UI. */

export interface Series {
  values: number[];
  color: string;
  fill?: boolean;
  width?: number;
}

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  if (w === 0 || h === 0) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** A sparkline: one series, auto-scaled, optional soft fill. */
export function sparkline(canvas: HTMLCanvasElement, values: number[], color: string, opts: { fill?: boolean; min?: number; max?: number; marker?: number } = {}): void {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  if (values.length < 2) return;
  let min = opts.min ?? Infinity, max = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 1e-6) {
    max = min + 1;
    min -= 1;
  }
  const pad = 2;
  const xs = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const ys = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(values[0]));
  for (let i = 1; i < values.length; i++) ctx.lineTo(xs(i), ys(values[i]));
  if (opts.fill) {
    ctx.save();
    ctx.lineTo(xs(values.length - 1), h);
    ctx.lineTo(xs(0), h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xs(i), ys(values[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (opts.marker !== undefined) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, ys(opts.marker));
    ctx.lineTo(w, ys(opts.marker));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Multi-series area chart with a faint grid; each series normalised to its own max if `independent`. */
export function areaChart(canvas: HTMLCanvasElement, series: Series[], opts: { independent?: boolean; labels?: string[] } = {}): void {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const padL = 4, padR = 4, padT = 6, padB = 4;
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }
  let globalMax = 1;
  if (!opts.independent) for (const sr of series) for (const v of sr.values) if (v > globalMax) globalMax = v;
  for (const sr of series) {
    const vals = sr.values;
    if (vals.length < 2) continue;
    let max = globalMax;
    if (opts.independent) {
      max = 1;
      for (const v of vals) if (v > max) max = v;
    }
    const xs = (i: number) => padL + (i / (vals.length - 1)) * (w - padL - padR);
    const ys = (v: number) => h - padB - (v / max) * (h - padT - padB);
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(xs(i), ys(vals[i]));
    if (sr.fill) {
      ctx.save();
      ctx.lineTo(xs(vals.length - 1), h - padB);
      ctx.lineTo(xs(0), h - padB);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, h);
      g.addColorStop(0, sr.color + '66');
      g.addColorStop(1, sr.color + '05');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(xs(0), ys(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(xs(i), ys(vals[i]));
    }
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = sr.width ?? 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Horizontal trait bar: value within [min,max], population mean marker, ±1sd band. */
export function traitBar(canvas: HTMLCanvasElement, value: number, min: number, max: number, mean: number, sd: number, color: string): void {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const x = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * w;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, h / 2 - 2, w, 4);
  // population band
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  const a = x(mean - sd), b = x(mean + sd);
  ctx.fillRect(a, h / 2 - 2, Math.max(2, b - a), 4);
  // mean tick
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x(mean) - 0.5, h / 2 - 6, 1, 12);
  // value
  ctx.beginPath();
  ctx.arc(x(value), h / 2, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Circular hue swatch. */
export function hueColor(h: number, s = 0.5, l = 0.5): string {
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
