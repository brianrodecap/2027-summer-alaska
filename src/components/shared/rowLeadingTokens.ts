// Sized to match AvatarOrDot's own Avatar exactly (see RowLeadingDot.tsx) —
// the dot-to-photo swap must never change a row's leading-column footprint,
// so every dot renders at the same diameter an Avatar would, icon included.
export const ROW_LEADING_SIZE = 48;

// Every row's own leading caption (see DayTimeline.tsx, ActivityRow.tsx,
// MealRow.tsx) uses this to sit flush against its dot/Avatar above, instead
// of the default line-height's built-in leading.
export const ROW_OVERLINE_SX = { lineHeight: 1 };
