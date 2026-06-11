// Routes Web Audio through a hidden <audio> element so mobile OSes treat
// playback as real media (lock screen, background, headset controls).

export class PlaybackSink {
  readonly element: HTMLAudioElement;

  constructor() {
    const el = document.createElement("audio");
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.preload = "auto";
    el.style.cssText =
      "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    this.element = el;
  }

  attach(stream: MediaStream): Promise<void> {
    this.element.srcObject = stream;
    return this.element.play();
  }

  detach(): void {
    this.element.pause();
    this.element.srcObject = null;
  }

  dispose(): void {
    this.detach();
    this.element.remove();
  }
}
