#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jpeg from 'jpeg-js';

const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const photosRoot = join(e2eRoot, '.work', 'photos', 'admin@example.com');
const cacheRoot = join(e2eRoot, '.work', 'cache');
const dbRoot = join(e2eRoot, '.work', 'db');
const NO_EXIF_WHEN = new Date('2023-03-15T09:00:00.000Z');

export const FIXTURES = [
  { file: 'path.jpg', datetime: '2026:08:31 10:00:00', rgb: [200, 48, 48] },
  { file: 'week-late.jpg', datetime: '2026:08:26 10:00:00', rgb: [220, 140, 40] },
  { file: 'yesterday.jpg', datetime: '2026:08:25 10:00:00', rgb: [200, 90, 90] },
  { file: 'week-start.jpg', datetime: '2026:08:24 10:00:00', rgb: [220, 200, 48] },
  { file: 'last-week.jpg', datetime: '2026:08:19 10:00:00', rgb: [180, 120, 40] },
  { file: 'july.jpg', datetime: '2026:07:15 10:00:00', rgb: [40, 160, 80] },
  { file: 'june.jpg', datetime: '2026:06:10 10:00:00', rgb: [48, 180, 140] },
  { file: 'spring.jpg', datetime: '2026:04:12 10:00:00', rgb: [80, 200, 120] },
  { file: 'previous-year.jpg', datetime: '2025:12:20 10:00:00', rgb: [40, 80, 200] },
  { file: 'fall.jpg', datetime: '2025:10:08 10:00:00', rgb: [200, 100, 40] },
  { file: 'no-exif.jpg', datetime: null, rgb: [140, 48, 180] },
];

function solidJpeg(r, g, b) {
  const width = 48;
  const height = 48;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 90).data;
}

function asciiField(tag, text, dataOffset) {
  const bytes = Buffer.from(`${text}\0`, 'ascii');
  const entry = Buffer.alloc(12);
  entry.writeUInt16LE(tag, 0);
  entry.writeUInt16LE(2, 2); // ASCII
  entry.writeUInt32LE(bytes.length, 4);
  entry.writeUInt32LE(dataOffset, 8);
  return { entry, bytes };
}

/** APP1 Exif IFD that goexif can read (piexifjs + jpeg-js is not). */
function withDateTimeOriginal(jpegBuf, datetime) {
  if (jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) {
    throw new Error('expected JPEG SOI');
  }
  const tiffHeaderSize = 8;
  const ifd0Count = 1;
  const ifd0 = tiffHeaderSize;
  const ifd0Next = ifd0 + 2 + 12 * ifd0Count;
  const exifIfd = ifd0Next + 4;
  const exifCount = 1;
  const exifNext = exifIfd + 2 + 12 * exifCount;
  const stringOffset = exifNext + 4;
  const dateField = asciiField(0x9003, datetime, stringOffset);
  const tiff = Buffer.alloc(stringOffset + dateField.bytes.length);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0, 4);
  tiff.writeUInt16LE(ifd0Count, ifd0);
  tiff.writeUInt16LE(0x8769, ifd0 + 2); // ExifOffset
  tiff.writeUInt16LE(4, ifd0 + 4);
  tiff.writeUInt32LE(1, ifd0 + 6);
  tiff.writeUInt32LE(exifIfd, ifd0 + 10);
  tiff.writeUInt32LE(0, ifd0Next);
  tiff.writeUInt16LE(exifCount, exifIfd);
  dateField.entry.copy(tiff, exifIfd + 2);
  tiff.writeUInt32LE(0, exifNext);
  dateField.bytes.copy(tiff, stringOffset);

  const exifBody = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const app1 = Buffer.alloc(4 + exifBody.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(2 + exifBody.length, 2);
  exifBody.copy(app1, 4);
  return Buffer.concat([jpegBuf.subarray(0, 2), app1, jpegBuf.subarray(2)]);
}

function fixtureByName(file) {
  const spec = FIXTURES.find((item) => item.file === file);
  if (!spec) {
    throw new Error(`Unknown fixture ${file}`);
  }
  return spec;
}

export async function writeFixture(spec, datetime = spec.datetime) {
  await mkdir(photosRoot, { recursive: true });
  const dest = join(photosRoot, spec.file);
  let body = solidJpeg(...spec.rgb);
  if (datetime) {
    body = withDateTimeOriginal(body, datetime);
  }
  await writeFile(dest, body);
  if (!datetime) {
    await setNoExifTimes(dest);
  }
  return dest;
}

export async function setNoExifTimes(filePath) {
  await utimes(filePath, NO_EXIF_WHEN, NO_EXIF_WHEN);
  if (process.platform !== 'win32') return;
  const escaped = filePath.replaceAll("'", "''");
  const stamp = '2023-03-15 09:00:00';
  const script = [
    `$i = Get-Item -LiteralPath '${escaped}'`,
    `$utc = [DateTime]::SpecifyKind([DateTime]'${stamp}', 'Utc')`,
    `$i.CreationTimeUtc = $utc`,
    `$i.LastWriteTimeUtc = $utc`,
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'failed to set CreationTime');
  }
}

export async function prepareAll() {
  await mkdir(cacheRoot, { recursive: true });
  // The backend image runs as uid 1000, and Docker creates a missing
  // bind-mount directory as root. Creating it here, as the developer, keeps
  // the container able to write the SQLite catalog on Linux.
  await mkdir(dbRoot, { recursive: true });
  await rm(photosRoot, { recursive: true, force: true });
  await mkdir(photosRoot, { recursive: true });
  for (const spec of FIXTURES) {
    await writeFixture(spec);
  }
}

export async function setExif(file, datetime) {
  await writeFixture(fixtureByName(file), datetime);
}

export async function removePhoto(file) {
  await unlink(join(photosRoot, file));
}

export async function relocatePhoto(from, to) {
  await rename(join(photosRoot, from), join(photosRoot, to));
}

const isMain =
  !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const [, , cmd, file, destOrDate, ...rest] = process.argv;
  if (cmd === 'set-exif') {
    const datetime = [destOrDate, ...rest].filter(Boolean).join(' ');
    if (!file || !datetime) {
      console.error(
        'Usage: node scripts/prepare-fixtures.mjs set-exif <file.jpg> <YYYY:MM:DD HH:MM:SS>',
      );
      process.exit(1);
    }
    await setExif(file, datetime);
  } else if (cmd === 'remove-photo') {
    if (!file) {
      console.error('Usage: node scripts/prepare-fixtures.mjs remove-photo <file.jpg>');
      process.exit(1);
    }
    await removePhoto(file);
  } else if (cmd === 'relocate-photo') {
    if (!file || !destOrDate) {
      console.error('Usage: node scripts/prepare-fixtures.mjs relocate-photo <from.jpg> <to.jpg>');
      process.exit(1);
    }
    await relocatePhoto(file, destOrDate);
  } else {
    await prepareAll();
  }
}
