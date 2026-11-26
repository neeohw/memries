import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  controlFile,
  dockerArgs,
  dpkgArgs,
  layout,
  packageName,
  parseArgs,
  prerequisites,
} from './build-deb.mjs';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

test('parseArgs defaults to the box', () => {
  const args = parseArgs([]);
  assert.equal(args.arch, 'arm64');
  assert.equal(args.out, 'dist/deb');
});

test('parseArgs reads every flag', () => {
  const args = parseArgs(['--out', 'build', '--arch', 'amd64', '--version', '1.2.3']);
  assert.deepEqual(args, { out: 'build', arch: 'amd64', version: '1.2.3', help: false });
});

// A bad version installs but can never be upgraded cleanly, which is worse
// than refusing it here.
test('parseArgs rejects a version Debian cannot order', () => {
  assert.throws(() => parseArgs(['--version', 'v1.0']), /must start with a digit/);
  assert.throws(() => parseArgs(['--arch', 'riscv']), /arm64 or amd64/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['--out']), /missing value/);
});

// What lands where is the part worth pinning: an installed path that moves
// silently breaks the web server config shipped beside it.
test('layout puts each file where the unit and the web config expect it', () => {
  const l = layout({ repoRoot });
  assert.deepEqual(Object.keys(l.binaries), ['usr/bin/memries-server', 'usr/bin/memries-indexer']);
  assert.deepEqual(Object.keys(l.files), [
    'etc/memries/config.yaml',
    'lib/systemd/system/memries.service',
    'usr/share/memries/nginx.conf',
    'usr/share/memries/nginx-sublocation.conf',
    'usr/share/memries/apache.conf',
  ]);
  // The SPA is copied wholesale: its filenames are content-hashed, so a list
  // of them here would rot on every build.
  assert.deepEqual(Object.keys(l.trees), ['usr/share/memries/www']);
});

test('every packaged source file exists in the repository', () => {
  const l = layout({ repoRoot });
  for (const src of [...Object.values(l.files), ...l.control.map(([, p]) => p)]) {
    assert.ok(existsSync(src), `missing ${src}`);
  }
});

// The paths the unit and the nginx config name have to be the paths the
// package installs, or the service starts and serves nothing.
test('the shipped unit and web config agree with the layout', () => {
  const unit = readFileSync(join(repoRoot, 'packaging', 'debian', 'memries.service'), 'utf8');
  assert.match(unit, /ExecStart=\/usr\/bin\/memries-server --config \/etc\/memries\/config\.yaml/);

  const nginx = readFileSync(join(repoRoot, 'packaging', 'web', 'nginx.conf'), 'utf8');
  assert.match(nginx, /root \/usr\/share\/memries\/www;/);
  // /auth is outside /api on purpose, so it has to be proxied by name too.
  assert.match(nginx, /\^\/\(api\|auth\)\//);

  const config = readFileSync(join(repoRoot, 'packaging', 'debian', 'config.yaml'), 'utf8');
  const port = nginx.match(/proxy_pass http:\/\/127\.0\.0\.1:(\d+);/)[1];
  assert.match(config, new RegExp(`addr: "127\\.0\\.0\\.1:${port}"`));
});

// Installing must be additive. A vhost on :80 matching `server_name _` takes
// every request that arrives by IP address, so on a box already serving
// something it either loses or turns the install into "disable the other
// site" — which is not ours to ask for (ADR 0030).
test('the web configs take a port of their own rather than competing for 80', () => {
  const nginx = readFileSync(join(repoRoot, 'packaging', 'web', 'nginx.conf'), 'utf8');
  const listen = [...nginx.matchAll(/^\s*listen\s+(?:\[::\]:)?(\d+)/gm)].map((m) => m[1]);
  assert.ok(listen.length > 0, 'the vhost must listen somewhere');
  assert.ok(
    listen.every((p) => p !== '80'),
    `listens on :80, which competes with the default site: ${listen}`,
  );
  assert.ok(!/default_server/.test(stripComments(nginx)), 'must not claim default_server');

  const apache = readFileSync(join(repoRoot, 'packaging', 'web', 'apache.conf'), 'utf8');
  assert.ok(!/<VirtualHost \*:80>/.test(apache), 'Apache vhost must not take :80 either');

  // public_url is the CORS allow-list and decides the cookie's Secure flag,
  // so it has to name the origin the browser really uses — this port.
  const config = readFileSync(join(repoRoot, 'packaging', 'debian', 'config.yaml'), 'utf8');
  assert.match(config, new RegExp(`public_url: http://localhost:${listen[0]}`));
});

// Mounting under a sublocation of an existing site is the other supported
// shape, and it only works if the prefix is stripped before the API sees it.
test('the sublocation snippet strips its prefix and serves both halves', () => {
  const conf = readFileSync(join(repoRoot, 'packaging', 'web', 'nginx-sublocation.conf'), 'utf8');
  assert.match(conf, /location = \/memries \{[\s\S]*return 301 \/memries\//);
  assert.match(conf, /alias \/usr\/share\/memries\/www\//);
  // The asset block captures the rest of the path so alias can rebuild it;
  // a bare alias with no capture 404s every hashed file.
  assert.match(conf, /location ~ \^\/memries\/assets\/\(\.\+\)\$ \{[\s\S]*?alias \/usr\/share\/memries\/www\/assets\/\$1;/);
  // /auth is outside /api, so both are proxied.
  assert.match(conf, /location ~ \^\/memries\/\(api\|auth\)\//);
  assert.match(conf, /rewrite \^\/memries\/\(\.\*\)\$ \/\$1 break;/);
  // Originals stream; buffering one to disk would stall every seek.
  assert.match(conf, /proxy_buffering off;/);
});

// Nothing we ship should tell an admin to delete a config that is not ours.
test('no shipped file asks for another site to be removed', () => {
  for (const file of [
    join(repoRoot, 'packaging', 'web', 'nginx.conf'),
    join(repoRoot, 'packaging', 'web', 'apache.conf'),
    join(repoRoot, 'packaging', 'debian', 'postinst'),
    join(repoRoot, 'README.md'),
  ]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(
      !/rm\s+(-\w+\s+)*\/etc\/nginx\/sites-enabled\/default/.test(text),
      `${file} tells the admin to delete the default site`,
    );
    assert.ok(!/a2dissite\s+000-default/.test(text), `${file} disables Apache's default site`);
  }
});

function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

// Shipping a session key in a package would give every install the same one.
test('the packaged config leaves the session key to be generated', () => {
  const config = readFileSync(join(repoRoot, 'packaging', 'debian', 'config.yaml'), 'utf8');
  assert.match(config, /replace-with-32-byte-random-base64/);
  const postinst = readFileSync(join(repoRoot, 'packaging', 'debian', 'postinst'), 'utf8');
  assert.match(postinst, /replace-with-32-byte-random-base64/);
  // Only while the placeholder is there, so reinstalling never signs
  // everybody out.
  assert.match(postinst, /grep -q 'replace-with-32-byte-random-base64'/);
});

// Purge may take what can be rebuilt. It must never take the photos.
test('purge removes the catalog and the cache but never the library', () => {
  const postrm = readFileSync(join(repoRoot, 'packaging', 'debian', 'postrm'), 'utf8');
  assert.match(postrm, /rm -rf \/var\/lib\/memries \/var\/cache\/memries/);
  assert.ok(!/rm -rf \/media/.test(postrm), 'purge must not touch mounted disks');
  assert.ok(!/library\.roots/.test(postrm.replace(/#.*/g, '')), 'purge must not read roots');
});

test('controlFile fills the template', () => {
  const out = controlFile('Version: {{VERSION}}\nArchitecture: {{ARCH}}\nInstalled-Size: {{SIZE}}\n', {
    version: '0.1.0',
    arch: 'arm64',
    sizeKiB: 42,
  });
  assert.match(out, /Version: 0\.1\.0/);
  assert.match(out, /Architecture: arm64/);
  assert.match(out, /Installed-Size: 42/);
  assert.ok(!out.includes('{{'), 'every placeholder should be filled');
});

test('the control template declares what the binaries need at runtime', () => {
  const control = readFileSync(join(repoRoot, 'packaging', 'debian', 'control'), 'utf8');
  // libvips is linked in; ffmpeg is run as a program (ADR 0025, ADR 0029).
  assert.match(control, /^Depends:.*libvips42t64/m);
  assert.match(control, /^Depends:.*ffmpeg/m);
});

test('packageName follows the Debian convention', () => {
  assert.equal(packageName('0.1.0', 'arm64'), 'memries_0.1.0_arm64.deb');
});

// --root-owner-group is what lets a checkout build a package whose files are
// owned by root without the build itself running as root.
test('dpkgArgs builds without needing root', () => {
  assert.deepEqual(dpkgArgs('/stage', '/out.deb'), [
    '--build',
    '--root-owner-group',
    '/stage',
    '/out.deb',
  ]);
});

test('dockerArgs runs the same build in a matched container', () => {
  const args = dockerArgs('/repo', 'dist/deb/stage', 'dist/deb/x.deb');
  assert.ok(args.includes('debian:trixie'));
  assert.equal(args[args.indexOf('-v') + 1], '/repo:/work');
  assert.ok(args.includes('dpkg-deb'));
  assert.ok(args.includes('--root-owner-group'));
});

test('prerequisites name the command that makes each missing piece', () => {
  const needed = prerequisites({ repoRoot });
  assert.ok(needed.some((p) => p.path.endsWith(join('dist', 'pi', 'memries-server')) && p.how === 'make build-pi'));
  assert.ok(needed.some((p) => p.path.endsWith('index.html') && /pnpm/.test(p.how)));
});
