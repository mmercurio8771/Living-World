/**
 * Packs the Vite build into one self-contained HTML file (dist/living-world.html)
 * that runs from disk with no server, and an artifact fragment (no html/head/body)
 * for hosted previews. Run after `vite build`.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = join(dist, 'assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
const css = readdirSync(assets).filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one js chunk, found ${js.length}: ${js.join(', ')}`);
const code = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

// pieces of the built page we keep verbatim
const fonts = html.match(/<link[^>]+rel="stylesheet"[^>]*>/)?.[0] ?? '';
const preconnects = (html.match(/<link rel="preconnect"[^>]*>/g) ?? []).join('\n    ');
const favicon = html.match(/<link rel="icon"[^>]*>/)?.[0] ?? '';
const body = html.match(/<body>([\s\S]*?)<script/)?.[1]?.trim() ?? '<canvas id="world"></canvas>\n    <div id="ui"></div>';

const standalone = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Living World</title>
    <meta name="description" content="A window into a tiny evolving ecosystem." />
    ${preconnects}
    ${fonts}
    ${favicon}
    <style>
${style}
    </style>
  </head>
  <body>
    ${body}
    <script type="module">
${code}
    </script>
  </body>
</html>
`;
writeFileSync(join(dist, 'living-world.html'), standalone);

const fragment = `<title>Living World</title>
${fonts}
<style>
${style}
</style>
${body}
<script type="module">
${code}
</script>
`;
const out = process.argv[2];
if (out) writeFileSync(out, fragment);
console.log(`dist/living-world.html ${(standalone.length / 1024).toFixed(0)} kB${out ? `, fragment → ${out}` : ''}`);
