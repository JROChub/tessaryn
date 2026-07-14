import { KeyxymV22Runtime, type KeyxymFrameResult } from "./keyxym-v22-runtime";

const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let metricScale = false;
let referenceMeters = 1;

const originalIngest = KeyxymV22Runtime.prototype.ingest;
KeyxymV22Runtime.prototype.ingest = function patchedIngest(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  timestampNs: bigint,
): KeyxymFrameResult {
  const result = originalIngest.call(
    this,
    rgba,
    width,
    height,
    timestampNs,
    metricScale,
  );
  updateQuality(result);
  return result;
};

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updateQuality(result: KeyxymFrameResult): void {
  const quality = result.quality;
  setText("tracking-value", `${Math.round(quality.tracking * 100)}%`);
  setText("parallax-value", `${quality.parallaxDegrees.toFixed(2)}°`);
  setText(
    "error-value",
    Number.isFinite(quality.reprojectionErrorPixels)
      ? `${quality.reprojectionErrorPixels.toFixed(2)} px`
      : "—",
  );
  setText("coverage-value", `${Math.round(quality.coverage * 100)}%`);
  setText("confirmed-value", quality.confirmed.toLocaleString());
  setText("uncertain-value", quality.uncertain.toLocaleString());
  setText("rejected-value", quality.rejected.toLocaleString());
  setText("scale-value", metricScale ? `METRIC ${referenceMeters.toFixed(2)} M` : "RELATIVE");
  const meter = document.getElementById("quality-meter");
  if (meter) meter.style.width = `${Math.round(quality.tracking * 100)}%`;
}

q("calibrate-button").onclick = () =>
  q<HTMLDialogElement>("calibration-dialog").showModal();

q("apply-calibration").onclick = () => {
  const value = Number(q<HTMLInputElement>("scale-input").value);
  if (!Number.isFinite(value) || value <= 0) return;
  referenceMeters = value;
  metricScale = true;
  setText("scale-value", `METRIC ${referenceMeters.toFixed(2)} M`);
  q<HTMLDialogElement>("calibration-dialog").close();
};
