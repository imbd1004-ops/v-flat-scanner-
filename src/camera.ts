/**
 * Rear-camera wrapper. Besides the live preview stream it exposes the pieces
 * that make a *sharp* scan possible on a phone:
 *  - continuous autofocus on the stream, with a forced single-shot refocus
 *    (optionally at a tapped point) when the page looks soft,
 *  - still capture through ImageCapture.takePhoto(), which uses the sensor's
 *    full photo resolution and runs the camera's own focus/exposure cycle,
 *    instead of grabbing a compressed preview frame.
 */

type AdvancedConstraint = Record<string, unknown>;

interface ImageCaptureLike {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
  getPhotoCapabilities(): Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number } }>;
}

declare global {
  interface Window {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }
}

export class Camera {
  private stream: MediaStream | null = null;
  private imageCapture: ImageCaptureLike | null = null;
  private caps: Record<string, unknown> = {};
  private refocusing = false;

  constructor(readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 카메라를 지원하지 않습니다.');
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        // Ask for the largest stream the device offers: the preview is
        // downscaled for detection anyway, and a bigger stream is the
        // fallback source when still capture is unavailable.
        width: { ideal: 4096 },
        height: { ideal: 3072 },
        frameRate: { ideal: 30 },
      },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }
    this.video.srcObject = this.stream;
    await this.video.play();

    const track = this.track;
    if (!track) return;
    this.caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    this.imageCapture = window.ImageCapture ? new window.ImageCapture(track) : null;

    const adv: AdvancedConstraint[] = [];
    if (this.supports('focusMode', 'continuous')) adv.push({ focusMode: 'continuous' });
    if (this.supports('exposureMode', 'continuous')) adv.push({ exposureMode: 'continuous' });
    if (this.supports('whiteBalanceMode', 'continuous')) adv.push({ whiteBalanceMode: 'continuous' });
    if (Array.isArray(this.caps.resizeMode) && (this.caps.resizeMode as string[]).includes('none')) adv.push({ resizeMode: 'none' });
    if (adv.length) await track.applyConstraints({ advanced: adv } as MediaTrackConstraints).catch(() => {});
  }

  private get track(): MediaStreamTrack | undefined {
    return this.stream?.getVideoTracks()[0];
  }

  private supports(cap: string, value: string): boolean {
    const v = this.caps[cap];
    return Array.isArray(v) && (v as string[]).includes(value);
  }

  get hasStillCapture(): boolean {
    return !!this.imageCapture;
  }

  get canFocus(): boolean {
    return this.supports('focusMode', 'single-shot') || this.supports('focusMode', 'continuous');
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.imageCapture = null;
    this.video.srcObject = null;
  }

  get running(): boolean {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  /**
   * Forces an autofocus cycle. `x`/`y` are normalised (0..1) preview
   * coordinates for tap-to-focus; omit them to focus on the centre.
   * Returns once the camera has had time to settle.
   */
  async refocus(x?: number, y?: number): Promise<void> {
    const track = this.track;
    if (!track || this.refocusing) return;
    this.refocusing = true;
    try {
      const adv: AdvancedConstraint[] = [];
      if (x !== undefined && y !== undefined && 'pointsOfInterest' in this.caps) adv.push({ pointsOfInterest: [{ x, y }] });
      if (this.supports('focusMode', 'single-shot')) {
        await track.applyConstraints({ advanced: [...adv, { focusMode: 'single-shot' }] } as MediaTrackConstraints).catch(() => {});
        await new Promise((r) => setTimeout(r, 650));
        if (this.supports('focusMode', 'continuous')) {
          await track.applyConstraints({ advanced: [...adv, { focusMode: 'continuous' }] } as MediaTrackConstraints).catch(() => {});
        }
      } else if (adv.length) {
        await track.applyConstraints({ advanced: adv } as MediaTrackConstraints).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      this.refocusing = false;
    }
  }

  /** Grabs the current preview frame at stream resolution. */
  grabFrame(): ImageData {
    const c = document.createElement('canvas');
    c.width = this.video.videoWidth;
    c.height = this.video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.video, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  /**
   * Takes a full-resolution still through ImageCapture when available.
   * Returns null when the platform has no still-capture support, so the
   * caller can fall back to the preview frame.
   */
  async takePhoto(maxSide = 3200): Promise<ImageData | null> {
    if (!this.imageCapture) return null;
    try {
      let settings: { imageWidth?: number; imageHeight?: number } | undefined;
      try {
        const pc = await this.imageCapture.getPhotoCapabilities();
        if (pc.imageWidth?.max && pc.imageHeight?.max) {
          const f = Math.min(1, maxSide / Math.max(pc.imageWidth.max, pc.imageHeight.max));
          settings = { imageWidth: Math.round(pc.imageWidth.max * f), imageHeight: Math.round(pc.imageHeight.max * f) };
        }
      } catch {
        settings = undefined;
      }
      const blob = await this.imageCapture.takePhoto(settings);
      const bmp = await createImageBitmap(blob);
      const f = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * f);
      c.height = Math.round(bmp.height * f);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return ctx.getImageData(0, 0, c.width, c.height);
    } catch {
      return null;
    }
  }

  async toggleTorch(on: boolean): Promise<boolean> {
    const track = this.track;
    if (!track || !('torch' in this.caps)) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }
}
