export const NODE_MAJOR = 22;
export const NODE_VERSION = '22.23.2';
export const GO_VERSION = '1.23.6';
export const PNPM_VERSION = '9.15.9';

export function parseNodeMajor(versionText) {
  const m = String(versionText || '').match(/v?(\d+)\./);
  return m ? Number(m[1]) : null;
}

export function parseGoVersion(versionText) {
  const m = String(versionText || '').match(/go(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0) };
}

export function nodeSatisfies(versionText) {
  const major = parseNodeMajor(versionText);
  return major != null && major >= NODE_MAJOR;
}

export function goSatisfies(versionText) {
  const v = parseGoVersion(versionText);
  if (!v) return false;
  if (v.major > 1) return true;
  if (v.major < 1) return false;
  return v.minor >= 23;
}

export function linuxArch(arch) {
  if (arch === 'arm64') return { node: 'arm64', go: 'arm64' };
  return { node: 'x64', go: 'amd64' };
}

export function distOs(platform = 'linux') {
  return platform === 'darwin' ? 'darwin' : 'linux';
}

export function nodeTarballUrl(arch, platform = 'linux') {
  const { node } = linuxArch(arch);
  const os = distOs(platform);
  return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${os}-${node}.tar.gz`;
}

export function goTarballUrl(arch, platform = 'linux') {
  const { go } = linuxArch(arch);
  const os = distOs(platform);
  return `https://go.dev/dl/go${GO_VERSION}.${os}-${go}.tar.gz`;
}
