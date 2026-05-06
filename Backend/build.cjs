const esbuild = require('esbuild');
const path = require('path');
const pkg = require('./package.json');

// Bundle only our source; let pkg snapshot real node_modules at runtime.
// Fastify (and many of its plugins) use dynamic require() patterns that don't
// survive single-file bundling, so every prod + dev dep stays external.
const external = Array.from(
  new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ])
);

esbuild.build({
  entryPoints: [path.join(__dirname, 'server.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(__dirname, 'dist-server', 'bundle.cjs'),
  external,
  define: {
    'import.meta.url': '__importMetaUrl',
  },
  banner: {
    js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  logLevel: 'info',
}).then(() => {
  console.log('esbuild bundle complete: dist-server/bundle.cjs');
  console.log('External packages (left for pkg to snapshot):', external.join(', '));
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
