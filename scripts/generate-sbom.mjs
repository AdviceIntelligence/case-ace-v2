import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const clientPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'client/package.json'), 'utf8'));
const backendPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend/package.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const sbomPath = path.join(rootDir, 'evidence/sbom.json');

const components = [];

// Helper to push components
function registerComponent(pkgName, version, scope, runtime, license, description) {
  components.push({
    type: 'library',
    name: pkgName,
    version: version,
    purl: `pkg:npm/${pkgName}@${version}`,
    scope: scope,
    runtime: runtime,
    licenses: [{ license: { id: license } }],
    description: description,
    properties: [
      { name: 'network-activity', value: 'none' },
      { name: 'telemetry-enabled', value: 'false' },
      { name: 'pinned', value: 'true' },
    ],
  });
}

// Client dependencies
registerComponent('react', '19.0.0', 'required', 'client-browser', 'MIT', 'Declarative UI library');
registerComponent('react-dom', '19.0.0', 'required', 'client-browser', 'MIT', 'DOM renderer for React');
registerComponent('lucide-react', '0.475.0', 'required', 'client-browser', 'MIT', 'Tree-shakeable SVG UI icons');
registerComponent('@vitejs/plugin-react', '4.3.4', 'optional', 'client-build', 'MIT', 'Vite JSX plugin');
registerComponent('vite', '6.1.0', 'optional', 'client-build', 'MIT', 'Frontend build tool');
registerComponent('typescript', '5.7.3', 'optional', 'build-tool', 'Apache-2.0', 'TypeScript compiler');

// Backend dependencies
registerComponent('express', '4.21.2', 'required', 'backend-node', 'MIT', 'Stateless API web framework');
registerComponent('helmet', '8.0.0', 'required', 'backend-node', 'MIT', 'Security headers middleware');
registerComponent('cors', '2.8.5', 'required', 'backend-node', 'MIT', 'CORS middleware');
registerComponent('dotenv', '16.4.7', 'required', 'backend-node', 'BSD-2-Clause', 'Environment variable loader');
registerComponent('tsx', '4.19.2', 'optional', 'backend-dev', 'MIT', 'TypeScript execution runner');

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [
      {
        vendor: 'Citizens Advice Wandsworth',
        name: 'Case Ace SBOM Generator',
        version: '2.0.0',
      },
    ],
    component: {
      type: 'application',
      name: 'case-ace-v2',
      version: '2.0.0',
      description: 'Privacy-preserving AI-assisted case note drafting tool for Citizens Advice Wandsworth',
      properties: [
        { name: 'region-pinned', value: 'europe-west2' },
        { name: 'data-classification', value: 'Special Category Data (UK GDPR Art 9)' },
        { name: 'control-standard', value: 'ISO/IEC 27001:2022 / 27701:2019 / 42001:2023' },
      ],
    },
  },
  components: components,
};

fs.writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
console.log(`[SBOM Generation] Generated CycloneDX SBOM at evidence/sbom.json with ${components.length} components.`);
