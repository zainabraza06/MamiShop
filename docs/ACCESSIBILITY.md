# Accessibility

Target: **WCAG 2.1 Level AA**.

This document records what is committed to, how it is verified, and where the
automated checks stop being sufficient.

---

## How it is tested

`tests/e2e/accessibility.spec.ts` runs axe-core over the homepage, product
listing, product detail (with and without a measurement form), cart, sign-in,
registration and the 404 page. It asserts **zero** violations at
`wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`.

Current status: **passing on every page.**

Automated auditing catches roughly a third of WCAG issues — contrast, missing
names, landmark structure, ARIA misuse. It cannot judge whether alt text is
_meaningful_, whether focus order makes sense, or whether a flow is usable with
a screen reader. So the suite is a floor, not a certificate, and the keyboard
tests alongside it cover a few things axe structurally cannot.

---

## Commitments and how each is met

### Colour and contrast

Every foreground/background pair in `src/app/globals.css` meets AA, with the
measured ratio noted inline wherever a pairing is close enough that a future
tweak could quietly break it. The palette is defined once as CSS variables so a
change happens in one place rather than in forty components.

Colour is never the only signal. Order statuses carry a label as well as a tone;
form errors carry an icon and text, not just a red border.

### Keyboard

Every interactive element is reachable and operable. A skip link is the first
tab stop on every page. `:focus-visible` gives one unmissable ring globally,
rather than each component inventing its own — and `:focus-visible` rather than
`:focus` so a mouse click does not leave a ring behind.

The measurement form, the unit toggle and the full checkout are all completable
by keyboard alone, and this is asserted rather than assumed.

### Touch targets

Buttons and inputs are `min-h-11` (44px), meeting WCAG 2.5.8. Most of this
store's traffic is on a phone, so this is a primary constraint rather than a
box-tick.

### Forms

`FormField` wires up four things together that hand-rolled markup usually gets
partly right:

- `htmlFor`/`id`, so the label focuses the control
- `aria-describedby` covering **both** the hint and the error, so a screen
  reader hears the requirement and the failure
- `aria-invalid` on the control
- `role="alert"` on the error, so it is announced when it appears

Long forms additionally get `FormErrorSummary`: one focusable list of links
straight to the offending fields, which is what WCAG 3.3.1 is really asking for
when an inline error may be far off-screen.

**Two labelling bugs were found by the E2E suite and fixed** — worth recording
because both were invisible on screen:

1. `MeasurementInput` wrapped its `<Input>` in a positioning div for the unit
   suffix. `FormField` clones its child to attach the id, so the id landed on
   the div and the input had no accessible name. The suffix is now an `Input`
   prop, and `FormField` warns in development when handed a plain host element.

2. The province and sort comboboxes had no accessible name at all. Radix's
   `Select` root renders **no DOM element**, so the cloned id vanished silently.
   `SelectField` now puts the id on `SelectTrigger`, the button the user
   actually focuses.

Both were caught because the tests select by accessible name: Playwright could
not find the fields, for exactly the reason a screen reader could not.

### Images

Every product image has alt text describing the garment, entered by the admin
and validated as required. Decorative images — the hover image on a card, the
measurement diagram — are `aria-hidden`, because the measurement instructions
already exist as text in each field's hint, which is what a screen-reader user
actually needs.

### Motion

`prefers-reduced-motion: reduce` collapses every animation and transition
globally, including skeleton shimmer and card hover transforms. Asserted in the
test suite.

### Zoom

The viewport meta deliberately does **not** cap `maximum-scale`. Blocking
pinch-zoom breaks WCAG 1.4.4, and it is usually done to stop iOS Safari zooming
on focused inputs. The real fix for that is a 16px input font size, which is
what `src/components/ui/input.tsx` does.

### Announcements

Live regions are used sparingly and deliberately. Result counts and cart
quantities are `aria-live="polite"`. Star ratings render the stars
`aria-hidden` and the value as text once — otherwise a screen reader reads
"star star star star star" on every review.

Product cards are a single link with one accessible name, rather than three
competing links per card. A grid of cards each exposing image, title and price
links makes navigation three times longer for no benefit.

---

## Known gaps

- **No screen-reader testing with real assistive technology.** NVDA and
  VoiceOver passes on the checkout flow are the highest-value next step.
- **No user testing** with people who use assistive technology.
- **Admin screens are less thoroughly audited** than the storefront. They are
  covered by the same primitives, but not by the axe suite.
- **Colour palette has not been checked** for the common forms of colour
  blindness beyond contrast ratios.

---

## Adding a component

1. Start from an existing primitive in `src/components/ui/`.
2. Use `FormField` for inputs and textareas, `SelectField` for selects.
3. Give every control an accessible name that a person would recognise.
4. Add the page to `tests/e2e/accessibility.spec.ts` if it is a new route.
5. Tab through it before opening the PR.
