import { useMap } from '@vis.gl/react-google-maps';
import { useEffect } from 'react';

import type { Coordinates } from '../../model/placeCoordinates';

// Frames every resolved point once (or re-centers on the one point when
// there's only one) rather than on every render, so a reader who's since
// panned/zoomed by hand doesn't get snapped back — see pointsKey below.
export function FitBoundsToPoints({
  points,
  pointsKey,
}: {
  points: Coordinates[];
  pointsKey: string;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 32);
    // points itself is a fresh array every render; pointsKey is the stable
    // "which places, resolved" identity this should actually react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointsKey]);
  return null;
}
