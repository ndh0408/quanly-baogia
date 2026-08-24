type BackdropGesture = {
  pointerId: number;
  backdrop: Element;
  downOnBackdrop: boolean;
  upOnBackdrop: boolean;
};

let installed = false;

/** Chỉ cho click nền đóng modal khi cả nhấn xuống và thả chuột đều ở nền. */
export function installSafeModalBackdropClicks() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  let gesture: BackdropGesture | null = null;
  const backdropOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest(".modal-backdrop") : null;

  document.addEventListener("pointerdown", (e) => {
    const backdrop = backdropOf(e.target);
    gesture = backdrop
      ? { pointerId: e.pointerId, backdrop, downOnBackdrop: e.target === backdrop, upOnBackdrop: false }
      : null;
  }, true);

  document.addEventListener("pointerup", (e) => {
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    gesture.upOnBackdrop = e.target === gesture.backdrop;
  }, true);

  document.addEventListener("pointercancel", () => { gesture = null; }, true);

  document.addEventListener("click", (e) => {
    const backdrop = backdropOf(e.target);
    if (backdrop && e.target === backdrop && gesture?.backdrop === backdrop
      && (!gesture.downOnBackdrop || !gesture.upOnBackdrop)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    gesture = null;
  }, true);
}
