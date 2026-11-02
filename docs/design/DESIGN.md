---
name: Solemate Clean & Craft
colors:
  surface: '#fff9ef'
  surface-dim: '#dfd9d1'
  surface-bright: '#fff9ef'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f9f3ea'
  surface-container: '#f3ede4'
  surface-container-high: '#ede7de'
  surface-container-highest: '#e7e2d9'
  on-surface: '#1d1b16'
  on-surface-variant: '#43474e'
  inverse-surface: '#32302a'
  inverse-on-surface: '#f6f0e7'
  outline: '#73777f'
  outline-variant: '#c3c6cf'
  surface-tint: '#3d608a'
  primary: '#002546'
  on-primary: '#ffffff'
  primary-container: '#133b63'
  on-primary-container: '#83a6d4'
  inverse-primary: '#a6c9f9'
  secondary: '#635e54'
  on-secondary: '#ffffff'
  secondary-container: '#e7dfd2'
  on-secondary-container: '#676258'
  tertiary: '#002544'
  on-tertiary: '#ffffff'
  tertiary-container: '#0c3b64'
  on-tertiary-container: '#80a6d5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d3e4ff'
  primary-fixed-dim: '#a6c9f9'
  on-primary-fixed: '#001c38'
  on-primary-fixed-variant: '#244871'
  secondary-fixed: '#e9e1d5'
  secondary-fixed-dim: '#cdc6b9'
  on-secondary-fixed: '#1e1b13'
  on-secondary-fixed-variant: '#4b463d'
  tertiary-fixed: '#d2e4ff'
  tertiary-fixed-dim: '#a3c9fa'
  on-tertiary-fixed: '#001c37'
  on-tertiary-fixed-variant: '#1f4972'
  background: '#fff9ef'
  on-background: '#1d1b16'
  surface-variant: '#e7e2d9'
typography:
  headline-xl:
    fontFamily: Outfit
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Outfit
    fontSize: 30px
    fontWeight: '800'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Outfit
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Outfit
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  title-lg:
    fontFamily: Outfit
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-sm:
    fontFamily: Outfit
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Outfit
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Outfit
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.08em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

This design system expresses premium sneaker and leather care through an artisan craft narrative combined with clean modern utility. The core aesthetic merges organic stationery sensibilities—warm mottled pulp paper, speckled beige, and crafted textures—with the crisp discipline of deep marine indigo and slate accents. 

The emotional tone balances obsessive sneakerhead craftsmanship with trustworthy operational efficiency. Users should perceive tactile warmth, reliability, meticulous hygiene, and effortless control over services, bookings, and inventory tracking. The style bridges high-end streetwear boutique detailing with human-centered service ergonomics: pill-shaped triggers, deeply rounded cards (`rounded-3xl`), tactile card framing, and structured tabular clarity.

## Colors

The palette revolves around deep coastal navy and natural unbleached kraft paper hues:

- **Primary (`#133b63` / `#1b4d7e`)**: Deep Marine & Navy Blue. Conveys clinical precision, premium status, and strong brand presence. Used for primary interactive actions, high-emphasis headlines, active navigation states, and solid brand anchors.
- **Secondary (`#eae2d5`)**: Warm Craft Neutral. Used as intermediate card surfaces, subtle chip containers, interactive hover fills, and borders to provide tactile warmth without visual clutter.
- **Tertiary (`#4a709c`)**: Slate Blue / Denim Mist. Used for secondary status pills, supporting micro-copy, icon accents, and subtle borders.
- **Neutral Canvas (`#f5efe6`)**: Warm Paper Cream. The default application canvas background, simulating organic fibrous cardstock.
- **Text & Foreground**: High-contrast navy (`#0d233a`) for primary body and titles; slate charcoal (`#4d5b6a`) for secondary captions and metadata.
- **Surface Elevation**: Off-white pearl (`#faf7f2`) for elevated card surfaces resting above the paper cream canvas.

## Typography

The type system blends the contemporary geometric punch of **Outfit** for headlines and brand badges with the clear, open humanist legibility of **Plus Jakarta Sans** for interfaces, tabular service data, and body copy.

- **Display & Headings (Outfit)**: Bold, condensed geometric rhythm reminiscent of vintage industrial garment tags and contemporary streetwear brands. Titles feature tight tracking for punchy delivery.
- **Labels & Badges (Outfit)**: Upper-case or title-case with deliberate tracking (`+0.04em` to `+0.08em`) to mirror archival shoe repair tickets and price catalogs.
- **Body & Tabular Digits (Plus Jakarta Sans)**: Ensures instant clarity for pricing tables, turnaround day counters, customer names, and workflow trackers.

## Layout & Spacing

The layout utilizes a structured 12-column responsive fluid grid for desktop and tablet screens, folding into a 4-column stack on mobile devices.

- **Margins & Gutter Architecture**: 
  - **Desktop (≥ 1024px)**: Outer margins at `2rem` (32px), with `1.25rem` (20px) gutters between dashboard modules.
  - **Mobile (< 768px)**: Outer margins collapse to `1rem` (16px), with `0.75rem` (12px) compact gutters to retain content density without edge crowding.
- **Rhythm**: Spacing follows a modular 4px/8px baseline rhythm (`0.25rem`, `0.5rem`, `1rem`, `1.5rem`, `2.25rem`). Card padding remains spacious at `1.5rem` on desktop to convey relaxed premium presentation, reducing to `1rem` on mobile interfaces.

## Elevation & Depth

Visual hierarchy uses physical material stacking rather than high-contrast digital dropshadows:

1. **Base Layer**: Mottled Paper Neutral (`#f5efe6`) representing raw textured backing.
2. **Surface Tier 1 (Cards & Work Panels)**: Soft Pale Tint (`#faf7f2`) framed with delicate low-contrast craft borders (`1.5px solid #eae2d5`). Ambient diffuse drop: `0px 4px 16px -2px rgba(19, 59, 99, 0.04)`.
3. **Surface Tier 2 (Hovered & Active Cards)**: Elevated white with deepened marine diffusion: `0px 10px 24px -4px rgba(19, 59, 99, 0.08)`.
4. **Surface Tier 3 (Modals, Overlays, Floating Menus)**: Pure cardstock background framed with `#133b63` hairline stroke and ambient blur: `0px 20px 36px -8px rgba(19, 59, 99, 0.14)`.

## Shapes

The design uses an ultra-friendly, pill-driven geometry paired with exaggerated rounded card architectures:

- **Buttons & Chips**: Pure pill shapes (`rounded-full` / `9999px`) to echo the pill-shaped service category badges seen in vintage clean-lab aesthetics.
- **Cards & Data Modules**: Generously curved `rounded-3xl` (1.5rem to 2rem) shells that soften the interface and emulate rounded foam soles and molded shoe silhouettes.
- **Inner Form Controls & Inputs**: Ergonomic `rounded-xl` (0.75rem to 1rem) corners nested naturally within outer card envelopes.

## Components

### Buttons
- **Primary Pill**: Background `#133b63`, foreground `#faf7f2`, font Outfit SemiBold, full pill shape (`rounded-full`), padding `0.75rem 1.75rem`. Hover state transitions to `#1b4d7e` with slight scale (`1.01`).
- **Secondary / Outlined Pill**: Border `1.5px solid #133b63`, background transparent, foreground `#133b63`. Active state fills with warm craft wash (`#eae2d5`).
- **Ghost Action**: Text `#4a709c`, hover background `rgba(234, 226, 213, 0.5)`.

### Chips & Badges
- **Category Badge**: Clean capsule shape (`rounded-full`), border `1.5px solid #133b63`, text `#133b63`, background `rgba(250, 247, 242, 0.8)`, letter-spaced uppercase text (`label-sm`).
- **Status Pills**:
  - *In Progress*: Background `#eae2d5`, text `#133b63`.
  - *Ready / Clean*: Background `#133b63`, text `#ffffff`.
  - *Express / Urgent*: Background `#fff1eb`, text `#bf360c`, border `1px solid #ffd7c2`.

### Cards & Panels
- **Service & Metric Modules**: Wrapped in `rounded-3xl`, background `#faf7f2`, subtle hairline stroke `1.5px solid #eae2d5`. Header elements utilize tabular layout with clean dividers.
- **Ticket / Order Summary**: Uses a dashed craft divider (`border-dashed border-[#d8cdbc]`) evoking physical drop-off receipts.

### Form Inputs & Selectors
- **Input Fields**: Height `48px`, background `#f5efe6` (inset tone), border `1.5px solid #eae2d5`, border-radius `0.75rem`. On focus: border `#133b63` with subtle ring `0 0 0 3px rgba(19, 59, 99, 0.12)`.
- **Checkboxes & Radios**: Fully rounded circular radio triggers and `rounded-md` checkboxes filled with `#133b63` on selection, paired with warm craft checkmarks.

### Price & Turnaround Lists
- Two-column or matrix lists with clean dotted or dashed baseline leaders connecting service tiers (e.g., "Deep Clean", "Unyellowing") directly to pricing (`K` notation in Outfit Bold).