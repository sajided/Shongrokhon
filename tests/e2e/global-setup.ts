import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

export default function globalSetup() {
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
