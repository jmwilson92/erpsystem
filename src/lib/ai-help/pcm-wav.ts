/** PCM helpers for server STT uploads (16-bit mono WAV). */

export const STT_SAMPLE_RATE = 16_000;

export function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const rate = inputRate || STT_SAMPLE_RATE;
  if (rate === STT_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return out;
  }
  const ratio = rate / STT_SAMPLE_RATE;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      n++;
    }
    const s = Math.max(-1, Math.min(1, n ? sum / n : 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function concatInt16(chunks: Int16Array[]): Int16Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function encodeWav(pcm: Int16Array, sampleRate = STT_SAMPLE_RATE): Blob {
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) view.setInt16(o, pcm[i], true);
  return new Blob([buf], { type: "audio/wav" });
}

export function durationMsOfPcm(pcm: Int16Array, sampleRate = STT_SAMPLE_RATE): number {
  if (!pcm.length) return 0;
  return Math.round((pcm.length / sampleRate) * 1000);
}
