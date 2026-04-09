export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-accent" />
      <p className="mt-4 text-sm text-text-muted">Loading...</p>
    </div>
  );
}
