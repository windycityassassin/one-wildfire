// Shared map-side UI: the floating inspector card and the hover tooltip.

const $ = (s) => document.querySelector(s);
let onClose = null;

export function openInspector({ eyebrow = "", title, body, close }) {
  $("#insp-eyebrow").textContent = eyebrow;
  $("#insp-title").innerHTML = title;
  $("#insp-body").innerHTML = body;
  $("#inspector").hidden = false;
  onClose = close || null;
  return $("#insp-body");
}

export function closeInspector(silent = false) {
  if ($("#inspector").hidden) return;
  $("#inspector").hidden = true;
  const f = onClose;
  onClose = null;
  if (f && !silent) f();
}

export function inspectorOpen() {
  return !$("#inspector").hidden;
}

export function showTip(point, html) {
  const tip = $("#tip");
  tip.innerHTML = html;
  tip.hidden = false;
  const stage = $(".stage").getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = point.x + 14, y = point.y + 14;
  if (x + w > stage.width - 8) x = point.x - w - 14;
  if (y + h > stage.height - 8) y = point.y - h - 14;
  tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

export function hideTip() {
  $("#tip").hidden = true;
}

export function initUI() {
  $("#insp-close").addEventListener("click", () => closeInspector());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInspector(); });
}
