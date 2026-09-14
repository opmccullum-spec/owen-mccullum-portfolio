import type { APIRoute } from "astro";
import { CONTRACT_TEMPLATE_BASE64 } from "../../lib/contractTemplateBase64";

// Lets a client review the blank agreement before signing — same bytes
// the PDF generator (src/lib/contractPdf.ts) draws onto, so this is always
// exactly what ends up in the signed document.
const templateBytes = Buffer.from(CONTRACT_TEMPLATE_BASE64, "base64");

export const GET: APIRoute = () => {
  return new Response(templateBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="photography-agreement-template.pdf"',
    },
  });
};
