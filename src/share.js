// Sharing: a shareable link, the Web Share API / clipboard fallback, a
// hand-drawn PNG share card (canvas, not DOM — mirrors the imagery tokens with
// literal colors), and the share-sheet overlay. The overlay is the migrated
// lit-html reference pattern (see CLAUDE.md): user text is a bare `${…}`
// interpolation (auto-escaped); trusted string helpers are wrapped in
// `unsafeHTML`.

import { state } from "./state.js";
import { setStatus, eventNoun, fmtTime, fmtDay } from "./format.js";
import { t, cardinal } from "./i18n.js";
import { azimuthToCardinal } from "./astronomy.js";
import { skyGradient, skyGradientCss } from "./sky.js";
import { scoreNumeral } from "./ui.js";
import { icon, ICONS } from "./icons.js";
import { scoreLabel } from "./score.js";
import { html, render as litRender, unsafeHTML } from "./render.js";

/** Build a shareable link to the current state (place + event). */
function buildShareUrl() {
  const { place, event } = state;
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("lat", place.latitude.toFixed(4));
  url.searchParams.set("lon", place.longitude.toFixed(4));
  url.searchParams.set("label", place.label);
  url.searchParams.set("event", event);
  return url.toString();
}

/** Share via the Web Share API, falling back to clipboard copy. */
async function shareCurrent(score) {
  const url = buildShareUrl();
  const text = t("share.text", {
    noun: eventNoun(state.event),
    score,
    label: state.place.label,
  });
  try {
    if (navigator.share) {
      await navigator.share({ title: "SkyHue", text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus(t("status.linkCopied"), "info");
  } catch {
    // Last resort: show the URL in the status bar.
    setStatus(url, "info");
  }
}

/** Fonts for the share canvas: same families as the app (with
 *  system fallbacks), so the PNG mirrors the brand identity. */
const IMG_DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const IMG_UI = "'Space Grotesk', system-ui, -apple-system, sans-serif";
const IMG_MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Draw an `icons.js` icon on the canvas (stroke, like in the app): no
 *  system emoji, identical rendering everywhere. */
function drawCanvasIcon(ctx, name, x, y, size, color) {
  const body = ICONS[name] || ICONS.help;
  const ds = [...body.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ds) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/**
 * Generate an image (canvas) with the Sunset Score, place, time and sun
 * direction, over the expected sky gradient, and share it (Web Share API
 * with a file) or download it as a fallback. No external dependencies.
 */
async function shareImage({
  place,
  score,
  factors,
  eventDate,
  event,
  sun,
  download = false,
}) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background: expected sky gradient (same stops as the preview).
  const stops = skyGradient(factors, score);
  const hsl = (s) => `hsl(${s.h} ${s.s}% ${s.l}%)`;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  // Use each stop's own position so the PNG matches the CSS hero (the warm band
  // rises with the score; fixed positions would desync the two).
  for (const s of stops) {
    g.addColorStop(Math.min(1, Math.max(0, (s.p ?? 0) / 100)), hsl(s));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const noun = eventNoun(event);

  // Ensure the webfonts before drawing, so the PNG uses Bricolage/Space
  // Grotesk like the app (falls back to system fonts if loading fails).
  try {
    if (document.fonts) {
      await Promise.all([
        document.fonts.load('800 330px "Bricolage Grotesque"'),
        document.fonts.load('700 66px "Bricolage Grotesque"'),
        document.fonts.load('600 46px "Bricolage Grotesque"'),
        document.fonts.load('600 54px "Space Grotesk"'),
        document.fonts.load('400 40px "Space Grotesk"'),
        document.fonts.load('400 34px "JetBrains Mono"'),
      ]);
    }
  } catch {
    /* continue with system fonts */
  }

  // Brand: "sunset" icon + SkyHue wordmark (no system emoji),
  // centered as in the preview.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 46px ${IMG_DISPLAY}`;
  const brand = "SkyHue";
  const brandIco = 42;
  const brandGap = 16;
  const brandW = brandIco + brandGap + ctx.measureText(brand).width;
  const brandX = (W - brandW) / 2;
  drawCanvasIcon(ctx, "sunset", brandX, 62, brandIco, "rgba(255,255,255,0.92)");
  ctx.fillText(brand, brandX + brandIco + brandGap, 96);
  ctx.textAlign = "center";

  // Same soft shadow as the preview: numeral readable on light gradients.
  ctx.save();
  ctx.shadowColor = "rgba(60,10,20,0.4)";
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = "#fff";
  ctx.font = `800 330px ${IMG_DISPLAY}`;
  ctx.fillText(String(score), W / 2, H / 2 + 30);
  ctx.restore();

  ctx.font = `700 66px ${IMG_DISPLAY}`;
  ctx.fillText(t("label." + scoreLabel(score)), W / 2, H / 2 + 150);

  // Place (shrink the font if too wide).
  let labelSize = 54;
  ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  while (ctx.measureText(place.label).width > W - 120 && labelSize > 28) {
    labelSize -= 3;
    ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  }
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(place.label, W / 2, H - 250);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `400 40px ${IMG_UI}`;
  ctx.fillText(
    t("share.imgTime", {
      noun,
      time: fmtTime(eventDate),
      day: fmtDay(eventDate),
    }),
    W / 2,
    H - 185,
  );
  ctx.fillText(
    `${t("stat.direction")}: ${cardinal(azimuthToCardinal(sun.azimuth))} (${Math.round(sun.azimuth)}°)`,
    W / 2,
    H - 135,
  );

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `400 34px ${IMG_MONO}`;
  ctx.fillText("nocfer.github.io/skyhue", W / 2, H - 64);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    setStatus(t("status.imgError"), "error");
    return;
  }
  const file = new File([blob], "skyhue.png", { type: "image/png" });
  const text = t("share.text", { noun, score, label: place.label });
  try {
    if (
      !download &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: "SkyHue", text });
      return;
    }
  } catch {
    /* share canceled or failed: fall back to the download */
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "skyhue.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus(t("status.imgSaved"), "info");
}

/** "Share" sheet (2d): 4:5 sky preview + share/save/link actions. */
export function openShareSheet(data) {
  const { place, score, factors, eventDate, event, sun } = data;
  const noun = eventNoun(event);
  const skyCss = skyGradientCss(skyGradient(factors, score));
  const label = t("label." + scoreLabel(score));
  const dir = cardinal(azimuthToCardinal(sun.azimuth));
  const overlay = document.createElement("div");
  overlay.className = "sheet-scrim";
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const onCopy = async (e) => {
    const btn = e.currentTarget;
    await shareCurrent(score);
    btn.textContent = t("status.linkCopied");
    setTimeout(() => {
      btn.textContent = t("share.copy");
    }, 1600);
  };
  // lit-html: `place.label` is a plain interpolation, so it is auto-escaped (no
  // more escapeHtml). The trusted string helpers (icon/scoreNumeral) are wrapped
  // in unsafeHTML; the buttons are real elements so their clicks bind via @click.
  const sheet = html`
    <div class="sheet" role="dialog" aria-modal="true">
      <span class="sheet__handle" aria-hidden="true"></span>
      <h2 class="sheet__title display">${t("share.title." + event)}</h2>
      <div class="sharecard" style="background:${skyCss}">
        <div class="grain" aria-hidden="true"></div>
        <span class="sharecard__brand"
          >${unsafeHTML(icon("sunset", { size: 15 }))} SkyHue</span
        >
        ${unsafeHTML(
          scoreNumeral(score, {
            size: "xl",
            color: "#fff",
            cls: "sharecard__score",
          }),
        )}
        <span class="sharecard__label display">${label}</span>
        <div class="sharecard__foot">
          <strong>${place.label}</strong>
          <span
            >${noun} ${fmtTime(eventDate)} · ${dir}
            ${Math.round(sun.azimuth)}°</span
          >
        </div>
      </div>
      <button
        class="btn btn--primary sheet__primary"
        type="button"
        @click=${() =>
          shareImage({ place, score, factors, eventDate, event, sun })}
      >
        ${unsafeHTML(icon("share", { size: 18 }))} ${t("share.image")}
      </button>
      <div class="sheet__row">
        <button
          class="btn btn--ghost sheet__ghost"
          type="button"
          @click=${() =>
            shareImage({
              place,
              score,
              factors,
              eventDate,
              event,
              sun,
              download: true,
            })}
        >
          ${t("share.save")}
        </button>
        <button
          class="btn btn--ghost sheet__ghost"
          type="button"
          @click=${onCopy}
        >
          ${t("share.copy")}
        </button>
      </div>
    </div>
  `;
  litRender(sheet, overlay);
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
