import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'pdfjs-dist');
const destination = path.join(root, 'pdfjs');

await mkdir(destination, { recursive: true });

// The runtime and worker are required. Optional resource directories vary
// between pdfjs-dist releases, so only copy them when the installed package
// actually ships them (for example, some releases omit /wasm).
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
  const sourceFile = path.join(source, 'build', file);
  await access(sourceFile);
  await cp(sourceFile, path.join(destination, file));
}

for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  const sourceDirectory = path.join(source, directory);
  try {
    await access(sourceDirectory);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`Skipping optional PDF.js asset directory: ${directory}`);
      continue;
    }
    throw error;
  }
  await cp(sourceDirectory, path.join(destination, directory), { recursive: true });
}

console.log('Copied available PDF.js runtime assets to /pdfjs.');
