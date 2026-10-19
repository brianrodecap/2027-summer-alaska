// What every booking-document import shares, whichever reads it: the file
// handling (a PDF, a photo or a saved email, as a message content block), the
// import's error type, and the review-queue entry a reading becomes. The reading itself is
// proposalImport.ts (the AI proposes changes) and proposals.ts (code checks
// them); see attachments/import-check/STRATEGIES.md for the approaches before.
import type { Activity, Booking, NoteKind, Ref, Stay, Transit, Traveler } from './types';

const SUPPORTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

// A saved email or a text export (a confirmation saved from Mail as .rtf or
// .eml) is read as its text, markup and all — browsers often give these no
// type, so the extension decides.
const TEXT_EXTENSIONS = ['.txt', '.rtf', '.eml', '.html', '.htm'];
export const DOCUMENT_ACCEPT = `.pdf,image/*,${TEXT_EXTENSIONS.join(',')}`;

function isTextDocument(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type.startsWith('text/') || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// The document as a message content block, whatever its format: a PDF or a
// text document as a document block, a photo or screenshot as an image.
export async function documentContent(file: File, readDataUrl = readAsDataUrl) {
  if (isTextDocument(file)) {
    return {
      type: 'document' as const,
      source: { type: 'text' as const, media_type: 'text/plain' as const, data: await file.text() },
    };
  }
  const data = await fileToBase64(file, readDataUrl);
  const mediaType = file.type as SupportedType;
  return mediaType === 'application/pdf'
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: mediaType, data },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mediaType as Exclude<SupportedType, 'application/pdf'>,
          data,
        },
      };
}

export class DocumentImportError extends Error {}

// The message an import UI shows for a failed extraction — a
// DocumentImportError's own text is already user-facing; anything else
// (network, unexpected shape) gets the generic line.
export function importErrorMessage(err: unknown): string {
  return err instanceof DocumentImportError
    ? err.message
    : 'Something went wrong reading that document.';
}

// The file read as a data: URL.
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new DocumentImportError('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(
  file: File,
  readDataUrl: (file: File) => Promise<string>,
): Promise<string> {
  if (!SUPPORTED_TYPES.includes(file.type as SupportedType)) {
    throw new DocumentImportError(
      `Unsupported file type: ${file.type || 'unknown'} — please use a PDF, an image, or a saved email (.eml, .rtf, .txt).`,
    );
  }
  const dataUrl = await readDataUrl(file);
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

// One draft in an import's review queue (see proposals.ts's
// queueFromProposals): the entry as it would be saved, the booking it writes,
// travelers it adds, the existing entry it updates, and its notes. The one
// shape both the import panel (which opens these for review) and the
// attachments check (which saves them as a reviewer would) use.
export interface QueuedImport {
  kind: 'activity' | 'stay' | 'transit';
  entity: Activity | Stay | Transit;
  bookings: Booking[];
  travelers: Traveler[]; // new travelers this draft names (see proposals.ts's addTraveler)
  overrideId?: string; // the existing entry it updates
  why?: string; // the reason the AI gave for the change
  notes: { ref: Ref; kind: NoteKind; text: string }[];
}
