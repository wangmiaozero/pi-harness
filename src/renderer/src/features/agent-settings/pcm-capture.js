/* global AudioWorkletProcessor, registerProcessor */
class CapturePcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Int16Array(2048)
    this.offset = 0
  }
  process(inputs) {
    const input = inputs[0]?.[0]
    if (input)
      for (const sample of input) {
        const value = Math.max(-1, Math.min(1, sample))
        this.samples[this.offset++] = value < 0 ? value * 32768 : value * 32767
        if (this.offset === this.samples.length) {
          this.port.postMessage(this.samples.buffer, [this.samples.buffer])
          this.samples = new Int16Array(2048)
          this.offset = 0
        }
      }
    return true
  }
}
registerProcessor('harness-pcm-capture', CapturePcm)
