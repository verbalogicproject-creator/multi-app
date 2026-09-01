# Design — multi-app

Locked 2026-09-01 through a design interview. Every decision below was chosen
deliberately over named alternatives; the alternatives are recorded so a later
change is a decision rather than a drift.

**Mobile-first.** The phone is the base case, not the fallback. Every rule below
describes the phone; `md:` and up *add*. This device is where the app is actually
used.

---

## 1. What is locked

| | Chosen | Over |
|---|---|---|
| Density | **Tool density** — generous by app standards, compact by agency standards | Editorial-airy; two separate scales |
| Accent | **Orange = attention, grey = chrome** | Orange = action; orange-and-grey only |
| Surfaces | **Hybrid** — a bezel only where it earns one | Flat everywhere; machined everywhere |
| Type | **Display + workhorse** — Clash Display, Geist Sans, Geist Mono | Geist alone; mono-led |
| Memory panel | **Right-hand drawer**, sheet on phone | Card beside the shelf; its own tab |
| Panel is | **An inbox** — what needs you | A ledger; a ladder |
| Approval | **Read the evidence, then approve** | One click; sign every time |
| Quiet states | **Explain the ladder** | Facts only; fall back to the trail |

### The glance test

The accent rule reduces to one sentence, and every component answers to it:

> **Any orange on screen means something needs you. No orange means nothing does.**

Orange is never decoration, never a brand flourish, never "the primary colour".
Buttons, tabs and chrome are metallic. A build running quietly for ten minutes
shows no orange at all — and that is the feature.

---

## 2. Tokens

Tailwind v4, declared once in `index.css`. There is no second place colours live.

```css
@import "tailwindcss";

@theme {
  /* ground — three planes, separated by value */
  --color-ground:   #0B0B0C;   /* the page */
  --color-surface:  #161617;   /* cards, panels */
  --color-raised:   #1E1E20;   /* inputs, wells, nested fields */

  /* metal — chrome, text, borders. the app is mostly this. */
  --color-metal-100: #F4F4F5;  /* primary text */
  --color-metal-200: #C9C9CE;  /* secondary text */
  --color-metal-300: #9A9AA2;  /* tertiary text, labels */
  --color-metal-400: #6E6E76;  /* hints, metadata — NOT body text */
  --color-metal-500: #4A4A51;  /* hairlines, disabled — decoration only */
  --color-metal-700: #2A2A2E;  /* button fills, inert chrome */

  /* accent — attention. never decoration. */
  --color-accent:        #EA580C;  /* the only orange allowed to carry text */
  --color-accent-strong: #C2410C;  /* fills and borders only — fails AA as text */
  --color-accent-soft:   #FB923C;  /* on raised surfaces, small text */

  --font-display: "Clash Display", ui-sans-serif, system-ui, sans-serif;
  --font-sans:    "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, SFMono-Regular, monospace;

  --radius-shell: 1.75rem;   /* bezel outer */
  --radius-core:  1.375rem;  /* bezel inner — concentric, shell minus p-1.5 */
  --radius-card:  0.75rem;   /* ordinary surfaces */
}
```

### Contrast, measured not assumed

Every pairing below was computed, not eyeballed. WCAG AA is 4.5:1 for body text,
3:1 for large text and for non-text UI (icons, dots, focus rings).

```
                      ground   surface  raised
metal-100  #F4F4F5     17.9     16.5     15.1   AAA
metal-200  #C9C9CE     11.9     11.0     10.1   AAA
metal-300  #9A9AA2      7.0      6.5      6.0   AA+
metal-400  #6E6E76      3.9      3.6      3.3   UI ONLY — never body text
accent     #EA580C      5.5      5.1      4.7   AA
accent-soft#FB923C      8.7      8.0      7.4   AAA

white on accent-strong #C2410C   5.18  AA      ← button fills are fine
metal-500  #4A4A51 on ground     2.24  FAIL    ← hairlines and decoration ONLY
```

**The trap this avoids:** classic burnt orange `#C2410C` reads as *the* brand
colour, and it fails AA at body size (3.80). It is kept — as a fill and a border,
where white sits on it at 5.18. Anything orange you have to *read* is `#EA580C`.

---

## 3. Density

Phone first. These are the base values; `md:` widens, never tightens.

```
section     py-10        md:py-14
card        p-5          md:p-6
grid gap    gap-4        md:gap-5
stack gap   space-y-3    md:space-y-4
container   px-4         md:px-6   max-w-6xl mx-auto
```

**Touch targets are 44px minimum**, always, including on desktop. A 32px icon
button is a desktop habit that fails on the device this runs on. Use `min-h-11`
(44px) and give small glyphs a padded hit area rather than shrinking the target.

Type scale, phone base:

```
display   text-2xl  md:text-3xl   Clash Display, tracking-[-0.03em]
heading   text-lg   md:text-xl    Geist Sans 600, tracking-[-0.02em]
body      text-sm   md:text-base  Geist Sans 400
label     text-xs                 Geist Sans 500, metal-300
data      text-xs                 Geist Mono, metal-300
```

---

## 4. Surfaces — the hybrid rule

A bezel is a claim that something matters. Three surfaces earn one; everything
else is a flat plane.

**Earns a bezel** — the live preview, the Memory drawer, the plan card.

```html
<!-- shell -->
<div class="rounded-[--radius-shell] bg-white/[0.03] ring-1 ring-white/[0.06] p-1.5">
  <!-- core: concentric, its own ground, one inset highlight -->
  <div class="rounded-[--radius-core] bg-surface
              shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
```

**Everything else** — file rows, message bubbles, terminal lines, shelf entries:

```html
<div class="rounded-[--radius-card] bg-white/[0.04]">
```

Separation is by **value**, not by outline. The only border in the system is a
hairline `ring-white/[0.06]`, and only where two planes genuinely meet. No
`border-gray-700`. No drop shadows — the one shadow in the system is the inset
highlight above, and it faces up.

---

## 5. Motion

Every transition uses `cubic-bezier(0.32, 0.72, 0, 1)` — weighted, decelerating,
never `ease-in-out`. Only `transform` and `opacity` animate; nothing that
triggers layout.

```
press       active:scale-[0.98]            120ms
drawer      translate-x / translate-y      320ms
disclosure  grid-template-rows 0fr → 1fr   240ms
```

**`prefers-reduced-motion: reduce` collapses every duration to 0ms.** Not a
nice-to-have: this runs on a phone that people use while tired.

No hover-only affordance anywhere. If something is only discoverable on hover, it
does not exist on the device this app runs on.

---

## 6. Typography

Three faces, self-hosted as woff2 in `public/fonts/`. **No CDN** — the device is
often offline and a font that fails to load is a layout that fails to load.

| Face | Role | Weights |
|---|---|---|
| Clash Display | step titles, empty states — the few big moments | 600 |
| Geist Sans | all dense UI, body, buttons, labels | 400, 500, 600 |
| Geist Mono | code, ids, paths, hashes, terminal | 400 |

`font-display: swap` with a metric-matched system fallback in the stack, so a
missing font degrades to a shift rather than to invisible text.

> **Before shipping:** confirm the Clash Display licence covers this use. Geist is
> OFL-1.1. This has not been verified yet.

---

## 7. The Memory panel

A **right-hand drawer**, opened from a metallic button in the chrome bar that
carries an orange dot when something needs you. On phone it is a full-screen
sheet, dismissed by swipe or by the close control — never a squeezed sidebar.

It is an **inbox**. It opens on the one thing no model can do.

```
● AWAITING YOU                              1
╭──────────────────────────────────────────╮
│ generated files import modules that were  │
│ never emitted                             │
│                                           │
│ ○ proposed → ● qualified → ○ approved     │
│ reused once, in a later build             │
│                                           │
│ ▾ evidence                                │
│   proposed  epi_896e…  ✕ 2 errors         │
│   reused    epi_84de…  ✓ passed           │
│   limits    Vite + React projects only    │
│                                           │
│ Eyal                     [ Approve ]      │
╰──────────────────────────────────────────╯

  LEARNED        2 approved
  THIS BUILD     3 episodes · 6 events · 3 evidence
```

**The approve gate.** The button stays inert `metal-700` until the evidence
disclosure has been opened. Approving is a judgement, and the panel's job is to
make the judgement possible rather than to assume it. The approver's name is
required by the engine and never defaulted; it is remembered after the first
time, but the evidence must be opened for each lesson.

A refusal from the engine (approving something not yet qualified) is displayed as
its own sentence, because it is a legitimate answer to a legitimate question.

**Empty state teaches the ladder** — the emptiest screen is the one with room to
explain the system, and the moment you have time to read it:

```
            nothing learned yet

    A failed build proposes a note.
    The next attempt tries it.
    If that one passes, it reaches
    you for approval.

    ○ proposed → ○ qualified → ○ approved

    3 episodes recorded so far.
```

**Degraded state** says what broke and, immediately, what it did not break:

```
● memory unavailable
  the builder is unaffected — it is
  running unadvised.
  multi-graph-memory dist/ is missing
```

---

## 8. What this replaces

Measured before the work started:

- **54 distinct colour utilities** across 10 hues, with no token layer at all.
  Gray and sky carried 87%; the tail — one purple, one teal, two emerald — were
  accidents rather than decisions.
- **7 anti-patterns** found by `npx impeccable detect components/`, every one
  `gray-on-color`: `text-gray-300` on `bg-sky-600` and its relatives.

The token layer above is what makes those unrepeatable: there is no `sky-600` to
reach for.

## 9. How this is checked

```sh
npx impeccable detect components/ index.css   # deterministic, 61 rules
npm run typecheck && npm run build
```

A design decision that cannot be checked is a preference. The contrast table in
§2 is the part of this document that is not negotiable.
