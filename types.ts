export enum VoiceName {
  Kore = 'Kore',
  Puck = 'Puck',
  Charon = 'Charon',
  Zephyr = 'Zephyr',
  Fenrir = 'Fenrir'
}

export enum ReadingSpeed {
  Slow = 'Slow',
  Normal = 'Normal',
  Fast = 'Fast'
}

export interface EpisodeNotesSection {
  heading: string;
  bullets: string[];
}

export interface EpisodeNotes {
  title: string;
  summary: string;
  sections: EpisodeNotesSection[];
}

export interface EpisodeBookmark {
  id: string;
  time: number;
  createdAt: number;
}

export interface GeminiGenerationUsage {
  provider: 'Gemini';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  responseId?: string;
  recordedAt: number;
}

export interface EpisodeGenerationCost {
  provider: 'Gemini';
  model: string;
  currency: 'USD';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  billableRequests: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  updatedAt: number;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  text: string;
  notes?: EpisodeNotes | string;
  bookmarks?: EpisodeBookmark[];
  categories?: string[];
  date: number;
  voice: string;
  audioBlobId: string; // Base ID for chunks: {id}_0, {id}_1...
  chunkCount: number;
  duration: number;
  chunkDurations?: number[];
  readyChunkCount?: number;
  generationStatus?: 'processing' | 'ready' | 'failed';
  generationCost?: EpisodeGenerationCost;
  playbackRate: number;
  lastPosition?: {
    chunkIndex: number;
    currentTime: number;
  };
}

export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  activeEpisode: PodcastEpisode | null;
  currentChunkIndex: number;
}
