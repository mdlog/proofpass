import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour every dialog in the app owes the user (PRD §11, and the
 * "approval modal focus trap" ARCHITECTURE §14 asks to be tested):
 *
 * - focus moves into the dialog on open, and back to the opener on close
 * - Tab and Shift+Tab cycle inside it instead of escaping to the page behind
 * - Escape dismisses it, unless the dialog is mid-flight
 *
 * Returns the ref to attach to the dialog element.
 */
export function useDialog<T extends HTMLElement>(onDismiss: () => void, { locked = false }: { locked?: boolean } = {}) {
  const ref = useRef<T>(null);
  // Held in a ref so changing the handler does not re-run the effect and steal
  // focus back from whatever the user has since tabbed to.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (!dialog.contains(document.activeElement)) {
      (focusable()[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lockedRef.current) return;
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      opener?.focus?.();
    };
  }, []);

  return ref;
}
