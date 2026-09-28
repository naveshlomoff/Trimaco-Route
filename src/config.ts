// Both values are public by design: the publishable key ships in every
// browser that opens the app. The data is protected by row-level security in
// the database (supabase/schema.sql): a device sees nothing until an admin
// approves it, so hiding this key would add nothing.
export const SUPABASE_URL = 'https://joomobxzhsvlfgcsckoj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pj1V9M0vAY90BwUgJCjfkg_ng0RLPLT';

export const isConfigured = !SUPABASE_PUBLISHABLE_KEY.startsWith('__');
