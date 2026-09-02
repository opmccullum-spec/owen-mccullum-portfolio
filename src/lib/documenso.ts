// Server-only. Small fetch wrapper for the Documenso v2 API — no SDK
// package for this yet, so a plain fetch client is simplest.
//
// NOTE: Documenso's API is mid-migration from a "documents/templates"
// model to a unified "envelopes" model. The endpoints below (template/use,
// template/{id}) are current per their docs as of this writing, but the
// OpenAPI reference at https://openapi.documenso.com/reference is the
// source of truth if anything here starts 404ing.

const BASE_URL = "https://app.documenso.com/api/v2";

class DocumensoError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

async function documensoFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: import.meta.env.DOCUMENSO_API_KEY,
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DocumensoError(`Documenso API error: ${res.status}`, res.status, body);
  }
  return body;
}

export type DocumensoField = {
  id: number;
  type: string; // e.g. "SIGNATURE", "TEXT", "DATE", "NAME", "EMAIL"...
  label?: string;
  fieldMeta?: { label?: string; placeholder?: string };
  recipientId: number;
};

export type DocumensoTemplate = {
  id: number;
  title: string;
  recipients: { id: number; email: string; name: string; role: string }[];
  fields: DocumensoField[];
};

export function getTemplate(templateId: number): Promise<DocumensoTemplate> {
  return documensoFetch(`/template/${templateId}`);
}

/**
 * Fields worth showing on our own "new contract" form for Owen to fill in
 * before sending — everything except the signature itself (that's the
 * client's job). Best-effort label extraction since the exact shape of
 * `fieldMeta` isn't confirmed against a real template yet — adjust here if
 * Documenso's real response differs once we test against Owen's template.
 */
export function prefillableFields(template: DocumensoTemplate) {
  return template.fields
    .filter((f) => f.type !== "SIGNATURE" && f.type !== "INITIALS")
    .map((f) => ({
      id: f.id,
      label: f.fieldMeta?.label || f.label || f.fieldMeta?.placeholder || `Field ${f.id}`,
    }));
}

export type UseTemplateResult = {
  id: number;
  envelopeId?: string;
  recipients: { id: number; email: string; signingUrl?: string }[];
};

export function useTemplate(params: {
  templateId: number;
  recipients: { id: number; email: string; name?: string }[];
  externalId: string;
  prefillFields?: { fieldId: number; value: string }[];
}): Promise<UseTemplateResult> {
  return documensoFetch("/template/use", {
    method: "POST",
    body: JSON.stringify({
      templateId: params.templateId,
      recipients: params.recipients,
      externalId: params.externalId,
      distributeDocument: true,
      ...(params.prefillFields ? { prefillFields: params.prefillFields } : {}),
    }),
  });
}
