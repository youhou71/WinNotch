/**
 * Tooltip rich pour les chips de la collapsed row.
 *
 * Avantages vs. l'attribut HTML `title` :
 *  - Délai d'apparition court (250 ms) au lieu de ~700 ms (OS-dépendant).
 *  - Apparence cohérente avec le reste de WinNotch (fond sombre + blur,
 *    coins arrondis, ombre, animation fade + glissement).
 *  - Contenu rich (JSX, icônes, multi-ligne) au lieu d'une string plate.
 *  - Rendu via `createPortal(document.body)` pour ne pas être tronqué
 *    par l'`overflow: hidden` du notch.
 *
 * Le wrapper utilise un `<span style={display: inline-flex}>` pour ne
 * pas casser la layout flex parent de `.cr-left` / `.cr-right`. La cible
 * conserve donc son comportement de chip (hover, click, hit-test).
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Contenu rendu dans la bulle tooltip — JSX libre. */
  content: ReactNode;
  /**
   * Élément cible — clonage React pour attacher mouseenter/leave/focus
   * sans wrapper supplémentaire (qui décalerait l'alignement gap des
   * conteneurs flex).
   */
  children: ReactElement;
  /** Délai en ms avant apparition (défaut 250). */
  delayMs?: number;
  /**
   * Custom properties CSS injectées sur la bulle pour piloter la couleur
   * signature du module (`--tt-accent`, `--tt-accent-fade`). Passer un
   * objet `{ '--tt-accent': '#06b6d4', '--tt-accent-fade': 'rgba(...)' }`.
   */
  accentStyle?: CSSProperties;
}

export function NotchTooltip({ content, children, delayMs = 250, accentStyle }: Props) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Aligne tous les tooltips de la collapsed row sur le même `top` —
    // les chips ont des hauteurs différentes (music est plus grande à
    // cause de la pochette), prendre `chip.bottom` directement donnerait
    // des tooltips à des hauteurs hétérogènes. On ancre sur le bottom de
    // la collapsed-row englobante quand elle existe.
    const row = el.closest('.collapsed-row') as HTMLElement | null;
    const baseTop = row ? row.getBoundingClientRect().bottom : r.bottom;
    setPos({ left: r.left + r.width / 2, top: baseTop + 8 });
  }, []);

  const onEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      compute();
      setShow(true);
    }, delayMs);
  }, [compute, delayMs]);

  const onLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShow(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Recalcule la position si on scroll ou redimensionne pendant l'affichage.
  useEffect(() => {
    if (!show) return;
    const handler = () => compute();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [show, compute]);

  if (!isValidElement(children)) return children;

  // On clone l'élément cible pour brancher les listeners et le ref, sans
  // wrapper. Cast en `any` côté props : le runtime est OK (l'élément est
  // un div/span de chip standard) mais TS perd la signature exacte avec
  // ReactElement générique.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childProps = (children as any).props ?? {};
  const wrapped = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const original = (children as any).ref;
      if (typeof original === 'function') original(node);
      else if (original && typeof original === 'object') original.current = node;
    },
    onMouseEnter: (e: MouseEvent) => {
      childProps.onMouseEnter?.(e);
      onEnter();
    },
    onMouseLeave: (e: MouseEvent) => {
      childProps.onMouseLeave?.(e);
      onLeave();
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return (
    <>
      {wrapped}
      {show && pos
        ? createPortal(
            <div
              className="notch-tooltip"
              style={{ left: pos.left, top: pos.top, ...(accentStyle ?? {}) }}
              role="tooltip"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
