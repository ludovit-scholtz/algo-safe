---
name: Algo Safe
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#b9cac6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#849490'
  outline-variant: '#3b4a47'
  surface-tint: '#00decb'
  primary: '#71ffec'
  on-primary: '#003732'
  primary-container: '#00e5d1'
  on-primary-container: '#006258'
  inverse-primary: '#006a61'
  secondary: '#b8c4ff'
  on-secondary: '#002486'
  secondary-container: '#004bf9'
  on-secondary-container: '#d5daff'
  tertiary: '#e8e8e8'
  on-tertiary: '#303030'
  tertiary-container: '#cccccc'
  on-tertiary-container: '#565656'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#41fce7'
  primary-fixed-dim: '#00decb'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005048'
  secondary-fixed: '#dde1ff'
  secondary-fixed-dim: '#b8c4ff'
  on-secondary-fixed: '#001354'
  on-secondary-fixed-variant: '#0036bb'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  container-max: 1280px
  gutter: 20px
---

## Brand & Style
The design system is engineered for high-stakes financial operations, focusing on institutional-grade security and clarity. The brand personality is **authoritative, precise, and resilient**, designed to instill confidence in treasury managers and DAO governors. 

The aesthetic follows a **Corporate / Modern** approach with a "Technical-High-Fidelity" twist. It utilizes a structured layout, subtle depth through tonal layering, and high-contrast status indicators to ensure that complex multi-signature workflows remain legible and error-proof. The UI avoids unnecessary ornamentation, favoring "function-first" density that mirrors the reliability of the Algorand blockchain.

## Colors
The palette is rooted in a deep "Midnight Navy" foundation to provide a stable, low-strain environment for professional use. 

- **Primary (Algorand Teal):** Used for primary actions, success states, and signature confirmations. It represents the speed and finality of the network.
- **Secondary (EURD Blue):** Used for liquidity-related actions, stablecoin balances, and secondary navigation elements.
- **Neutral / Slate:** A range of blues and greys ranging from `#020617` (deepest background) to `#94A3B8` (text/labels) to ensure hierarchical clarity.
- **Functional Accents:** High-vibrancy reds and ambers are reserved strictly for destructive actions (deleting policies) or pending approvals.

## Typography
This design system utilizes **Inter** for all interface elements to ensure maximum legibility across dense data tables and policy forms. For wallet addresses, transaction hashes, and technical metadata, **JetBrains Mono** is employed to provide a clear distinction between human-readable content and machine-readable data.

- **Scale:** Modular 1.25x scale.
- **Formatting:** Use `label-md` in all-caps for section headers and table column titles to create a distinct structural rhythm.
- **Accessibility:** Minimum contrast ratio of 4.5:1 for body text against the navy background is strictly enforced.

## Layout & Spacing
The layout follows a **Fixed-Width Grid** on desktop (1280px max-width) to maintain a controlled reading line for complex financial data. 

- **Grid:** 12-column system with 24px gutters.
- **Rhythm:** A 4px baseline grid ensures consistent vertical alignment.
- **Mobile Adaptation:** At the 768px breakpoint, the sidebar collapses into a bottom navigation bar or a hamburger menu, and horizontal padding reduces to 16px. Cards reflow from multi-column to single-column stacks.
- **Density:** Use "Compact" spacing for data tables (8px cell padding) and "Comfortable" spacing for policy creation wizards (24px+ padding).

## Elevation & Depth
Depth is achieved through **Tonal Layering** rather than traditional drop shadows, which can feel muddy in dark interfaces. 

- **Level 0 (Background):** `#020617` — The canvas.
- **Level 1 (Surface):** `#0F172A` — Primary cards and navigation panels.
- **Level 2 (Elevated):** `#1E293B` — Active states, dropdowns, and modals.
- **Borders:** Every card and interactive element must have a 1px solid border (`#334155`). 
- **Active State Shadow:** For modals, use a focused 16px blur shadow with 40% opacity of the background color to lift the element without adding visual noise.

## Shapes
The design system uses a **Soft (0.25rem)** roundedness approach. This strikes a balance between the "Industrial/Scientific" look of sharp corners and the "Consumer/Friendly" look of fully rounded UI. 

- **Small elements (Buttons/Inputs):** 4px (rounded-sm).
- **Medium elements (Cards/Modals):** 8px (rounded-md).
- **Large containers:** 12px (rounded-lg).
- **Status Pills:** 100px (full-round) to distinguish status chips from interactive buttons.

## Components

### Buttons
- **Primary:** Algorand Teal background, black text. High-contrast, no shadow.
- **Secondary:** Transparent background, Teal 1px border.
- **Tertiary:** Slate background, white text. For low-priority actions.

### Transaction Previews
Transaction items must include a **Direction Indicator** (Inbound/Outbound) using colored icons. Amount typography should be prominent (`headline-sm`). Always include a "Verify on Explorer" link in `label-md`.

### Policy Controls
Policy rows should use a "Logic-Block" style: **[Condition] + [Action] + [Signers]**. Each block is a Level 2 surface with a subtle inner glow when being edited.

### Agent Status Cards
Status cards for automated treasury agents (e.g., rebalancing bots) use a "Pulse" indicator:
- **Active:** Teal pulse.
- **Paused:** Slate static.
- **Error:** Red pulse.
Include a "Heartbeat" timestamp in `code-sm` to show the last successful block synchronization.

### Input Fields
Darker background than the card surface (`#020617`). 1px Slate border. On focus, the border transitions to Primary Teal with a 2px outer glow (0% blur).