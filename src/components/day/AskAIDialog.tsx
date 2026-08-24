import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { getStoredApiKey, setStoredApiKey } from '../../config/aiKey';
import {
  askAI,
  AskAIError,
  type AskAIMessage,
  buildTripContext,
  type ProposedEdit,
  resolveProposalDraft,
} from '../../model/askAI';
import { findByKind } from '../../model/editForms';
import { transitRouteLabel } from '../../model/tripModel';
import type { Activity, Stay, Transit, TripData } from '../../model/types';
import { useEdit } from '../../state/useEdit';
import { ImportDocumentPanel } from '../edit/ImportDocumentDialog';
import { ApiKeyField } from '../shared/ApiKeyField';

function proposalLabel(proposal: ProposedEdit, data: TripData): string {
  if (!proposal.entityId) return proposal.summary;
  const existing = findByKind(proposal.kind, proposal.entityId, data);
  if (!existing) return proposal.summary;
  const name =
    proposal.kind === 'stay'
      ? ((existing as Stay).lodging?.name ?? 'this stay')
      : proposal.kind === 'transit'
        ? transitRouteLabel(existing as Transit)
        : (existing as Activity).text || 'this activity';
  return `${proposal.summary} (${name})`;
}

interface AskAIDialogProps {
  open: boolean;
  onClose: () => void;
  data: TripData;
}

// Single entry point for both AI-backed features: a chat over the trip's own
// data (AskPanel) and document-extraction-driven entity creation
// (ImportDocumentPanel, src/components/edit/ImportDocumentDialog.tsx). Both
// sections sit in the same dialog rather than behind tabs — nothing is
// hidden, and both hit the same Anthropic API with the same browser-stored
// key, so that key field lives here once rather than being duplicated.
export function AskAIDialog({ open, onClose, data }: AskAIDialogProps) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey() ?? '');

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Ask AI
        <IconButton aria-label="Close" size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!apiKey.trim() && <ApiKeyField value={apiKey} onChange={setApiKey} />}
        <AskPanel data={data} apiKey={apiKey} onClose={onClose} />
        <Divider />
        <ImportDocumentPanel apiKey={apiKey} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

interface AskPanelProps {
  data: TripData;
  apiKey: string;
  onClose: () => void;
}

// The chat half of AskAIDialog — the assistant can answer questions in plain
// text, or propose one concrete edit at a time. A proposal never applies
// itself: "Review & apply" hands it to EditContext's openFromDraft, which
// opens the same EditDialog a manual add/edit uses, pre-filled, so the
// actual Save decision always stays with a human.
function AskPanel({ data, apiKey, onClose }: AskPanelProps) {
  const { openFromDraft } = useEdit();
  const [messages, setMessages] = useState<AskAIMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuilt only when `data` itself changes (a save elsewhere in the app), not on every
  // keystroke or chat turn — a full per-leg scan+sort over every Stay/Transit/Activity
  // that would otherwise redo identical work on each message sent in a conversation.
  const tripContext = useMemo(() => buildTripContext(data), [data]);
  const proposalLabels = useMemo(
    () => messages.map((m) => (m.proposal ? proposalLabel(m.proposal, data) : undefined)),
    [messages, data],
  );

  const handleSend = async () => {
    const trimmed = question.trim();
    if (!trimmed || !apiKey.trim() || loading) return;
    setStoredApiKey(apiKey.trim());
    const userMessage: AskAIMessage = { role: 'user', text: trimmed };
    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setQuestion('');
    setLoading(true);
    setError(null);
    try {
      const reply = await askAI(messages, trimmed, tripContext, apiKey.trim());
      setMessages([...nextHistory, reply]);
    } catch (err) {
      setError(err instanceof AskAIError ? err.message : 'Something went wrong asking that.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (proposal: ProposedEdit) => {
    const resolved = resolveProposalDraft(proposal, data);
    if ('error' in resolved) {
      setError(resolved.error);
      return;
    }
    openFromDraft(resolved.kind, resolved.draft, resolved.overrideId);
    onClose();
  };

  return (
    <>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack spacing={1.5}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ask about the schedule, what's still unbooked, or request a change — e.g. "do we have
            time for the tram before dinner on the 14th?"
          </Typography>
        )}
        {messages.map((m, i) => (
          <Paper
            key={i}
            variant={m.role === 'user' ? 'elevation' : 'outlined'}
            elevation={m.role === 'user' ? 1 : 0}
            sx={{
              p: 1.5,
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              bgcolor: m.role === 'user' ? 'primary.container' : 'background.default',
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {m.text}
            </Typography>
            {m.proposal && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                  {proposalLabels[i]}
                </Typography>
                <Box
                  sx={{
                    mt: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Chip
                    size="small"
                    label={m.proposal.entityId ? 'Edit' : 'New'}
                    color="secondary"
                  />
                  <Button size="small" variant="outlined" onClick={() => handleApply(m.proposal!)}>
                    Review & apply
                  </Button>
                </Box>
              </Box>
            )}
          </Paper>
        ))}
        {loading && (
          <Box sx={{ alignSelf: 'flex-start', p: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </Stack>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Ask me anything about this trip…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={loading}
        />
        <IconButton
          color="primary"
          aria-label="Send"
          onClick={() => void handleSend()}
          disabled={!question.trim() || !apiKey.trim() || loading}
        >
          <SendIcon />
        </IconButton>
      </Box>
    </>
  );
}
