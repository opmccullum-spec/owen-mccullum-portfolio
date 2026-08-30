import { supabaseAdmin } from "./admin";

/**
 * Belt-and-suspenders: the DB trigger (see supabase/schema.sql) normally
 * creates a profiles row on signup, but it can't retroactively fix accounts
 * created before schema.sql was applied (or before the trigger existed at
 * all). Call this after any successful login to guarantee a row exists,
 * without touching one that already exists (so a later login never resets
 * is_admin or full_name back to default).
 */
export async function ensureProfile(user: { id: string; email?: string | null }) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: user.id, email: user.email ?? "" }, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    console.error("ensureProfile upsert failed:", error.code, error.message, error.details);
  }
}
