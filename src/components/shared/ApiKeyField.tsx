import TextField from '@mui/material/TextField';

interface ApiKeyFieldProps {
  value: string;
  onChange: (value: string) => void;
}

// Shared by every dialog that calls the Anthropic API directly from the browser
// (ImportDocumentDialog, AskAIDialog) — same field, same copy, same
// localStorage-only promise, wherever a key is collected.
export function ApiKeyField({ value, onChange }: ApiKeyFieldProps) {
  return (
    <TextField
      label="Anthropic API key"
      type="password"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText="Kept only in this browser's local storage — never committed or sent anywhere but api.anthropic.com."
    />
  );
}
