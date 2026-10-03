// Creates a compliance analyst for the Investigation Assistant (admin/ app).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-analyst.ts analyst@example.com 'long-password'
//
// Staff accounts are email accounts with app_metadata.staff = true (so they get
// no customer wallet) plus a public.staff row. Public email sign-up is refused
// by the database, so this service-role script is the only way in (TC-P4-INV-01).
import { createClient } from '@supabase/supabase-js';

async function main() {
  const [email, password] = process.argv.slice(2);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !password || password.length < 12 || !url || !key) {
    console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-analyst.ts <email> <password, 12+ chars>');
    process.exit(2);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { staff: true } });
  if (error) throw error;
  const { error: staffError } = await admin.from('staff').insert({ user_id: data.user.id, email });
  if (staffError) throw staffError;
  console.log(`Analyst ${email} created (${data.user.id}).`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
