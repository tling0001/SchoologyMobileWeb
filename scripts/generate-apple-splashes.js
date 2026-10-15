'use strict';

const fs = require('node:fs');
const path = require('node:path');
const splashHandler = require('../lib/apple-splash.js');

const root = path.resolve(__dirname, '..');
const logo = splashHandler.decodePng(fs.readFileSync(path.join(root, 'assets', 'logo_schoology.png')));
const outputDirectory = path.join(root, 'assets', 'apple-splash');
const dimensions = [[640,1136],[750,1334],[828,1792],[1125,2436],[1242,2208],[1170,2532],[1179,2556],[1206,2622],[1242,2688],[1284,2778],[1290,2796],[1320,2868],[1536,2048],[1620,2160],[1668,2224],[1668,2388],[2048,2732],[1136,640],[1334,750],[1792,828],[2436,1125],[2208,1242],[2532,1170],[2688,1242],[2048,1536],[2224,1668],[2388,1668],[2732,2048],[2160,1620]];

fs.mkdirSync(outputDirectory, { recursive: true });
for (const [width, height] of dimensions) {
  const filename = `apple-touch-startup-image-${width}x${height}.png`;
  const outputPath = path.join(outputDirectory, filename);
  fs.writeFileSync(outputPath, splashHandler.renderSplash(logo, width, height));
  process.stdout.write(`Generated ${path.relative(root, outputPath)}\\n`);
}
