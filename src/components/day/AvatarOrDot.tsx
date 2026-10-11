import type { Image } from '../../model/types';
import { RowLeadingDot } from '../shared/RowLeadingDot';
import { ROW_LEADING_SIZE } from '../shared/rowLeadingTokens';
import { TripImage } from '../shared/TripImage';
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
//
// A plain <img> in a circle rather than MUI's Avatar: Avatar probes its src
// with a hidden `new Image()` before drawing its own <img>, so a photo that
// fails to load is requested twice. Until there's a photo to draw — or when it
// doesn't load, or the place has none — the row shows the dot.
export function AvatarOrDotView({
  image,
  icon,
  inView,
  observe,
}: {
  image: Image | null;
  icon: string | null;
  inView: boolean;
  // AvatarOrDot's useInViewport ref, put on whichever of the two is drawn.
  observe?: (node: Element | null) => void;
}) {
  return (
    <TripImage
      ref={observe}
      image={image}
      enabled={inView}
      sx={{
        width: ROW_LEADING_SIZE,
        height: ROW_LEADING_SIZE,
        borderRadius: '50%',
        objectFit: 'cover',
        display: 'block',
      }}
      fallback={<RowLeadingDot ref={image ? observe : undefined} icon={icon} />}
    />
  );
}

export function AvatarOrDot({ image, icon }: { image: Image | null; icon: string | null }) {
  const { ref, inView } = useInViewport<Element>();
  return <AvatarOrDotView observe={ref} image={image} icon={icon} inView={inView} />;
}
