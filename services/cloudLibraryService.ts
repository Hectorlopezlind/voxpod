import type { EpisodeGenerationCost, PodcastEpisode } from '../types';
import { supabase } from './supabaseClient';

const CLOUD_EPISODES_TABLE = 'podcast_episodes';
export const AUDIO_BUCKET_NAME = 'Audio';

type CloudEpisodeRow = {
  user_id: string;
  episode_id: string;
  payload: PodcastEpisode | null;
  updated_at: string;
};

type CloudGenerationUsageRow = {
  episode_id: string;
  provider: 'Gemini';
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_cost_usd: number | string;
  output_cost_usd: number | string;
  total_cost_usd: number | string;
  pricing: {
    inputUsdPerMillionTokens?: number;
    outputUsdPerMillionTokens?: number;
  } | null;
  created_at: string;
};

const isStorageNotFoundError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /not found|status code 404|object not found/i.test(message);
};

export const isMissingCloudSchemaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /podcast_episodes/i.test(message) && /does not exist|not found|schema cache/i.test(message);
};

export const isCloudPermissionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /row-level security|permission|unauthorized|forbidden|not allowed/i.test(message);
};

const normalizeEpisodePayload = (episodeId: string, payload: PodcastEpisode | null): PodcastEpisode => {
  const candidate = payload && typeof payload === 'object' ? payload as Partial<PodcastEpisode> : {};

  return {
    id: candidate.id || episodeId,
    title: candidate.title || 'Untitled episode',
    text: candidate.text || '',
    notes: candidate.notes,
    bookmarks: Array.isArray(candidate.bookmarks) ? candidate.bookmarks : [],
    categories: Array.isArray(candidate.categories) ? candidate.categories : [],
    date: typeof candidate.date === 'number' ? candidate.date : Date.now(),
    voice: candidate.voice || 'Kore',
    audioBlobId: candidate.audioBlobId || candidate.id || episodeId,
    chunkCount: typeof candidate.chunkCount === 'number' ? candidate.chunkCount : 0,
    duration: typeof candidate.duration === 'number' ? candidate.duration : 0,
    chunkDurations: Array.isArray(candidate.chunkDurations) ? candidate.chunkDurations : [],
    readyChunkCount: typeof candidate.readyChunkCount === 'number' ? candidate.readyChunkCount : undefined,
    generationStatus: candidate.generationStatus,
    generationCost: candidate.generationCost,
    playbackRate: typeof candidate.playbackRate === 'number' ? candidate.playbackRate : 1,
    lastPosition: candidate.lastPosition,
  };
};

const serializeEpisode = (episode: PodcastEpisode): PodcastEpisode => ({
  ...episode,
  bookmarks: episode.bookmarks ?? [],
  categories: episode.categories ?? [],
  chunkDurations: episode.chunkDurations ?? [],
  playbackRate: typeof episode.playbackRate === 'number' ? episode.playbackRate : 1,
});

const sumCloudGenerationCosts = (rows: CloudGenerationUsageRow[]) => {
  const totals = new Map<string, EpisodeGenerationCost>();

  rows.forEach((row) => {
    const current = totals.get(row.episode_id);
    totals.set(row.episode_id, {
      provider: 'Gemini',
      model: row.model,
      currency: 'USD',
      inputTokens: (current?.inputTokens ?? 0) + row.input_tokens,
      outputTokens: (current?.outputTokens ?? 0) + row.output_tokens,
      totalTokens: (current?.totalTokens ?? 0) + row.total_tokens,
      inputCostUsd: (current?.inputCostUsd ?? 0) + Number(row.input_cost_usd),
      outputCostUsd: (current?.outputCostUsd ?? 0) + Number(row.output_cost_usd),
      totalCostUsd: (current?.totalCostUsd ?? 0) + Number(row.total_cost_usd),
      billableRequests: (current?.billableRequests ?? 0) + 1,
      inputUsdPerMillionTokens: row.pricing?.inputUsdPerMillionTokens ?? current?.inputUsdPerMillionTokens ?? 0,
      outputUsdPerMillionTokens: row.pricing?.outputUsdPerMillionTokens ?? current?.outputUsdPerMillionTokens ?? 0,
      updatedAt: Math.max(current?.updatedAt ?? 0, new Date(row.created_at).getTime()),
    });
  });

  return totals;
};

export const getCloudChunkPath = (userId: string, audioBlobId: string, index: number) =>
  `${userId}/${audioBlobId}/chunk-${index}.wav`;

export const getCloudSummaryPath = (userId: string, audioBlobId: string) =>
  `${userId}/${audioBlobId}/summary.wav`;

export const fetchCloudEpisodes = async (userId: string): Promise<PodcastEpisode[]> => {
  if (!supabase) {
    return [];
  }

  const [{ data, error }, { data: usageData, error: usageError }] = await Promise.all([
    supabase
      .from(CLOUD_EPISODES_TABLE)
      .select('user_id, episode_id, payload, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('podcast_generation_usage')
      .select('episode_id, provider, model, input_tokens, output_tokens, total_tokens, input_cost_usd, output_cost_usd, total_cost_usd, pricing, created_at')
      .eq('user_id', userId)
      .eq('usage_category', 'podcast_audio'),
  ]);

  if (error) {
    throw error;
  }

  if (usageError) {
    console.warn('Could not read podcast generation usage', usageError);
  }
  const serverCosts = sumCloudGenerationCosts((usageData as CloudGenerationUsageRow[] | null) ?? []);

  return (data as CloudEpisodeRow[]).map((row) => {
    const episode = normalizeEpisodePayload(row.episode_id, row.payload);
    return {
      ...episode,
      generationCost: serverCosts.get(row.episode_id) ?? episode.generationCost,
    };
  });
};

export const upsertCloudEpisodes = async (userId: string, episodes: PodcastEpisode[]): Promise<void> => {
  if (!supabase || episodes.length === 0) {
    return;
  }

  const rows = episodes.map((episode) => ({
    user_id: userId,
    episode_id: episode.id,
    payload: serializeEpisode(episode),
  }));

  const { error } = await supabase
    .from(CLOUD_EPISODES_TABLE)
    .upsert(rows, { onConflict: 'user_id,episode_id' });

  if (error) {
    throw error;
  }
};

export const deleteCloudEpisode = async (userId: string, episode: PodcastEpisode): Promise<void> => {
  if (!supabase) {
    return;
  }

  const audioPaths = Array.from(
    { length: Math.max(episode.chunkCount, episode.readyChunkCount ?? 0) },
    (_, index) => getCloudChunkPath(userId, episode.audioBlobId, index)
  );
  audioPaths.push(getCloudSummaryPath(userId, episode.audioBlobId));

  const { error: removeError } = await supabase
    .storage
    .from(AUDIO_BUCKET_NAME)
    .remove(audioPaths);

  if (removeError && !isStorageNotFoundError(removeError)) {
    throw removeError;
  }

  const { error } = await supabase
    .from(CLOUD_EPISODES_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('episode_id', episode.id);

  if (error) {
    throw error;
  }
};

export const uploadCloudEpisodeChunk = async (
  userId: string,
  audioBlobId: string,
  index: number,
  wavBuffer: ArrayBuffer
): Promise<void> => {
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .storage
    .from(AUDIO_BUCKET_NAME)
    .upload(
      getCloudChunkPath(userId, audioBlobId, index),
      new Blob([wavBuffer], { type: 'audio/wav' }),
      {
        contentType: 'audio/wav',
        upsert: true,
      }
    );

  if (error) {
    throw error;
  }
};

export const uploadCloudSummaryAudio = async (
  userId: string,
  audioBlobId: string,
  wavBuffer: ArrayBuffer
): Promise<void> => {
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .storage
    .from(AUDIO_BUCKET_NAME)
    .upload(
      getCloudSummaryPath(userId, audioBlobId),
      new Blob([wavBuffer], { type: 'audio/wav' }),
      {
        contentType: 'audio/wav',
        upsert: true,
      }
    );

  if (error) {
    throw error;
  }
};

const downloadCloudAudio = async (path: string): Promise<ArrayBuffer | null> => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .storage
    .from(AUDIO_BUCKET_NAME)
    .download(path);

  if (error) {
    if (isStorageNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  return data.arrayBuffer();
};

export const downloadCloudEpisodeChunk = async (
  userId: string,
  audioBlobId: string,
  index: number
): Promise<ArrayBuffer | null> =>
  downloadCloudAudio(getCloudChunkPath(userId, audioBlobId, index));

export const downloadCloudSummaryAudio = async (
  userId: string,
  audioBlobId: string
): Promise<ArrayBuffer | null> =>
  downloadCloudAudio(getCloudSummaryPath(userId, audioBlobId));
