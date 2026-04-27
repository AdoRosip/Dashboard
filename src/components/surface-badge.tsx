type SurfaceTone = "production" | "ops" | "research" | "experimental";

const STYLES: Record<SurfaceTone, string> = {
  production: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  ops: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  research: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  experimental: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

export function SurfaceBadge({
  tone,
  label,
}: {
  tone: SurfaceTone;
  label: string;
}) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-wide ${STYLES[tone]}`}>
      {label}
    </span>
  );
}
