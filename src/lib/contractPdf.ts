// Generates the final signed contract PDF ourselves — no external
// e-signature vendor. Overlays the admin-entered field values plus a typed
// signature onto Owen's actual contract template, then appends a
// certificate-of-completion page recording who signed and when.
//
// Field positions below were extracted directly from Documenso's own
// template API (GET /template/17261) before this template was ported off
// Documenso — Documenso stores each field's box as a PERCENTAGE of the
// page's width/height, measured from the page's TOP-LEFT corner. pdf-lib's
// coordinate system has its origin at the BOTTOM-LEFT with y increasing
// upward, so every position is flipped below (see `pctBoxToPdfBaseline`).
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { CONTRACT_TEMPLATE_BASE64 } from "./contractTemplateBase64";

const templateBytes = Buffer.from(CONTRACT_TEMPLATE_BASE64, "base64");

type FieldBox = { page: number; xPct: number; yPct: number; widthPct: number; heightPct: number; fontSize: number };

export const CONTRACT_FIELD_BOXES: Record<string, FieldBox> = {
  clientName: { page: 1, xPct: 20.42251528631354, yPct: 21.68787852048936, widthPct: 56.61047577803683, heightPct: 2.558114071164493, fontSize: 12 },
  clientNamePrint: { page: 5, xPct: 18.18709426429189, yPct: 59.44120264904591, widthPct: 57.13151730009463, heightPct: 1.978726059013484, fontSize: 12 },
  address: { page: 1, xPct: 17.75947437086396, yPct: 24.17559561815762, widthPct: 57.1107904085256, heightPct: 2.678279196629645, fontSize: 12 },
  email: { page: 1, xPct: 36.40212240054056, yPct: 26.96280000013314, widthPct: 32.11845641245261, heightPct: 2.558114071164485, fontSize: 12 },
  phone: { page: 1, xPct: 68.56775491598398, yPct: 26.80597372378093, widthPct: 13.50791430233077, heightPct: 2.751243408548095, fontSize: 12 },
  sessionDate: { page: 1, xPct: 25.21762366588591, yPct: 39.80852949127466, widthPct: 34.36079172947055, heightPct: 2.751243408548097, fontSize: 12 },
  startEndTime: { page: 1, xPct: 23.09058614564822, yPct: 42.00676278240471, widthPct: 36.60411748017895, heightPct: 2.791412479571168, fontSize: 12 },
  location: { page: 1, xPct: 20.42314402929925, yPct: 44.90523338635905, widthPct: 53.73596230159598, heightPct: 3.00814227372812, fontSize: 12 },
  totalFee: { page: 1, xPct: 27.88443703924903, yPct: 58.06757106319895, widthPct: 22.25902049702148, heightPct: 2.751243408548031, fontSize: 12 },
  retainer: { page: 1, xPct: 47.60213143872032, yPct: 60.94947305290365, widthPct: 13.98910899259688, heightPct: 2.751243408548822, fontSize: 12 },
  balance: { page: 1, xPct: 53.81819896571752, yPct: 67.95437414544001, widthPct: 14.86300279790641, heightPct: 2.751243408547866, fontSize: 12 },
};

// Documenso rendered its own signature/date UI here; we now render a typed
// signature (italic) and today's date ourselves at the same spots.
const SIGNATURE_BOX: FieldBox = { page: 5, xPct: 18.35054189786062, yPct: 56.54031269698767, widthPct: 31.86079040852567, heightPct: 2.751243408548064, fontSize: 18 };
const SIGNED_DATE_BOX: FieldBox = { page: 5, xPct: 14.81420251811557, yPct: 61.06613908883533, widthPct: 41.241464992442, heightPct: 2.871408534013202, fontSize: 12 };

// These three (section 3's rush-delivery override, section 4's promotional
// opt-out) are conditional/not needed on every contract, so — same as with
// Documenso — they're left for the client to fill in themselves on the
// signing page rather than the admin form. See ClientFilledFields below.
const DELIVERY_TIMELINE_BOX: FieldBox = { page: 2, xPct: 58.25932504440473, yPct: 14.93553289766781, widthPct: 15.98579040852571, heightPct: 2.751243177580534, fontSize: 12 };
const DELIVERY_FEE_BOX: FieldBox = { page: 2, xPct: 34.45888806802945, yPct: 17.13045228215937, widthPct: 10.32207359436688, heightPct: 2.751243177580482, fontSize: 12 };
const PROMO_OPT_OUT_BOX: FieldBox = { page: 2, xPct: 6.950126927490185, yPct: 56.89418085712542, widthPct: 15.11632138197712, heightPct: 4.118580460590175, fontSize: 12 };
// Section 1's "additional details" blank spans two printed lines (roughly
// double the height of every other single-line box above).
const ADDITIONAL_DETAILS_BOX: FieldBox = { page: 1, xPct: 35.523349942627, yPct: 47.7727759103808, widthPct: 50.60595262276074, heightPct: 5.744748137994164, fontSize: 11 };
const MINOR_NAMES_BOX: FieldBox = { page: 5, xPct: 23.51310143196209, yPct: 30.89715920253516, widthPct: 66.36079031834007, heightPct: 2.751243408548053, fontSize: 12 };
const MINOR_RELATIONSHIP_BOX: FieldBox = { page: 5, xPct: 33.74777975133212, yPct: 33.39923576588641, widthPct: 57.48593077424704, heightPct: 2.75124340854813, fontSize: 12 };

/** Converts a Documenso-style top-left percentage box into a pdf-lib baseline (x, y) in points. */
function boxToBaseline(page: PDFPage, box: FieldBox): { x: number; y: number } {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const x = (box.xPct / 100) * pageWidth;
  const topY = (box.yPct / 100) * pageHeight;
  const boxHeight = (box.heightPct / 100) * pageHeight;
  const bottomY = pageHeight - topY - boxHeight;
  // Roughly vertically center the text within the field's box.
  const y = bottomY + (boxHeight - box.fontSize) / 2 + box.fontSize * 0.15;
  return { x, y };
}

function drawInBox(page: PDFPage, box: FieldBox, text: string, font: PDFFont) {
  if (!text) return;
  const { x, y } = boxToBaseline(page, box);
  page.drawText(text, { x, y, size: box.fontSize, font });
}

/**
 * Same as drawInBox, but for a blank that spans two printed lines: wraps the
 * text and centers each wrapped line within its own half of the box, the
 * same way drawInBox centers a single line — rather than a fixed line-height
 * guess, which risked the second line landing right on the printed
 * underline instead of above it.
 */
function drawWrappedInBox(page: PDFPage, box: FieldBox, text: string, font: PDFFont) {
  if (!text) return;
  const pageWidth = page.getWidth();
  const boxWidthPts = (box.widthPct / 100) * pageWidth;
  const lines = wrapText(text, font, box.fontSize, boxWidthPts).slice(0, 2);
  const halfHeightPct = box.heightPct / 2;
  lines.forEach((line, i) => {
    const subBox: FieldBox = { ...box, yPct: box.yPct + halfHeightPct * i, heightPct: halfHeightPct };
    drawInBox(page, subBox, line, font);
  });
}

export type ContractPrefillFields = {
  clientName: string;
  address?: string;
  email: string;
  phone?: string;
  sessionDate: string;
  startEndTime?: string;
  location?: string;
  totalFee: string;
  retainer: string;
  balance: string;
};

/** Fields the client (not the admin) fills in on the signing page itself — conditional details that don't apply to every contract. */
export type ClientFilledFields = {
  additionalDetails?: string;
  deliveryTimeline?: string;
  deliveryFee?: string;
  optOutPromo?: boolean;
  minorNames?: string;
  minorRelationship?: string;
};

export async function generateSignedPdf(params: {
  title: string;
  prefillFields: ContractPrefillFields;
  clientFields?: ClientFilledFields;
  signatureName: string;
  signedAtISO: string;
  signerIp: string;
  signerUserAgent: string;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italicFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const pages = pdfDoc.getPages();

  const f = params.prefillFields;
  const values: Record<string, string | undefined> = {
    clientName: f.clientName,
    clientNamePrint: f.clientName,
    address: f.address,
    email: f.email,
    phone: f.phone,
    sessionDate: f.sessionDate,
    startEndTime: f.startEndTime,
    location: f.location,
    totalFee: f.totalFee,
    retainer: f.retainer,
    balance: f.balance,
  };

  for (const [key, box] of Object.entries(CONTRACT_FIELD_BOXES)) {
    const value = values[key];
    if (!value) continue;
    const page = pages[box.page - 1];
    if (!page) continue;
    drawInBox(page, box, value, font);
  }

  const c = params.clientFields ?? {};
  if (c.additionalDetails) {
    const page = pages[ADDITIONAL_DETAILS_BOX.page - 1];
    if (page) drawWrappedInBox(page, ADDITIONAL_DETAILS_BOX, c.additionalDetails, font);
  }
  if (c.deliveryTimeline) {
    const page = pages[DELIVERY_TIMELINE_BOX.page - 1];
    if (page) drawInBox(page, DELIVERY_TIMELINE_BOX, c.deliveryTimeline, font);
  }
  if (c.deliveryFee) {
    const page = pages[DELIVERY_FEE_BOX.page - 1];
    if (page) drawInBox(page, DELIVERY_FEE_BOX, c.deliveryFee, font);
  }
  if (c.optOutPromo) {
    const page = pages[PROMO_OPT_OUT_BOX.page - 1];
    if (page) drawInBox(page, PROMO_OPT_OUT_BOX, "X", font);
  }
  if (c.minorNames) {
    const page = pages[MINOR_NAMES_BOX.page - 1];
    if (page) drawInBox(page, MINOR_NAMES_BOX, c.minorNames, font);
  }
  if (c.minorRelationship) {
    const page = pages[MINOR_RELATIONSHIP_BOX.page - 1];
    if (page) drawInBox(page, MINOR_RELATIONSHIP_BOX, c.minorRelationship, font);
  }

  const signaturePage = pages[SIGNATURE_BOX.page - 1];
  if (signaturePage) {
    drawInBox(signaturePage, SIGNATURE_BOX, params.signatureName, italicFont);
    const signedDate = new Date(params.signedAtISO).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    drawInBox(signaturePage, SIGNED_DATE_BOX, signedDate, font);
  }

  appendCertificatePage(pdfDoc, font, {
    title: params.title,
    signatureName: params.signatureName,
    email: f.email,
    signedAtISO: params.signedAtISO,
    signerIp: params.signerIp,
    signerUserAgent: params.signerUserAgent,
  });

  return pdfDoc.save();
}

function appendCertificatePage(
  pdfDoc: PDFDocument,
  font: PDFFont,
  params: { title: string; signatureName: string; email: string; signedAtISO: string; signerIp: string; signerUserAgent: string },
) {
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const margin = 60;
  let y = 792 - margin;
  const lineHeight = 20;

  const heading = "Certificate of Completion";
  page.drawText(heading, { x: margin, y, size: 18, font });
  y -= lineHeight * 2;

  const signedAt = new Date(params.signedAtISO);
  const timestamp = signedAt.toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "America/New_York",
  });

  const lines = [
    `Document: ${params.title}`,
    "",
    `Signed by: ${params.signatureName}`,
    `Email: ${params.email}`,
    `Signed at: ${timestamp}`,
    `IP address: ${params.signerIp}`,
    `Browser/device: ${params.signerUserAgent}`,
    "",
    "By typing their name and submitting this form, the signer affirmed their",
    "intent to electronically sign this document and agreed that their typed",
    "name constitutes a legal signature under the U.S. ESIGN Act and",
    "applicable state law.",
  ];

  const maxWidth = 612 - margin * 2;
  for (const line of lines) {
    for (const wrapped of wrapText(line, font, 11, maxWidth)) {
      page.drawText(wrapped, { x: margin, y, size: 11, font });
      y -= lineHeight;
    }
  }
}

/** Greedy word-wrap so a long value (e.g. a browser user-agent string) never runs off the page. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
