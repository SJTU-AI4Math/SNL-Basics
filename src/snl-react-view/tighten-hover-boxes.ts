/**
 * Post-process KaTeX-rendered HTML to shrink SNL hover-highlight boxes so
 * they don't include trailing atom-spacing.
 *
 * Problem: `\htmlData{name=X,kind=Y}{...}` produces
 *   <span class="enclosing" data-name="X" data-kind="Y">
 *     ...children...
 *     <span class="mspace" style="margin-right:0.2222em;"/>   ← inter-atom spacing
 *   </span>
 * KaTeX writes the right-side inter-atom \mspace as a CHILD of the wrapper
 * whenever the wrapped atom is immediately followed by a differently-classed
 * atom (mord next to mbin, etc.). Consequence: the SNL hover highlight
 * (`.snl-single-hover`) draws its background + box-shadow around the whole
 * wrapper, so it visibly extends past the last glyph into a ~0.22em strip
 * of empty right padding.
 *
 * Fix at data-emission time (`\mathord{\htmlData{...}}`) would work for
 * `\mord` children but would REBIN mbin/mrel/etc. children as `\mord` and
 * silently lose their operator spacing. Fix in the template layer would
 * force every macro author to know about this pitfall.
 *
 * So we fix at the DOM level: after `el.innerHTML = html`, walk every
 * `.enclosing[data-name]` and, while the last child is a `.mspace`, move
 * that mspace out as the wrapper's next sibling. The mspace is preserved
 * (KaTeX's spacing algorithm still applies) but the hover box tightens to
 * the actual content.
 *
 * Runs in O(number of SNL wraps × trailing-mspace-count). Idempotent —
 * calling it twice on the same subtree is a no-op after the first pass.
 */
export function tightenHoverBoxes(root: HTMLElement): void {
  if (!root) return
  const wraps = root.querySelectorAll<HTMLElement>(
    '.enclosing[data-name]',
  )
  for (let i = 0; i < wraps.length; i++) {
    const wrap = wraps[i]
    // Safeguard: don't touch wraps that have no siblings (they'd trigger
    // parent-vs-null handling for no benefit — the trailing mspace only
    // matters when there's something after the wrap in visual reading).
    // We still process leaf-with-mspace wraps because a preview canvas
    // may center-align them and the extra 0.22em looks off.
    let last = wrap.lastElementChild as HTMLElement | null
    while (last && isMspace(last)) {
      const parent = wrap.parentElement
      if (!parent) break
      // Move mspace out as next-sibling of the wrap.
      parent.insertBefore(last, wrap.nextSibling)
      last = wrap.lastElementChild as HTMLElement | null
    }
  }
}

function isMspace(el: Element | null): boolean {
  if (!el) return false
  // .mspace is KaTeX's class for inter-atom spacing. Guard on tag=span too
  // in case downstream CSS ever re-uses the class name.
  return el.tagName === 'SPAN' && el.classList.contains('mspace')
}
