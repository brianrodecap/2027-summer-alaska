// The size of a day-list card's photo, and of the icon box that stands in for it
// (AvatarOrDot, RowLeadingDot), so the swap never changes the card's layout.
export const ROW_PHOTO_SX = {
  // narrow on a phone, so a long name still breaks between words
  width: { xs: 64, sm: 120 },
  height: { xs: 48, sm: 84 },
  flexShrink: 0,
  borderRadius: 1.5,
} as const;

// A card's inner padding, which the drag handle beside it lines up with.
export const CARD_PADDING_PX = 10;
