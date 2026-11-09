import TextField, { type TextFieldProps } from '@mui/material/TextField';
import { useState } from 'react';

// A text field that keeps what is typed to itself and hands it over once, when
// the field is left or Enter is pressed. To show a change made elsewhere, give
// it a `key` that changes with `value`.
export function CommitField({
  value,
  onCommit,
  ...props
}: {
  value: string;
  // Returning false means the change was refused, and the field goes back.
  onCommit: (text: string) => boolean | void;
} & Omit<TextFieldProps, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
  const [text, setText] = useState(value);
  const commit = () => {
    if (text !== value && onCommit(text) === false) setText(value);
  };
  return (
    <TextField
      {...props}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
