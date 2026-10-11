// The edits a list-of-rows field makes — change one row, drop one, add one —
// for the editors that hold a short list inline (PackagesField, PortCallsField),
// each handing the whole new list to its form.
export function rowList<T>(rows: T[], onChange: (rows: T[]) => void) {
  return {
    updateAt: (index: number, patch: Partial<T>) =>
      onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row))),
    removeAt: (index: number) => onChange(rows.filter((_, i) => i !== index)),
    add: (row: T) => onChange([...rows, row]),
  };
}
