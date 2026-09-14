/**
 * A table that may be wider than the screen.
 *
 * The horizontal scroll was there from the first portal; what was missing was a
 * way to reach it without a mouse. A `div` with `overflow-x: auto` scrolls for a
 * pointer and for a touch screen and not for a keyboard, because it is not
 * focusable — so on a narrow window, or at 200% zoom, the columns past the edge
 * were unreachable for anyone who does not use a mouse. Twenty-two tables across
 * the four portals had it.
 *
 * It went unnoticed for eleven phases because the automated check only fires
 * when the content actually overflows at the tested width, and the earlier
 * tables happened to fit. That is worth remembering about accessibility
 * checking in general: a passing suite means the violations it could see are
 * absent, not that the pattern is sound.
 *
 * `tabIndex={0}` is the fix. The name is what makes the focus stop worth
 * arriving at: without it a keyboard user lands on an anonymous box. It is
 * `role="group"` rather than `role="region"` deliberately — a region is a
 * landmark, and twenty-two of them would fill the landmark menu with scroll
 * containers and bury the ones that mean something.
 *
 * The label usually repeats the table's caption, and that is on purpose. The
 * focus stop arrives *before* the table does, so it has to say what it is; the
 * caption is still there because it is what table navigation reads. Hearing the
 * same short phrase twice is a smaller cost than arriving somewhere unnamed.
 */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="table-scroll" tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}
