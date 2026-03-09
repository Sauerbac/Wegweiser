/**
 * useContainerFit — reactive helper that observes an element's content size
 * and derives a CSS `style` string that scales a content item to fill the
 * available space while preserving a given aspect ratio.
 *
 * Usage:
 *   const fit = useContainerFit(() => naturalW, () => naturalH);
 *   // bind the element:  bind:this={fit.el}
 *   // apply the style:   style={fit.style}
 */
export function useContainerFit(
  getNaturalW: () => number,
  getNaturalH: () => number,
) {
  let el = $state<HTMLElement | undefined>(undefined);
  let containerW = $state(0);
  let containerH = $state(0);

  $effect(() => {
    const target = el;
    if (!target) return;
    const obs = new ResizeObserver(([entry]) => {
      containerW = entry.contentRect.width;
      containerH = entry.contentRect.height;
    });
    obs.observe(target);
    return () => obs.disconnect();
  });

  const style = $derived.by(() => {
    const naturalW = getNaturalW();
    const naturalH = getNaturalH();
    if (naturalW === 0 || naturalH === 0 || containerW === 0 || containerH === 0)
      return 'display: block; max-width: 100%;';
    const s = Math.min(containerW / naturalW, containerH / naturalH);
    return `display: block; width: ${Math.round(naturalW * s)}px; height: ${Math.round(naturalH * s)}px;`;
  });

  return {
    get el() { return el; },
    set el(v) { el = v; },
    get style() { return style; },
  };
}
