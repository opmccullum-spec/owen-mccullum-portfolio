// Regenerates src/lib/contractTemplateBase64.ts from the actual PDF at
// src/assets/documents/photography-agreement-template.pdf. Run this again
// any time that file is replaced (e.g. Owen updates the contract wording).
//
// Why base64-embed rather than import the PDF as a normal asset: a Vite
// `?arraybuffer`-suffix import silently returned something other than raw
// bytes at runtime, and the `new URL(..., import.meta.url)` + readFileSync
// pattern (Vite's own documented way to bundle a binary file for SSR/node
// output) built fine but the referenced asset was never actually copied
// into the deployed Vercel function's output directory. A plain exported
// string is just JS and survives every build target unchanged.
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = new URL("../src/assets/documents/photography-agreement-template.pdf", import.meta.url);
const OUTPUT = new URL("../src/lib/contractTemplateBase64.ts", import.meta.url);

const bytes = readFileSync(SOURCE);
const base64 = bytes.toString("base64");

const content = `// Auto-generated from src/assets/documents/photography-agreement-template.pdf.
// Base64, not a Vite asset import: this file is bundled into every server
// target (dev, build, Vercel function) as a plain JS string, sidestepping
// asset-pipeline differences between them that silently produced either a
// URL string instead of bytes, or a copied-asset path that never actually
// existed in the deployed function output.
// Regenerate by running: node scripts/embed-contract-template.mjs
export const CONTRACT_TEMPLATE_BASE64 = "${base64}";
`;

writeFileSync(OUTPUT, content);
console.log(`Wrote ${OUTPUT.pathname} (${(content.length / 1024).toFixed(0)} KB)`);
