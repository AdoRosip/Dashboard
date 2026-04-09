import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <AlertTriangle className="mb-4 h-12 w-12 text-text-muted" />
      <h2 className="text-xl font-bold text-text-primary">Not Found</h2>
      <p className="mt-2 text-sm text-text-muted">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <a
        href="/"
        className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-light"
      >
        Back to Fixtures
      </a>
    </div>
  );
}
