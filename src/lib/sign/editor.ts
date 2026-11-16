import type { Field, Recipient } from './model';

export const fieldLabels: Record<Field['type'], string> = {
  signature: 'Signature',
  name: 'Full Name',
  date: 'Date Signed',
  date_input: 'Manual Date',
  initials: 'Initials',
  text: 'Text',
  checkbox: 'Checkbox',
  email: 'Email',
  company: 'Company',
};
export const groups = {
  signature_date: 'Signature + Date',
  signature_name: 'Signature + Full Name',
  signature_name_date: 'Signature + Name + Date',
  witness_group: 'Witness Name + Signature + Date',
  two_party: 'Two-Party Signing',
};
export type Tool =
  | Field['type']
  | keyof typeof groups
  | 'witness_name'
  | 'witness_signature'
  | 'witness_date';
export const toolLabels: Record<Tool, string> = {
  ...fieldLabels,
  ...groups,
  witness_name: 'Witness Name',
  witness_signature: 'Witness Signature',
  witness_date: 'Witness Date',
};
export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export function recipientsForTool(
  tool: Tool,
  recipients: Recipient[],
  selected?: string,
) {
  const eligible = recipients.filter(
    (r) =>
      r.role !== 'viewer' &&
      (!tool.startsWith('witness_') || r.role === 'witness'),
  );
  const first = eligible.find((r) => r.id === selected) ?? eligible[0];
  if (!first) return [];
  if (tool !== 'two_party') return [first];
  const second = eligible.find((r) => r.id !== first.id);
  return second ? [first, second] : [];
}

export function makeFields(
  tool: Tool,
  owners: Recipient[],
  page: number,
  x: number,
  y: number,
): Field[] {
  const witness = tool.startsWith('witness_');
  const types: Field['type'][] =
    tool === 'witness_group'
      ? ['name', 'signature', 'date']
      : tool === 'signature_name_date'
        ? ['signature', 'name', 'date']
        : tool === 'signature_name'
          ? ['signature', 'name']
          : tool === 'signature_date'
            ? ['signature', 'date']
            : tool === 'two_party'
              ? ['signature', 'signature']
              : [(witness ? tool.slice(8) : tool) as Field['type']];
  const heights = types.map((t) =>
    t === 'signature' || t === 'initials' ? 0.075 : 0.035,
  );
  let top = clamp(
    y,
    0,
    1 - heights.reduce((a, b) => a + b, 0) - 0.01 * (types.length - 1),
  );
  let signatureId: string | undefined;
  return types.map((type, i) => {
    const width = type === 'checkbox' ? 0.035 : 0.26;
    const field: Field = {
      id: crypto.randomUUID(),
      type,
      recipientId: owners[tool === 'two_party' ? i : 0].id,
      page,
      x: clamp(x, 0, 1 - width),
      y: top,
      width,
      height: heights[i],
      required: true,
      label: witness
        ? toolLabels[('witness_' + type) as Tool]
        : fieldLabels[type],
      placeholder: '',
      inputMode: type === 'date' ? 'auto' : 'editable',
      fontSize: type === 'signature' || type === 'initials' ? 36 : 12,
      alignment: 'left',
    };
    if (type === 'signature') signatureId = field.id;
    if (type === 'date') field.signatureFieldId = signatureId;
    top += field.height + 0.01;
    return field;
  });
}

export function transformField(
  f: Field,
  dx: number,
  dy: number,
  corner: string,
  grid = false,
): Field {
  const snap = (v: number) => (grid ? Math.round(v * 100) / 100 : v);
  if (!corner)
    return {
      ...f,
      x: clamp(snap(f.x + dx), 0, 1 - f.width),
      y: clamp(snap(f.y + dy), 0, 1 - f.height),
    };
  const left = corner.includes('w')
    ? clamp(snap(f.x + dx), 0, f.x + f.width - 0.02)
    : f.x;
  const top = corner.includes('n')
    ? clamp(snap(f.y + dy), 0, f.y + f.height - 0.015)
    : f.y;
  const right = corner.includes('e')
    ? clamp(snap(f.x + f.width + dx), left + 0.02, 1)
    : f.x + f.width;
  const bottom = corner.includes('s')
    ? clamp(snap(f.y + f.height + dy), top + 0.015, 1)
    : f.y + f.height;
  return {
    ...f,
    x: left,
    y: top,
    width: Math.max(0.02, right - left),
    height: Math.max(0.015, bottom - top),
  };
}

export type FieldHistory = { past: Field[][]; future: Field[][] };
export function advanceHistory(
  history: FieldHistory,
  action: { type: 'edit' | 'undo' | 'redo'; fields: Field[] },
): FieldHistory {
  if (action.type === 'edit')
    return { past: [...history.past.slice(-99), action.fields], future: [] };
  if (action.type === 'undo' && history.past.length)
    return {
      past: history.past.slice(0, -1),
      future: [...history.future, action.fields],
    };
  if (action.type === 'redo' && history.future.length)
    return {
      past: [...history.past, action.fields],
      future: history.future.slice(0, -1),
    };
  return history;
}

export function proportionalResize(
  field: Field,
  dx: number,
  dy: number,
  corner: string,
): Field {
  const horizontal = (corner.includes('w') ? -dx : dx) / field.width;
  const vertical = (corner.includes('n') ? -dy : dy) / field.height;
  const change =
    Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
  const maxWidth = corner.includes('w') ? field.x + field.width : 1 - field.x;
  const maxHeight = corner.includes('n') ? field.y + field.height : 1 - field.y;
  const scale = clamp(
    1 + change,
    Math.max(0.02 / field.width, 0.015 / field.height),
    Math.min(maxWidth / field.width, maxHeight / field.height),
  );
  const width = Math.max(0.02, field.width * scale),
    height = Math.max(0.015, field.height * scale);
  return {
    ...field,
    width,
    height,
    x: corner.includes('w') ? field.x + field.width - width : field.x,
    y: corner.includes('n') ? field.y + field.height - height : field.y,
  };
}
