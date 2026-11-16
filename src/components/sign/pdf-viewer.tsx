'use client';
import * as React from 'react';
import { signatureAppearance } from '@/lib/sign/appearance';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Field } from '@/lib/sign/model';
import { proportionalResize, transformField } from '@/lib/sign/editor';
import { PdfThumbnail } from './pdf-thumbnail';
export function PdfViewer({
  url,
  fields = [],
  values = {},
  selected,
  onSelect,
  onPlace,
  onDeselect,
  onDropTool,
  grid,
  onFieldChange,
  onLoaded,
}: {
  url: string;
  fields?: Field[];
  values?: Record<string, string | boolean>;
  selected?: string;
  onSelect?: (f: Field) => void;
  onPlace?: (page: number, x: number, y: number) => void;
  grid?: boolean;
  onDeselect?: () => void;
  onDropTool?: (tool: string, page: number, x: number, y: number) => void;
  onFieldChange?: (field: Field) => void;
  onLoaded?: () => void;
}) {
  const section = React.useRef<HTMLElement>(null);
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null),
    [error, setError] = React.useState(''),
    [zoom, setZoom] = React.useState(1),
    [page, setPage] = React.useState(1);
  const [attempt, setAttempt] = React.useState(0);
  const [fullscreenAvailable, setFullscreenAvailable] = React.useState(false);
  const [fullscreenError, setFullscreenError] = React.useState('');
  React.useEffect(
    () => setFullscreenAvailable(!!document.fullscreenEnabled),
    [],
  );
  const loaded = React.useRef(onLoaded);
  loaded.current = onLoaded;
  React.useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setPdf(null);
    setError('');
    setPage(1);
    void import('pdfjs-dist')
      .then(async (lib) => {
        lib.GlobalWorkerOptions.workerSrc = '/sign/pdf.worker.min.mjs';
        const task = lib.getDocument({
          url,
          withCredentials: true,
          useSystemFonts: true,
        });
        destroy = () => {
          void task.destroy();
        };
        const doc = await task.promise;
        if (!cancelled) {
          setPdf(doc);
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'The document could not be rendered. Retry or download the original.',
          );
      });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, attempt]);
  return (
    <section
      ref={section}
      aria-label="Document viewer"
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <label>
            Page{' '}
            <select
              aria-label="Document page"
              value={page}
              onChange={(e) => {
                setPage(Number(e.target.value));
                document
                  .getElementById(`pdf-page-${e.target.value}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="rounded border p-1"
            >
              {Array.from({ length: pdf?.numPages ?? 1 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <span>of {pdf?.numPages ?? '…'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={zoom <= 0.5}
            aria-label="Zoom out"
            className="size-8 rounded border"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            disabled={zoom >= 2}
            aria-label="Zoom in"
            className="size-8 rounded border"
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          >
            +
          </button>
          <button
            aria-label="Full screen document"
            disabled={!fullscreenAvailable}
            title={
              fullscreenAvailable
                ? 'Toggle full screen'
                : 'Full screen is unavailable in this browser'
            }
            className="hidden rounded border px-2 py-1 sm:block"
            onClick={async () => {
              try {
                setFullscreenError('');
                if (document.fullscreenElement) await document.exitFullscreen();
                else await section.current?.requestFullscreen();
              } catch {
                setFullscreenError('Your browser could not enter full screen.');
              }
            }}
          >
            Full screen
          </button>
          <a href={url} className="ml-2 text-blue-700" download>
            Download PDF
          </a>
        </div>
      </div>
      {fullscreenError && (
        <p role="alert" className="bg-white px-3 text-xs text-red-700">
          {fullscreenError}
        </p>
      )}
      {pdf && (
        <nav
          aria-label="Document page thumbnails"
          className="flex gap-2 overflow-x-auto border-b bg-slate-50 p-2"
        >
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfThumbnail
              key={i}
              pdf={pdf}
              page={i + 1}
              onClick={() => {
                setPage(i + 1);
                document
                  .getElementById(`pdf-page-${i + 1}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
          ))}
        </nav>
      )}
      {error ? (
        <div role="alert" className="p-6 text-sm text-red-700">
          {error}
          <button
            type="button"
            className="ml-3 rounded border border-red-300 px-3 py-2 font-medium"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry document
          </button>
        </div>
      ) : !pdf ? (
        <p role="status" className="p-10 text-center text-sm text-slate-500">
          Loading your document…
        </p>
      ) : (
        <div
          className="max-h-[75vh] overflow-auto p-3 sm:p-6"
          onScroll={(ev) => {
            const bounds = ev.currentTarget.getBoundingClientRect();
            const pages =
              ev.currentTarget.querySelectorAll<HTMLElement>('[data-pdf-page]');
            const midpoint = (bounds.top + bounds.bottom) / 2;
            for (const sheet of pages) {
              const rect = sheet.getBoundingClientRect();
              if (rect.bottom >= midpoint) {
                setPage(Number(sheet.dataset.pdfPage));
                break;
              }
            }
          }}
        >
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              number={i + 1}
              zoom={zoom}
              fields={fields.filter((f) => f.page === i + 1)}
              values={values}
              selected={selected}
              onSelect={onSelect}
              onPlace={onPlace}
              grid={grid}
              onDropTool={onDropTool}
              onDeselect={onDeselect}
              onFieldChange={onFieldChange}
              onRendered={i === 0 ? () => loaded.current?.() : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
function PdfPage({
  pdf,
  number,
  zoom,
  fields,
  values,
  selected,
  onSelect,
  onPlace,
  onDeselect,
  onDropTool,
  grid,
  onFieldChange,
  onRendered,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  zoom: number;
  fields: Field[];
  values: Record<string, string | boolean>;
  selected?: string;
  onSelect?: (f: Field) => void;
  onPlace?: (page: number, x: number, y: number) => void;
  grid?: boolean;
  onDeselect?: () => void;
  onDropTool?: (tool: string, page: number, x: number, y: number) => void;
  onFieldChange?: (field: Field) => void;
  onRendered?: () => void;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null),
    container = React.useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = React.useState<
    { label: string; type: string; x: number; y: number }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const guides = React.useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = React.useState(595),
    [displayWidth, setDisplayWidth] = React.useState(595),
    [ratio, setRatio] = React.useState(0.707),
    [visible, setVisible] = React.useState(false),
    [failure, setFailure] = React.useState(''),
    [text, setText] = React.useState('');
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    void pdf
      .getPage(number)
      .then(async (page) => {
        if (cancelled) return;
        const content = await page.getTextContent();
        if (cancelled) return;
        setText(
          content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' '),
        );
        const viewport = page.getViewport({ scale: 1.7 });
        const candidates = content.items.flatMap((item) => {
          if (!('str' in item)) return [];
          const match = item.str
            .trim()
            .match(
              /^(witness signature|witness name|witness date|full name|signature|authorized signatory|signed by|date)\s*[:_]*$/i,
            );
          if (!match) return [];
          const types: Record<string, string> = {
            'signed by': 'name',
            'full name': 'name',
            'authorized signatory': 'signature',
            'witness signature': 'witness_signature',
            'witness name': 'witness_name',
            'witness date': 'witness_date',
            signature: 'signature',
            date: 'date_input',
          };
          const [x, y] = viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );
          return [
            {
              label: item.str,
              type: types[match[1].toLowerCase()],
              x: x / viewport.width,
              y: y / viewport.height + 0.005,
            },
          ];
        });
        setSuggestions(candidates.slice(0, 30));
        setRatio(viewport.width / viewport.height);
        setPageWidth(viewport.width / 1.7);
        const canvas = ref.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const render = page.render({ canvas, viewport });
        task = render;
        await render.promise;
        if (!cancelled) onRendered?.();
      })
      .catch((e) => {
        if (!cancelled && e.name !== 'RenderingCancelledException')
          setFailure('Page could not load.');
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, number, visible]);
  React.useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setDisplayWidth(entries[0].contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  function move(ev: React.PointerEvent<HTMLButtonElement>, field: Field) {
    if (!onFieldChange || ev.button !== 0 || !ev.isPrimary || onPlace) return;
    onSelect?.(field);
    ev.stopPropagation();
    const target = ev.currentTarget,
      rect = container.current!.getBoundingClientRect(),
      startX = ev.clientX,
      startY = ev.clientY,
      corner = (ev.target as HTMLElement).dataset.corner ?? '';
    target.setPointerCapture(ev.pointerId);
    let next = field;
    const pointerMove = (event: PointerEvent) => {
      const dx = (event.clientX - startX) / rect.width,
        dy = (event.clientY - startY) / rect.height;
      if (event.pointerId !== ev.pointerId) return;
      next =
        corner && event.shiftKey
          ? proportionalResize(field, dx, dy, corner)
          : transformField(field, dx, dy, corner, grid);
      if (!corner && !grid && guides.current) {
        let vertical: number | undefined, horizontal: number | undefined;
        for (const peer of fields) {
          if (peer.id === field.id) continue;
          if (
            vertical === undefined &&
            Math.abs(peer.x - next.x) * rect.width < 5 &&
            peer.x + next.width <= 1
          ) {
            vertical = peer.x;
            next.x = peer.x;
          }
          if (
            horizontal === undefined &&
            Math.abs(peer.y - next.y) * rect.height < 5 &&
            peer.y + next.height <= 1
          ) {
            horizontal = peer.y;
            next.y = peer.y;
          }
        }
        const [v, h] = Array.from(guides.current.children) as HTMLElement[];
        v.hidden = vertical === undefined;
        h.hidden = horizontal === undefined;
        v.style.left = (vertical ?? 0) * 100 + '%';
        h.style.top = (horizontal ?? 0) * 100 + '%';
      }
      Object.assign(target.style, {
        left: `${next.x * 100}%`,
        top: `${next.y * 100}%`,
        width: `${next.width * 100}%`,
        height: `${next.height * 100}%`,
      });
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== ev.pointerId) return;
      if (guides.current)
        for (const line of guides.current.children)
          (line as HTMLElement).hidden = true;
      target.removeEventListener('pointermove', pointerMove);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      target.removeEventListener('lostpointercapture', end);
      if (target.hasPointerCapture(event.pointerId))
        target.releasePointerCapture(event.pointerId);
      if (event.type !== 'pointerup') {
        Object.assign(target.style, {
          left: `${field.x * 100}%`,
          top: `${field.y * 100}%`,
          width: `${field.width * 100}%`,
          height: `${field.height * 100}%`,
        });
      } else if (next !== field) onFieldChange(next);
    };
    target.addEventListener('pointermove', pointerMove);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }
  return (
    <>
      {onDropTool && suggestions.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            aria-expanded={showSuggestions}
            className="rounded border bg-white px-2 py-1"
            onClick={() => setShowSuggestions(!showSuggestions)}
          >
            Suggested fields · page {number}
          </button>
          {showSuggestions &&
            suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="rounded border bg-white px-2 py-1"
                onClick={() => onDropTool(s.type, number, s.x, s.y)}
              >
                Add {s.label}
              </button>
            ))}
        </div>
      )}
      <div
        ref={container}
        data-pdf-page={number}
        id={`pdf-page-${number}`}
        className="relative mx-auto mb-5 bg-white shadow-sm"
        style={{
          width: `${zoom * 100}%`,
          maxWidth: 850 * zoom,
          aspectRatio: ratio,
        }}
        onDragOver={(e) => {
          if (
            onDropTool &&
            e.dataTransfer.types.includes('application/x-nextmav-field')
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const tool = e.dataTransfer.getData('application/x-nextmav-field');
          if (!onDropTool || !tool) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onDropTool(
            tool,
            number,
            (e.clientX - r.left) / r.width,
            (e.clientY - r.top) / r.height,
          );
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (onPlace)
            onPlace(
              number,
              (e.clientX - r.left) / r.width,
              (e.clientY - r.top) / r.height,
            );
          else onDeselect?.();
        }}
      >
        <div ref={guides} className="pointer-events-none absolute inset-0 z-10">
          <i
            hidden
            className="absolute inset-y-0 border-l border-fuchsia-500"
          />
          <i
            hidden
            className="absolute inset-x-0 border-t border-fuchsia-500"
          />
        </div>
        <canvas
          ref={ref}
          aria-label={`Document page ${number}. Download PDF for selectable text and assistive reading.`}
          className="pointer-events-none block h-full w-full"
        />
        <div className="sr-only" aria-label={`Page ${number} text`}>
          {text}
        </div>
        {failure && (
          <p role="alert" className="absolute left-3 top-3 text-red-700">
            {failure}
          </p>
        )}
        {fields.map((f) => (
          <button
            key={f.id}
            type="button"
            onPointerDown={(ev) => move(ev, f)}
            aria-label={`${f.label || f.type}${f.required ? ' (required)' : ''}, page ${number}`}
            onFocus={() => {
              if (onFieldChange && !onPlace) onSelect?.(f);
            }}
            onClick={(e) => {
              if (onPlace) return;
              e.stopPropagation();
              onSelect?.(f);
            }}
            style={{
              pointerEvents: onPlace ? 'none' : undefined,
              touchAction: onFieldChange ? 'none' : undefined,
              cursor: onFieldChange ? 'move' : undefined,
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.width * 100}%`,
              height: `${f.height * 100}%`,
            }}
            className={`absolute flex items-center justify-center overflow-hidden rounded-sm border text-[10px] sm:text-xs ${selected === f.id ? 'border-blue-600 bg-blue-100 ring-2 ring-blue-300' : values[f.id] ? 'border-transparent bg-transparent' : onPlace || onFieldChange ? 'border-dashed border-blue-300 bg-blue-50/40' : 'border-blue-400 bg-blue-50/90'} focus:outline-2 focus:outline-blue-600`}
          >
            <span
              className="w-full px-1"
              style={{
                fontFamily:
                  f.fontFamily === 'serif'
                    ? 'Times New Roman,serif'
                    : f.fontFamily === 'mono'
                      ? 'Courier New,monospace'
                      : 'Arial,sans-serif',
                fontSize: ((f.fontSize ?? 12) * displayWidth) / pageWidth,
                textAlign: f.alignment ?? 'left',
                whiteSpace: f.multiline ? 'pre-wrap' : 'nowrap',
              }}
            >
              {typeof values[f.id] === 'string' &&
              ['signature', 'initials'].includes(f.type)
                ? (() => {
                    const a = signatureAppearance(String(values[f.id]));
                    return a.mark.startsWith('data:') ? (
                      <img
                        alt="Applied signature"
                        src={a.mark}
                        className="absolute object-contain"
                        style={{
                          objectPosition: `${a.x * 100}% ${a.y * 100}%`,
                          width: `${a.scale * 100}%`,
                          height: `${a.scale * 100}%`,
                          left: `${(1 - a.scale) * a.x * 100}%`,
                          top: `${(1 - a.scale) * a.y * 100}%`,
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: `${a.scale}em` }}>{a.mark}</span>
                    );
                  })()
                : values[f.id]
                  ? String(values[f.id])
                  : `${f.label || f.type}${f.required ? ' *' : ''}`}
            </span>
            {onFieldChange &&
              ['se', ...(selected === f.id ? ['sw', 'ne', 'nw'] : [])].map(
                (corner) => (
                  <span
                    key={corner}
                    data-resize={corner === 'se' ? 'true' : undefined}
                    data-corner={corner}
                    aria-hidden="true"
                    style={{
                      cursor: corner + '-resize',
                      [corner.includes('n') ? 'top' : 'bottom']: 0,
                      [corner.includes('w') ? 'left' : 'right']: 0,
                    }}
                    className="absolute size-3 rounded-sm border border-blue-700 bg-white"
                  />
                ),
              )}
          </button>
        ))}
      </div>
    </>
  );
}
