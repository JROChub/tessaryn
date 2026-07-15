const REJECT_POSE = 1 << 0;
const REJECT_TRACKING = 1 << 1;
const REJECT_PARALLAX = 1 << 2;
const REJECT_REPROJECTION = 1 << 3;
const REJECT_GEOMETRY = 1 << 4;
const REJECT_CONTINUITY = 1 << 5;
const REJECT_RECEIPT = 1 << 6;
const REJECT_DEGENERATE = 1 << 7;

function numericAttribute(root: HTMLElement, name: string): number {
  const value = Number(root.dataset[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function installWorldCellGuidance(): () => void {
  const root = document.documentElement;
  const stage = document.getElementById("stage-message");
  const heading = stage?.querySelector("b") ?? null;
  const detail = stage?.querySelector("span") ?? null;
  const capture = document.getElementById("capture-state");
  if (!stage || !heading || !detail || !capture) return () => undefined;

  stage.setAttribute("aria-live", "polite");
  let establishedTracking = false;

  const update = () => {
    if (root.dataset.keyxymAuthority !== "verified") return;
    const authorityStage = root.dataset.authorityStage ?? "forming";
    if (authorityStage !== "forming") {
      establishedTracking = true;
      return;
    }
    if ((capture.textContent ?? "").trim() === "READY") return;

    const mask = numericAttribute(root, "authorityRejectionMask");
    if (mask & REJECT_RECEIPT) {
      heading.textContent = "AUTHORITY RECEIPT REJECTED";
      detail.textContent = "Stop capture and restart the verified Keyxym authority. No Moment or seal can be created from an invalid receipt chain.";
    } else if (mask & REJECT_REPROJECTION) {
      heading.textContent = "REDUCE MOTION BLUR";
      detail.textContent = "Move more slowly, keep textured edges sharp, and maintain the same objects in view until reprojection returns below the authority limit.";
    } else if (mask & (REJECT_POSE | REJECT_TRACKING | REJECT_PARALLAX | REJECT_DEGENERATE)) {
      heading.textContent = establishedTracking ? "REACQUIRE TRACKING" : "CREATE 3D PARALLAX";
      detail.textContent = "Move slowly sideways around textured objects at different depths. Keep them in view; avoid flat walls, digital screens, blur, and repeating patterns.";
    } else if (mask & (REJECT_GEOMETRY | REJECT_CONTINUITY)) {
      heading.textContent = "BUILD VERIFIED GEOMETRY";
      detail.textContent = "Continue a slow arc, then revisit the same surfaces so Keyxym can confirm them across frames before enabling a Moment.";
    } else {
      return;
    }
    stage.style.display = "";
  };

  const rootObserver = new MutationObserver(update);
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: ["data-keyxym-authority", "data-authority-stage", "data-authority-rejection-mask"],
  });
  const captureObserver = new MutationObserver(update);
  captureObserver.observe(capture, { childList: true, characterData: true, subtree: true });
  update();
  return () => {
    rootObserver.disconnect();
    captureObserver.disconnect();
  };
}
