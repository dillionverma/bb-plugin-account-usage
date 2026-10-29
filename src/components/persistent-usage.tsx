import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { UsagePanel } from "./usage-panel.tsx";

/** The footer is a fixed-height icon row, and the rail layout also wraps it in
 * a flex row, so the panel can live neither inside it nor beside it. Climb to
 * the nearest ancestor that stacks vertically and mount above that. */
function anchorFor(footer: Element): Element {
  let anchor = footer;
  for (let parent = anchor.parentElement; parent !== null; parent = anchor.parentElement) {
    const style = getComputedStyle(parent);
    if (!style.display.endsWith("flex") || !style.flexDirection.startsWith("row")) break;
    anchor = parent;
  }
  return anchor;
}

/** BB has no persistent footer slot. Keep a plugin-owned portal directly above
 * the sidebar footer instead of a disclosure that can be dismissed or replaced
 * by another plugin. The semantic data-sidebar attribute is the only host DOM
 * dependency. */
export function PersistentUsage(): React.ReactElement {
  const [targets, setTargets] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const roots = new Map<Element, HTMLDivElement>();
    const reconcile = () => {
      let changed = false;
      for (const [footer, root] of roots) {
        if (!footer.isConnected) {
          root.remove();
          roots.delete(footer);
          changed = true;
        }
      }
      for (const footer of document.querySelectorAll('[data-sidebar="footer"]')) {
        let root = roots.get(footer);
        if (!root) {
          root = document.createElement("div");
          root.dataset.bbPluginRoot = "";
          root.dataset.bbPlugin = "account-usage";
          root.dataset.accountUsageMount = "";
          root.style.flexShrink = "0";
          roots.set(footer, root);
          changed = true;
        }
        if (!root.nextElementSibling?.contains(footer)) anchorFor(footer).before(root);
      }
      if (changed) setTargets([...roots.values()]);
    };
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    reconcile();
    return () => {
      observer.disconnect();
      for (const root of roots.values()) root.remove();
    };
  }, []);

  return <>{targets.map((target, index) => createPortal(<UsagePanel />, target, String(index)))}</>;
}
