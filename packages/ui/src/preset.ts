import type { Config } from 'tailwindcss'

/**
 * The locked preset. Every value the components may use is a NAMED token here;
 * arbitrary values (text-[#…], p-[13px]) are forbidden by local/no-arbitrary-value
 * so this file is the only door to the palette, scale, spacing and radii.
 */
const preset = {
  theme: {
    extend: {
      // Named breakpoint so the Shell can stack under 840px without an arbitrary value.
      screens: { wide: '840px' },
      colors: {
        // Pocket's (B57.2). Text is ink, ink-2 or ink-3; tangerine-ink is the one orange that may
        // carry words; tangerine, the agent colours, success and danger fills are never text.
        page: 'var(--page)',
        cloud: { DEFAULT: 'var(--cloud)', 2: 'var(--cloud-2)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        line: 'var(--line)',
        control: 'var(--control)',
        tangerine: { DEFAULT: 'var(--tangerine)', ink: 'var(--tangerine-ink)', 50: 'var(--tangerine-50)' },
        success: { DEFAULT: 'var(--success)', 50: 'var(--success-50)' },
        danger: { DEFAULT: 'var(--danger)', 50: 'var(--danger-50)' },
        primary: 'var(--primary)',
        'on-primary': 'var(--on-primary)',
        scrim: 'var(--scrim)',
        agent: {
          cobalt: 'var(--agent-cobalt)', orchid: 'var(--agent-orchid)', sky: 'var(--agent-sky)', mint: 'var(--agent-mint)',
          lemon: 'var(--agent-lemon)', rose: 'var(--agent-rose)', lime: 'var(--agent-lime)',
        },
        // Today's names, aliases onto Pocket's in theme.css, until each screen is redrawn (B57.88).
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        sidebar: 'var(--sidebar)',
        rule: { DEFAULT: 'var(--rule)', strong: 'var(--rule-strong)' },
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        label: 'var(--label)',
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', ink: 'var(--accent-ink)', tint: 'var(--accent-tint)', strong: 'var(--accent-strong)' },
        lens: 'var(--lens)',
        lxc: 'var(--lxc)',
        tier1: 'var(--tier1)',
        tier3: 'var(--tier3)',
        settled: 'var(--settled)',
        held: 'var(--held)',
        slashed: 'var(--slashed)',
      },
      fontFamily: {
        sans: ['var(--sans)'],
        // Pocket's display face: headings and large money.
        display: ['var(--display)'],
        mono: ['var(--mono)'],
        /**
         * THE FIGURE FACE — `font-figure`. Every numeral in the product renders here.
         *
         * Pocket (B57.2): Figtree with tabular figures, so columns of money line up. It was
         * IBM Plex Mono with `tnum` while the system followed the 4 Oct board; Pocket sets every
         * number in its UI face and only large money in the display face (`font-display`).
         * Mono stays for identifiers: keys, hashes, code.
         */
        figure: ['var(--sans)', { fontFeatureSettings: '"tnum" 1' }],
      },
      fontSize: {
        // ── THE CONSOLE SCALE, IN rem ─────────────────────────────────────────────────────────
        //
        // These five steps and the eyebrow below are what every screen behind the gate, both
        // front doors and both legal pages are written in. They are in `rem` because that is the
        // ONLY unit the reader's own browser font-size preference reaches: with no author rule on
        // the root element, that preference IS `font-size` on `<html>`, and `rem` resolves
        // against it. In px it reaches nothing.
        //
        // MEASURED IN REAL CHROME on the built artifact at `c4a7aa4`, moving the root from 16px
        // to 24px (Chrome's "Very Large") across all fifteen addresses: 488 elements carrying a
        // text node, 0 changed size — while a `font-size:1rem` probe on each page moved 16 → 24,
        // and /marketing's document grew 5392 → 6301px because the SPACING scale is already rem.
        // The gaps inflated and the type did not.
        //
        // ⚠ THE NUMBERS ARE THE SAME NUMBERS. Each is its old px over 16, so at the default root
        // the product is byte-for-byte the design it was. Changing the unit must never change the
        // size; apps/web/src/typeScaleUnits.test.ts holds both halves of that.
        //
        // ⚠ NOT `em`. em resolves against the PARENT, so a token used inside another token's
        // element compounds. rem is the only one that means "the reader's size" wherever it is
        // written.
        /**
         * THE CONSOLE'S ONE DISPLAY STEP — `page`, the heading that opens a screen.
         *
         * The five steps below are a control-panel scale that stops at 24px, and §DISPLAY at the
         * bottom of this file says of the marketing ramp "⚠ NOT FOR THE APP … if a console screen
         * ever wants display type, that is a design conversation, not an import."
         * displayScale.test.ts enforces that at the AuthGate. THIS IS THAT CONVERSATION, resolved
         * the way the sentence asks for: the console gets ONE fluid step of its own rather than an
         * import of a marketing one, so the boundary stays exactly where it is.
         *
         * ⚠ ONE STEP, NOT A RAMP — the same argument `scale-98` makes below. There is no `page-2`
         * because a console has one page title per address and nothing else needs display type.
         *
         * ⚠ THE TWO NUMBERS ARE BORROWED, NOT INVENTED, and that is what makes them checkable:
         *   · FLOOR 1.5rem IS `title` — literally the same declaration, so at a narrow viewport
         *     `page` renders at exactly what this heading renders at today, AT ANY ROOT. That is
         *     the non-regression claim, and it is asserted rather than asserted-about.
         *   · CEILING 38px IS `display-2`'s ceiling, the site's second display step, so the
         *     console's largest type never out-shouts the public page's.
         * apps/web/src/pageScale.test.tsx asserts BOTH bounds against the EMITTED stylesheet, and
         * asserts the ceiling is strictly above the floor — a value that collapsed back to 24px
         * would be a rename wearing a new name, and it would red.
         *
         * ⚠ THE LEADING AND TRACKING ARE THE CONSOLE'S, NOT THE SITE'S, and the difference is the
         * point. `display-2` sets 1.06/-0.03em: a closing line with air around it. This heading
         * sits directly above dense rows, so it takes 1.15/-0.02em — looser leading so a
         * two-line headline does not clot, gentler tracking so it reads as the product's voice
         * rather than as a hero borrowed from the front door.
         *
         * ⚠⚠ THE FLOOR IS rem AND THE CEILING IS px, AND THE FIRST HALF IS A CORRECTION MEASURED
         * IN REAL CHROME. This step was written `clamp(24px, 3vw, 38px)` — the value W1.1.0
         * specifies — on §DISPLAY's reasoning that a clamp floor in rem "grows with the reader
         * while the viewport does not". That reasoning is right about /marketing and WRONG here,
         * and the difference is worth stating because it inverts the accessibility direction.
         *
         * MEASURED at 320px CSS width, probing `title` against both candidate floors:
         *
         *     root    title    clamp(24px,…)    clamp(1.5rem,…)
         *     16px    24px     24px  ✓          24px  ✓
         *     20px    30px     24px  ✗          30px  ✓
         *     24px    36px     24px  ✗          36px  ✓
         *
         * With a px floor, a reader who has ENLARGED their browser font sees the page heading get
         * SMALLER when it is promoted from `title` — 36px down to 24px at Chrome's "Very Large".
         * That is a regression for exactly the reader the rem rule above exists to serve, and it
         * is invisible at the default root, where the two are identical.
         *
         * ⚠ AND THE OVERFLOW THAT MOTIVATED px DOES NOT REPRODUCE HERE. Measured at 320×24 with a
         * rem floor: document scrollWidth 320 against clientWidth 320 on every root tested. That
         * overflow was /marketing's `flex-1 whitespace-nowrap` section tabs, which cannot give
         * width back; a heading in a `max-w-3xl` block WRAPS. The rule is not "display steps are
         * px", it is "a step that cannot wrap must not grow with the root".
         *
         * The CEILING stays px on purpose: 38px is a hard cap borrowed from `display-2`, and in
         * rem it would let a large-root reader push the console's biggest type past the site's.
         * ⚠ AT THE DEFAULT 16px ROOT THIS IS BYTE-FOR-BYTE THE VALUE W1.1.0 SPECIFIED — 1.5rem IS
         * 24px — so the design is unchanged and only its behaviour under a changed preference is.
         */
        page: ['clamp(1.5rem, 3vw, 38px)', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '500' }],
        title: ['1.5rem', { lineHeight: '1.2', fontWeight: '640' }], // 24px at a 16px root
        head: ['1.0625rem', { lineHeight: '1.3', fontWeight: '600' }], // 17px
        // B29.7 — the shell's top-bar title: the board's PRODUCT UI tile sets it in Space Grotesk 500.
        bar: ['1.25rem', { lineHeight: '1.3', fontWeight: '500' }], // 20px
        body: ['0.875rem', { lineHeight: '1.45', fontWeight: '400' }], // 14px
        // B29.10 — a chat reply and question, read at length: the board's body step, 15/24.
        reading: ['0.9375rem', { lineHeight: '1.6', fontWeight: '400' }], // 15px on 24px
        caption: ['0.75rem', { lineHeight: '1.35', fontWeight: '600' }], // 12px
        // the µ-tail: 12.5px, dimmed + underscored in MuNumeral (moves with the scale).
        micro: ['0.78125rem', { lineHeight: '1', fontWeight: '500' }], // 12.5px

        // ── THE EYEBROW ───────────────────────────────────────────────────────────────────────
        //
        // The small uppercase label that names a region before it says anything, and the ONE
        // small label in this system. It existed already, hand-rolled twenty-one times in four
        // shapes — `text-caption uppercase tracking-wide` with text-muted, with text-faint, with
        // font-semibold, and once with no colour at all. Four shapes is not a style, it is drift.
        //
        // Measured off the public site, which uses one shape for it everywhere: 11px, mono,
        // letter-spacing .14em–.32em, weight 400, in the faint or dim ink. Pinned at the modal
        // .24em, with the tracking IN the token — a caller who applies the size and forgets the
        // tracking gets small mono text, not an eyebrow.
        //
        // ⚠ WEIGHT IS 400, WHICH IS A DROP FROM THE CAPTION'S 600, AND THAT IS THE POINT: it
        // leaves `font-semibold` free to MEAN something. Members distinguishes owner from member
        // by weight rather than hue; at 600 the token would have silently collapsed that
        // distinction into no distinction at all.
        //
        // ⚠ THE UPPERCASE IS NOT IN HERE, deliberately. `text-transform: uppercase` maps
        // µ (U+00B5) to Greek capital Mu, and µLENS/µLXC sit inside these labels. It is applied
        // at the call site, where MuNumeral can keep its µ in a `normal-case` span.
        eyebrow: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.24em', fontWeight: '400' }], // 11px
        // B57.3 — Pocket's eyebrow (pocket.css .eyebrow): 12px Figtree at .04em, uppercase at the call site.
        'pocket-eyebrow': ['0.75rem', { lineHeight: '1.3', letterSpacing: '0.04em', fontWeight: '600' }],
        // B57.5 — a dialog's heading (pocket.css .dialog h2, 22px) and the approval sheet's amount (.sheet .amount, 56px),
        // both in the display face at the call site.
        'pocket-dialog': ['1.375rem', { lineHeight: '1.2', fontWeight: '750' }],
        'pocket-amount': ['3.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '750' }],
        // B57.7 — a balance card's amount (the reference's 44px, and 40px where cards sit side by side).
        'pocket-balance': ['2.75rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '750' }],
        'pocket-balance-sm': ['2.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '750' }],

        // ── DISPLAY: the marketing scale ──────────────────────────────────────────────────────
        //
        // The five sizes above are a CONTROL-PANEL scale and stop at 24px on purpose — a console
        // has no use for display type, and giving it any would invite a hero headline into a
        // settings screen.
        //
        // The public page does need it, and the honest way to give it one is a named scale rather
        // than arbitrary values: `no-arbitrary-value` exists so a component cannot silently invent
        // its own type, and a marketing page is not an exemption from that — it is simply a
        // consumer with a requirement the scale had not covered yet. Fluid by design (clamp), so
        // the page holds its proportions from a phone to a wide monitor without a breakpoint per
        // size, and each entry carries its own leading and tracking so a caller cannot half-apply
        // one.
        //
        // ⚠ NOT FOR THE APP. Nothing behind the AuthGate should reach for these; if a console
        // screen ever wants display type, that is a design conversation, not an import.
        //
        // ⚠ WEIGHT AND TRACKING RECALIBRATED TO THE FACE. These were set for a system
        // neo-grotesque at 640–660. Space Grotesk is a GEOMETRIC sans and carries its
        // character in the letterforms, not the weight; the site sets every display line at
        // font-medium/semibold with -0.03em. Measured off the served markup: h1 is
        // `clamp(1.9rem,4.4vw,3.6rem) font-medium leading-[1.04] tracking-[-0.03em]`. The size
        // ramp is unchanged — only the weight and tracking move, because those are properties
        // of the typeface and the typeface changed.
        //
        // ⚠ STILL px WHILE THE CONSOLE SCALE ABOVE IS rem, AND THAT IS A MEASUREMENT RATHER THAN
        // AN OVERSIGHT. Converting these too was measured in Chrome at 320px CSS width with a
        // 24px root: /marketing's scrollWidth went to 346 against a 320 client width — a clamp
        // FLOOR in rem grows with the reader while the viewport does not, and the page's section
        // tabs (`flex-1 whitespace-nowrap`) cannot give the width back. The console conversion
        // does not touch that: at the same 320×24, all fifteen addresses including /marketing sit
        // at scrollWidth 320. typeScaleUnits.test.ts pins this side of the table too, with the
        // number to re-measure if anyone moves it.
        'display-1': ['clamp(34px, 6vw, 58px)', { lineHeight: '1.04', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-2': ['clamp(25px, 3.8vw, 38px)', { lineHeight: '1.06', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-3': ['clamp(23px, 3.2vw, 33px)', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-4': ['clamp(19px, 2.5vw, 26px)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        // The paragraph that sits directly under a display heading.
        lede: ['clamp(15px, 1.7vw, 19px)', { lineHeight: '1.5', fontWeight: '400' }],
        // A measured figure quoted at reading size — the ledger numbers on the public page.
        figure: ['28px', { lineHeight: '1', fontWeight: '560' }],
      },
      /**
       * THE PRESS — `active:scale-98`, the one motion token in the system.
       *
       * The site writes it `active:scale-[0.98]`. That exact string is what
       * `local/no-arbitrary-value` exists to refuse, and the refusal is right: an escaped
       * 0.98 in one component and an escaped 0.97 in the next is not a system. So the scale
       * is EXTENDED by one step instead. Tailwind's own scale is keyed in percent
       * (scale-95 = .95); 98 continues it rather than inventing a naming.
       *
       * ⚠ ONE STEP, NOT A RAMP. There is no scale-99 or scale-97 here because nothing needs
       * one. A second press depth would be a second answer to a question with one answer.
       *
       * ⚠ THE SCALE IS NEUTRALISED UNDER prefers-reduced-motion IN theme.css, and it has to
       * be: zeroing transition-duration removes the tween, not the transform, so without
       * that block this token is an instant 2% jump for the users who asked for less motion.
       * apps/web/src/motion.test.tsx pins both halves.
       */
      scale: { 98: '0.98' },
      borderColor: { DEFAULT: 'var(--rule)' },
      // Pocket's: cards 24 and 18, inputs 14 (control), the sheet 28, pills for buttons and chips; B57.4's icon tiles 12
      // (pocket.css .kindico, .roomico) and the facts inset in a card or sheet 16 (.facts2).
      borderRadius: { card: '24px', 'card-tight': '18px', control: '14px', sheet: '28px', pill: '9999px', tile: '12px', inset: '16px' },
      // `edge` is Pocket's 1.5px control edge on every field (pocket.css .input), 3:1 on the page.
      // `edge-current` is the danger button's ring (pocket.css .btn.danger): the same 1.5px in the button's own ink.
      // `pick` is a picked choice's ring (pocket.css .pick.on): 2px of ink inside it (B57.141).
      boxShadow: {
        pocket: 'var(--shadow)', 'pocket-lg': 'var(--shadow-lg)', edge: 'inset 0 0 0 1.5px var(--control)',
        'edge-current': 'inset 0 0 0 1.5px currentColor', pick: 'inset 0 0 0 2px var(--ink)',
      },
      // B57.4 — Pocket's control sizes, as half steps of Tailwind's own quarter-rem scale (h-11 is 44 already):
      // 0.75 the switch's 3px inset, 5.25 its thumb's travel, 6.5 the switch and chip (26), 8.5 the small button (34),
      // 9.5 the kind tile (38), 11.5 the field (46), 13.5 the large button (54).
      spacing: {
        gutter: '16px', row: '38px',
        0.75: '0.1875rem', 5.25: '1.3125rem', 6.5: '1.625rem', 8.5: '2.125rem', 9.5: '2.375rem', 11.5: '2.875rem', 13.5: '3.375rem',
        // B57.5 — the sheet's 7px tangerine edge (1.75) and its 22px foot (5.5), the sheet 420 wide (105), a dialog 480 (120).
        1.75: '0.4375rem', 5.5: '1.375rem', 105: '26.25rem', 120: '30rem',
        // B57.8 — the shell: the sidebar 232 wide (58) with its 18px padding (4.5), and the top bar 72 tall (`header`).
        4.5: '1.125rem', 58: '14.5rem', header: '4.5rem',
      },
      // Pocket's focus ring is 3px of tangerine (B57.4).
      outlineWidth: { 3: '3px' },
      // `below-header` — the viewport under the console's sticky top bar (`top-header`, Pocket's 72px, B57.8).
      // B10.3's chat fills exactly that, so its composer sits at the bottom of the screen.
      height: { row: '38px', 'below-header': 'calc(100dvh - 4.5rem)' },
      minHeight: { row: '38px', 'below-header': 'calc(100dvh - 4.5rem)' },
      outlineColor: { accent: 'var(--accent)' },
      ringColor: { accent: 'var(--accent)' },
    },
  },
} satisfies Partial<Config>

export default preset
