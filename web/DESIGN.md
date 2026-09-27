# Design of the Nosandwich (NOSAND) site

This documents the implemented design of the one-page site in `web/`, extracted from the final
source (`web/src/styles.css`, the components in `web/src/components/` and `web/src/App.tsx`) and
confirmed in the headless-browser run recorded in `docs/FRONTEND.md`. The assignment's write scope
did not include the repository root, so this file lives at `web/DESIGN.md`.

## Overview

Audience: people testing the NOSAND anti-sandwich pool on Sepolia, reading prices and hook
accounting and sending test swaps. The character is a calm, light, data-first utility page:
white cards on a pale neutral page, one teal accent reserved for the primary action and links,
status colours only where a state exists (ok / warning / error), no imagery, no motion beyond a
120 ms colour transition and a press scale on buttons.

System-wide rules: one `h1`, `h2` per card, `h3` for a sub-list inside a card; content sits in a
72 rem column; groups are separated by space first and 1 px borders second; every changing number
is tabular; every control has a visible label and a visible focus ring; status is always colour
plus text. The specific arrangement (price card full width, swap form beside the hook card, activity
full width, contracts full width) is this page's composition, not a rule for other pages.

## Colors

Tokens are CSS custom properties in `web/src/styles.css` (`:root`), hex notation, light theme only.
Primitives are named by hue and step; components use only the semantic tier.

| Semantic token | Primitive / value | Job |
| --- | --- | --- |
| `--color-bg-page` | `--n-50` `#f6f7f9` | Page background |
| `--color-bg-surface` | `--n-0` `#ffffff` | Cards, inputs, secondary buttons |
| `--color-bg-subtle` | `--n-100` `#eceef2` | Quote summary box, neutral badge, hover on secondary buttons |
| `--color-bg-accent-tint` | `--teal-50` `#e4f3f1` | Selected radio "choice" background |
| `--color-border` | `--n-200` `#d8dce3` | Card borders, table row and list dividers |
| `--color-border-strong` | `--n-300` `#848d9b` | Input, button and choice borders |
| `--color-text` | `--n-900` `#161a21` | Body text |
| `--color-text-secondary` | `--n-500` `#626b79` | Captions, hints, `dt` labels, muted copy |
| `--color-accent-solid` / `-hover` | `--teal-600` `#0e6f68` / `--teal-700` `#0a5751` | Primary button fill and hover |
| `--color-accent-text` | `--teal-700` `#0a5751` | Links, selected choice text |
| `--color-text-on-accent` | `#ffffff` | Text on the primary button |
| `--color-focus` | `--blue-600` `#1f56d6` | Focus ring (2 px solid, 2 px offset) |
| `--color-status-ok-*` | `#e9f7ee` / `#1b6b3a` | "On Sepolia", "Code verified", success notice |
| `--color-status-warn-*` | `#fff5e0` / `#7a4b06` | "Wrong network" badge, warning notice |
| `--color-status-err-*` | `#fdeeee` / `#b3261e` | Field errors, failed step text, error notices, invalid input border |

Measured contrast (WCAG 2.x, computed from these declared pairs, `test/scratch/contrast.py`):
body text on surface 17.4:1; secondary text on surface 5.4:1, on page 5.0:1, on subtle 4.6:1;
accent text on surface 8.4:1 and on tint 7.4:1; white on accent solid 6.0:1; ok badge 5.9:1;
warn badge 6.8:1; error text on error tint 5.8:1 and on surface 6.5:1; focus ring on surface 6.3:1
and on page 5.8:1; control border on surface 3.35:1 and on page 3.13:1. The focus ring is offset
2 px so it always borders the surface behind the control, never the teal fill. Disabled controls
use `opacity: 0.55` and are exempt from contrast requirements.

## Typography

- Family: system stack `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
  (`--font-sans`); monospace `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`
  (`--font-mono`) for addresses, hashes and pool ids (`code`, `.mono`). No font files are shipped.
- Scale (`--text-*`): caption 0.8125 rem, ui 0.875 rem, body 1 rem, value 1.375 rem, h2 1.25 rem, h1 1.75 rem.
- Roles: `h1` 650 weight, letter-spacing −0.01 em, line-height 1.15, `text-wrap: balance`;
  `h2` 600; `h3` 600 at body size; body 400, line-height 1.5, `p { text-wrap: pretty }`;
  captions/hints/`dt` at caption size in secondary colour; the two headline prices use
  `.stat dd.value` (value size, 600, line-height 1.2).
- Numbers: `.num`, `.stat dd`, `.input`, `.summary` values and numeric table cells use
  `font-variant-numeric: tabular-nums`. Amounts are formatted with thousands separators and
  truncated (never rounded up) fraction digits; ratios use significant digits.
- Inputs are 1 rem (16 px) so iOS does not zoom. Long identifiers wrap with `overflow-wrap: anywhere`.
- Measure: lede and footer capped at 60–70 ch; card copy wraps inside the grid columns.
- `lang="en"` and `dir="ltr"` on the document; font smoothing set once on `html`.

## Layout

- Container `.page`: max-width 72 rem, padding 1 rem (1.5 rem from 40 rem), bottom padding 2 rem.
- Spacing scale `--s-1 … --s-8` (0.25 rem to 2 rem on a 4 px base). Within a group 0.25–0.5 rem,
  between groups 0.75–1 rem, between cards 1.5 rem.
- Grid `.grid-2`: single column by default; two equal columns from 56 rem, where `.span-2`
  stretches a card across both. `.price-pair` and `.form-row` split into two columns from 40 rem.
- Header `.page-header`: title block and wallet panel wrap; on narrow screens the wallet panel
  goes full width and left-aligned (`@media (max-width: 40rem)`).
- Tables sit in `.table-wrap` (horizontal scroll inside the card, bleeding to the card padding)
  so wide rows never widen the page. Verified: no horizontal overflow at 320, 390, 820 and 1280 px.
- Logical properties are used for inline spacing (`margin-inline`, `inset-inline-start`, `padding-inline`).
- The primary action stays in normal flow inside its card; nothing is sticky or fixed.

## Elevation & Depth

Flat. Cards are `--color-bg-surface` with a 1 px `--color-border`; there are no shadows. Depth
inside a card is tonal: the quote summary and neutral badges use `--color-bg-subtle`, the selected
choice uses the accent tint. Notices use the status tints. The only overlay-like element is the
skip link, which appears at the top when focused.

## Shapes

- `--radius-card` 10 px for cards and the transfer disclosure (`details`).
- `--radius-control` 6 px for inputs, buttons, choices, summaries and notices.
- Badges are pills (999 px).
- Borders: 1 px everywhere; the error state changes an input's border colour only.

## Components

All components are React function components in `web/src/components/`; styles are global classes.

- **Card** (`section.card` with `h2`, optional `.card-head` for a heading plus right-aligned meta/actions).
- **Stats list** (`dl.stats > div.stat > dt + dd`): caption label over a value; `dd.value` for the
  headline figure, `dd.caption` for supporting detail. Used by `PricePanel`, `HookPanel`, `ContractsPanel`.
- **Buttons** (`.btn`, `.btn.primary`, `.btn.small`, `.btn.wide`): 2.5 rem min-height (2 rem for small),
  6 px radius, secondary is white with a strong border, primary is teal with white text. Hover only
  under `@media (hover: hover)`; `:active` scales to 0.96; disabled uses opacity 0.55 and
  `cursor: not-allowed`. Exactly one primary per view region (Buy/Sell, Connect, Switch).
- **Field** (`.field` with `label`, `.input`, `.hint`, `.error`): label bound with `htmlFor`; the hint is
  linked through `aria-describedby`, replaced by the error id when invalid; invalid inputs get
  `aria-invalid="true"` and the first invalid field receives focus on submit. `.input-row` puts a
  small button (Max) beside an input.
- **Choice** (`label.choice > input[type=radio]`): bordered pill-like radio with text; selected state
  is accent tint + accent text; focus ring drawn on the label via `:has(input:focus-visible)`.
  Grouped in a `fieldset` with a `legend`.
- **Summary** (`.summary` with `.row`s): grey box listing quote facts; `aria-live="polite"` so the quote
  announces when it changes.
- **Steps** (`Steps.tsx`, `ol.steps`): numbered transaction steps with a state word (Pending / In progress /
  Done / Failed / Skipped), detail text and an explorer link for the hash; rendered inside a
  `role="status"` region.
- **Badge** (`.badge`, `.badge.ok|warn|err`): short status text; never colour-only.
- **Notice** (`.notice`, `.notice.ok|warn|err`): block message; errors that block a task use `role="alert"`.
- **Tables** (`table` in `.table-wrap`): caption-sized bold header cells, numeric cells right-aligned
  and tabular, last row without a border.
- **Contract list** (`ul.contract-list`): name + code badge, role, explorer link, ABI link and hash.
- **Disclosure** (`details/summary`): the transfer form is collapsed by default; the summary is the
  visible cue.
- **Wallet panel** (`WalletPanel.tsx`): connect buttons (one per discovered wallet), connected
  address with explorer link, chain badge, a single "Switch to Sepolia" control on the wrong chain,
  Disconnect, and a polite live region for errors.
- **Skip link** (`.skip-link`): first focusable element, visible on focus.

Keyboard: every control is native (`button`, `input`, `a`, `summary`); Tab order follows reading
order; `:focus-visible` draws the 2 px ring on everything, including choices.

## Do's and Don'ts

- Start a new page with `main.page`, a `.page-header`, then `section.card`s inside `.grid-2`; use
  `.span-2` for full-width cards.
- Use semantic tokens only; add a token if a role is missing rather than reusing a border colour as text.
- Keep one `.btn.primary` per task region; everything else is `.btn`.
- Put every number that updates in a `.num` or `.stat dd` so it stays tabular; format amounts with
  `formatAmount` and ratios with `formatRatio` from `web/src/lib/price.ts`.
- Every new input needs a `label`, a hint or error linked by `aria-describedby`, and `inputMode`.
- Keep transaction controls disabled with a visible reason when the wallet, chain or code checks are
  not satisfied; validate amounts on submit and focus the first error.
- Do not add shadows, a dark theme, a second accent hue, decorative motion or web fonts; the system
  is deliberately flat and single-accent.
- Recipe for another page: copy `index.html` and `main.tsx`, render a component that returns
  `<main className="page">` with cards built from the stats list, field and button classes, reuse
  `loadDeployment` for addresses and `makePublicClient` for reads, and keep `base: './'`.
