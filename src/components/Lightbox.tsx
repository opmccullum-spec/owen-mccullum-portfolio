import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export interface LightboxImage {
  src: string;
  title: string;
  location: string;
  width: number;
  height: number;
  print?: boolean;
  lqip?: string;
}

interface Props {
  images: LightboxImage[];
}

/** Clear the view-transition tag from every grid image. */
function clearGridNames() {
  document
    .querySelectorAll<HTMLElement>(".plate img")
    .forEach((i) => (i.style.viewTransitionName = ""));
}

/**
 * Full-screen viewer that presents each photograph as a framed print on a dark
 * gallery wall. Opening/closing morphs the photo to and from its spot in the
 * grid (View Transitions API, where supported); a low-res placeholder blurs up
 * to the full image. Keyboard + swipe navigation, scroll lock.
 */
export default function Lightbox({ images }: Props) {
  const [index, setIndex] = useState<number | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const open = index !== null;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef<number | null>(null);
  indexRef.current = index;

  const supportsVT =
    typeof document !== "undefined" &&
    typeof (document as any).startViewTransition === "function";

  const close = useCallback(() => {
    const i = indexRef.current;
    const doClose = () => setIndex(null);
    if (supportsVT && i != null) {
      // Tag the current grid image so the card morphs back into it.
      const gridImg = document.querySelector<HTMLElement>(
        `.plate[data-lightbox="${i}"] img`,
      );
      if (gridImg) gridImg.style.viewTransitionName = "active-photo";
      (document as any)
        .startViewTransition(() => flushSync(doClose))
        .finished.finally(clearGridNames);
    } else {
      doClose();
    }
  }, [supportsVT]);

  const prev = useCallback(
    () => setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length)),
    [images.length],
  );
  const next = useCallback(
    () => setIndex((i) => (i === null ? i : (i + 1) % images.length)),
    [images.length],
  );

  // Open requests from the gallery plates — morph the clicked photo open.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ index: number }>).detail;
      if (!d || !Number.isInteger(d.index)) return;
      const doOpen = () => setIndex(d.index);
      if (supportsVT) {
        (document as any)
          .startViewTransition(() => flushSync(doOpen))
          .finished.finally(clearGridNames);
      } else {
        doOpen();
      }
    };
    window.addEventListener("lightbox:open", onOpen as EventListener);
    return () => window.removeEventListener("lightbox:open", onOpen as EventListener);
  }, [supportsVT]);

  // Track viewport so the mat can be sized to fit the photo.
  useEffect(() => {
    const measure = () =>
      setVp({
        w: document.documentElement.clientWidth || window.innerWidth,
        h: document.documentElement.clientHeight || window.innerHeight,
      });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Keyboard controls + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, prev, next]);

  if (!open) return null;
  const img = images[index!];

  // Size the photo to fit the viewport, then frame it with an even white mat.
  const isPhone = vp.w < 700;
  const frame = isPhone ? 12 : 18; // top/left/right border
  const capH = isPhone ? 46 : 56; // reserved height for the caption block
  const maxCardW = Math.min(vp.w * 0.94, 1180);
  const availW = maxCardW - frame * 2;
  const availH = vp.h * 0.9 - frame - capH;
  const scale = Math.min(availW / img.width, availH / img.height, 1);
  const dispW = Math.max(1, Math.round(img.width * scale));
  const dispH = Math.max(1, Math.round(img.height * scale));

  return (
    <div
      class="lb"
      role="dialog"
      aria-modal="true"
      aria-label={`${img.title}, ${img.location}`}
      onClick={close}
    >
      <button class="lb-close" aria-label="Close" onClick={close}>
        ✕
      </button>
      <button
        class="lb-nav lb-prev"
        aria-label="Previous"
        onClick={(e) => {
          e.stopPropagation();
          prev();
        }}
      >
        ‹
      </button>

      <figure
        class="lb-card"
        style={{ width: `${dispW + frame * 2}px`, padding: `${frame}px ${frame}px 0` }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = touchStart.current;
          touchStart.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) next();
            else prev();
          }
        }}
      >
        <div
          class="lb-photo"
          style={{
            width: `${dispW}px`,
            height: `${dispH}px`,
            backgroundImage: img.lqip ? `url("${img.lqip}")` : undefined,
          }}
        >
          <img
            class="lb-img blurup"
            key={img.src}
            src={img.src}
            alt={img.title}
            width={img.width}
            height={img.height}
            style={{ width: `${dispW}px`, height: `${dispH}px` }}
          />
        </div>
        <figcaption class="lb-cap">
          {img.print && (
            <a class="lb-print" href="/prints">
              Available as a print →
            </a>
          )}
          <span class="lb-count">
            {index! + 1} / {images.length}
          </span>
        </figcaption>
      </figure>

      <button
        class="lb-nav lb-next"
        aria-label="Next"
        onClick={(e) => {
          e.stopPropagation();
          next();
        }}
      >
        ›
      </button>
    </div>
  );
}
