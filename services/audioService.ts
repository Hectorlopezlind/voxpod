
import { PodcastEpisode } from "../types";

let audioEl: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;
let audioUnlocked = false;

const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

export const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000): ArrayBuffer => {
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);
  const pcmView = new Uint8Array(pcmData.buffer);
  for (let i = 0; i < pcmData.length; i++) {
    view.setUint8(44 + i, pcmView[i]);
  }
  return buffer;
};

const MP3_BITRATE_KBPS = 96;
const MP3_FRAME_SIZE = 1152;

type LameJsModule = typeof import("lamejs");
type Mp3EncoderInstance = InstanceType<LameJsModule["Mp3Encoder"]>;

const readWavChunkAsMono = (
  wavBuffer: ArrayBuffer,
  WavHeader: LameJsModule["WavHeader"]
) => {
  const header = WavHeader.readHeader(new DataView(wavBuffer));
  if (!header) {
    throw new Error("Ogiltig WAV-data.");
  }

  const interleaved = new Int16Array(wavBuffer, header.dataOffset, header.dataLen / 2);

  if (header.channels === 1) {
    return {
      sampleRate: header.sampleRate,
      samples: interleaved,
    };
  }

  const frameCount = interleaved.length / header.channels;
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let channel = 0; channel < header.channels; channel++) {
      sum += interleaved[frame * header.channels + channel];
    }
    mono[frame] = Math.round(sum / header.channels);
  }

  return {
    sampleRate: header.sampleRate,
    samples: mono,
  };
};

export const exportEpisodeAsMp3 = async (buffers: ArrayBuffer[]): Promise<Blob> => {
  if (buffers.length === 0) {
    throw new Error("Inga ljudbitar att exportera.");
  }

  const { Mp3Encoder, WavHeader } = await import("lamejs");
  let sampleRate: number | null = null;
  let encoder: Mp3EncoderInstance | null = null;
  const mp3Chunks: Int8Array[] = [];

  for (const wavBuffer of buffers) {
    const chunk = readWavChunkAsMono(wavBuffer, WavHeader);

    if (sampleRate === null) {
      sampleRate = chunk.sampleRate;
      encoder = new Mp3Encoder(1, sampleRate, MP3_BITRATE_KBPS);
    } else if (chunk.sampleRate !== sampleRate) {
      throw new Error("Ljudbitarna har olika sample rate.");
    }

    for (let offset = 0; offset < chunk.samples.length; offset += MP3_FRAME_SIZE) {
      const frame = chunk.samples.subarray(offset, offset + MP3_FRAME_SIZE);
      const encodedFrame = encoder.encodeBuffer(frame);
      if (encodedFrame.length > 0) {
        mp3Chunks.push(encodedFrame);
      }
    }
  }

  const finalFrame = encoder?.flush();
  if (finalFrame && finalFrame.length > 0) {
    mp3Chunks.push(finalFrame);
  }

  return new Blob(mp3Chunks, { type: "audio/mpeg" });
};

export const initAudioElement = () => {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
    audioEl.setAttribute('playsinline', 'true');
    audioEl.setAttribute('webkit-playsinline', 'true');
  }
  return audioEl;
};

export const unlockAudioPlayback = async () => {
  if (audioUnlocked) {
    return true;
  }

  try {
    const unlockEl = new Audio(SILENT_WAV_DATA_URL);
    unlockEl.preload = 'auto';
    unlockEl.muted = true;
    unlockEl.setAttribute('playsinline', 'true');
    unlockEl.setAttribute('webkit-playsinline', 'true');
    await unlockEl.play();
    unlockEl.pause();
    unlockEl.currentTime = 0;
    audioUnlocked = true;
    return true;
  } catch {
    return false;
  }
};

export const loadAudioFromBuffer = (wavBuffer: ArrayBuffer) => {
  const el = initAudioElement();
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
  }
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  currentBlobUrl = URL.createObjectURL(blob);
  el.src = currentBlobUrl;
  el.load();
};

export const playAudio = () => {
  const el = initAudioElement();
  return el.play();
};

export const pauseAudio = () => {
  const el = initAudioElement();
  el.pause();
};

export const stopAudio = () => {
  const el = initAudioElement();
  el.pause();
  el.currentTime = 0;
};

export const seekAudio = (delta: number) => {
  const el = initAudioElement();
  el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
};

export const setPlaybackPosition = (percent: number) => {
  const el = initAudioElement();
  if (el.duration) {
    el.currentTime = (percent / 100) * el.duration;
  }
};

export const setPlaybackRate = (rate: number) => {
  const el = initAudioElement();
  el.playbackRate = rate;
};

export const setupMediaSession = (episode: PodcastEpisode, actions: { onPlay: () => void, onPause: () => void, onSeek: (delta: number) => void }) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: 'VoxPod AI',
      artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/3039/3039396.png', sizes: '512x512', type: 'image/png' }]
    });

    navigator.mediaSession.setActionHandler('play', actions.onPlay);
    navigator.mediaSession.setActionHandler('pause', actions.onPause);
    navigator.mediaSession.setActionHandler('seekbackward', () => actions.onSeek(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => actions.onSeek(30));
  }
};

export const setMediaSessionPlaybackState = (isPlaying: boolean) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
};

export const getAudioState = () => {
  const el = initAudioElement();
  return {
    currentTime: el.currentTime || 0,
    duration: el.duration || 0,
    isPlaying: !el.paused,
    playbackRate: el.playbackRate
  };
};

export const decodeBase64ToUint8 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};
