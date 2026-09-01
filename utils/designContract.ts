import { ThemeColors, TypographyOption } from './palettes';

/** Expands #abc to #aabbcc and converts to rgba() so tokens can be tinted. */
export const hexToRgba = (hex: string, alpha: number): string => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const int = parseInt(full, 16);
    if (Number.isNaN(int) || full.length !== 6) return `rgba(128,128,128,${alpha})`;
    return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};

/** True when a hex color is dark enough to need light text on top (W3C luminance). */
export const isDark = (hex: string): boolean => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const int = parseInt(full, 16);
    if (Number.isNaN(int) || full.length !== 6) return false;
    const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/**
 * Renders the chosen design tokens as a real page — type scale, controls, a card,
 * a form field and the empty/error/success states — so the direction can be judged
 * before any code is generated. Fully self-contained: no scripts, no network.
 */
export const buildDesignContractHtml = (
    colors: ThemeColors,
    typography: TypographyOption,
    projectName = 'Your Project',
): string => {
    const onPrimary = isDark(colors.primary) ? '#ffffff' : '#111111';
    const onAccent = isDark(colors.accent) ? '#ffffff' : '#111111';
    const border = hexToRgba(colors.muted, 0.28);
    const name = escapeHtml(projectName || 'Your Project');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: ${colors.bg}; color: ${colors.text}; font-family: ${typography.bodyFamily}; line-height: 1.55; }
  h1, h2, h3, .brand { font-family: ${typography.headingFamily}; font-weight: ${typography.headingWeight}; text-transform: ${typography.headingTransform}; letter-spacing: ${typography.headingSpacing}; margin: 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 32px; }
  nav { display: flex; align-items: center; gap: 14px; padding: 14px 20px; background: ${colors.surface}; border-bottom: 1px solid ${border}; }
  .brand { font-size: 17px; margin-right: auto; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: ${colors.primary}; margin-right: 8px; }
  .navlink { color: ${colors.muted}; font-size: 13px; text-decoration: none; }
  .btn { display: inline-block; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; }
  .btn-primary { background: ${colors.primary}; color: ${onPrimary}; }
  .btn-hover { background: ${colors.primary}; color: ${onPrimary}; filter: brightness(0.88); }
  .btn-secondary { background: transparent; color: ${colors.text}; border: 1px solid ${border}; }
  .btn-accent { background: ${colors.accent}; color: ${onAccent}; }
  .btn-disabled { background: ${hexToRgba(colors.muted, 0.25)}; color: ${colors.muted}; cursor: not-allowed; }
  section { margin-top: 28px; }
  .label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${colors.muted}; margin-bottom: 10px; font-family: ${typography.headingFamily}; }
  .hero { padding: 34px 0 8px; }
  .eyebrow { display: inline-block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${colors.accent}; margin-bottom: 10px; }
  .hero h1 { font-size: 38px; line-height: 1.1; }
  .hero p { color: ${colors.muted}; font-size: 16px; max-width: 46ch; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .card { background: ${colors.surface}; border: 1px solid ${border}; border-radius: 12px; padding: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
  .muted { color: ${colors.muted}; }
  .field { display: block; width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid ${border}; background: ${colors.bg}; color: ${colors.text}; font-family: inherit; font-size: 14px; }
  .field-focus { border-color: ${colors.primary}; box-shadow: 0 0 0 3px ${hexToRgba(colors.primary, 0.25)}; }
  .state { border-radius: 10px; padding: 12px 14px; font-size: 13px; border: 1px solid ${border}; background: ${colors.surface}; }
  .state-error { border-color: ${hexToRgba('#dc2626', 0.5)}; background: ${hexToRgba('#dc2626', 0.09)}; }
  .state-success { border-color: ${hexToRgba(colors.accent, 0.55)}; background: ${hexToRgba(colors.accent, 0.12)}; }
  .empty { border: 1px dashed ${border}; border-radius: 10px; padding: 20px; text-align: center; color: ${colors.muted}; font-size: 13px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
  .sw { flex: 1 1 90px; border-radius: 8px; border: 1px solid ${border}; overflow: hidden; font-size: 10px; }
  .sw i { display: block; height: 34px; }
  .sw span { display: block; padding: 5px 7px; color: ${colors.muted}; font-family: ${typography.bodyFamily}; }
  .scale > * + * { margin-top: 8px; }
</style></head>
<body>
  <nav>
    <span class="brand"><span class="dot"></span>${name}</span>
    <span class="navlink">Features</span><span class="navlink">Pricing</span>
    <span class="btn btn-primary">Get started</span>
  </nav>

  <div class="wrap">
    <div class="hero">
      <span class="eyebrow">Design direction</span>
      <h1>A headline in your chosen type</h1>
      <p>Body copy sits at a comfortable measure so you can judge contrast, rhythm and colour before a single file is generated.</p>
      <div class="row" style="margin-top:16px">
        <span class="btn btn-primary">Primary action</span>
        <span class="btn btn-secondary">Secondary</span>
      </div>
    </div>

    <section>
      <div class="label">Type scale</div>
      <div class="card scale">
        <h1 style="font-size:30px">Heading one</h1>
        <h2 style="font-size:21px">Heading two</h2>
        <p style="margin:0">Body text — the size most of the interface is set in.</p>
        <p class="muted" style="margin:0; font-size:12px">Caption and helper text.</p>
      </div>
    </section>

    <section>
      <div class="label">Controls &amp; states</div>
      <div class="row">
        <span class="btn btn-primary">Default</span>
        <span class="btn btn-hover">Hover</span>
        <span class="btn btn-accent">Accent</span>
        <span class="btn btn-secondary">Secondary</span>
        <span class="btn btn-disabled">Disabled</span>
      </div>
    </section>

    <section class="grid">
      <div class="card">
        <div class="label" style="margin-bottom:6px">Card</div>
        <h3 style="font-size:16px">Card title</h3>
        <p class="muted" style="font-size:13px; margin:6px 0 0">Supporting detail on a surface colour.</p>
      </div>
      <div class="card">
        <div class="label" style="margin-bottom:6px">Form field</div>
        <input class="field" value="Resting input" readonly>
        <input class="field field-focus" style="margin-top:8px" value="Focused input" readonly>
      </div>
    </section>

    <section>
      <div class="label">Feedback states</div>
      <div class="grid">
        <div class="state state-success">Saved successfully.</div>
        <div class="state state-error">Something went wrong.</div>
      </div>
      <div class="empty" style="margin-top:12px">Nothing here yet — the empty state.</div>
    </section>

    <section>
      <div class="label">Tokens</div>
      <div class="swatches">
        ${(['bg', 'surface', 'text', 'muted', 'primary', 'accent'] as (keyof ThemeColors)[])
          .map(key => `<div class="sw"><i style="background:${colors[key]}"></i><span>${key}<br>${colors[key]}</span></div>`)
          .join('\n        ')}
      </div>
    </section>
  </div>
</body></html>`;
};
