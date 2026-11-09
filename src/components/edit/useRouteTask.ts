import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestAbortedError } from '../../model/anthropicClient';
import { AskAIError, runAskAITurn } from '../../model/askAI';
import type { ProposedRoute } from '../../model/askAIDrafts';
import { routeProposalOf } from '../../model/routeTasks';
import { todayDateStr } from '../../model/tripModel';
import { useLiveDays } from '../../state/useLiveDays';
import { useTripData } from '../../state/useTripData';

// Asks the assistant one question, on a conversation of its own, and returns the
// route it proposes, or null with `error` set. One at a time, stopped when the
// planner closes.
export function useRouteTask() {
  const { data, view } = useTripData();
  const live = useLiveDays();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    async (question: string): Promise<ProposedRoute | null> => {
      if (!data || !view || abort.current) return null;
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setError(null);
      try {
        const done = await runAskAITurn(null, {
          question,
          data,
          tools: { data, view, byDate: live.byDate, today: todayDateStr() },
          signal: controller.signal,
        });
        const proposal = routeProposalOf(done);
        // Its own reply, when it gave one, says why there was nothing to propose.
        if (!proposal) {
          const reply = done.messages[done.messages.length - 1]?.text.trim();
          setError(reply || 'The assistant had no route to suggest.');
        }
        return proposal;
      } catch (err) {
        if (!(err instanceof RequestAbortedError)) {
          setError(err instanceof AskAIError ? err.message : 'Something went wrong asking that.');
        }
        return null;
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [data, view, live],
  );

  return { run, busy, error, setError };
}
