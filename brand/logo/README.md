# Talyvor logo kit

Chosen by Nick on 4 Nov 2026: "4 lowercase" and "make it the actual logo and use it." He asked for an upgrade the same day: "make it more beautiful and full. add some kind of effect. make the text fuller, find a better more friendly font and more attractive font, harder to immitate." Then: "i want the middle set of lines of the light version to be the blue colour of dark version, not black. and i dont want the video of moving lights through the lines." This kit is that version: the logo is still, with no animation.

The logo shows many streams of payments flowing into one tangerine arrow, with the name in lowercase. It is drawn as vectors from the two images Nick picked, without the dotted wave.

## What is in the drawing

- **Streams:** 14 lines in the top stream, 12 in the middle and 14 in the bottom. Each fades in from the left and is stronger in the middle of its stream, so the streams look round.
- **Silk:** a translucent layer under each stream gives the streams body.
- **Light:** a warm glow where the streams meet the arrow.
- **Arrow:** a gradient, a darker shade at the bottom, a gloss at the top left and a lit edge. On light backgrounds it casts a soft shadow; on dark ones it glows.
- **Name:** Figtree, the typeface of Pocket's app, at weight 850 and redrawn as our own outline. Every corner is softened, the inner joins are eased and the letters sit a touch tighter. Typing "talyvor" in Figtree does not reproduce it, and no font is needed to show it.

## Two versions, one drawing

| Version | Use it on | Streams (top, middle, bottom) | Arrow | Name |
|---|---|---|---|---|
| `on-light` | white and light backgrounds | ink, blue, tangerine | tangerine, soft shadow | ink `#111216` |
| `on-dark` | ink and dark backgrounds | white, blue, tangerine, with a glow | tangerine, glowing | `#F2F3F5` |

Every path, line width and position is identical in the two versions; only the colours and the light change. `build/check_identical.py` proves this; run it after any change.

## Which file goes where

| Need | File |
|---|---|
| Website and app header, light | `svg/talyvor-logo-on-light.svg` (240 px wide and up), `svg/talyvor-logo-small-on-light.svg` (120 to 240 px) |
| Website and app header, dark | `svg/talyvor-logo-on-dark.svg`, `svg/talyvor-logo-small-on-dark.svg` |
| The symbol on its own | `svg/talyvor-symbol-on-light.svg`, `svg/talyvor-symbol-on-dark.svg` (120 px and up); `symbol-small` for 48 to 120 px |
| The name on its own | `svg/talyvor-wordmark-on-light.svg`, `svg/talyvor-wordmark-on-dark.svg` |
| Browser tab | `png/favicon/favicon.ico` (16, 32 and 48 px, each drawn for its size), `png/favicon/favicon.svg` |
| iPhone app | `png/app-icon/app-icon-1024.png` (square, no transparency; iOS rounds the corners) |
| Android app | `png/app-icon/android-adaptive-foreground-432.png` on `android-adaptive-background-432.png` (or background colour `#111216`) |
| Web app install (manifest) | `png/app-icon/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`; `apple-touch-icon.png` (180) |
| Phone splash | `png/symbol/talyvor-symbol-on-dark-1024.png` centred on `#111216` |
| Widget and Live Activity | `svg/talyvor-symbol-small-on-dark.svg` |
| Decks, documents, slides | `png/app-icon/app-icon-rounded-512.png`, `png/logo/*` |
| Profile pictures (LinkedIn, X) | `png/social/avatar-400.png`, `avatar-800.png` (safe inside a circle) |
| Link previews | `png/social/og-image-dark-1200x630.png`, `og-image-light-1200x630.png` |
| Emails (Track, Docs, receipts) | `png/email/talyvor-email-logo-on-light-400.png`, shown 200 px wide (email apps do not show SVG) |
| Lens status page, receipts, reports | `svg/talyvor-symbol-on-light.svg` and `-on-dark.svg` in browsers; the PNGs where a PDF or image renderer draws the page |
| Sign up and sign in, behind the card (decorative) | `svg/talyvor-streams-on-light.svg`, `svg/talyvor-streams-on-dark.svg`: the logo's streams on their own, as the Pocket design kit draws them |

For the build queue's logo swap (the five "Swap the logo everywhere" items): web app, favicons and website (1 of 5), the phone (2 of 5), Lens (3 of 5), Track's emails (4 of 5), Docs' emails (5 of 5). Every PNG and ICO here is made from the SVGs by `build/export.py`, so keep that script with the files.

## Sizes

- Full logo: 240 px wide and up. Between 120 and 240 px use the `logo-small` files, which draw fewer, stronger streams so they stay clear.
- Symbol: full from 120 px; `symbol-small` from 48 to 120 px. Favicons have their own drawings at 48, 32 and 16 px.
- Below 120 px wide, use the app icon or the symbol instead of the full logo.

## Space around it

Keep clear space of at least half the arrow's height on every side of the logo's frame. Nothing else goes inside it.

## Colours (Pocket)

Ink `#111216`, slate `#4A5061`, grey `#646B7B`, tangerine `#FF7A1A`, tangerine ink `#A84100`, dark page `#0F1013` and light text on dark `#F2F3F5`. The middle stream is blue in both versions, between Pocket's cobalt `#2F5BFF` and sky `#39C2FF`. Every gradient stop, the silk and the light are in `logo-colours.json`.

## Please do not

- Flatten the streams, remove their fades, silk or light, or redraw them as solid shapes.
- Recolour the streams or the arrow, or swap the versions (the on-light version on a dark background, or the reverse).
- Stretch, squash, rotate, outline, add other shadows, or put the logo on a busy photo.
- Set the name in a font: use the drawn name in these files. Do not change its spacing or move the arrow.
- Rebuild the logo by hand; change `build/logo.py` and run `build/export.py` instead.

## Technical notes

- The SVGs use gradients and SVG filters (the shadow and the glow). Every current browser shows them. Some PDF and image libraries, and every email app, do not: use the PNGs there.
- If two copies of the same SVG are pasted into one page as code, their internal ids repeat. Use them as `<img src>` files, or give each copy unique ids.
- Rebuild everything: `pip install fonttools uharfbuzz scipy numpy pillow pyclipper`, `npm i playwright`, then `python3 build/export.py` from this folder, then `python3 build/check_identical.py`.

## Before public filing

The logo is not yet cleared as a trademark. It started from AI images, which give no exclusive rights; the redraw and the drawn name are our own work, and Figtree's licence (SIL Open Font License, in `build/fonts/`) allows it in a logo. A UK trademark attorney's clearance search (UK, EU and US; classes 9, 36 and 42) should come before filing it or printing anything expensive with it.
