interface StatusBarProps {
  message: string;
  searching: boolean;
  pendingCount: number;
}

export function StatusBar({ message, searching, pendingCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <p role="status" aria-live="polite">
        <span className={`status-bar__pulse${searching ? " active" : ""}`} aria-hidden="true" />
        {searching ? "Searching sources" : message}
      </p>
      <span className="status-bar__pending">
        {pendingCount === 0 ? "No pending changes" : `${pendingCount} pending`}
      </span>
    </footer>
  );
}
