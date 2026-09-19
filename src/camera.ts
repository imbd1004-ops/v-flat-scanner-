/** Thin wrapper around getUserMedia for the rear camera. */
export class Camera {
  private stream: MediaStream | null = null;
  constructor(readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 카메라를 지원하지 않습니다.');
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    // Continuous autofocus where supported (Android Chrome).
    const track = this.stream.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const adv: Record<string, unknown>[] = [];
    if (Array.isArray(caps.focusMode) && (caps.focusMode as string[]).includes('continuous')) adv.push({ focusMode: 'continuous' });
    if (adv.length) track.applyConstraints({ advanced: adv } as MediaTrackConstraints).catch(() => {});
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get running(): boolean {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  /** Grabs the current frame at native resolution. */
  grabFrame(): ImageData {
    const c = document.createElement('canvas');
    c.width = this.video.videoWidth;
    c.height = this.video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.video, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  async toggleTorch(on: boolean): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    if (!('torch' in caps)) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }
}
