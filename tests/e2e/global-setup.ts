import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

export default async function globalSetup() {
  // Phase 2: payments are scored by the ML container (npm run ml:up).
  const ml = await fetch('http://127.0.0.1:8710/health').catch(() => null);
  if (!ml?.ok) throw new Error('ML service not reachable on :8710; run `npm run ml:up` first');

  // Known state: seeded personas and unused test phone numbers.
  execSync('supabase db reset', { cwd: root, stdio: 'ignore' });

  // QR images for upload tests, plus .y4m videos for Chromium's fake camera.
  execSync('npx tsx scripts/gen-qr-fixtures.ts', { cwd: root, stdio: 'ignore' });
  for (const name of ['valid-static-mlegit']) {
    const png = join(root, 'fixtures', 'qr', `${name}.png`);
    const y4m = join(root, 'fixtures', 'qr', `${name}.y4m`);
    if (!existsSync(y4m)) {
      execSync(`ffmpeg -y -loglevel error -loop 1 -i "${png}" -vf "scale=480:480,pad=640:480:80:0:white" -t 1 -r 10 -pix_fmt yuv420p "${y4m}"`);
    }
  }
}
