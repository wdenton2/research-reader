import { useRef, useState } from "react";
import { startSwipe, moveSwipe, finishSwipe } from "../shared/swipe.js";

export default function useArticleSwipe({ disabled, onSwipe }) {
  const gesture = useRef(null);
  const suppressClickUntil = useRef(0);
  const [offset, setOffset] = useState(0);
  function cancel() {
    if (gesture.current?.axis === "x")
      suppressClickUntil.current = Date.now() + 350;
    gesture.current = null;
    setOffset(0);
  }
  return {
    offset,
    handlers: {
      onPointerDown(e) {
        if (!e.isPrimary) {
          cancel();
          return;
        }
        if (
          disabled ||
          e.button !== 0 ||
          (e.pointerType === "mouse" &&
            !window.matchMedia("(max-width: 760px)").matches) ||
          e.target.closest("button, input, select, textarea")
        )
          return;
        gesture.current = {
          ...startSwipe(e.clientX, e.clientY, e.currentTarget.clientWidth),
          pointerId: e.pointerId,
        };
      },
      onPointerMove(e) {
        if (!gesture.current || gesture.current.pointerId !== e.pointerId)
          return;
        gesture.current = moveSwipe(gesture.current, e.clientX, e.clientY);
        if (gesture.current.axis === "x") {
          if (!e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.setPointerCapture(e.pointerId);
          setOffset(Math.max(-112, Math.min(112, gesture.current.dx)));
        }
      },
      onPointerUp(e) {
        if (!gesture.current || gesture.current.pointerId !== e.pointerId)
          return;
        const read = finishSwipe(gesture.current);
        cancel();
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (read !== null && !disabled) onSwipe(read);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClickCapture(e) {
        if (Date.now() < suppressClickUntil.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
    },
  };
}
