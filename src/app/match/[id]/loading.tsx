export default function MatchLoading() {
  return (
    <div className="space-y-6 pb-12">
      {/* Header skeleton */}
      <div className="h-6 w-32 animate-pulse rounded bg-bg-card" />
      <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
        <div className="flex flex-col items-center px-4 py-8 sm:flex-row sm:justify-center sm:gap-8 sm:py-10">
          <div className="flex flex-col items-center gap-2">
            <div className="h-20 w-20 animate-pulse rounded-full bg-bg-secondary" />
            <div className="h-5 w-24 animate-pulse rounded bg-bg-secondary" />
          </div>
          <div className="my-4 flex flex-col items-center gap-2 sm:my-0">
            <div className="h-4 w-32 animate-pulse rounded bg-bg-secondary" />
            <div className="text-2xl font-bold text-text-muted">VS</div>
            <div className="h-4 w-40 animate-pulse rounded bg-bg-secondary" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="h-20 w-20 animate-pulse rounded-full bg-bg-secondary" />
            <div className="h-5 w-24 animate-pulse rounded bg-bg-secondary" />
          </div>
        </div>
      </div>

      {/* Stats skeleton */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-xl border border-border bg-bg-card"
        />
      ))}
    </div>
  );
}
