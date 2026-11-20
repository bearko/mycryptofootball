// A tiny helper for building DOM trees without a framework.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

/**
 * h('button.big.primary', { onclick, disabled, style: { color } }, 'text', child)
 * - the tag may carry classes after dots
 * - `on*` props are event listeners, `style` may be an object, `data` sets data-* attributes
 */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, props?: Props | Child, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(' ');
  let rest = children;
  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props as Props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = `${el.className} ${String(v)}`.trim();
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else (el.style as unknown as Record<string, string>)[sk] = sv;
        }
      } else if (k === 'data' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = String(dv);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in el && k !== 'list') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, String(v));
    }
  } else {
    rest = [props as Child, ...children];
  }
  append(el, rest);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
