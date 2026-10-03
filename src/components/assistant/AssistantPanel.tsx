import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getStoredApiKey, setStoredApiKey } from '../../config/aiKey';
import {
  applyDayPlan,
  type AskAIMessage,
  type AskAIProposal,
  describeDayPlanOp,
  describeNewActivity,
  type ProposedEdit,
  resolveProposalDraft,
} from '../../model/askAI';
import {
  applyAlternative,
  changedActivities,
  fetchMissingPlaceImages,
  type ProposedAlternative,
  type ProposedNote,
  type ProposedRoute,
  resolveNoteProposal,
  resolveRouteProposal,
  withPlaceImages,
  withPlaceImagesInData,
} from '../../model/askAIDrafts';
import { recomputeRouteTravel } from '../../model/directions';
import { entityLabel, findByKind } from '../../model/editForms';
import type { Activity, Day, Route, TripData } from '../../model/types';
import { useEdit } from '../../state/useEdit';
import { useNoteEdit } from '../../state/useNoteEdit';
import { useTripData } from '../../state/useTripData';
import { useTripEdits } from '../daysview/useTripEdits';
import { ImportDocumentPanel } from '../edit/ImportDocumentPanel';
import { RouteEditDialog } from '../edit/RouteEditDialog';
import { ApiKeyField } from '../shared/ApiKeyField';
import { ICON_NAMES } from '../shared/materialIcon';
import { useChat } from './useChat';
import { useFitToViewport } from './useFitToViewport';

function proposalLabel(proposal: ProposedEdit, data: TripData): string {
  if (!proposal.entityId) return proposal.summary;
  const existing = findByKind(proposal.kind, proposal.entityId, data);
  if (!existing) return proposal.summary;
  return `${proposal.summary} (${entityLabel(proposal.kind, existing)})`;
}

function Bubble({ role, children }: { role: AskAIMessage['role']; children: ReactNode }) {
  const user = role === 'user';
  return (
    <Paper
      variant={user ? 'elevation' : 'outlined'}
      elevation={user ? 1 : 0}
      sx={{
        p: 1.5,
        alignSelf: user ? 'flex-end' : 'flex-start',
        maxWidth: '90%',
        bgcolor: user ? 'primary.container' : 'background.default',
      }}
    >
      {children}
    </Paper>
  );
}

function Lookups({ labels }: { labels: string[] }) {
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
      {labels.map((label) => `✓ ${label}`).join(' · ')}
    </Typography>
  );
}

// One proposal that opens a dialog for review: what it does, what kind of change it is,
// and the button that opens it.
function ReviewItem({
  label,
  chip,
  busy = false,
  onReview,
}: {
  label: string;
  chip: string;
  // Set while the draft is being prepared (a route's drive times are looked up).
  busy?: boolean;
  onReview: () => void;
}) {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {label}
      </Typography>
      <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip size="small" label={chip} color="secondary" />
        <Button size="small" variant="outlined" disabled={busy} onClick={onReview}>
          Review & apply
        </Button>
      </Box>
    </Box>
  );
}

function noteChip(note: ProposedNote): string {
  if (note.remove) return 'Remove note';
  return note.noteId ? 'Edit note' : 'New note';
}

// A reviewable batch (a day plan's changes, an alternative's activities), each item
// with its own checkbox: unchecking one skips just that item, so declining one
// suggestion never costs the rest. `onApply` gets the indexes left checked.
function ChecklistReview({
  title,
  items,
  applied,
  busy,
  onApply,
}: {
  title: string;
  items: string[];
  applied: boolean;
  // Set while the place photos for the kept items are being looked up.
  busy: boolean;
  onApply: (kept: ReadonlySet<number>) => void;
}) {
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const keptCount = items.length - skipped.size;
  const toggle = (i: number) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {title}
      </Typography>
      <Stack spacing={0}>
        {items.map((item, i) => (
          <FormControlLabel
            key={i}
            disabled={applied}
            control={<Checkbox size="small" checked={!skipped.has(i)} onChange={() => toggle(i)} />}
            label={<Typography variant="body2">{item}</Typography>}
          />
        ))}
      </Stack>
      {applied ? (
        <Chip size="small" label="Applied" color="success" />
      ) : (
        <Button
          size="small"
          variant="outlined"
          disabled={!keptCount || busy}
          onClick={() => onApply(new Set(items.map((_, i) => i).filter((i) => !skipped.has(i))))}
        >
          {keptCount === items.length ? 'Apply all' : `Apply ${keptCount} of ${items.length}`}
        </Button>
      )}
    </Box>
  );
}

// What a new alternative does to the day, in the reader's terms.
function alternativeTitle(alt: ProposedAlternative, data: TripData): string {
  if (alt.siblingOf) {
    const sibling = data.scenarios.find((s) => s._id === alt.siblingOf);
    return `${alt.summary} — new option "${alt.label}"${sibling ? ` beside "${sibling.label}"` : ''}`;
  }
  return `${alt.summary} — splits the day into "${alt.idealLabel}" (the current plan) and "${alt.label}"`;
}

// What one proposal shows for review: a single change opens a dialog (`chip` says what
// kind), a batch lists its items to check off.
type ReviewSummary = { title: string } & ({ chip: string } | { items: string[] });

function reviewSummary(proposal: AskAIProposal, data: TripData): ReviewSummary {
  switch (proposal.type) {
    case 'edit':
      return {
        title: proposalLabel(proposal.edit, data),
        chip: proposal.edit.entityId ? 'Edit' : 'New',
      };
    case 'note':
      return { title: proposal.note.summary, chip: noteChip(proposal.note) };
    case 'route':
      return {
        title: proposal.route.summary,
        chip: proposal.route.routeId ? 'Edit route' : 'New route',
      };
    case 'dayPlan':
      return {
        title: proposal.plan.summary,
        items: proposal.plan.ops.map((op) => describeDayPlanOp(op, data)),
      };
    case 'alternative':
      return {
        title: alternativeTitle(proposal.alternative, data),
        items: proposal.alternative.activities.map(describeNewActivity),
      };
  }
}

// The finished conversation. Memoized, so neither a streaming reply nor typing a
// question re-renders the history — only a new message, an apply, or a trip edit does.
const MessageList = memo(function MessageList({
  messages,
  summaries,
  applied,
  busyId,
  onReview,
  onApply,
}: {
  messages: AskAIMessage[];
  summaries: ReadonlyMap<string, ReviewSummary>;
  applied: readonly string[];
  busyId: string | null;
  onReview: (proposal: AskAIProposal) => void;
  onApply: (proposal: AskAIProposal, kept: ReadonlySet<number>) => Promise<void>;
}) {
  return messages.map((m, mi) => (
    <Bubble key={mi} role={m.role}>
      {m.lookups && <Lookups labels={m.lookups} />}
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
        {m.text}
      </Typography>
      {m.proposals?.map((proposal) => {
        const summary = summaries.get(proposal.id);
        if (!summary) return null;
        return 'items' in summary ? (
          <ChecklistReview
            key={proposal.id}
            title={summary.title}
            items={summary.items}
            applied={applied.includes(proposal.id)}
            busy={busyId === proposal.id}
            onApply={(kept) => void onApply(proposal, kept)}
          />
        ) : (
          <ReviewItem
            key={proposal.id}
            label={summary.title}
            chip={summary.chip}
            busy={busyId === proposal.id}
            onReview={() => onReview(proposal)}
          />
        );
      })}
    </Bubble>
  ));
});

interface AssistantPanelProps {
  // The day the reader has scrolled to — sent with each question so "this day" works.
  focusDay: Day | null;
  // Shown as a close button in the header when the panel can be dismissed (the phone
  // sheet); the wide-screen sidebar switches away with its own tabs instead.
  onClose?: () => void;
  // Size to the visible part of the viewport rather than the container — for the
  // sticky sidebar, whose bottom starts out below the fold (see useFitToViewport).
  fitViewport?: boolean;
}

// An icon name the registry can't draw would show as a question mark; fall back to
// the defaults instead.
const knownIcon = (name?: string) => (name && ICON_NAMES.includes(name) ? name : undefined);

// The trip assistant: a chat over the trip that can look things up and propose
// changes, plus document import behind the paperclip. Nothing here applies a change
// on its own — a single-entity proposal opens the regular edit dialog for review, and
// a day plan applies only the changes left checked when Apply is pressed.
export function AssistantPanel({ focusDay, onClose, fitViewport = false }: AssistantPanelProps) {
  const chat = useChat();
  const { data, setData } = useTripData();
  const { openFromDraft } = useEdit();
  const { saveRoute, deleteRoute } = useTripEdits();
  const { openNoteDraftSequence, openNoteEdit } = useNoteEdit();
  const [routeReview, setRouteReview] = useState<{ route: Route; isNew: boolean } | null>(null);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey() ?? '');
  const [question, setQuestion] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // The proposal whose draft or photos are being looked up, so its button shows busy.
  const [busyId, setBusyId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { ref: panelRef, height: fitHeight } = useFitToViewport<HTMLDivElement>(fitViewport);
  const { messages, pending, applied, markApplied } = chat;

  // Each summary is a linear entity scan against the trip, so they're built once per
  // conversation or trip change, not on every render.
  const summaries = useMemo(() => {
    const byId = new Map<string, ReviewSummary>();
    if (!data) return byId;
    for (const m of messages) {
      for (const p of m.proposals ?? []) byId.set(p.id, reviewSummary(p, data));
    }
    return byId;
  }, [messages, data]);

  // Follow the conversation as it grows, including while an answer streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending?.text, pending?.lookups.length]);

  // The assistant names places by id only, so whatever it drafts gets a photo looked up
  // for each place still without one before it's reviewed or applied (see
  // fetchMissingPlaceImages).
  const reviewEdit = useCallback(
    async (proposal: ProposedEdit, trip: TripData) => {
      const resolved = resolveProposalDraft(proposal, trip);
      if ('error' in resolved) {
        setLocalError(resolved.error);
        return;
      }
      let { draft } = resolved;
      if (resolved.kind === 'activity') {
        const activity = draft as Activity;
        draft = withPlaceImages(activity, await fetchMissingPlaceImages([activity]));
      }
      openFromDraft({
        kind: resolved.kind,
        entity: draft,
        overrideId: resolved.overrideId,
        source: 'ai-chat',
      });
    },
    [openFromDraft],
  );

  // Drive times are never proposed; they're looked up before the route editor opens,
  // exactly as picking each stop by hand would.
  const reviewRoute = useCallback(async (proposal: ProposedRoute, id: string, trip: TripData) => {
    const resolved = resolveRouteProposal(proposal, trip);
    if ('error' in resolved) {
      setLocalError(resolved.error);
      return;
    }
    setBusyId(id);
    const route = await recomputeRouteTravel(resolved.route);
    setBusyId(null);
    setRouteReview({ route, isNew: resolved.isNew });
  }, []);

  const handleReview = useCallback(
    (proposal: AskAIProposal) => {
      if (!data) return;
      if (proposal.type === 'edit') void reviewEdit(proposal.edit, data);
      else if (proposal.type === 'route') void reviewRoute(proposal.route, proposal.id, data);
      else if (proposal.type === 'note') {
        // A drafted note opens the same dialog a manual note does — for a removal, the
        // existing note, where Delete asks for confirmation.
        const resolved = resolveNoteProposal(proposal.note, data);
        if ('error' in resolved) setLocalError(resolved.error);
        else if (resolved.mode === 'edit') openNoteEdit(resolved.note);
        else openNoteDraftSequence([resolved]);
      }
    },
    [data, reviewEdit, reviewRoute, openNoteEdit, openNoteDraftSequence],
  );

  // Applies a batch with the checked items only. `apply` runs once against the current
  // trip to find the activities it adds or changes and look up their places' photos
  // (the item shows busy meanwhile), then again against the latest data — the trip may
  // have changed during the lookup — with the photos filled in.
  const handleApply = useCallback(
    async (proposal: AskAIProposal, kept: ReadonlySet<number>) => {
      if (!data) return;
      let apply: (prev: TripData) => TripData;
      if (proposal.type === 'dayPlan') {
        const plan = { ...proposal.plan, ops: proposal.plan.ops.filter((_, i) => kept.has(i)) };
        apply = (prev) => applyDayPlan(plan, prev);
      } else if (proposal.type === 'alternative') {
        const alt = proposal.alternative;
        const withIcons = {
          ...alt,
          icon: knownIcon(alt.icon),
          idealIcon: knownIcon(alt.idealIcon),
        };
        const check = applyAlternative(withIcons, data, kept);
        if ('error' in check) {
          setLocalError(check.error);
          return;
        }
        apply = (prev) => {
          const result = applyAlternative(withIcons, prev, kept);
          return 'error' in result ? prev : result.data;
        };
      } else {
        return;
      }
      setBusyId(proposal.id);
      const images = await fetchMissingPlaceImages(changedActivities(data, apply(data)));
      setBusyId(null);
      setData((prev) => withPlaceImagesInData(apply(prev), images), 'ai-chat');
      markApplied(proposal.id);
    },
    [data, setData, markApplied],
  );

  if (!data) return null;
  const hasKey = Boolean(apiKey.trim());

  const handleSend = () => {
    const trimmed = question.trim();
    if (!trimmed || !hasKey || pending) return;
    try {
      setStoredApiKey(apiKey.trim());
    } catch {
      // Storage is blocked or full. The key still works for this visit, so the
      // question goes out anyway; it just won't be remembered.
      setLocalError(
        "Couldn't save your API key in this browser — you'll need to paste it again next visit.",
      );
    }
    setQuestion('');
    void chat.send(trimmed, apiKey.trim(), focusDay?.date ?? null).then((answered) => {
      // A failed or stopped turn isn't kept, so put the question back to resend.
      if (!answered) setQuestion((current) => current || trimmed);
    });
  };

  const error = chat.error ?? localError;

  return (
    <Box
      ref={panelRef}
      sx={{ display: 'flex', flexDirection: 'column', height: fitHeight ?? '100%', minHeight: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Trip assistant
        </Typography>
        {messages.length > 0 && (
          <Button size="small" onClick={chat.newConversation}>
            New conversation
          </Button>
        )}
        {onClose && (
          <IconButton aria-label="Close assistant" size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1 }}>
        <Stack spacing={1.5}>
          {messages.length === 0 && !pending && (
            <Typography variant="body2" color="text.secondary">
              Ask about the schedule, the weather, drive times or what's still unbooked, or ask for
              a change — e.g. "if it rains on the 14th, what could we do instead?"
            </Typography>
          )}
          <MessageList
            messages={messages}
            summaries={summaries}
            applied={applied}
            busyId={busyId}
            onReview={handleReview}
            onApply={handleApply}
          />
          {pending && (
            <>
              <Bubble role="user">
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {pending.question}
                </Typography>
              </Bubble>
              <Bubble role="assistant">
                {pending.lookups.length > 0 && <Lookups labels={pending.lookups} />}
                {pending.text ? (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {pending.text}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption" color="text.secondary">
                      {pending.progress || 'Thinking…'}
                    </Typography>
                  </Box>
                )}
              </Bubble>
            </>
          )}
        </Stack>
      </Box>

      <Stack spacing={1} sx={{ px: 2, pb: 2, pt: 1 }}>
        {error && (
          <Alert
            severity="error"
            onClose={() => {
              chat.clearError();
              setLocalError(null);
            }}
          >
            {error}
          </Alert>
        )}
        {!hasKey && <ApiKeyField value={apiKey} onChange={setApiKey} />}
        {importOpen && <ImportDocumentPanel apiKey={apiKey} onClose={() => setImportOpen(false)} />}
        {focusDay && (
          <Typography variant="caption" color="primary">
            Looking at {focusDay.dateLabel}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <Tooltip title="Add from a booking document">
            <IconButton
              aria-label="Add from a booking document"
              color={importOpen ? 'primary' : 'default'}
              onClick={() => setImportOpen((open) => !open)}
            >
              <AttachFileIcon />
            </IconButton>
          </Tooltip>
          <TextField
            fullWidth
            size="small"
            multiline
            maxRows={4}
            placeholder="Ask about this trip…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {pending ? (
            <IconButton color="primary" aria-label="Stop" onClick={chat.stop}>
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              color="primary"
              aria-label="Send"
              onClick={handleSend}
              disabled={!question.trim() || !hasKey}
            >
              <SendIcon />
            </IconButton>
          )}
        </Box>
      </Stack>
      {routeReview && (
        <RouteEditDialog
          route={routeReview.route}
          isNew={routeReview.isNew}
          onClose={() => setRouteReview(null)}
          onSave={(route) => {
            saveRoute(route, 'ai-chat');
            setRouteReview(null);
          }}
          onDelete={(id) => {
            deleteRoute(id, 'ai-chat');
            setRouteReview(null);
          }}
        />
      )}
    </Box>
  );
}
