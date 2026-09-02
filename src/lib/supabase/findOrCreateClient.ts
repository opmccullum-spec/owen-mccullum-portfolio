import { supabaseAdmin } from "./admin";
import { ensureProfile } from "./ensureProfile";

/**
 * Find the Supabase auth user for this email, creating one (and its
 * profiles row) if it doesn't exist yet — lets Owen invoice/contract
 * anyone, not just clients who've already logged into the portal.
 * Known limitation: the "already exists" fallback only searches the
 * first 1000 users, fine at this business's scale.
 */
export async function findOrCreateClient(email: string) {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  let authUser = created?.user;
  if (createErr) {
    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const existing = list.users.find((u) => u.email === email);
    if (!existing) throw createErr;
    authUser = existing;
  }

  await ensureProfile(authUser!);
  return authUser!;
}
