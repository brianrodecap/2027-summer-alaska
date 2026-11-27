import type { Image } from '../../model/types';
import { RowLeadingDot } from '../shared/RowLeadingDot';
import { ROW_PHOTO_SX } from '../shared/rowLeadingTokens';
import { TripImage } from '../shared/TripImage';
import { useInViewport } from './useInViewport';

// A day-list card's photo: the row's own image (once it's scrolled near enough to
// view), or an icon box until then. AvatarOrDotView takes `inView` as a
// prop, for ActivityRow/MealRow, whose card already has an observer; AvatarOrDot
// adds one for the stay and transit cards.
//
// A plain <img> rather than MUI's Avatar: Avatar probes its src
// with a hidden `new Image()` before drawing its own <img>, so a photo that
// fails to load is requested twice. Until there's a photo to draw — or when it
// doesn't load, or the place has none — the row shows the icon box.
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
      size="card"
      sx={{ ...ROW_PHOTO_SX, objectFit: 'cover', display: 'block' }}
      fallback={<RowLeadingDot ref={image ? observe : undefined} icon={icon} />}
    />
  );
}

export function AvatarOrDot({ image, icon }: { image: Image | null; icon: string | null }) {
  const { ref, inView } = useInViewport<Element>();
  return <AvatarOrDotView observe={ref} image={image} icon={icon} inView={inView} />;
}
