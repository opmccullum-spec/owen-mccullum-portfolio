import type { ImageMetadata } from "astro";

/**
 * The gallery is data-driven. To add a photo:
 *   1. Drop the file into `src/assets/photos/`
 *   2. Add an entry below (the `file` is the filename, no path)
 * Astro compresses/optimizes every referenced image at build time.
 */

export type PhotoSpan = 4 | 6 | 12;
export type PhotoShape = "land" | "port" | "feature" | "square";
export type SeriesId = "portraits";

export interface Photo {
  /** Filename inside src/assets/photos */
  file: string;
  title: string;
  location: string;
  /** Which section of the gallery this photograph belongs to */
  series: SeriesId;
  /** Grid columns to span (out of 12) */
  span: PhotoSpan;
  /** Aspect-ratio treatment */
  shape: PhotoShape;
  /** Available as a print (only photographs with no identifiable likeness) */
  print?: boolean;
}

export interface Series {
  id: SeriesId;
  /** Display index, museum-wing style (01, 02, …) */
  index: string;
  title: string;
  /** One-line curatorial note */
  note: string;
}

/** The bodies of work, in display order. */
export const series: Series[] = [
  { id: "portraits", index: "01", title: "Portraits", note: "People met at arm's length — a gesture, a held gaze, a face turned to the light." },
];

// Order within each section is the on-page order. Titles and classifications
// were derived from the photographs themselves (vision pass + adversarial
// verification) — locations are kept general where the frame doesn't prove a
// specific place. Photographs with any identifiable likeness are not offered
// as prints.
export const photos: Photo[] = [
  // ── 01 · Portraits ───────────────────────────────────────────
  { file: "repose.jpg",         title: "Repose",            location: "Washington, D.C. — 2025",series: "portraits",    span: 12, shape: "feature"   },
  { file: "in-navy.jpg",        title: "In Navy",           location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "steady-gaze.jpg",    title: "Steady Gaze",       location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "looking-up.jpg",     title: "Looking Up",        location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "the-chair.jpg",      title: "The Chair",         location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "the-lean.jpg",       title: "The Lean",          location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "warm-light.jpg",     title: "Warm Light",        location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "adorned.jpg",        title: "Adorned",           location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "sunlight.jpg",       title: "Sunlight",          location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
  { file: "the-matriarch.jpg",  title: "The Matriarch",     location: "Washington, D.C. — 2025",series: "portraits",    span: 4,  shape: "port"      },
];

/** Photos for one section, in display order. */
export function photosBySeries(id: SeriesId): Photo[] {
  return photos.filter((p) => p.series === id);
}

/** Photos available as prints (no identifiable likeness). */
export function printPhotos(): Photo[] {
  return photos.filter((p) => p.print);
}

/**
 * Eagerly import every image in src/assets/photos so each `Photo.file`
 * resolves to optimizable Astro `ImageMetadata`.
 */
const imageModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/photos/*.{jpg,jpeg,png,webp,avif}",
  { eager: true },
);

const imageMap: Record<string, ImageMetadata> = {};
for (const [path, mod] of Object.entries(imageModules)) {
  const name = path.split("/").pop()!;
  imageMap[name] = mod.default;
}

export function getPhotoImage(file: string): ImageMetadata {
  const img = imageMap[file];
  if (!img) {
    throw new Error(
      `Photo "${file}" listed in photos.ts but not found in src/assets/photos/`,
    );
  }
  return img;
}
