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
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Marge sous le bas mesuré de la bulle pour englober son box-shadow
// (`0 6px 24px` dans tooltip.css) quand on dimensionne la fenêtre.
const TOOLTIP_SHADOW_MARGIN_PX = 28;

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
  const bubbleRef = useRef<HTMLDivElement | null>(null);
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

  // La bulle est rendue en portal (position fixed) et déborde sous le notch
  // collapsed. Or la fenêtre Electron épouse désormais la hauteur du notch
  // (cf. notchWindow.ts) → sans agrandir la fenêtre, le bas de la bulle est
  // clippé par son bord. Tant qu'elle est affichée, on pousse la couche
  // 'tooltip' = bas réel mesuré de la bulle + marge d'ombre (re-mesure si la
  // position ou le contenu changent). Le main prend le max des couches
  // (croissance immédiate) → la fenêtre s'agrandit dès l'apparition.
  //
  // On ne touche la couche QUE quand la tooltip est affichée : la couche
  // 'tooltip' est partagée par toutes les chips (un seul survol à la fois).
  // Si une chip masquée poussait 0 à chaque re-render (ex. sparkline système
  // qui re-render chaque seconde), elle écraserait la réserve de la chip
  // dont la tooltip est ouverte → fenêtre qui rétrécit sous la bulle.
  useLayoutEffect(() => {
    if (!show) return;
    const bottom = bubbleRef.current?.getBoundingClientRect().bottom ?? 0;
    window.notch.shell.setHeight(
      Math.ceil(bottom) + TOOLTIP_SHADOW_MARGIN_PX,
      'tooltip',
    );
  }, [show, pos, content]);

  // Libère la réserve à la fermeture (transition show → false) et au mount.
  // Dépend de `show` seul → aucun spam IPC sur les re-render de contenu.
  useEffect(() => {
    if (show) return;
    window.notch.shell.setHeight(0, 'tooltip');
  }, [show]);

  // Filet de sécurité : libère aussi si le composant se démonte alors qu'une
  // tooltip est ouverte (passage collapsed → expanded, chip retirée…).
  useEffect(() => {
    return () => {
      window.notch.shell.setHeight(0, 'tooltip');
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
              ref={bubbleRef}
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
