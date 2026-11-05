/** flö wordmark: the umlaut dots are the brand accent. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline font-semibold tracking-tight text-fg" style={{ fontSize: size, lineHeight: 1 }} aria-label="flö">
      fl
      <span className="relative inline-block">
        o
        <span className="absolute left-1/2 flex -translate-x-1/2 gap-[0.12em]" style={{ top: '-0.08em' }} aria-hidden>
          <span className="block rounded-full bg-accent" style={{ width: '0.17em', height: '0.17em' }} />
          <span className="block rounded-full bg-accent" style={{ width: '0.17em', height: '0.17em' }} />
        </span>
      </span>
    </span>
  );
}
