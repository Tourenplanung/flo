import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HexColorSchema } from '@/core/schema';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
  className,
  testId,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-fg-muted transition-colors',
        'enabled:hover:bg-field-hover enabled:hover:text-fg disabled:opacity-35',
        active && 'bg-accent/20 text-accent enabled:hover:bg-accent/25 enabled:hover:text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex h-5 items-center justify-between">
        <h3 className="text-[11px] font-semibold text-fg">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export type Mixed = 'mixed';
export const MIXED: Mixed = 'mixed';

/** Numeric field with label scrubbing (drag the label horizontally to change the value). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  precision = 2,
  suffix,
  title,
  disabled,
  testId,
  mixedLabel = 'Mixed',
  onClear,
}: {
  label: ReactNode;
  value: number | Mixed;
  onChange: (v: number, final: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  title?: string;
  disabled?: boolean;
  testId?: string;
  mixedLabel?: string;
  /** When provided, committing an empty field clears the value. */
  onClear?: () => void;
}) {
  const fmt = (v: number | Mixed) => (v === MIXED ? '' : String(Math.round(v * 10 ** precision) / 10 ** precision));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (final: boolean) => {
    const expr = text.trim();
    if (!expr) {
      if (onClear && final) onClear();
      return setText(fmt(value));
    }
    let v = Number(expr.replace(',', '.'));
    // Allow simple relative math like "120+8" or "200/2".
    if (!Number.isFinite(v)) {
      const m = /^(-?[\d.]+)\s*([+\-*/])\s*(-?[\d.]+)$/.exec(expr);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[3]);
        v = m[2] === '+' ? a + b : m[2] === '-' ? a - b : m[2] === '*' ? a * b : b !== 0 ? a / b : NaN;
      }
    }
    if (!Number.isFinite(v)) return setText(fmt(value));
    v = clamp(v);
    setText(fmt(v));
    onChange(v, final);
  };

  const onScrubStart = (e: React.PointerEvent) => {
    if (disabled || value === MIXED) return;
    e.preventDefault();
    const startX = e.clientX;
    const startV = value;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1);
      const v = clamp(startV + delta);
      setText(fmt(v));
      onChange(v, false);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      onChange(clamp(Number(text) || startV), true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <label
      title={title}
      className={cx(
        'group flex h-7 min-w-0 items-center rounded-md border border-transparent bg-field text-fg',
        'focus-within:border-accent hover:border-line-strong',
        disabled && 'opacity-40',
      )}
    >
      <span
        onPointerDown={onScrubStart}
        className="flex h-full w-6 shrink-0 cursor-ew-resize items-center justify-center text-[11px] text-fg-subtle select-none"
      >
        {label}
      </span>
      <input
        data-testid={testId}
        disabled={disabled}
        value={text}
        placeholder={value === MIXED ? mixedLabel : undefined}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(true);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== MIXED) {
            e.preventDefault();
            const v = clamp((Number(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(v));
            onChange(v, false);
          }
        }}
        className="h-full w-full min-w-0 bg-transparent pr-1.5 text-[11px] tabular-nums outline-none placeholder:text-fg-subtle"
      />
      {suffix && <span className="pr-2 text-[11px] text-fg-subtle">{suffix}</span>}
    </label>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  testId,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const props = {
    'data-testid': testId,
    value: text,
    placeholder,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (text !== value) onChange(text);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    className:
      'w-full min-w-0 rounded-md border border-transparent bg-field px-2 text-[11px] text-fg outline-none hover:border-line-strong focus:border-accent placeholder:text-fg-subtle',
  };
  if (multiline) return <textarea {...props} rows={3} className={props.className + ' resize-y py-1.5 leading-4'} />;
  return (
    <input
      {...props}
      className={props.className + ' h-7'}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function SelectField<T extends string | number>({
  value,
  options,
  onChange,
  testId,
  title,
}: {
  value: T | Mixed;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
  title?: string;
}) {
  return (
    <select
      title={title}
      data-testid={testId}
      value={value === MIXED ? '' : String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      className="h-7 w-full min-w-0 rounded-md border border-transparent bg-field px-1.5 text-[11px] text-fg outline-none hover:border-line-strong focus:border-accent"
    >
      {value === MIXED && <option value="">—</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | Mixed;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-7 rounded-md bg-field p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.label}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex flex-1 items-center justify-center rounded-[5px] text-[11px] text-fg-muted',
            value === o.value ? 'bg-line-strong text-fg' : 'hover:text-fg',
          )}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <label className="flex h-6 cursor-default items-center gap-2 text-[11px] text-fg-muted hover:text-fg">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}

/** Color swatch + hex input + opacity. */
export function ColorField({
  color,
  opacity,
  onChange,
  testId,
}: {
  color: string;
  opacity?: number;
  onChange: (color: string, opacity: number | undefined, final: boolean) => void;
  testId?: string;
}) {
  const [hex, setHex] = useState(color.slice(1).toUpperCase());
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setHex(color.slice(1).toUpperCase());
  }, [color]);
  const commitHex = () => {
    let h = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
    const next = `#${h.toUpperCase()}`;
    if (HexColorSchema.safeParse(next).success) onChange(next, opacity, true);
    else setHex(color.slice(1).toUpperCase());
  };
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-transparent bg-field hover:border-line-strong focus-within:border-accent">
      <label className="relative ml-1 h-5 w-5 shrink-0 overflow-hidden rounded border border-white/10" style={{ background: color }}>
        <input
          type="color"
          aria-label="Color picker"
          value={color.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase(), opacity, false)}
          onBlur={(e) => onChange(e.target.value.toUpperCase(), opacity, true)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <input
        data-testid={testId}
        value={hex}
        maxLength={7}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          commitHex();
        }}
        onChange={(e) => setHex(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-full w-full min-w-0 bg-transparent px-2 font-mono text-[11px] uppercase text-fg outline-none"
      />
      {opacity !== undefined && (
        <OpacityInput value={opacity} onChange={(o, final) => onChange(color, o, final)} />
      )}
    </div>
  );
}

function OpacityInput({ value, onChange }: { value: number; onChange: (v: number, final: boolean) => void }) {
  const [text, setText] = useState(String(Math.round(value * 100)));
  useEffect(() => setText(String(Math.round(value * 100))), [value]);
  const commit = () => {
    const v = Number(text.replace('%', ''));
    if (Number.isFinite(v)) onChange(Math.min(100, Math.max(0, v)) / 100, true);
    else setText(String(Math.round(value * 100)));
  };
  return (
    <div className="flex h-full w-14 shrink-0 items-center border-l border-line pl-1.5">
      <input
        aria-label="Opacity"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-full w-full min-w-0 bg-transparent text-[11px] tabular-nums text-fg outline-none"
      />
      <span className="pr-1.5 text-[11px] text-fg-subtle">%</span>
    </div>
  );
}
