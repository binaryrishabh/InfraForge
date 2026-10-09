import { useEffect, useRef } from "react";
import { useCanvasStore } from "../store/canvasStore";

/* Reports a card wrapper's rendered height into canvasStore.
Live cards are not always exactly NODE_CARD_HEIGHT tall — a chaos strip or
a RESTARTING line stretches them — and the connection anchors used to assume
a fixed height, so tubes left the card a few px above/below the port dot.
Measured heights make every anchor land on the real port center. */
export function useCardHeight(cardId: string) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = (height: number) => {
      const current = useCanvasStore.getState().cardHeights[cardId];
      // Only commit real changes so the observer can never loop.
      if (current === undefined || Math.abs(current - height) > 0.5) {
        useCanvasStore.getState().setCardHeight(cardId, height);
      }
    };
    report(el.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        report(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cardId]);

  return ref;
}