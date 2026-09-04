/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
  readonly DOCUMENSO_API_KEY: string;
  readonly DOCUMENSO_TEMPLATE_ID: string;
  readonly DOCUMENSO_WEBHOOK_SECRET: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_REFRESH_TOKEN: string;
  readonly GOOGLE_CALENDAR_ID: string | undefined;
  readonly RESEND_API_KEY: string;
  readonly EMAIL_FROM: string;
  readonly OWNER_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
