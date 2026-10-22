const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const pluginRoot = path.dirname(path.dirname(require.resolve('@bglocation/capacitor')));

async function buildFrontend() {
    await Promise.all([
        esbuild.build({
            entryPoints: [path.join(__dirname, 'background-location.js')],
            bundle: true,
            format: 'iife',
            target: 'es2020',
            outfile: path.join(projectRoot, 'public', 'background-location.bundle.js')
        }),
        esbuild.build({
            entryPoints: [path.join(__dirname, 'speech-synthesis.js')],
            bundle: true,
            format: 'iife',
            target: 'es2020',
            outfile: path.join(projectRoot, 'public', 'speech-synthesis.bundle.js')
        }),
        esbuild.build({
            entryPoints: [path.join(__dirname, 'device-info.js')],
            bundle: true,
            format: 'iife',
            target: 'es2020',
            outfile: path.join(projectRoot, 'public', 'device-info.bundle.js')
        }),
        esbuild.build({
            entryPoints: [path.join(__dirname, 'push-notifications.js')],
            bundle: true,
            format: 'iife',
            target: 'es2020',
            outfile: path.join(projectRoot, 'public', 'push-notifications.bundle.js')
        })
    ]);

    fs.copyFileSync(
        path.join(pluginRoot, 'LICENSE.md'),
        path.join(projectRoot, 'public', 'bglocation-license.md')
    );
}

buildFrontend().catch((error) => {
    console.error('No se pudieron compilar los bundles de Capacitor:', error);
    process.exitCode = 1;
});
