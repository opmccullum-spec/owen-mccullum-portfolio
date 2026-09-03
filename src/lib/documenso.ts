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

export type DocumensoTemplate = {
  id: number;
  title: string;
  recipients: { id: number; email: string; name: string; role: string }[];
};

export function getTemplate(templateId: number): Promise<DocumensoTemplate> {
  return documensoFetch(`/template/${templateId}`);
}

/**
 * Field IDs on Owen's specific contract template (Documenso template
 * 17261, "Photography_Service_and_Release_Agreement_TEMPLATE.pdf").
 * None of the fields have labels set in Documenso (the dashboard doesn't
 * require it), so these were mapped by hand from each field's page +
 * position, cross-checked against the actual PDF text — verified live
 * against the API on 2026-09-02. Deleting/re-adding fields in the template
 * changes their IDs (moving a field does not) — re-derive this map via
 * `GET /template/17261` if contract sending starts erroring or fields land
 * in the wrong spot on a signed contract.
 *
 * Deliberately not included here (left for the client to fill in
 * themselves when they open the document to sign, since they're
 * conditional/not needed on every contract): additional session details,
 * the rush-delivery timeline override, minor's name/relationship, and the
 * promotional-use opt-out checkbox.
 */
export const CONTRACT_FIELDS = {
  clientName: 17302129,
  clientNamePrint: 17302297, // mirrors clientName, next to the client's signature
  address: 17302160,
  email: 17302161,
  phone: 17302162,
  sessionDate: 17302163,
  startEndTime: 17302164,
  location: 17302186,
  totalFee: 17302188,
  retainer: 17302189,
  balance: 17302190,
} as const;

export type UseTemplateResult = {
  id: number;
  envelopeId?: string;
  // NOTE: the real API response has no `signingUrl` field, only `token` —
  // confirmed live (the docs are silent on this). The client's signing link
  // is constructed from it: `https://app.documenso.com/sign/${token}`.
  recipients: { id: number; email: string; token?: string }[];
};

export function signingUrlFromToken(token: string): string {
  return `https://app.documenso.com/sign/${token}`;
}

// Discriminated union confirmed live against the real API (the docs we
// found described this as `{ fieldId, value }`, which 400s — the actual
// shape is `{ id, type, value }`, type matching the field's own type).
// All of CONTRACT_FIELDS above are plain TEXT fields, so `text` covers v1.
export type PrefillField = { id: number; type: "text"; value: string };

export function useTemplate(params: {
  templateId: number;
  recipients: { id: number; email: string; name?: string }[];
  externalId: string;
  prefillFields?: PrefillField[];
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
