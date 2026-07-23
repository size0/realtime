class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.input = new Float32Array(0);
    this.position = 0;
    this.output = [];
    this.batchSamples = 320;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    const merged = new Float32Array(this.input.length + channel.length);
    merged.set(this.input);
    merged.set(channel, this.input.length);
    this.input = merged;

    while (this.position + 1 < this.input.length) {
      const leftIndex = Math.floor(this.position);
      const fraction = this.position - leftIndex;
      const sample =
        this.input[leftIndex] * (1 - fraction) +
        this.input[leftIndex + 1] * fraction;
      this.output.push(Math.max(-1, Math.min(1, sample)));
      this.position += this.ratio;

      if (this.output.length >= this.batchSamples) {
        const pcm = new Int16Array(this.batchSamples);
        for (let index = 0; index < this.batchSamples; index += 1) {
          const value = this.output[index];
          pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
        }
        this.output.splice(0, this.batchSamples);
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }

    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.input = this.input.slice(consumed);
      this.position -= consumed;
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

