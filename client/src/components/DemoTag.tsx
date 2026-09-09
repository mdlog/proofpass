/**
 * Marks a value that is seeded rather than stored.
 *
 * PRD §5 ("Honest demo") and ADR-003 require demo content to be distinguishable
 * from real content wherever the two sit side by side. A single "Demo mode"
 * badge in the sidebar is not enough when a fabricated number is rendered next
 * to one that came out of the database.
 */
export function DemoTag({ label = "Demo", title = "Seeded demo data — not stored" }: { label?: string; title?: string }) {
  return <span className="demo-tag" title={title}>{label}</span>;
}
