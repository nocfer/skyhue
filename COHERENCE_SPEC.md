# SkyHue — Coherence Contract

The redesign loses coherence when screens are styled **individually**. This spec fixes that by making the app a composition of a **fixed token layer** and a **small set of primitives**. The rule is one sentence:

> **Every screen is built ONLY from the tokens in §1 and the primitives in §2. No screen introduces a raw color, spacing, radius, font-size, shadow, or a one-off variant of a shared element. If a screen needs something not here, the primitive is extended here first, then reused — never forked inline.**

Enforce this literally. 90% of the incoherence is a screen re-typing a value (a 16px radius, a `#ffce6f` numeral, a 15px gap) that *almost* matches a token but doesn't. Ban "almost."

---

## 1. Token layer — the ONLY legal values

Define these as CSS custom properties in `styles.css` under `:root` (dark, default) and `:root[data-theme='light']`. **Nothing in any component may use a literal value where a token exists.**

### 1.1 Color
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#120a16` | `#fdf7ef` | screen / content background |
| `--bg-deep` | `#0a070d` | `#f6ede1` | behind sheets / dim layer |
| `--surface` | `#171020` | `#ffffff` | sheets, panels, map bottom-sheet |
| `--card` | `rgba(255,255,255,.05)` | `#ffffff` | card fill |
| `--card-2` | `rgba(255,255,255,.035)` | `#fbf7f2` | quieter card fill |
| `--card-shadow` | `none` | `0 6px 22px -12px rgba(90,45,20,.22)` | card elevation (light only) |
| `--hairline` | `rgba(255,255,255,.10)` | `rgba(0,0,0,.10)` | borders |
| `--divider` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.08)` | section rules |
| `--text` | `#f6efe8` | `#2a1f26` | primary text |
| `--muted` | `#8f8189` | `#8a7c82` | secondary text |
| `--muted-2` | `#c9bfc4` | `#7c6e74` | tertiary text |
| `--faint` | `#6f6570` | `#9b8f88` | footnotes / mono captions |
| `--accent` | `#ff8a52` | `#ee6d3a` | primary action, accent icons |
| `--ink` | `#150d0a` | `#150d0a` | text on accent/gold fills |
| `--score-text` | `#ffce6f` | `#c0801a` | **gold as text** (numerals, labels) |
| `--score-text-hi` | `#ffe4a6` | `#b8791a` | top-end score text |
| `--good-text` | `#f2b44e` | `#b57a15` | favourable text |
| `--bad-text` | `#e0785c` | `#c0472a` | unfavourable text |
| `--sentiment-good` | `#ffce6f` | `#f2b44e` | good accent bar / tile (surface, both themes stay warm) |
| `--sentiment-neutral` | `#9c9086` | `#9c9086` | neutral accent bar |
| `--sentiment-bad` | `#d85a3c` | `#d85a3c` | bad accent bar |

**Imagery tokens (identical in BOTH themes — never inverted):**
| Token | Value | Use |
|---|---|---|
| `--sky-hero` | `linear-gradient(to bottom,#160f2e,#3a1a4d 20%,#7c2b55 40%,#c94360 58%,#ff7e46 78%,#ffb85e 92%,#ffe4a6 100%)` | hero + share card |
| `--sky-swatch` | `linear-gradient(to top,#2a1633,#c4416a 55%,#ffb85e)` | thumbnails |
| `--sun-glow` | `radial-gradient(circle,#fff4d4 0%,#ffd07a 42%,rgba(255,170,90,0) 72%)` | sun disc |
| `--gold-img` | `#ffce6f` | sun-ray stroke, dot glows, best-day dot (**imagery only, stays bright in light**) |
| `--map-canvas` | `#14101c` | map inset (stays dark in both themes) |
| `--marker-ring` | `rgba(255,255,255,.9)` | marker rings on the dark map |

> **The gold rule, encoded:** text uses `--score-text` / `--good-text`; imagery uses `--gold-img` / the gradients. Two different tokens so a theme swap can darken one without touching the other. A component must pick the right one — never `#ffce6f` raw.

### 1.2 Spacing — 8px base scale (the only gaps/margins/paddings allowed)
`--s-1: 4px · --s-2: 8px · --s-3: 12px · --s-4: 16px · --s-5: 20px · --s-6: 24px · --s-7: 32px · --s-8: 40px`
- **Screen gutter = `--s-5` (20px)** left/right on every screen. (The mockups drift 20↔22; standardize on 20.)
- **Card padding = `--s-4` (16px)**; compact cards/rows `--s-3` (12px).
- **Gap between sibling cards/rows = `--s-3` (12px)**; chips in a row `--s-2` (8px).
- **Section-to-section rhythm = `--s-7` (32px)** top margin; header-to-content `--s-4`.
- No bare margins for layout — use flex/grid `gap`.

### 1.3 Radius — 6 values (see also the radius standard)
`--r-pill: 999px · --r-tile: 12px · --r-control: 14px · --r-card: 18px · --r-feature: 20px · --r-sheet: 26px` · (screen shell = 42px, mock-only)
- **Card = `--r-card` (18px) is the default.** Controls/inputs/thumbnails `--r-control` (14). Icon tiles / small swatches `--r-tile` (12). Feature/emphasis cards `--r-feature` (20). Bottom sheets `--r-sheet` top corners only. Chips/circles `--r-pill`.
- Ban 16, 22, 24, 10, 11, 13 — snap to the nearest token.

### 1.4 Type — one ramp, fixed family per role
Families: `--font-display: 'Bricolage Grotesque'` · `--font-ui: 'Space Grotesk'` · `--font-mono: 'JetBrains Mono'`.
| Role | Family | Size / weight / tracking | Used for |
|---|---|---|---|
| `display-xl` | display | 44px / 800 / -0.03em / lh .92 | hero headline |
| `display-l` | display | 40px / 800 / -0.02em | screen H1 ("Where to watch it") |
| `display-m` | display | 22px / 700 / -0.01em | section H2 ("This week") |
| `num-xl` | display | 76px / 800 | share-card score |
| `num-l` | display | 40px / 800 | hero score, winner score |
| `num-m` | display | 27px / 800 | spot / row scores |
| `num-s` | display | 24px / 700 | stat-card values |
| `body` | ui | 16px / 400 / lh 1.5 | paragraphs |
| `label` | ui | 15px / 600 | card titles, buttons |
| `meta` | ui | 13–14px / 400 | secondary lines |
| `caption` | mono | 11px / 500 / 0.14em / uppercase | meta rows, coords, section index |
| `eyebrow` | mono/ui | 12px / 600 / 0.22em / uppercase | "TONIGHT · SUNSET" |

**Rule:** every numeral that represents a score is `--font-display`. Every technical/meta string is `--font-mono`. Body/labels are `--font-ui`. No exceptions — mixing families per screen is the #1 coherence tell.

### 1.5 Shadow / motion
- `--card-shadow` (light only, §1.1). Sheets: `0 -8px 40px -12px rgba(0,0,0,.5)`. Device shadow is mock-only.
- Motion tokens: `--dur-fast: .12s · --dur: .2s · --ease: cubic-bezier(.2,.7,.2,1)`. Sun pulse `2.8s`. All motion gated by `prefers-reduced-motion`.

---

## 2. Primitives — the only building blocks

Build each **once**, then every screen composes them. Each lists the tokens it consumes so nothing is re-specified downstream.

1. **`Screen`** — sets `--bg`, `--font-ui`, `--text`, gutter `--s-5`, and the top status bar (glyphs use `currentColor` so they flip per context). Owns the home-indicator bar.
2. **`Hero`** — full-bleed `--sky-hero`, `color:#fff` (fixed — white in both themes), the melt-to-`--bg` overlay at the bottom, `--sun-glow` disc. Slots: eyebrow, `display-xl` headline, `num-l` score. Nothing below the hero inherits its white.
3. **`SectionHeader`** — `display-m` title (or `caption` index + label + `--divider` rule line for the mono variant). One component, two variants — not two hand-built headers.
4. **`Card`** — `--card` fill, `--card-shadow`, `--r-card`, padding `--s-4`. Variants: `feature` (`--r-feature`, gold-tinted), `quiet` (`--card-2`), `row` (horizontal, `--s-3` padding). Optional `sentiment` left-border (`--sentiment-*`).
5. **`ScoreNumeral`** — `--font-display`, size prop (`num-xl…num-s`), color `--score-text` / `--score-text-hi` (or hue ramp), with a `caption` sublabel. **All scores render through this** — this alone kills most drift.
6. **`Chip`** — `--r-pill`, `--s-2` padding. Variants: `sky` (gold tint + `--score-text`), `golden`/`blue` (light-hour), `filter`. Segmented control = a row of chips with one `--accent` active.
7. **`Button`** — primary (`--accent` fill, `--ink` text, `--r-control`) / outline (`--hairline` border, `--text`). One height, one padding.
8. **`Sheet`** — `--surface`, `--r-sheet` top, drag handle, sheet shadow. Used by share (2d) and the map panel (2b).
9. **`StatCell`** — `Card quiet` + `caption` label + `num-s` value + optional `--score-text` micro-caption. Conditions (1b) and Atmosphere (3d) are grids of these — identical cell.
10. **`SpotRow`** — `Card row` + `SkySwatch` thumb + title(`label`) + verdict(`--good-text`/`--bad-text` + kind icon) + `caption` meta + `ScoreNumeral num-m` + `Chip sky`. Every spot everywhere (1b, 3c) is this one row.
11. **`SkySwatch`** — `--sky-swatch`, size prop, `--r-tile`/`--r-control`, optional sun dot. Thumbnails, place cards, compare rows all use it.
12. **`MapInset`** — `--map-canvas` (dark, both themes), coastline stroke `--gold-img`, `--marker-ring` dots, dashed `--gold-img` sun ray, `--sun-glow` glyph. Used full-screen (2b) and mini (3d) — same component, size prop.

---

## 3. Screen = composition (no new CSS per screen)

Each screen is a stack of the above. If a screen's markup contains a color/size/radius literal, or a bespoke card/header/score, it's a defect.

- **1b Results:** `Hero` → banner(`Card feature`) → `SectionHeader`+why cards(`Card`+`ScoreNumeral`) → trend(`Card`) → where-to-look(`Card`+MapInset-less compass) → `SpotRow`×3 → StatCell grid. One scroll.
- **2a Home:** `Hero`(short) → search(`Button`-height input) → segmented(`Chip` row) → place cards(`Card row`+`SkySwatch`+`ScoreNumeral`) → `Button` outline.
- **2b Map:** `Screen` bar + `MapInset`(full) + `Sheet`(swatch + `ScoreNumeral` + verdict + `Button`).
- **2c Compare:** `SectionHeader` + `Card feature`(winner) + ranked `Card row`×N (`ScoreNumeral`).
- **2d Share:** dim + `Sheet` + share-card(`--sky-hero` + `ScoreNumeral num-xl`) + `Button` ×3.
- **3a Why:** `SectionHeader` + contribution bar(`Card`) + factor `Card`×N (sentiment).
- **3b Trend:** banner + `SectionHeader` + chart(`Card`) + swatch row(`SkySwatch`) + light `Chip`s.
- **3c Spots:** `SectionHeader` + legend + `SpotRow`×N (incl. bad variant) + estimate `Button` + estimated `SpotRow`.
- **3d Point:** `SectionHeader` + `MapInset`(mini) + `Button` + `caption` grid note + StatCell grid.

---

## 4. Enforcement checklist (run on every screen)

- [ ] Zero hex/rgba/hsl literals in screen markup — all via `var(--…)`. (grep the diff for `#`, `rgba(`, `hsl(` outside `styles.css` → should be ~0.)
- [ ] Zero raw px for spacing/radius/font-size in screen markup — all via tokens. (grep `px` in component styles.)
- [ ] Every score numeral is `ScoreNumeral`; every card is `Card`; every section title is `SectionHeader`; every spot is `SpotRow`. No hand-built equivalents.
- [ ] `--font-display` only on display/numeral roles; `--font-mono` only on caption/meta; `--font-ui` for the rest. No family mixing within a role.
- [ ] Screen gutter is exactly `--s-5` on all screens; card gaps `--s-3`; section rhythm `--s-7`.
- [ ] Gold text uses `--score-text`/`--good-text`; gold imagery uses `--gold-img`/gradients. No `#ffce6f` raw.
- [ ] Theme swap changes only tokens — diff `:root` vs `[data-theme=light]` and confirm no component rule is theme-specific.
- [ ] Same primitive looks pixel-identical across the screens it appears on (compare `StatCell` in 1b vs 3d; `SpotRow` in 1b vs 3c; status bar everywhere).

---

## 5. Anti-patterns (the actual sources of incoherence — reject in review)

- A screen defines its own `.card`, `.spot`, or score style instead of the primitive → **fork; delete and compose.**
- "Close enough" values: `16px`/`22px` radius, `15px`/`21px` gap, `#ffd27a` numeral → snap to token.
- Bespoke section header on one screen (different size/weight/rule) → use `SectionHeader`.
- Family drift: a numeral in Space Grotesk, a heading in the mono font, body in display → wrong role/family.
- Gold numerals left bright in light theme (unreadable) OR sun glow darkened in light theme (dead) → gold-token split violated.
- Per-screen one-off spacing to "make it fit" → adjust the primitive or the scale, once.
- New color introduced for a state (e.g. a blue "info") that isn't a token → add to the token layer or reuse sentiment.

**Bottom line:** coherence is not achieved by fixing screens one by one — it's achieved by making screens incapable of diverging, because they can only reference tokens (§1) and compose primitives (§2). Build that layer first; port screens onto it second.
