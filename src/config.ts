// Both values are public by design: the publishable key ships in every
// browser that opens the app. The data is protected by login + row-level
// security in the database (supabase/schema.sql), not by hiding this key.
export const SUPABASE_URL = 'https://joomobxzhsvlfgcsckoj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pj1V9M0vAY90BwUgJCjfkg_ng0RLPLT';

// Users log in with a short username; Supabase Auth needs an email, so
// "adi" becomes "adi@trimaco-route.local". Accounts are created by an admin.
export const LOGIN_DOMAIN = 'trimaco-route.local';

export const isConfigured = !SUPABASE_PUBLISHABLE_KEY.startsWith('__');
