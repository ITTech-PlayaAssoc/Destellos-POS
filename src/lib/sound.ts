let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => undefined);
  }
  return sharedAudioCtx;
}

/**
 * Emits a crisp, pleasant POS confirmation beep using the browser Web Audio API.
 */
export function playScanSuccessBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.setValueAtTime(1560, now + 0.045);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // Ignore audio context restrictions if blocked by browser policy
  }
}

/**
 * Emits a subtle low-pitched double alert beep when a barcode is missing or out of stock.
 */
export function playScanErrorBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const playPulse = (offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now + offset);
      osc.frequency.setValueAtTime(190, now + offset + 0.05);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.12);
    };

    playPulse(0);
    playPulse(0.14);
  } catch {
    // Ignore audio context restrictions if blocked by browser policy
  }
}
