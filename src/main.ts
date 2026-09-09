import './style.css';
import { App, seedFromLocation } from './app';
import { UI } from './ui/ui';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const app = new App(canvas, seedFromLocation());
const ui = new UI(app, document.getElementById('ui') as HTMLElement);

// picking
let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
  downT = performance.now();
});
canvas.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved > 6 || performance.now() - downT > 400 || e.button !== 0) return;
  if (ui.consumeClick(e.clientX, e.clientY)) return;
  const o = app.pick(e.clientX, e.clientY);
  app.select(o);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  app.hovered = app.pick(e.clientX, e.clientY, 18);
});
canvas.addEventListener('pointerleave', () => (app.hovered = null));

function loop(now: number) {
  app.frame(now);
  ui.update();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy for poking at the world from the console
(window as unknown as { lw: App }).lw = app;
