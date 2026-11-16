'use client';
import * as React from 'react';
import { type Field, type Recipient, fieldTypes } from '@/lib/sign/model';
import {
  advanceHistory,
  fieldLabels,
  toolLabels,
  recipientsForTool,
  makeFields,
  transformField,
  type Tool,
} from '@/lib/sign/editor';
import { PdfViewer } from './pdf-viewer';
const control =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs';
const button =
  'rounded-lg border px-3 py-2 text-xs hover:bg-blue-50 disabled:opacity-40';
export { fieldLabels };
export function FieldEditor({
  url,
  fields,
  recipients,
  pages,
  onChange: publish,
  preview = false,
}: {
  url: string;
  fields: Field[];
  recipients: Recipient[];
  pages: number;
  onChange?: (fields: Field[]) => void;
  preview?: boolean;
}) {
  const [selected, setSelected] = React.useState(''),
    [recipient, setRecipient] = React.useState(
      recipients.find((r) => r.role !== 'viewer')?.id ?? '',
    ),
    [tool, setTool] = React.useState<Tool>('signature'),
    [placing, setPlacing] = React.useState(false),
    [error, setError] = React.useState(''),
    [left, setLeft] = React.useState(true),
    [right, setRight] = React.useState(true);
  const f = fields.find((f) => f.id === selected),
    editable = !!publish && !preview;
  const assigned =
    recipients.find((r) => r.id === recipient && r.role !== 'viewer') ??
    recipients.find((r) => r.role !== 'viewer');
  const [{ past, future }, record] = React.useReducer(advanceHistory, {
    past: [],
    future: [],
  });
  const dragLabel = React.useRef<HTMLDivElement>(null);
  const pointerStart = React.useRef<{ x: number; y: number } | null>(null);
  const ignoreClick = React.useRef(false);
  const clipboard = React.useRef<Field | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const [grid, setGrid] = React.useState(false);
  function onChange(next: Field[]) {
    if (!editable) return;
    record({ type: 'edit', fields });
    publish?.(next);
  }
  function travel(redo: boolean) {
    const source = redo ? future : past,
      next = source.at(-1);
    if (!editable || !next) return;
    record({ type: redo ? 'redo' : 'undo', fields });
    const changed = next.find((field) => !fields.includes(field));
    setSelected(
      changed?.id ?? (next.some((v) => v.id === selected) ? selected : ''),
    );
    setPlacing(false);
    publish?.(next);
  }
  function remove() {
    if (!f) return;
    onChange(
      fields
        .filter((v) => v.id !== f.id)
        .map((v) =>
          v.signatureFieldId === f.id
            ? { ...v, signatureFieldId: undefined }
            : v,
        ),
    );
    setSelected('');
  }
  function duplicate(source?: Field | null) {
    if (
      !source ||
      !recipients.some(
        (r) => r.id === source.recipientId && r.role !== 'viewer',
      )
    )
      return;
    const copy = {
      ...transformField(source, 0.02, 0.02, ''),
      id: crypto.randomUUID(),
      signatureFieldId: undefined,
    };
    onChange([...fields, copy]);
    setSelected(copy.id);
    setRight(true);
  }
  function shortcut(e: React.KeyboardEvent) {
    if (
      !editable ||
      (e.target instanceof HTMLElement &&
        e.target.closest('input,select,textarea,[contenteditable=true]'))
    )
      return;
    const key = e.key.toLowerCase(),
      mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z') travel(e.shiftKey);
    else if (mod && key === 'y') travel(true);
    else if (mod && key === 'c' && f) clipboard.current = f;
    else if (mod && key === 'v' && clipboard.current)
      duplicate(clipboard.current);
    else if (mod && key === 'd' && f) duplicate(f);
    else if ((key === 'delete' || key === 'backspace') && f) remove();
    else if (key === 'escape') {
      setSelected('');
      setPlacing(false);
    } else if (
      f &&
      ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)
    ) {
      const n = e.shiftKey ? 0.025 : 0.005;
      change(
        transformField(
          f,
          key === 'arrowleft' ? -n : key === 'arrowright' ? n : 0,
          key === 'arrowup' ? -n : key === 'arrowdown' ? n : 0,
          '',
        ),
      );
    } else return;
    e.preventDefault();
  }
  function change(patch: Partial<Field>) {
    if (!f || !editable) return;
    let next = { ...f, ...patch };
    next = {
      ...next,
      width: Math.max(0.02, Math.min(1, next.width)),
      height: Math.max(0.015, Math.min(1, next.height)),
    };
    next.x = Math.max(0, Math.min(1 - next.width, next.x));
    next.y = Math.max(0, Math.min(1 - next.height, next.y));
    onChange(fields.map((v) => (v.id === f.id ? next : v)));
  }
  function place(page: number, x: number, y: number, kind: Tool = tool) {
    const owners = recipientsForTool(kind, recipients, recipient);
    if (!editable) return;
    if (!owners.length) {
      setError(
        kind.startsWith('witness_')
          ? 'Add a witness in Recipients before placing this field.'
          : 'Add a signing recipient first.',
      );
      return;
    }
    const added = makeFields(
      kind,
      owners,
      page,
      grid ? Math.round(x * 100) / 100 : x,
      grid ? Math.round(y * 100) / 100 : y,
    );
    onChange([...fields, ...added]);
    setSelected(added[0].id);
    setRecipient(owners[0].id);
    setRight(true);
    setPlacing(false);
    setError('');
    root.current?.focus({ preventScroll: true });
  }
  function activate(kind: Tool) {
    setRecipient(recipientsForTool(kind, recipients, recipient)[0]?.id ?? '');
    setTool(kind);
    setPlacing(true);
    setSelected('');
    setError('');
  }
  const text =
    f && !['signature', 'initials', 'checkbox', 'date'].includes(f.type);
  return (
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={shortcut}
      aria-label="Document field editor"
      className="space-y-3 outline-none"
    >
      <div
        ref={dragLabel}
        hidden
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-50 rounded border border-blue-500 bg-white px-3 py-2 text-xs text-blue-800 shadow"
      />
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <button
              className={button}
              aria-pressed={!placing}
              onClick={() => {
                setPlacing(false);
                setSelected('');
              }}
            >
              Select / scroll
            </button>
            <button
              className={button}
              disabled={!past.length}
              onClick={() => travel(false)}
            >
              Undo
            </button>
            <button
              className={button}
              disabled={!future.length}
              onClick={() => travel(true)}
            >
              Redo
            </button>
            <button
              className={button}
              disabled={!fields.length}
              onClick={() => {
                onChange([]);
                setSelected('');
              }}
            >
              Clear fields
            </button>
            <label className="flex items-center gap-2 px-2 text-xs">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) => setGrid(e.target.checked)}
              />
              Snap to 1% grid
            </label>
          </>
        )}
        <button className={button} onClick={() => setLeft(!left)}>
          {left ? 'Hide' : 'Show'} fields
        </button>
        <button className={button} onClick={() => setRight(!right)}>
          {right ? 'Hide' : 'Show'} properties
        </button>
        {preview && (
          <p className="p-2 text-xs text-blue-700">
            Recipient preview · illustrative values; no signing action is
            recorded.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-col items-stretch gap-4 xl:flex-row">
        {left && (
          <aside className="space-y-4 rounded-xl border bg-white p-4 xl:w-56 xl:shrink-0">
            <h2 className="text-sm font-semibold">Document fields</h2>
            <label className="block text-xs">
              Assigned recipient
              <select
                className={control}
                value={assigned?.id ?? ''}
                onChange={(e) => setRecipient(e.target.value)}
              >
                {recipients
                  .filter((r) => r.role !== 'viewer')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || 'Unnamed'} · {r.role}
                    </option>
                  ))}
              </select>
            </label>
            {editable && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(toolLabels) as Tool[]).map((t) => {
                    const available =
                      recipientsForTool(t, recipients, recipient).length > 0;
                    const reason = t.startsWith('witness_')
                      ? 'Add a Witness in Advanced Send recipients.'
                      : t === 'two_party'
                        ? 'Add two signing recipients.'
                        : 'Add a signing recipient.';
                    return (
                      <button
                        type="button"
                        key={t}
                        draggable={false}
                        disabled={!available}
                        title={
                          available
                            ? 'Click to place or drag onto a page'
                            : reason
                        }
                        style={{
                          touchAction: 'none',
                          cursor: available ? 'grab' : undefined,
                        }}
                        onPointerDown={(ev) => {
                          ignoreClick.current = false;
                          if (ev.button !== 0 || !ev.isPrimary) return;
                          pointerStart.current = {
                            x: ev.clientX,
                            y: ev.clientY,
                          };
                          ev.currentTarget.setPointerCapture(ev.pointerId);
                        }}
                        onPointerMove={(ev) => {
                          const start = pointerStart.current,
                            label = dragLabel.current;
                          if (
                            !start ||
                            !label ||
                            Math.hypot(
                              ev.clientX - start.x,
                              ev.clientY - start.y,
                            ) < 6
                          )
                            return;
                          label.hidden = false;
                          label.textContent = toolLabels[t];
                          label.style.transform =
                            'translate(' +
                            (ev.clientX + 12) +
                            'px,' +
                            (ev.clientY + 12) +
                            'px)';
                        }}
                        onLostPointerCapture={() => {
                          pointerStart.current = null;
                          if (dragLabel.current)
                            dragLabel.current.hidden = true;
                        }}
                        onPointerCancel={() => {
                          pointerStart.current = null;
                          if (dragLabel.current)
                            dragLabel.current.hidden = true;
                        }}
                        onPointerUp={(ev) => {
                          const start = pointerStart.current;
                          pointerStart.current = null;
                          if (dragLabel.current)
                            dragLabel.current.hidden = true;
                          if (
                            !start ||
                            Math.hypot(
                              ev.clientX - start.x,
                              ev.clientY - start.y,
                            ) < 6
                          )
                            return;
                          ignoreClick.current = true;
                          const page = document
                            .elementFromPoint(ev.clientX, ev.clientY)
                            ?.closest<HTMLElement>('[data-pdf-page]');
                          if (!page) return;
                          const rect = page.getBoundingClientRect();
                          place(
                            Number(page.dataset.pdfPage),
                            (ev.clientX - rect.left) / rect.width,
                            (ev.clientY - rect.top) / rect.height,
                            t,
                          );
                        }}
                        aria-pressed={placing && tool === t}
                        className={
                          button +
                          (placing && tool === t
                            ? ' border-blue-600 bg-blue-50'
                            : '') +
                          ' min-h-9 leading-tight text-left'
                        }
                        onClick={() => {
                          if (!ignoreClick.current) activate(t);
                          ignoreClick.current = false;
                        }}
                      >
                        {toolLabels[t]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {placing
                    ? 'Click the PDF to place your field.'
                    : 'Choose a tool and click a page, or drag the tool onto it. Hold Shift while resizing to preserve proportions.'}
                </p>
              </>
            )}
            <p className="text-xs text-slate-500">
              {fields.length} fields · {pages} pages
            </p>
            {editable && !recipients.some((r) => r.role === 'witness') && (
              <p className="text-xs text-slate-500">
                Add a witness in Advanced Send to enable witness fields.
              </p>
            )}
          </aside>
        )}
        <div className="min-w-0 flex-1">
          <PdfViewer
            url={url}
            fields={
              preview
                ? fields.filter((f) => f.recipientId === assigned?.id)
                : fields
            }
            selected={selected}
            values={
              preview
                ? Object.fromEntries(
                    fields
                      .filter((f) => f.recipientId === assigned?.id)
                      .map((f) => [
                        f.id,
                        f.defaultValue ||
                          (f.type === 'checkbox'
                            ? true
                            : f.type === 'date'
                              ? 'Date at signing'
                              : f.type === 'signature'
                                ? 'Sample signature'
                                : f.type === 'name'
                                  ? 'Sample full name'
                                  : f.type === 'date_input'
                                    ? '2026-12-01'
                                    : 'Sample'),
                      ]),
                  )
                : {}
            }
            grid={grid}
            onDeselect={() => setSelected('')}
            onDropTool={
              editable
                ? (kind, page, x, y) => {
                    if (Object.hasOwn(toolLabels, kind))
                      place(page, x, y, kind as Tool);
                  }
                : undefined
            }
            onSelect={(f) => {
              setSelected(f.id);
              setPlacing(false);
              setRight(true);
            }}
            onPlace={editable && placing ? place : undefined}
            onFieldChange={
              editable
                ? (field) =>
                    onChange?.(
                      fields.map((f) => (f.id === field.id ? field : f)),
                    )
                : undefined
            }
          />
        </div>
        {right && (
          <aside className="space-y-3 rounded-xl border bg-white p-4 xl:w-60 xl:shrink-0">
            <h2 className="text-sm font-semibold">Field properties</h2>
            {f && editable ? (
              <>
                <label className="block text-xs">
                  Field type
                  <select
                    className={control}
                    value={f.type}
                    onChange={(e) => {
                      const type = e.target.value as Field['type'];
                      onChange?.(
                        fields.map((v) =>
                          v.id === f.id
                            ? {
                                ...v,
                                type,
                                inputMode:
                                  type === 'date' ? 'auto' : 'editable',
                                signatureFieldId: undefined,
                                defaultValue: undefined,
                                validation: undefined,
                                multiline: undefined,
                              }
                            : v.signatureFieldId === f.id
                              ? { ...v, signatureFieldId: undefined }
                              : v,
                        ),
                      );
                    }}
                  >
                    {fieldTypes.map((t) => (
                      <option key={t} value={t}>
                        {fieldLabels[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  Display label
                  <input
                    className={control}
                    maxLength={100}
                    value={f.label}
                    onChange={(e) => change({ label: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  Recipient
                  <select
                    aria-label="Recipient"
                    className={control}
                    value={f.recipientId}
                    onChange={(e) => {
                      const recipientId = e.target.value;
                      onChange?.(
                        fields.map((v) =>
                          v.id === f.id
                            ? { ...v, recipientId, signatureFieldId: undefined }
                            : v.signatureFieldId === f.id
                              ? { ...v, recipientId }
                              : v,
                        ),
                      );
                    }}
                  >
                    {recipients
                      .filter((r) => r.role !== 'viewer')
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {r.role}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => change({ required: e.target.checked })}
                  />
                  Required
                </label>
                <details open>
                  <summary className="cursor-pointer text-xs font-medium">
                    Position & size
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(['Left', 'Center', 'Right'] as const).map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        className={button}
                        title={'Align to page ' + edge.toLowerCase()}
                        onClick={() =>
                          change({
                            x:
                              edge === 'Left'
                                ? 0
                                : edge === 'Center'
                                  ? (1 - f.width) / 2
                                  : 1 - f.width,
                          })
                        }
                      >
                        {edge}
                      </button>
                    ))}
                  </div>
                  <label className="block text-xs">
                    Page
                    <input
                      className={control}
                      type="number"
                      min={1}
                      max={pages}
                      value={f.page}
                      onChange={(e) =>
                        change({
                          page: Math.max(
                            1,
                            Math.min(pages, Number(e.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map((k) => (
                      <label className="text-xs capitalize" key={k}>
                        {k} (%)
                        <input
                          className={control}
                          type="number"
                          step={0.1}
                          value={Math.round(f[k] * 1000) / 10}
                          onChange={(e) =>
                            change({ [k]: Number(e.target.value) / 100 })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
                {f.type !== 'checkbox' && (
                  <details open>
                    <summary className="cursor-pointer text-xs font-medium">
                      Appearance
                    </summary>
                    <label className="block text-xs">
                      Font family
                      <select
                        className={control}
                        value={f.fontFamily ?? 'sans'}
                        onChange={(e) =>
                          change({
                            fontFamily: e.target.value as Field['fontFamily'],
                          })
                        }
                      >
                        <option value="sans">Liberation Sans</option>
                        <option value="serif">Times Roman</option>
                        <option value="mono">Courier</option>
                      </select>
                    </label>
                    <label className="block text-xs">
                      Font size (pt)
                      <input
                        className={control}
                        type="number"
                        min={6}
                        max={72}
                        value={f.fontSize ?? 12}
                        onChange={(e) =>
                          change({
                            fontSize: Math.max(
                              6,
                              Math.min(72, Number(e.target.value)),
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="block text-xs">
                      Text alignment
                      <select
                        className={control}
                        value={f.alignment ?? 'left'}
                        onChange={(e) =>
                          change({
                            alignment: e.target.value as Field['alignment'],
                          })
                        }
                      >
                        {['left', 'center', 'right'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </details>
                )}
                {['date', 'date_input'].includes(f.type) && (
                  <>
                    <label className="block text-xs">
                      Date format
                      <select
                        className={control}
                        value={f.dateFormat ?? 'iso'}
                        onChange={(e) =>
                          change({
                            dateFormat: e.target.value as Field['dateFormat'],
                          })
                        }
                      >
                        <option value="iso">YYYY-MM-DD</option>
                        <option value="medium">DD Mon YYYY</option>
                      </select>
                    </label>
                    {f.type === 'date' && (
                      <label className="block text-xs">
                        Signing timezone
                        <input
                          className={control}
                          value={f.timeZone ?? 'UTC'}
                          onChange={(e) => change({ timeZone: e.target.value })}
                        />
                      </label>
                    )}
                    {f.type === 'date' && (
                      <p className="text-xs text-slate-500">
                        Recorded by the server from this recipient’s signing
                        event (UTC unless a timezone is configured).
                      </p>
                    )}
                  </>
                )}
                {text && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Input & validation
                    </summary>
                    <label className="block text-xs">
                      Behavior
                      <select
                        className={control}
                        value={
                          f.inputMode ??
                          (['name', 'email'].includes(f.type)
                            ? 'auto'
                            : 'editable')
                        }
                        onChange={(e) =>
                          change({
                            inputMode: e.target.value as Field['inputMode'],
                          })
                        }
                      >
                        <option value="editable">Recipient enters value</option>
                        <option value="readonly">Read-only default</option>
                        {['name', 'email'].includes(f.type) && (
                          <option value="auto">
                            Recipient details (automatic)
                          </option>
                        )}
                      </select>
                    </label>
                    <label className="block text-xs">
                      Placeholder
                      <input
                        className={control}
                        value={f.placeholder}
                        maxLength={100}
                        onChange={(e) =>
                          change({ placeholder: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-xs">
                      Default value
                      <input
                        className={control}
                        type={f.type === 'date_input' ? 'date' : 'text'}
                        value={f.defaultValue ?? ''}
                        maxLength={1000}
                        onChange={(e) =>
                          change({ defaultValue: e.target.value })
                        }
                      />
                    </label>
                    {f.type === 'text' && (
                      <label className="flex gap-2 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={!!f.multiline}
                          onChange={(e) =>
                            change({ multiline: e.target.checked })
                          }
                        />
                        Multiline
                      </label>
                    )}
                    <label className="block text-xs">
                      Maximum characters
                      <input
                        className={control}
                        type="number"
                        min={1}
                        max={1000}
                        value={f.maxLength ?? 1000}
                        onChange={(e) =>
                          change({
                            maxLength: Math.max(
                              1,
                              Math.min(1000, Number(e.target.value)),
                            ),
                          })
                        }
                      />
                    </label>
                    {!['email', 'date_input'].includes(f.type) && (
                      <label className="block text-xs">
                        Validation
                        <select
                          className={control}
                          value={f.validation ?? 'none'}
                          onChange={(e) =>
                            change({
                              validation: e.target.value as Field['validation'],
                            })
                          }
                        >
                          <option value="none">Any text</option>
                          <option value="letters">Letters / name</option>
                          <option value="number">Number</option>
                        </select>
                      </label>
                    )}
                  </details>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <button className={button} onClick={() => duplicate(f)}>
                    Duplicate field
                  </button>
                  <button className={button + ' text-red-700'} onClick={remove}>
                    Remove field
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">
                {editable
                  ? 'Select a field on the document to customize it.'
                  : 'Document fields are read-only.'}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
