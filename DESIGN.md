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
| Nav | **The dock, at every width** — Projects · Chat · Build · Code · Preview · Harness, plus Memory *(changed 2026-09-04, §5)* | A bottom bar plus a rail; a full screen stack |
| Phone vs desktop | **One layout** — a destination fills the screen at every width *(changed 2026-09-04, §5)* | Two designs; a desktop-only two-up split |
| Chat identity | **Shape** — one raised bubble for you, flat text for the assistant | Indigo vs teal; two greys; the accent for your turn |
| Counterpoint | **Mono is the machine's voice** | The hairline as a grid; concentric radii alone |
| Preview runtime | **iframe over a server-bundled blob**, behind one seam | WebContainer now; deciding later |
| Interactive preview | **Sandpack, one named cross-origin exception** *(added 2026-09-05, A0)* | Self-host Sandpack's bundler; WebContainer instead |

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
<div class="rounded-shell bg-white/[0.03] ring-1 ring-white/[0.06] p-1.5">
  <!-- core: concentric, its own ground, one inset highlight -->
  <div class="rounded-core bg-surface
              shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
```

**Everything else** — file rows, message bubbles, terminal lines, shelf entries:

```html
<div class="rounded-card bg-white/[0.04]">
```

Separation is by **value**, not by outline. The only border in the system is a
hairline `ring-white/[0.06]`, and only where two planes genuinely meet. No
`border-gray-700`. No drop shadows — the one shadow in the system is the inset
highlight above, and it faces up.

---

## 5. The shell

> **Changed 2026-09-04.** Two locked decisions were overturned here — *"phone nav:
> bottom tab bar"* and *"phone vs desktop: two designs"*. The original reasoning is kept
> below, because it was right about the problem and wrong about the remedy, and a locked
> decision is allowed to change but not to change silently.

### What the two-design rule was for, and why it stopped working

The phone and the desktop were **two designs**, not one design at two widths. That was
a deliberate choice, taken after measuring what the "mobile-first" claim at the top of
this document was actually worth:

```
19 breakpoints  Step_Theme        │  0 breakpoints  ProjectManager  (w-96, shrink-0)
12              AiControls        │  0              ChatPanel
 7              ToolMessage       │  0              IdeView
 1              App.tsx           │  0              AgentManager · BuildShelf · FileExplorer
```

Three blocking consequences, all in the shell: a 384px rail on a 390px screen; a
`w-2/3` code editor beside a `w-1/3` chat with no breakpoint at all; and a
terminal pinned to `h-1/3` of a `h-full` inside an `h-dvh` — nested
fixed-fraction scrolling, the exact pattern a phone cannot absorb.

The diagnosis held. The remedy — a second design — did not, and it failed in the way
second designs fail: the phone got a four-slot bar, the desktop kept a rail with a tab
strip inside it, and the two became **two answers to one question**. `Chat` and `Build`
shared a slot whose label flipped depending on a rail tab, so what you tapped and what
you got were decided in different places. `AI Tools` was worse than ambiguous: its tab
lived in the rail while its content rendered in the main panel, so a phone that tapped
it got an empty card. That is not a bug that was introduced; it is what two navigation
systems do to each other over time.

**The phone shell as it was, kept for the record:**

```
┌──────────────────┐
│  Projects        │   one surface at a time, full width
├──────────────────┤
│                  │
│   content        │
│                  │
├──────────────────┤
│  ▤    ◆   ⟨⟩   ●│   44px, safe-b, md:hidden
│ Proj Chat Code Mem│
└──────────────────┘
```

- **Projects** — the rail, full width, with its own Projects/Agents/AI Tools/AI
  Settings tab strip.
- **Chat / Build** — one slot whose label tracked what the main panel actually was.
- **Code** — `IdeView`, disabled without an active agent.
- **Memory** — a toggle, with a `md:`-only floating trigger beside it.

### The dock is the only navigation

```
┌────────────────────┐
│                    │
│    destination     │  one surface, the whole screen, every width
│                    │
│                    │
├────────────────────┤
│ ▤  ◆  ✦  ⟨⟩  ▭  ⚙  ●│  44px, safe-b, revolving, no ends
│ Pr Ch Bu Co Pv Ha Me│
└────────────────────┘
```

Six destinations — **Projects · Chat · Build · Code · Preview · Harness** — plus
**Memory**, which stays the drawer §1 locks it as rather than becoming a seventh
destination: it must be reachable *from* wherever you are rather than instead of it,
and it carries the accent dot so the glance test works from every screen. Its floating
`md:` trigger is gone; its own comment said "two ways in at the same corner is one too
many", and the dock now runs at every width, so that reasoning applies at every width.

**A destination fills the screen.** No `md:w-2/3` primary beside a `md:w-1/3` companion,
because that arrangement is what made every destination need two layouts and two sets
of widths — six destinations' worth of second design to keep right, forever. One layout
that grows is not a compromise here; it is the reason one dock could replace two
navigation systems at all.

*What it costs, stated rather than glossed:* you can no longer watch chat beside the
editor on a wide screen. That is a real loss. The honest way to give it back is a split
the user opts into on the one destination that wants it — a toggled editor panel, noted
as a later upgrade — never a breakpoint-driven second layout returning by the back door.

**Disabled, not absent.** `Code` and `Preview` need an open project — a project, not an
agent, since `b8399a7`. They stay in the dock, greyed, with the reason in their title,
so the dock's contents never shuffle under a thumb between visits.

**Three copies, one of them real.** The dock renders its children three times to fake an
endless strip. The middle set is live and carries `data-dock-live`; the outer two are
`aria-hidden` **and** `inert`. `inert` is the load-bearing half — `aria-hidden` alone
leaves a focusable button a keyboard walks into and a screen reader then refuses to
describe. React 19 takes `inert` as a real boolean and silently drops `inert=""`, which
is how this first shipped: eighteen focusable controls for six destinations. `audit:ui`
asserts it, and asserts that the dock's items are exactly the destinations `types/ui.ts`
declares — a surface with no dock item is a page with no door, and a dock item for
nothing declared is a door to nowhere. Both render perfectly.

**One state variable.** The shell used to hold `activeTab` *and* `surface`. Two values
answering "where am I" is how the two navigation systems came to disagree, so `AppTab`
is gone and `surface` is the only answer.

**Surfaces are hidden, not unmounted.** `hidden` rather than a conditional
render, so chat scroll position, an unsent message and terminal history all
survive a trip to Code and back.

### The preview runs in an iframe, and that is a decision about headers

Generated React renders in an **iframe fed a self-contained document** that the
server bundles with esbuild — not in a WebContainer. Shipped as described: the
seam below is `components/PreviewHost.tsx` and `services/buildPreview.ts`, and
the bundler is `preview/` behind `POST /api/preview/build`.

WebContainer is the better product: a real Node runtime in the tab, real
`npm install`, real Vite, real HMR. It needs `SharedArrayBuffer`, which since
Spectre is only exposed to a **cross-origin isolated** document, which requires
both:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`COEP: require-corp` is the expensive half. It makes the document **refuse** any
cross-origin subresource that has not explicitly opted in with
`Cross-Origin-Resource-Policy` or valid CORS. Not degrade — refuse, silently.
And these are **document** headers: they cannot be scoped to the Code tab. Send
them and every screen is isolated, including the ones that load generated images
and video.

So the choice is deferred rather than taken, and the app is shaped so it stays
cheap to take later:

- the preview lives behind **one seam** — a `PreviewHost` component and a
  `buildPreview()` service — so swapping the runtime is two files, not the app;
- **media loads through our own server, never a third-party URL.** This is the
  expensive part of COEP compliance, it is good practice regardless, and doing it
  during the wizard migration means the headers become a config line if
  WebContainer is ever wanted.

#### The one exception, taken with its eyes open (A0)

`SandpackAppPreview.tsx` embeds `<iframe src="https://*.codesandbox.io">` — a
second, interactive preview next to the esbuild one, for the reason WebContainer
was attractive in the first place: unlimited npm packages, CDN-resolved, no local
install. `scripts/audit-ui.mjs`'s origins check has one named exception for it.

This is not free, and it is not the same deferral as above. Everything else in
the app stays cross-origin-fetch-free specifically so `COEP: require-corp` stays
a config line; this one surface cannot make that promise, because the entire
point of it is a bundler we do not run. If WebContainer is ever pursued, this
component is what has to change first — self-host Sandpack's bundler (it is
open-source) or remove the exception — not a header.

Taken anyway because Sandpack, today, delivers most of what WebContainer was
being kept open *for* — packages the local `node_modules` does not have — at a
fraction of the cost, and WebContainer itself was never scheduled, only kept
cheap. `tsc` and esbuild remain the verdict regardless of which preview a person
is looking at; see `SandpackAppPreview.tsx`'s doc comment.

#### What the sandbox costs, measured

`sandbox="allow-scripts"` **without** `allow-same-origin` — the two together are
not a sandbox — gives the document an **opaque origin**, and a surprising amount
of ordinary React throws there. Measured in a real sandboxed frame, not read:

| API | At an opaque origin |
|---|---|
| `history.pushState` / `replaceState` | `SecurityError` |
| `localStorage` / `sessionStorage` | `SecurityError` on *property access* |
| `document.cookie` (read and write) | `SecurityError` |
| `location.hash = '#/x'` | works |
| `indexedDB`, `matchMedia`, `fetch` | present |

The first two rows are what generated apps do: the generate prompt **mandates**
`react-router-dom` v6, and persisting to `localStorage` is routine. Unshimmed,
the first click on a nav link throws and the pane goes white — and it reads as
the model's bug rather than ours. So the bundler substitutes `MemoryRouter` for
`BrowserRouter` (`HashRouter` is no escape; v6's hash history is also built on
`pushState`) and the document shims the storage APIs before the app runs.

`postMessage` works, which is what carries runtime errors back out — but
`event.origin` is the string `"null"` and identifies nothing, so the parent
verifies the frame's own `contentWindow` instead.

The rule that follows, and it binds the migration: **when a component that loads
media is migrated, its media is proxied at the same time.** Doing the colours now
and the origins later means touching those files twice, and the second pass is
the one that can break them.

### IdeView is one component, two layouts

Because the desktop keeps its split, there is exactly one code surface in the
app rendered two ways — a tab on the phone, the two-thirds column on desktop.
When a real editor and file tree land, they land *inside `IdeView`*, once, and
both layouts get them. That is why the phone did not get a code *sheet*: a sheet
would have been a second home to delete later.

**The editor is decided: CodeMirror 6, with type errors from `tsc`.** Both
candidates were built and measured on this device.

```
CodeMirror 6   editor                    505 KB raw / 170 KB gzip   one file, no workers
Monaco         editor only              ~4.4 MB    / ~1.17 MB       + editor.worker
Monaco         + TypeScript service    ~11.3 MB    / ~2.6 MB        + a resident ts.worker
```

Monaco is genuinely better in one way: a real TypeScript language service. But
that is also where its weight and nearly all of its memory cost sit — strip the
worker and it is a nine-times heavier CodeMirror doing the same job. Its own FAQ
answers mobile support with "No.", which for a phone-first app means any touch
bug is permanently ours.

**And the valuable half of a language service is the cheap half.** Type errors
come from `npx tsc --noEmit` run server-side — about 15 KB of client code and one
route — while the expensive half, completion, pays off only where a human
hand-authors substantial TypeScript. Here the model writes the files and a person
reviews them on a soft keyboard. Full LSP stays on the shelf until desktop
hand-authoring proves real; the plan and the verified prototype are in
`comprehensive-LSP-context-for-build-and-implementation.md`.

The step with compounding value is the one most likely to be skipped: **feeding
type errors back through `PROPOSAL_TABLE`** so the builder learns from its own.
Generated code is the model's output and `tsc` is a deterministic judge — which
is exactly the loop this repo already has.

`typescript` is pinned to **`5.9.3` exactly** — that is what this app compiles
with, and it is what Stage 2's `tsc --noEmit` will run. Note that the caret range
it replaced (`^5.4.5`) could *not* have drifted to TypeScript 7: a caret is
major-locked, so the drift warning in that document is overstated. The reasons to
pin are reproducibility and Track C.

**The two pins are not the same pin.** Track C — the deferred LSP — needs a
TypeScript that still ships `lib/tsserver.js`, and `typescript@latest` is now
**7.0.2**, the native Go port, whose 2.5 MB package ships none. Verified on this
device: **6.0.3 is the newest release that still ships it** (24.3 MB, same
`tsserver.js` shim + `_tsserver.js` pair as 5.9.3), and `typescript-language-server`
6.0.0 initialises against it. So the LSP document's pin is `6.0.3`; the app's stays
`5.9.3` until there is a reason to move a compiler major, which is its own change
with its own risk.

#### What landed, and what it cost

CodeMirror 6 replaced the `<textarea>` on 2026-09-03. Measured on this device,
not estimated:

```
before            858 KB raw / 208 KB gzip   one chunk
after (naive)   1,379 KB raw / 390 KB gzip   one chunk  — +182 KB on first paint
after (split)     858 KB raw / 209 KB gzip   app
                + 522 KB raw / 181 KB gzip   CodeEditor, loaded on demand
```

The editor is a `lazy()` chunk. It is larger than the entire rest of the app, and
most sessions open the chat before they open a file, so it streams in behind a
usable screen instead of standing in front of one. First paint pays **0.75 KB**
for the split; opening a file pays the 181 KB once. The grammars for HTML, CSS and
JSON are why this is 181 KB rather than the 170 KB measured for JS/TS alone.

**Syntax has no hue, and that is the system working rather than a compromise.**
§6 says a signal needing a third job beyond attention and chrome must find it
outside the palette. Syntax is exactly such a signal. So `components/editor/theme.ts`
spends none: keywords are `metal-100` at 600, types and functions `metal-100`,
strings and numbers `metal-200`, punctuation `metal-300`, comments `metal-300`
italic. Three values and two weights carry more structure than they sound like,
and the accent stays unspent — which is what leaves it free to mean *this line has
a type error* in Stage 2. The one exception is an unclosed bracket, which is
already the accent's job: something needs you.

Three things the token layer had to be told about. `EditorView.lineWrapping` is on,
because a long line that scrolls sideways on a 390px viewport is a line nobody
reads. `indentWithTab` is deliberately **absent**: it traps keyboard focus in the
editor with no way out, and CodeMirror ships no escape hatch for it. And
`.cm-content` carries `min-height: 100%`, because `.cm-gutters` is `height: 100%`
of a flex line sized by the content — without it the gutter's hairline stops where
the document does and hangs in mid-air below it.

**That last one was found by looking at the screenshot, and nothing else would have
found it.** The same pass removed a `padding-bottom: 35vh` on `.cm-scroller` that
was there to clear a soft keyboard: it is a guess about a platform this project has
never exercised (see the open risk on Android Chrome), and it bought a permanent
phantom scrollbar in exchange. An unmeasured convenience is not worth a visible
defect.

**The failure mode this component has is invisible**, which is why it has its own
gate. Rebuild the `EditorView` when the `file` prop changes identity — which it
does on every save — and the pane looks perfect, keeps your text, and passes every
visual check, while silently discarding undo history each time you press Save. The
effect is therefore keyed on `file.id`, and `npm run check:editor` proves both
halves through the keyboard: history and cursor survive a save, and history resets
across files. Reverting the key to `[file]` makes three of its assertions fail with
the right diagnosis — that negative control was run, not assumed.

#### What the touch probe did and did not establish

This section carried a second, older copy of itself that still said the
editor was undecided. The decision above supersedes it; the evidence below is
the part that survives, because it is measurement rather than framing.

Measured on this device against a real Monaco build
(Pixel 7 emulation, touch, Chromium 149):

| touch/mobile behaviour | Monaco | CodeMirror 6 |
|---|---|---|
| renders, syntax highlighting | works | works |
| tap to place cursor | works | works |
| typing after a touch focus | works | works |
| double-tap to select a word | works | works |
| shift+arrow, Ctrl+A | works | works |
| Ctrl+Space autocomplete | works | no popup (no type service) |
| **drag a finger to select a range** | **not established — see below** | **not established** |

**The drag-select finding is withdrawn.** It was reported here as Monaco's one
real gap. Then the identical probe was run against CodeMirror 6 — which handles
touch selection well — and it failed in exactly the same way, including with real
browser-level input through CDP `Input.dispatchTouchEvent` rather than synthetic
`TouchEvent`s. When a test fails identically on the thing that works and the
thing that supposedly does not, **the test is the finding.**

The reason is that "drag = select" is not the mobile idiom anywhere. On a phone a
finger drag *scrolls*; selection is long-press, then drag the handles the OS
draws. Synthesising that reliably, in headless Chromium, against browser-drawn
selection UI, is not something to trust. **This one is a human test on a real
device, and it takes ten seconds.**

On a phone the three panes recompose rather than shrink:

| | Desktop | Phone |
|---|---|---|
| Tree | 256px column | sheet, summoned from the file name |
| Editor | the remainder | everything left over |
| Terminal | `h-1/3`, always | a disclosure, shut until asked for |

A third of a 780px screen is not a terminal, it is a tax on the editor.

---

## 6. Identity without hue

The accent rule gives colour exactly two jobs — attention and chrome. Anything
that needs a *third* signal has to find it somewhere other than the palette,
because a third job would quietly empty "any orange means something needs you"
of its meaning by teaching the eye that colour here is sometimes just decoration.

**Chat turns.** They used to be `bg-indigo-500` for you and `bg-teal-500` for
the assistant. Now they are told apart by shape, which the markup already had
and was not using:

```
    ◆  the assistant speaks flat on the ground,        ← glyph, left, no bubble
       left-aligned, full width

                       ╭────────────────────────╮
                       │ and your turn is the   │      ← the one raised block
                       │ one raised block       │
                       ╰───────────────────────╯
```

Two silhouettes rather than two colours — which survives greyscale, daylight on
a phone, and colour-blindness. None of those was true of indigo-versus-teal.

**The counterpoint: mono is the machine's voice.** Geist Mono was loaded and
barely used. It now has exactly one job, and nothing else has it:

> File paths, model ids, build ids, token counts, timings, hex values — every
> machine fact — is `.meta`: mono, `metal-300`, tight. Prose is never mono, and
> a machine fact is never prose.

Declared once as a utility so it cannot drift:

```css
@utility meta {
  font-family: var(--font-mono);
  letter-spacing: -0.01em;
  color: var(--color-metal-300);
}
```

Size stays with the caller; the *voice* is what is declared. This is the quieter
signature the palette leaves room for: it gives the eye a second axis to sort by
that is not colour, and it is true to what the product is — a builder, whose
screens are full of machine facts.

---

## 7. Motion

Every transition uses `cubic-bezier(0.32, 0.72, 0, 1)` — weighted, decelerating,
never `ease-in-out`. Only `transform` and `opacity` animate; nothing that
triggers layout.

**Write `ease-fluid` and `rounded-card`, never `ease-[--ease-fluid]` or
`rounded-[--radius-card]`.** Tailwind compiles the bracket form to
`transition-timing-function: --ease-fluid`, a bare custom property where a value
belongs — invalid CSS, silently dropped by every engine. For a year of commits
that meant the motion curve and every corner radius in this document existed only
in the document. `@theme`'s `--ease-*` and `--radius-*` namespaces already
generate the real utilities; use them. `npm run check:css` now fails the build on
any dropped declaration.

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

## 8. Typography

Three faces, self-hosted as woff2 in `public/fonts/`. **No CDN** — the device is
often offline and a font that fails to load is a layout that fails to load.

| Face | Role | Weights |
|---|---|---|
| Clash Display | step titles, empty states — the few big moments | 600 |
| Geist Sans | all dense UI, body, buttons, labels | 400, 500, 600 |
| Geist Mono | code, ids, paths, hashes, terminal | 400 |

`font-display: swap` with a metric-matched system fallback in the stack, so a
missing font degrades to a shift rather than to invisible text.

**Licences, verified.** Geist is OFL-1.1 (Vercel / basement.studio). Clash Display
is the ITF Free Font License, which grants commercial use free of charge (§01) and
states explicitly that "nothing in this Section 02 restricts the self-hosting,
embedding or other use of the Font Software by the Licensee for the Licensee's own
websites, applications" (§59). Two constraints follow and are binding:

- **§51 — no subsetting and no format conversion.** The woff2 ships exactly as
  downloaded. Do not run it through a subsetter to save bytes.
- **§57 — it may not be offered to third parties as a selectable font.** Clash is
  for multi-app's own chrome. It must never be handed to a *generated* app's
  typography options.

Both licence texts are committed beside the fonts.

**One skill disagrees, deliberately overruled.** `impeccable detect` flags Geist as
an overused face, and it is right about marketing sites. This is a personal tool
with a terminal and a file tree in it, where legibility at 11px beats
distinctiveness, and Clash Display carries the personality instead. Recorded as a
value-scoped exception in `.impeccable/config.json` rather than by turning the
rule off, so the rule still fires for the next font someone reaches for.

---

## 9. The Memory panel

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

**Unproven notes are shown, not hidden.** A proposed lesson has no action attached — it cannot be approved and it is not waiting on you — so it sits below the fold, greyed, with one line explaining that it reaches you only if a later attempt that used it then passes. Hiding it would make the ladder's bottom rung invisible, and the bottom rung is where most notes live.

**Degraded state** says what broke and, immediately, what it did not break:

```
● memory unavailable
  the builder is unaffected — it is
  running unadvised.
  multi-graph-memory dist/ is missing
```

---

## 10. What this replaces

Measured before the work started:

- **54 distinct colour utilities** across 10 hues, with no token layer at all.
  Gray and sky carried 87%; the tail — one purple, one teal, two emerald — were
  accidents rather than decisions.
- **7 anti-patterns** found by `npx impeccable detect components/`, every one
  `gray-on-color`: `text-gray-300` on `bg-sky-600` and its relatives.

The token layer above is what makes those unrepeatable: there is no `sky-600` to
reach for.

**Progress, counted with the full alphabet.** The first sweep's verification
grep listed eight hues and no property prefixes, and reported clean while
`text-purple-400` and `accent-sky-500` were still on screen. Every count below
is taken across all 22 Tailwind hue families and all 17 property prefixes,
because *a check is only as good as its alphabet*.

```
after the chat sweep     26 files   336 usages
after the shell pass     13 files   204 usages
after the wizard          6 files    62 usages
```

Done: `App` · `AppDock` · `ProjectManager` · `AgentManager` · `ChatPanel` ·
`MessageItem` · `UserMessage` · `IdeView` · `FileExplorer` · `CodeEditor` ·
`Terminal` · `LoadingIndicator` · `QuotaBadge` · `ModelPicker` · `MemoryPanel` ·
`AiControls` · `AssistantMessage` · `ImageEditorPane` · `ModeSelector` ·
`ToolMessage` · `Step_Theme`.

**Nothing is left.** The only legacy hue in the tree is one class in
`DesignContractPreview`, and it stays: that surface renders the *generated* app
and must not inherit this palette.

**Two of those carry a second obligation.** `ImageUpload` and
`VideoGeneratorPane` load media, so under the preview-runtime decision in §5
their origins are proxied in the same pass that recolours them. Doing the
colours now and the origins later means touching them twice, and the second
pass is the one that can break them.

## 11. How this is checked

```sh
npx impeccable detect components/ index.css App.tsx   # deterministic, 61 rules
npm run typecheck && npm run build
npm run check:css        # dropped declarations in the BUILT css — see below
```

Plus the hue sweep, which must use every hue family and every property prefix:

```sh
HUES='slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
PREF='bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|divide|accent|caret|placeholder'
grep -rnoE "($PREF)-($HUES)-[0-9]{2,3}" components/ App.tsx
```

**And a silent check must be proved awake.** `impeccable detect` printing
nothing is a claim, not a result, so it is run against a known-bad file from git
in the same breath:

```sh
git show <pre-sweep>:components/ModeSelector.tsx > /tmp/ctl.tsx
node …/detect.mjs /tmp/ctl.tsx   # exit 2 — the detector is awake
node …/detect.mjs components/    # exit 0 — and that zero is real
```

**And it is looked at.** There *is* a browser on this device — two, under
`~/.cache/ms-playwright/`: `chromium-1228` is Chromium 149.0.7827.0 and
`chromium-1234` is Chromium 151.0.7922.34. Use **1228**, the revision the local
`playwright-core` 1.61.1 expects.
The earlier claim that none existed was wrong: only `~/.cache/puppeteer` had been
checked, and its directories are empty scaffolding. Screenshots are taken at
390×844 (phone, `isMobile`, DPR 2) and 1440×900 (desktop) against a seeded
`localStorage` — projects, files, personas, agents and a real conversation — so
the states photographed are the states people meet, not empty ones.

Four things were only findable that way, and none of them would have failed a
typecheck, a build, or the detector:

- The assistant turn was still a **bubble** (`bg-metal-700 rounded-2xl`). The
  colour had been migrated and the shape had not, so "flat on the ground" was in
  this document and not in the app.
- `IdeView` opened on **an empty tree for a project that has files** —
  `filesByProject` is filled lazily and nothing filled it for that route.
- The desktop Memory trigger sat **on top of the send button**.
- The phone editor spent **88px on two stacked header rows** before any code.

**And behaviour is checked separately from appearance**, because the editor's
worst failure has no appearance:

```sh
npm run check:editor   # 17 assertions, keyboard only, on the built output
```

It asserts CodeMirror mounted, the grammar produced styled spans, typing reaches
the document, `Mod-s` saves, and then the two that define the stage: within a
file the cursor and undo history survive a save; across files undo cannot walk
back into the previous file's edits. Every assertion also checks that its subject
*moved* — a test in which "nothing changed" can pass is a test that passes when
the editor is dead. Proved awake by keying the effect on `[file]` instead of
`[file.id]`: three assertions fail, naming the rebuild.

**Both browser gates need multi-app's own backend**, and that is now checked
rather than assumed. `vite preview` proxies `/api`, so an upstream that accepts
the connection and never answers leaves every request pending, `networkidle`
never fires, and the run dies on a `page.goto` timeout that reads exactly like
broken UI. That happened: port 8080 was held by an unrelated project's server,
which answers `/healthz` with `{status:'ok'}` — healthy, wrong app. **The default
backend port moved to 8050 because of it**, which makes the collision unlikely
rather than impossible — so `assertBackend` still asserts the response shape only
this app returns, because a liveness probe any server can pass is not a probe.
`API_TARGET` moves the target if 8050 is ever taken too:

```sh
PORT=9000 node server.js
API_TARGET=http://localhost:9000 npm run audit:ui
```

The same class of bug bit the preview server itself: `--strictPort` makes Vite
exit when the port is held, and a leftover preview from an earlier run answers
200 on the very next poll — so the audit ran against a stale build served by a
process it did not start. `startPreview` now watches its own child's exit code
first.

A design decision that cannot be checked is a preference. The contrast table in
§2 is the part of this document that is not negotiable.
