import Avatar from '@mui/material/Avatar';
import { forwardRef } from 'react';

import type { Image } from '../../model/types';
import { ROW_LEADING_SIZE, RowLeadingDot } from '../shared/RowLeadingDot';
import { useInViewport } from './useInViewport';

// The day timeline's own dot-or-photo treatment: a row/node's own image
// (once it's scrolled near enough to view), swapped in for the plain
// outlined icon dot every row starts with. AvatarOrDotView is the shared
// presentational half, taking `inView` as a plain prop; ActivityLeading and
// MealRowLeading render it directly with the `inView` their own ActivityNode
// already computed (its dot and its row text cross the same rootMargin
// together), so they don't stand up a second, unused useInViewport of their
// own. AvatarOrDot below adds that observer for DayTimeline's StayNode/
// TransitBoundaryNode, which have no other in-row gate to borrow one from.
export const AvatarOrDotView = forwardRef<
  HTMLDivElement,
  { image: Image | null; icon: string | null; inView: boolean }
>(function AvatarOrDotView({ image, icon, inView }, ref) {
  return image && inView ? (
    <Avatar ref={ref} src={image.uri} sx={{ width: ROW_LEADING_SIZE, height: ROW_LEADING_SIZE }} />
  ) : (
    <RowLeadingDot ref={image ? ref : undefined} icon={icon} />
  );
});

export function AvatarOrDot({ image, icon }: { image: Image | null; icon: string | null }) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  return <AvatarOrDotView ref={ref} image={image} icon={icon} inView={inView} />;
}
