import { ActivityDetailPanel } from '../detail/ActivityDetailPanel';
import { StayDetailPanel } from '../detail/StayDetailPanel';
import { TransitDetailPanel } from '../detail/TransitDetailPanel';
import type { DetailPanelsState } from './useDetailPanels';

// The activity / stay / transit side sheets, driven by useDetailPanels' state.
export function DetailPanels({ panels }: { panels: DetailPanelsState }) {
  const { activityPanel, stayPanel, transitPanel } = panels;
  return (
    <>
      <ActivityDetailPanel
        activity={activityPanel.entity}
        selectedOption={activityPanel.secondary}
        open={activityPanel.open}
        onClose={activityPanel.onClose}
        onEdit={activityPanel.onEdit}
      />
      <StayDetailPanel
        stay={stayPanel.entity}
        open={stayPanel.open}
        onClose={stayPanel.onClose}
        onEdit={stayPanel.onEdit}
      />
      <TransitDetailPanel
        transit={transitPanel.entity}
        open={transitPanel.open}
        onClose={transitPanel.onClose}
        onEdit={transitPanel.onEdit}
      />
    </>
  );
}
