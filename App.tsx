
import React, { useState, useEffect, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { VoiceName, PodcastEpisode, PlayerState, EpisodeNotes, EpisodeBookmark } from './types';
import { generateTTS, translateText, generateNotes, GeminiRequestOptions, streamTextFromImage, streamTextFromPdf } from './services/geminiService';
import { saveAudioBlob, getAudioBlob, deleteAudioBlobsByPrefix, getImportTextCache, saveImportTextCache } from './services/dbService';
import { DOCUMENT_UPLOAD_ACCEPT, isTextDocumentFile, streamLocalDocumentText } from './services/documentService';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import { 
  initAudioElement, 
  loadAudioFromBuffer, 
  playAudio, 
  pauseAudio, 
  stopAudio,
  setupMediaSession,
  pcmToWav,
  decodeBase64ToUint8,
  setPlaybackRate,
  exportEpisodeAsMp3,
  setMediaSessionPlaybackState,
  unlockAudioPlayback
} from './services/audioService';

const PREMIUM_VOICES = [
  { name: VoiceName.Kore, label: 'Klara' },
  { name: VoiceName.Puck, label: 'Peter' },
  { name: VoiceName.Charon, label: 'Chris' },
  { name: VoiceName.Zephyr, label: 'Sofia' },
  { name: VoiceName.Fenrir, label: 'Erik' }
];

const LANGUAGES = [
  // Prioriterade språk absolut överst
  { code: 'English', label: 'English' },
  { code: 'Spanish', label: 'Spanish' },
  { code: 'Swedish', label: 'Swedish' },
  // Europeiska språk (A-Ö)
  { code: 'Bulgarian', label: 'Bulgarian' },
  { code: 'Danish', label: 'Danish' },
  { code: 'Finnish', label: 'Finnish' },
  { code: 'French', label: 'French' },
  { code: 'Greek', label: 'Greek' },
  { code: 'Icelandic', label: 'Icelandic' },
  { code: 'Italian', label: 'Italian' },
  { code: 'Dutch', label: 'Dutch' },
  { code: 'Norwegian', label: 'Norwegian' },
  { code: 'Polish', label: 'Polish' },
  { code: 'Portuguese', label: 'Portuguese' },
  { code: 'Romanian', label: 'Romanian' },
  { code: 'Russian', label: 'Russian' },
  { code: 'Slovak', label: 'Slovak' },
  { code: 'Czech', label: 'Czech' },
  { code: 'Turkish', label: 'Turkish' },
  { code: 'German', label: 'German' },
  { code: 'Ukrainian', label: 'Ukrainian' },
  { code: 'Hungarian', label: 'Hungarian' },
  // Globala språk (A-Ö)
  { code: 'Arabic', label: 'Arabic' },
  { code: 'Hindi', label: 'Hindi' },
  { code: 'Indonesian', label: 'Indonesian' },
  { code: 'Japanese', label: 'Japanese' },
  { code: 'Chinese', label: 'Chinese' },
  { code: 'Korean', label: 'Korean' },
  { code: 'Thai', label: 'Thai' },
  { code: 'Vietnamese', label: 'Vietnamese' }
];

const EN_TRANSLATIONS = {
  app_subtitle: 'AI Podcast Streamer',
  docs_btn: '📄 DOCS',
  camera_btn: '📸 Camera',
  images_btn: '📷 IMAGES',
  scanning_pdf: 'Reading PDF...',
  scanning_images: 'Reading images...',
  translating: 'Translating...',
  placeholder_text: 'Write something wonderful...',
  placeholder_notes: 'Personal notes (optional)...',
  clear_btn: '🗑️ Clear',
  translate_btn: '🌐 Translate',
  voice_label: 'Voice',
  speed_label: 'Speed',
  generate_btn: 'Start Podcast ✨',
  creating_podcast: 'Creating podcast',
  loading_text: 'Loading text',
  translating_short: 'Translating',
  progress_label: 'Progress',
  time_left: 'left',
  library_title: 'Library',
  empty_library: 'Empty Library',
  ai_voice_mode: 'AI VOICE MODE',
  part_label: 'PART',
  of_label: 'OF',
  notes_title: 'Notes',
  no_notes: 'No notes available yet.',
  close_btn: 'Close',
  sec_left: 'sec left',
  scanning_progress: 'Scanning...',
  est_time: 'est.',
  countdown_label: 'COUNTDOWN',
  almost_done: 'Almost done',
  target_label: 'Target',
  files_label: 'files',
  step_label: 'Step',
  image_order_title: 'Image order',
  image_order_hint: 'The app reads images in this order.',
  retrying: 'Retrying automatically',
  waiting_for_network: 'Waiting for network',
  listen_summary_btn: 'Listen to summary',
  pause_summary_btn: 'Pause summary',
  summary_audio_error: 'Could not play the summary.',
  summary_button_title: 'Summary audio',
  add_bookmark_btn: 'Add bookmark',
  bookmarks_title: 'Bookmarks',
  speed_toggle_show: 'Show speed',
  speed_toggle_hide: 'Hide speed',
  player_hide: 'Hide player',
  player_show: 'Show player',
  categories_title: 'Categories',
  category_placeholder: 'politics, novels, history',
  category_hint: 'Separate categories with commas.',
  save_categories_btn: 'Save categories',
  edit_categories_btn: 'Categories',
  all_categories: 'All',
  sort_label: 'Sort',
  sort_newest: 'Newest',
  sort_oldest: 'Oldest',
  sort_title: 'Title',
  uncategorized_label: 'Uncategorized',
  empty_category_filter: 'No audio in this category yet.',
  auth_title: 'Account',
  auth_subtitle_signed_out: 'Sign in to prepare cloud sync across devices.',
  auth_subtitle_signed_in: 'You are signed in. Library sync can be connected next.',
  auth_email_label: 'Email',
  auth_password_label: 'Password',
  auth_sign_in_tab: 'Sign in',
  auth_sign_up_tab: 'Create account',
  auth_sign_in_btn: 'Sign in',
  auth_sign_up_btn: 'Create account',
  auth_sign_out_btn: 'Sign out',
  auth_signed_in_as: 'Signed in as',
  auth_success_signed_in: 'Signed in.',
  auth_success_signed_out: 'Signed out.',
  auth_check_email: 'Account created. Check your email to verify it before signing in if verification is enabled.',
  auth_email_confirmed: 'Account created and signed in.',
  auth_loading: 'Connecting...'
} as const;

type SupportedLanguage = 'en' | 'sv';
type TranslationKey = keyof typeof EN_TRANSLATIONS;

const TRANSLATIONS: Record<SupportedLanguage, Record<TranslationKey, string>> = {
  en: EN_TRANSLATIONS,
  sv: {
    app_subtitle: 'AI Podcast Streamer',
    docs_btn: '📄 DOK',
    camera_btn: '📸 Kamera',
    images_btn: '📷 BILDER',
    scanning_pdf: 'Läser PDF...',
    scanning_images: 'Läser bilder...',
    translating: 'Översätter...',
    placeholder_text: 'Skriv något härligt...',
    placeholder_notes: 'Egna anteckningar (valfritt)...',
    clear_btn: '🗑️ Rensa',
    translate_btn: '🌐 Översätt',
    voice_label: 'Röst',
    speed_label: 'Hastighet',
    generate_btn: 'Starta podd ✨',
    creating_podcast: 'Skapar podd',
    loading_text: 'Laddar text',
    translating_short: 'Översätter',
    progress_label: 'Framsteg',
    time_left: 'kvar',
    library_title: 'Bibliotek',
    empty_library: 'Tomt bibliotek',
    ai_voice_mode: 'AI VOICE MODE',
    part_label: 'DEL',
    of_label: 'AV',
    notes_title: 'Anteckningar',
    no_notes: 'Inga anteckningar än.',
    close_btn: 'Stäng',
    sec_left: 'sek kvar',
    scanning_progress: 'Läser...',
    est_time: 'ca',
    countdown_label: 'NEDRÄKNING',
    almost_done: 'Snart klar',
    target_label: 'Målspråk',
    files_label: 'filer',
    step_label: 'Steg',
    image_order_title: 'Bildordning',
    image_order_hint: 'Appen läser bilderna i den här ordningen.',
    retrying: 'Försöker igen automatiskt',
    waiting_for_network: 'Väntar på nätverk',
    listen_summary_btn: 'Lyssna på sammanfattning',
    pause_summary_btn: 'Pausa sammanfattning',
    summary_audio_error: 'Kunde inte spela upp sammanfattningen.',
    summary_button_title: 'Lyssna på sammanfattning',
    add_bookmark_btn: 'Lägg bokmärke',
    bookmarks_title: 'Bokmärken',
    speed_toggle_show: 'Visa hastighet',
    speed_toggle_hide: 'Göm hastighet',
    player_hide: 'Göm spelare',
    player_show: 'Visa spelare',
    categories_title: 'Kategorier',
    category_placeholder: 'politik, romaner, historia',
    category_hint: 'Separera kategorier med kommatecken.',
    save_categories_btn: 'Spara kategorier',
    edit_categories_btn: 'Kategorier',
    all_categories: 'Alla',
    sort_label: 'Sortera',
    sort_newest: 'Nyast',
    sort_oldest: 'Äldst',
    sort_title: 'Titel',
    uncategorized_label: 'Utan kategori',
    empty_category_filter: 'Inga ljudfiler i den här kategorin än.',
    auth_title: 'Konto',
    auth_subtitle_signed_out: 'Logga in för att förbereda molnsynk mellan enheter.',
    auth_subtitle_signed_in: 'Du är inloggad. Bibliotekssynk kan kopplas på härnäst.',
    auth_email_label: 'E-post',
    auth_password_label: 'Lösenord',
    auth_sign_in_tab: 'Logga in',
    auth_sign_up_tab: 'Skapa konto',
    auth_sign_in_btn: 'Logga in',
    auth_sign_up_btn: 'Skapa konto',
    auth_sign_out_btn: 'Logga ut',
    auth_signed_in_as: 'Inloggad som',
    auth_success_signed_in: 'Inloggad.',
    auth_success_signed_out: 'Utloggad.',
    auth_check_email: 'Kontot skapades. Kontrollera din e-post om verifiering krävs innan du loggar in.',
    auth_email_confirmed: 'Kontot skapades och du är nu inloggad.',
    auth_loading: 'Ansluter...'
  }
};

type ScanSession = {
  startedAt: number;
  totalItems: number;
  completedItems: number;
  estimatedSeconds: number;
};

type TranslateSession = {
  startedAt: number;
  estimatedSeconds: number;
  targetLanguage: string;
};

type GenerationSession = {
  startedAt: number;
  estimatedSeconds: number;
  totalSteps: number;
  notesIncluded: boolean;
  notesCompleted: boolean;
};

type LibraryUpdater = (currentLibrary: PodcastEpisode[]) => PodcastEpisode[];

type ImportSource = 'document' | 'camera' | 'images';

type ImportSessionState = {
  id: string;
  source: ImportSource;
  baseText: string;
  text: string;
  isComplete: boolean;
};

type LibrarySortMode = 'newest' | 'oldest' | 'title';
type AuthMode = 'signIn' | 'signUp';

type AuthFeedback = {
  kind: 'error' | 'success' | 'info';
  message: string;
};

type LiveGenerationState = {
  sourceSessionId: string;
  episodeId: string;
  episodeCreated: boolean;
  generatedCount: number;
  generatedDurations: number[];
  startedPlayback: boolean;
  voice: VoiceName;
  title: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const estimateImageScanSeconds = (fileCount: number) =>
  clamp(fileCount * 6, 8, 50);

const estimatePdfScanSeconds = (fileSizeBytes: number) =>
  clamp(Math.ceil(fileSizeBytes / 350_000) * 4, 10, 40);

const estimateTranslationSeconds = (textLength: number) =>
  clamp(Math.ceil(textLength / 320), 5, 22);

const estimateGenerationSeconds = (chunkCount: number, includesNotes: boolean) =>
  clamp(chunkCount * 4 + (includesNotes ? 6 : 0), 10, 120);

const formatCountdown = (seconds: number) => {
  const safeSeconds = Math.max(1, Math.ceil(seconds));
  if (safeSeconds >= 60) {
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
  }
  return `${safeSeconds}s`;
};

const imageNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

const INITIAL_PLAYBACK_BUFFER = 2;
const MAX_CHUNK_CHARACTERS = 1800;
const MAX_NOTES_SOURCE_CHARACTERS = 12000;
const MAX_SUMMARY_AUDIO_CHARACTERS = 1200;
const MAX_SUMMARY_AUDIO_BULLETS = 4;
const LIVE_GENERATION_MIN_READY_CHUNKS = 2;
const LIVE_GENERATION_EARLY_START_CHARACTERS = 900;
const IMPORT_STREAM_FLUSH_CHARACTERS = 80;
const IMPORT_TEXT_CACHE_VERSION = 1;
const LIBRARY_STORAGE_KEY = 'voxpod_library';
const INPUT_TEXT_STORAGE_KEY = 'voxpod_input_text';
const INPUT_NOTES_STORAGE_KEY = 'voxpod_input_notes';
const LIBRARY_PERSIST_DELAY_MS = 180;
const AUDIO_SAMPLE_RATE = 24000;
const ESTIMATED_CHARACTERS_PER_SECOND = 14;

const sortFilesForReading = (files: File[]) =>
  files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => {
      const nameComparison = imageNameCollator.compare(a.file.name, b.file.name);
      if (nameComparison !== 0) return nameComparison;

      const modifiedComparison = a.file.lastModified - b.file.lastModified;
      if (modifiedComparison !== 0) return modifiedComparison;

      return a.index - b.index;
    })
    .map(({ file }) => file);

const sleep = (ms: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, ms));

const waitForNextPaint = () =>
  new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

const formatStopwatch = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const estimateEpisodeDurationSeconds = (text: string) =>
  clamp(Math.ceil(text.trim().length / ESTIMATED_CHARACTERS_PER_SECOND), 15, 60 * 60 * 6);

const calculateChunkDurationSeconds = (pcmBytes: Uint8Array, sampleRate: number = AUDIO_SAMPLE_RATE) =>
  pcmBytes.length / (sampleRate * 2);

const sumDurations = (durations: number[] = []) =>
  durations.reduce((total, value) => total + value, 0);

const getEpisodeTimeline = (episode: PodcastEpisode) => {
  const actualDurations = episode.chunkDurations ?? [];
  const actualTotal = sumDurations(actualDurations);
  const totalDuration = Math.max(episode.duration || 0, actualTotal);
  const remainingChunks = Math.max(0, episode.chunkCount - actualDurations.length);
  const estimatedChunkDuration = remainingChunks > 0
    ? Math.max(1, (totalDuration - actualTotal) / remainingChunks)
    : 0;

  return Array.from({ length: episode.chunkCount }, (_, index) => actualDurations[index] ?? estimatedChunkDuration);
};

const getEpisodeDuration = (episode: PodcastEpisode) =>
  Math.max(episode.duration || 0, sumDurations(episode.chunkDurations));

const getEpisodeOffset = (episode: PodcastEpisode, chunkIndex: number) =>
  getEpisodeTimeline(episode)
    .slice(0, chunkIndex)
    .reduce((total, value) => total + value, 0);

const isEpisodeAtEnd = (episode: PodcastEpisode, chunkIndex: number, chunkTime: number) => {
  const timeline = getEpisodeTimeline(episode);
  if (timeline.length === 0) {
    return false;
  }

  const safeChunkIndex = clamp(chunkIndex, 0, timeline.length - 1);
  const chunkDuration = timeline[safeChunkIndex] ?? 0;
  const overallTime = getEpisodeOffset(episode, safeChunkIndex) + Math.max(0, chunkTime);
  const episodeDuration = getEpisodeDuration(episode);

  return (
    safeChunkIndex === timeline.length - 1 &&
    (
      overallTime >= Math.max(0, episodeDuration - 0.5) ||
      (chunkDuration > 0 && chunkTime >= Math.max(0, chunkDuration - 0.5))
    )
  );
};

const locateChunkAtTime = (episode: PodcastEpisode, requestedTime: number) => {
  const timeline = getEpisodeTimeline(episode);
  const episodeDuration = timeline.reduce((total, value) => total + value, 0);
  let remainingTime = clamp(requestedTime, 0, episodeDuration);

  for (let index = 0; index < timeline.length; index++) {
    const chunkDuration = timeline[index] ?? 0;
    if (remainingTime <= chunkDuration || index === timeline.length - 1) {
      return {
        chunkIndex: index,
        chunkTime: Math.max(0, Math.min(chunkDuration || remainingTime, remainingTime))
      };
    }
    remainingTime -= chunkDuration;
  }

  return { chunkIndex: 0, chunkTime: 0 };
};

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const readFileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error ?? new Error('Kunde inte läsa filen.'));
    reader.readAsDataURL(file);
  });

const estimateDocumentScanSeconds = (file: File) =>
  isTextDocumentFile(file)
    ? clamp(Math.ceil(file.size / 250_000), 2, 8)
    : estimatePdfScanSeconds(file.size);

const estimateDocumentBatchScanSeconds = (files: File[]) =>
  clamp(files.reduce((total, file) => total + estimateDocumentScanSeconds(file), 0), 2, 180);

const buildImportCacheKey = (file: File) =>
  [
    'import-text',
    IMPORT_TEXT_CACHE_VERSION,
    file.name,
    file.size,
    file.lastModified,
    file.type || 'unknown'
  ].join(':');

const composeImportedText = (baseText: string, importedText: string) => {
  const trimmedBaseText = baseText.replace(/\s+$/g, '');
  const trimmedImportedText = importedText.replace(/^\s+/g, '');

  if (!trimmedBaseText) {
    return importedText;
  }

  if (!trimmedImportedText) {
    return baseText;
  }

  return `${trimmedBaseText}\n\n${trimmedImportedText}`;
};

const splitParagraphIntoSentences = (paragraph: string) =>
  paragraph.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(part => part.trim()).filter(Boolean) ?? [paragraph.trim()];

const NOTES_UI_LABELS = {
  en: {
    title: 'Notes',
    summary: 'Summary',
    personal: 'Your notes',
    highlights: 'Highlights',
    keyPoints: 'Key points',
    details: 'Details'
  },
  sv: {
    title: 'Anteckningar',
    summary: 'Sammanfattning',
    personal: 'Dina anteckningar',
    highlights: 'Höjdpunkter',
    keyPoints: 'Nyckelpunkter',
    details: 'Detaljer'
  }
} as const;

const PERSONAL_NOTES_HEADINGS = new Set(
  Object.values(NOTES_UI_LABELS).map(labels => labels.personal.toLowerCase())
);

const cleanBulletText = (value: string) =>
  value
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[\).\s-]+/, '')
    .trim();

const mergeGeneratedAndPersonalNotes = (
  generatedNotes: EpisodeNotes,
  personalNotes: string,
  userLang: string
): EpisodeNotes => {
  const trimmedPersonalNotes = personalNotes.trim();
  if (!trimmedPersonalNotes) {
    return generatedNotes;
  }

  const labels = NOTES_UI_LABELS[userLang as keyof typeof NOTES_UI_LABELS] ?? NOTES_UI_LABELS.en;
  const personalBullets = trimmedPersonalNotes
    .split(/\r?\n/)
    .map(cleanBulletText)
    .filter(Boolean);

  return {
    ...generatedNotes,
    sections: [
      ...generatedNotes.sections,
      {
        heading: labels.personal,
        bullets: personalBullets.length > 0 ? personalBullets : [trimmedPersonalNotes]
      }
    ]
  };
};

const normalizeInlineText = (value: string) =>
  value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxLength: number) => {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(' ');
  return `${(lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim()}…`;
};

const finalizeNoteBullet = (value: string) => {
  let bullet = normalizeInlineText(cleanBulletText(value));
  if (!bullet) return '';
  if (!/[.!?]$/.test(bullet)) {
    bullet = `${bullet}.`;
  }
  return bullet;
};

const getNotesLabels = (userLang: string) =>
  NOTES_UI_LABELS[userLang as keyof typeof NOTES_UI_LABELS] ?? NOTES_UI_LABELS.en;

const SUMMARY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'att', 'av', 'be', 'blev', 'by', 'de', 'dem', 'den', 'det',
  'detta', 'do', 'där', 'eller', 'en', 'ett', 'for', 'från', 'för', 'had', 'har', 'have', 'hur',
  'i', 'if', 'in', 'into', 'is', 'it', 'kan', 'med', 'men', 'not', 'och', 'om', 'on', 'or', 'på',
  'så', 'som', 'that', 'the', 'their', 'them', 'there', 'this', 'till', 'to', 'var', 'vi',
  'was', 'were', 'what', 'which', 'with'
]);

const tokenizeSummaryWords = (value: string) =>
  value
    .toLowerCase()
    .match(/[a-z0-9à-öø-ÿ]+/gi)
    ?.filter(word => word.length > 3 && !SUMMARY_STOP_WORDS.has(word)) ?? [];

const collectTextSentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap(paragraph => splitParagraphIntoSentences(paragraph))
    .map(sentence => normalizeInlineText(sentence))
    .filter(sentence => sentence.length >= 24);

const selectSummarySentences = (text: string, maxSentences: number) => {
  const sentences = collectTextSentences(text);
  if (sentences.length <= maxSentences) {
    return sentences;
  }

  const frequencies = new Map<string, number>();
  sentences.forEach(sentence => {
    tokenizeSummaryWords(sentence).forEach(word => {
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    });
  });

  return sentences
    .map((sentence, index) => {
      const tokens = tokenizeSummaryWords(sentence);
      const keywordScore = tokens.reduce((total, word) => total + (frequencies.get(word) ?? 0), 0);
      const densityScore = keywordScore / Math.max(tokens.length, 1);
      const introBonus = index === 0 ? 1.35 : index === 1 ? 1.15 : 1;
      const outroBonus = index === sentences.length - 1 ? 1.1 : 1;
      const lengthBonus = sentence.length >= 60 && sentence.length <= 220 ? 1.1 : 0.95;

      return {
        index,
        sentence,
        score: densityScore * introBonus * outroBonus * lengthBonus
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence);
};

const buildSummaryFallbackCore = (
  text: string,
  userLang: string,
  titleOverride?: string
): EpisodeNotes => {
  const labels = getNotesLabels(userLang);
  const firstLine = titleOverride
    || text
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    || labels.title;
  const summarySentences = selectSummarySentences(text, 3);
  const bulletSentences = selectSummarySentences(text, 4);
  const summary = truncateText(summarySentences.join(' '), 280)
    || truncateText(text, 280)
    || labels.summary;
  const bullets = bulletSentences
    .map(finalizeNoteBullet)
    .filter(Boolean)
    .slice(0, 4);

  return {
    title: truncateText(firstLine, 70) || labels.title,
    summary,
    sections: [
      {
        heading: labels.keyPoints,
        bullets: bullets.length > 0 ? bullets : [finalizeNoteBullet(summary) || summary]
      }
    ]
  };
};

const extractPersonalNotesSection = (
  sections: EpisodeNotes['sections'],
  userLang: string
) => {
  const labels = getNotesLabels(userLang);
  const bullets = sections
    .filter(section => PERSONAL_NOTES_HEADINGS.has(normalizeInlineText(section.heading).toLowerCase()))
    .flatMap(section => section.bullets)
    .map(finalizeNoteBullet)
    .filter(Boolean)
    .slice(0, 4);

  if (bullets.length === 0) {
    return null;
  }

  return {
    heading: labels.personal,
    bullets
  };
};

const sanitizeEpisodeNotes = (
  notes: EpisodeNotes,
  sourceText: string,
  userLang: string
): EpisodeNotes => {
  const labels = getNotesLabels(userLang);
  const fallback = buildSummaryFallbackCore(sourceText, userLang, notes.title);
  const personalSection = extractPersonalNotesSection(notes.sections, userLang);
  const mainBullets = notes.sections
    .filter(section => !PERSONAL_NOTES_HEADINGS.has(normalizeInlineText(section.heading).toLowerCase()))
    .flatMap(section => section.bullets)
    .map(finalizeNoteBullet)
    .filter(Boolean);
  const uniqueBullets = Array.from(new Set(mainBullets)).slice(0, 4);

  return {
    title: truncateText(notes.title || fallback.title, 70) || fallback.title,
    summary: truncateText(notes.summary || fallback.summary, 280) || fallback.summary,
    sections: [
      {
        heading: labels.keyPoints,
        bullets: uniqueBullets.length > 0 ? uniqueBullets : fallback.sections[0].bullets
      },
      ...(personalSection ? [personalSection] : [])
    ]
  };
};

const normalizeEpisodeNotes = (
  notes: PodcastEpisode['notes'],
  userLang: string
): EpisodeNotes | null => {
  if (!notes) return null;

  if (typeof notes !== 'string') {
    const sourceText = [
      notes.summary,
      ...notes.sections.flatMap(section => section.bullets)
    ].join(' ');
    return sanitizeEpisodeNotes(notes, sourceText, userLang);
  }

  if (!notes.trim()) return null;
  return buildSummaryFallbackCore(notes, userLang);
};

const buildNotesSourceText = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_NOTES_SOURCE_CHARACTERS) {
    return trimmed;
  }

  const head = trimmed.slice(0, 8500).trim();
  const tail = trimmed.slice(-2500).trim();
  return `${head}\n\n[...]\n\n${tail}`;
};

const buildFallbackEpisodeNotes = (
  text: string,
  personalNotes: string,
  userLang: string
): EpisodeNotes => {
  const fallback = buildSummaryFallbackCore(text, userLang);
  return mergeGeneratedAndPersonalNotes(fallback, personalNotes, userLang);
};

const polishEpisodeNotes = (
  notes: EpisodeNotes | null | undefined,
  sourceText: string,
  personalNotes: string,
  userLang: string
): EpisodeNotes => {
  if (!notes) {
    return mergeGeneratedAndPersonalNotes(buildSummaryFallbackCore(sourceText, userLang), personalNotes, userLang);
  }

  const polished = sanitizeEpisodeNotes(notes, sourceText, userLang);
  return mergeGeneratedAndPersonalNotes(polished, personalNotes, userLang);
};

const getSummaryAudioBlobId = (episode: PodcastEpisode) =>
  `${episode.audioBlobId}_summary`;

const normalizeCategoryName = (value: string) =>
  value.replace(/\s+/g, ' ').trim();

const parseCategoryInput = (value: string) => {
  const uniqueCategories = new Map<string, string>();

  value
    .split(',')
    .map(normalizeCategoryName)
    .filter(Boolean)
    .forEach((category) => {
      const key = category.toLocaleLowerCase();
      if (!uniqueCategories.has(key)) {
        uniqueCategories.set(key, category);
      }
    });

  return Array.from(uniqueCategories.values()).slice(0, 8);
};

const getEpisodeCategories = (episode: PodcastEpisode) =>
  episode.categories ?? [];

const sortLibraryEpisodes = (episodes: PodcastEpisode[], mode: LibrarySortMode) => {
  const nextEpisodes = [...episodes];

  switch (mode) {
    case 'oldest':
      return nextEpisodes.sort((a, b) => a.date - b.date);
    case 'title':
      return nextEpisodes.sort((a, b) => imageNameCollator.compare(a.title, b.title));
    case 'newest':
    default:
      return nextEpisodes.sort((a, b) => b.date - a.date);
  }
};

const normalizeAuthErrorMessage = (message: string, userLang: SupportedLanguage) => {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return userLang === 'sv'
      ? 'Fel e-post eller lösenord.'
      : 'Incorrect email or password.';
  }

  if (normalized.includes('email not confirmed')) {
    return userLang === 'sv'
      ? 'Bekräfta din e-postadress innan du loggar in.'
      : 'Confirm your email address before signing in.';
  }

  if (normalized.includes('user already registered')) {
    return userLang === 'sv'
      ? 'Det finns redan ett konto med den här e-postadressen.'
      : 'An account with this email already exists.';
  }

  if (normalized.includes('password should be at least')) {
    return userLang === 'sv'
      ? 'Lösenordet måste vara minst 6 tecken.'
      : 'Password must be at least 6 characters.';
  }

  return message;
};

const toSpeechSentence = (value: string) => {
  const normalized = normalizeInlineText(value);
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const buildEpisodeSummaryPlaybackText = (
  episode: PodcastEpisode,
  userLang: string
) => {
  const notes = normalizeEpisodeNotes(episode.notes, userLang);
  if (!notes) {
    return truncateText(episode.text, MAX_SUMMARY_AUDIO_CHARACTERS);
  }

  const bulletLines = notes.sections
    .flatMap(section => section.bullets)
    .map(toSpeechSentence)
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_AUDIO_BULLETS);

  const summaryText = [
    toSpeechSentence(notes.title),
    toSpeechSentence(notes.summary),
    ...bulletLines
  ]
    .filter(Boolean)
    .join(' ');

  return truncateText(summaryText, MAX_SUMMARY_AUDIO_CHARACTERS);
};

const getRequiredLiveReadyChunks = (
  allChunks: string[],
  finalizedCount: number,
  isComplete: boolean
) => {
  if (isComplete) {
    return Math.max(1, Math.min(LIVE_GENERATION_MIN_READY_CHUNKS, finalizedCount));
  }

  if (finalizedCount >= LIVE_GENERATION_MIN_READY_CHUNKS) {
    return LIVE_GENERATION_MIN_READY_CHUNKS;
  }

  const firstChunkLength = allChunks[0]?.length ?? 0;
  if (finalizedCount >= 1 && firstChunkLength >= LIVE_GENERATION_EARLY_START_CHARACTERS) {
    return 1;
  }

  return LIVE_GENERATION_MIN_READY_CHUNKS;
};

const App: React.FC = () => {
  const [userLang] = useState<SupportedLanguage>(() => {
    const navLang = navigator.language.split('-')[0];
    return navLang in TRANSLATIONS ? navLang as SupportedLanguage : 'en';
  });

  const t = (key: TranslationKey) => TRANSLATIONS[userLang][key];
  const [library, setLibrary] = useState<PodcastEpisode[]>([]);
  const [inputText, setInputText] = useState(() => localStorage.getItem(INPUT_TEXT_STORAGE_KEY) || '');
  const [inputNotes, setInputNotes] = useState(() => localStorage.getItem(INPUT_NOTES_STORAGE_KEY) || '');
  const [selectedVoice, setSelectedVoice] = useState<string>(PREMIUM_VOICES[0].name);
  const [playbackRate, setRate] = useState(1.0);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [scanSource, setScanSource] = useState<'document' | 'camera' | 'images' | null>(null);
  const [isLoadingChunk, setIsLoadingChunk] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState<PodcastEpisode | null>(null);
  const [showSpeedControls, setShowSpeedControls] = useState(false);
  const [editingCategoryEpisodeId, setEditingCategoryEpisodeId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('newest');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [authMode, setAuthMode] = useState<AuthMode>('signIn');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [playerInset, setPlayerInset] = useState(0);
  const [isPlayerCollapsed, setIsPlayerCollapsed] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const playerShellRef = useRef<HTMLDivElement>(null);
  const playRequestRef = useRef(0);
  const [searchBuffer, setSearchBuffer] = useState('');
  const searchTimeoutRef = useRef<number | null>(null);
  const [uiClock, setUiClock] = useState(() => Date.now());
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [translateSession, setTranslateSession] = useState<TranslateSession | null>(null);
  const [generationSession, setGenerationSession] = useState<GenerationSession | null>(null);
  const [summaryPlayback, setSummaryPlayback] = useState({
    episodeId: null as string | null,
    isLoading: false,
    isPlaying: false
  });

  // Cache for pre-loaded chunks to prevent gaps
  const chunkCache = useRef<Map<string, ArrayBuffer>>(new Map());
  const summaryChunkCache = useRef<Map<string, ArrayBuffer>>(new Map());
  const summaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const summaryBlobUrlRef = useRef<string | null>(null);
  const summaryRequestRef = useRef(0);
  const libraryRef = useRef<PodcastEpisode[]>([]);
  const libraryPersistTimeoutRef = useRef<number | null>(null);
  const hasHydratedLibraryRef = useRef(false);
  const importSessionRef = useRef<ImportSessionState | null>(null);
  const liveGenerationRef = useRef<LiveGenerationState | null>(null);
  const liveGenerationPumpRef = useRef(false);

  const [player, setPlayer] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    activeEpisode: null,
    currentChunkIndex: 0
  });

  useEffect(() => {
    const shell = playerShellRef.current;
    if (!shell) {
      setPlayerInset(0);
      return;
    }

    const updateInset = () => {
      setPlayerInset(shell.getBoundingClientRect().height);
    };

    updateInset();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateInset);
      return () => {
        window.removeEventListener('resize', updateInset);
      };
    }

    const observer = new ResizeObserver(updateInset);
    observer.observe(shell);
    window.addEventListener('resize', updateInset);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateInset);
    };
  }, [player.activeEpisode]);

  useEffect(() => {
    if (player.activeEpisode) {
      setIsPlayerCollapsed(false);
    }
  }, [player.activeEpisode?.id]);

  useEffect(() => {
    if (isPlayerCollapsed) {
      setShowSpeedControls(false);
    }
  }, [isPlayerCollapsed]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    const bootstrapSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        console.error('Kunde inte läsa Supabase-sessionen', error);
        setAuthFeedback({
          kind: 'error',
          message: normalizeAuthErrorMessage(error.message, userLang),
        });
        return;
      }

      setAuthSession(data.session);
      setAuthUser(data.session?.user ?? null);
    };

    void bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setAuthSession(session);
      setAuthUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [userLang]);

  useEffect(() => {
    const summaryEl = new Audio();
    summaryEl.preload = 'auto';
    summaryEl.setAttribute('playsinline', 'true');
    summaryEl.setAttribute('webkit-playsinline', 'true');
    summaryAudioRef.current = summaryEl;

    const handlePlay = () => {
      setSummaryPlayback(prev => ({ ...prev, isPlaying: true, isLoading: false }));
    };

    const handlePause = () => {
      setSummaryPlayback(prev => ({ ...prev, isPlaying: false }));
    };

    const handleEnded = () => {
      summaryEl.currentTime = 0;
      setSummaryPlayback(prev => ({ ...prev, isPlaying: false }));
    };

    summaryEl.addEventListener('play', handlePlay);
    summaryEl.addEventListener('pause', handlePause);
    summaryEl.addEventListener('ended', handleEnded);

    return () => {
      summaryEl.pause();
      summaryEl.removeEventListener('play', handlePlay);
      summaryEl.removeEventListener('pause', handlePause);
      summaryEl.removeEventListener('ended', handleEnded);
      if (summaryBlobUrlRef.current) {
        URL.revokeObjectURL(summaryBlobUrlRef.current);
        summaryBlobUrlRef.current = null;
      }
      summaryAudioRef.current = null;
    };
  }, []);

  // Handle click outside to close language menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setShowLangMenu(false);
      }
    };
    if (showLangMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLangMenu]);

  // Focus the menu when it opens to enable keyboard shortcuts
  useEffect(() => {
    if (showLangMenu && langMenuRef.current) {
      const timer = setTimeout(() => {
        langMenuRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showLangMenu]);

  // Keyboard jumping logic
  const handleLangKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowLangMenu(false);
      return;
    }

    // Only handle single character keys (A-Z, etc)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const char = e.key.toLowerCase();
      const newBuffer = searchBuffer + char;
      setSearchBuffer(newBuffer);
      
      if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = window.setTimeout(() => setSearchBuffer(''), 1000);

      const foundIndex = LANGUAGES.findIndex(l => 
        l.label.toLowerCase().startsWith(newBuffer)
      );

      if (foundIndex !== -1 && langMenuRef.current) {
        const buttons = langMenuRef.current.querySelectorAll('button');
        const targetButton = buttons[foundIndex];
        if (targetButton) {
          targetButton.scrollIntoView({ block: 'start', behavior: 'smooth' });
          (targetButton as HTMLElement).focus();
        }
      }
    }
  };

  useEffect(() => {
    localStorage.setItem(INPUT_TEXT_STORAGE_KEY, inputText);
  }, [inputText]);

  useEffect(() => {
    localStorage.setItem(INPUT_NOTES_STORAGE_KEY, inputNotes);
  }, [inputNotes]);

  const isScanning = scanSource !== null;
  const isBusy = isGenerating || isGeneratingNotes || isTranslating;
  const contentBottomInset = player.activeEpisode ? playerInset + 24 : 32;

  const makeRetryOptions = (): GeminiRequestOptions => ({
    onRetry: ({ online }) => {
      setRetryNotice(online ? t('retrying') : t('waiting_for_network'));
    }
  });

  const readImportTextCache = async (file: File) => {
    try {
      return await getImportTextCache(buildImportCacheKey(file));
    } catch (error) {
      console.warn('Kunde inte läsa importcache', error);
      return null;
    }
  };

  const writeImportTextCache = async (file: File, text: string) => {
    if (!text.trim()) return;

    try {
      await saveImportTextCache(buildImportCacheKey(file), text);
    } catch (error) {
      console.warn('Kunde inte skriva importcache', error);
    }
  };

  const persistLibrarySnapshot = (episodes: PodcastEpisode[]) => {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(episodes));
  };

  const flushLibraryPersistence = () => {
    if (libraryPersistTimeoutRef.current) {
      window.clearTimeout(libraryPersistTimeoutRef.current);
      libraryPersistTimeoutRef.current = null;
    }

    persistLibrarySnapshot(libraryRef.current);
  };

  const updateLibrary = (updater: LibraryUpdater) => {
    const nextLibrary = updater(libraryRef.current);
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    return nextLibrary;
  };

  const startImportSession = (source: ImportSource) => {
    const session: ImportSessionState = {
      id: crypto.randomUUID(),
      source,
      baseText: inputText,
      text: '',
      isComplete: false,
    };

    importSessionRef.current = session;
    setInputText(composeImportedText(session.baseText, session.text));
    return session;
  };

  const replaceImportSessionText = (sessionId: string, nextText: string) => {
    const session = importSessionRef.current;
    if (!session || session.id !== sessionId) return;

    session.text = nextText;
    setInputText(composeImportedText(session.baseText, nextText));

    if (liveGenerationRef.current?.sourceSessionId === sessionId) {
      void pumpLiveGeneration();
    }
  };

  const appendImportSessionText = (sessionId: string, textChunk: string) => {
    const session = importSessionRef.current;
    if (!session || session.id !== sessionId || !textChunk) return;

    replaceImportSessionText(sessionId, `${session.text}${textChunk}`);
  };

  const completeImportSession = (sessionId: string) => {
    const session = importSessionRef.current;
    if (!session || session.id !== sessionId) return;
    session.isComplete = true;

    if (liveGenerationRef.current?.sourceSessionId === sessionId) {
      void pumpLiveGeneration();
    }
  };

  const loadSummaryAudioBuffer = (wavBuffer: ArrayBuffer) => {
    const summaryEl = summaryAudioRef.current;
    if (!summaryEl) {
      throw new Error('Summary audio element is not available.');
    }

    if (summaryBlobUrlRef.current) {
      URL.revokeObjectURL(summaryBlobUrlRef.current);
    }

    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    summaryBlobUrlRef.current = URL.createObjectURL(blob);
    summaryEl.src = summaryBlobUrlRef.current;
    summaryEl.load();
  };

  const stopSummaryPlayback = (resetPosition: boolean = true) => {
    const summaryEl = summaryAudioRef.current;
    if (!summaryEl) return;

    summaryRequestRef.current += 1;
    summaryEl.pause();
    if (resetPosition) {
      summaryEl.currentTime = 0;
    }

    setSummaryPlayback(prev => ({ ...prev, isPlaying: false, isLoading: false }));
  };

  const pauseEpisodePlaybackForSummary = () => {
    if (!player.activeEpisode) return;

    const el = initAudioElement();
    saveBookmark(player.activeEpisode.id, player.currentChunkIndex, el.currentTime);
    pauseAudio();
    setMediaSessionPlaybackState(false);
    setPlayer(prev => ({ ...prev, isPlaying: false }));
  };

  const applyChunkStartTime = async (timeInChunk: number) => {
    const el = initAudioElement();
    if (timeInChunk <= 0) {
      el.currentTime = 0;
      return;
    }

    if (el.readyState < 1) {
      await new Promise<void>(resolve => {
        const handleLoaded = () => {
          resolve();
        };

        el.addEventListener('loadedmetadata', handleLoaded, { once: true });
      });
    }

    el.currentTime = timeInChunk;
  };

  useEffect(() => {
    if (!scanSession && !translateSession && !generationSession) return;

    const timer = window.setInterval(() => {
      setUiClock(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [scanSession, translateSession, generationSession]);

  // Sync player time with Audio element
  useEffect(() => {
    const el = initAudioElement();
    const handlePlay = () => setMediaSessionPlaybackState(true);
    const handlePause = () => setMediaSessionPlaybackState(false);
    
    const syncTime = () => {
      setPlayer(prev => {
        if (!prev.activeEpisode) {
          return prev;
        }

        const offset = getEpisodeOffset(prev.activeEpisode, prev.currentChunkIndex);
        return {
          ...prev,
          currentTime: offset + (el.currentTime || 0),
          duration: getEpisodeDuration(prev.activeEpisode)
        };
      });
    };

    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('durationchange', syncTime);
    el.addEventListener('loadedmetadata', syncTime);
    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);

    const interval = setInterval(() => {
      if (!el.paused) {
        syncTime();
        if (el.currentTime > 0 && el.duration > 0 && el.currentTime >= el.duration - 0.2) {
          if (player.activeEpisode && player.currentChunkIndex < player.activeEpisode.chunkCount - 1) {
            void playChunk(player.activeEpisode, player.currentChunkIndex + 1);
          }
        }
      }
    }, 500);

    return () => {
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('durationchange', syncTime);
      el.removeEventListener('loadedmetadata', syncTime);
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      clearInterval(interval);
    };
  }, [player.activeEpisode, player.currentChunkIndex]);

  useEffect(() => {
    const saved = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (saved) {
      try {
        const parsedLibrary = JSON.parse(saved) as PodcastEpisode[];
        libraryRef.current = parsedLibrary;
        setLibrary(parsedLibrary);
      } catch (e) {
        console.error(e);
        libraryRef.current = [];
      }
    } else {
      libraryRef.current = [];
    }

    hasHydratedLibraryRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydratedLibraryRef.current) return;

    if (libraryPersistTimeoutRef.current) {
      window.clearTimeout(libraryPersistTimeoutRef.current);
    }

    libraryPersistTimeoutRef.current = window.setTimeout(() => {
      persistLibrarySnapshot(libraryRef.current);
      libraryPersistTimeoutRef.current = null;
    }, LIBRARY_PERSIST_DELAY_MS);

    return () => {
      if (libraryPersistTimeoutRef.current) {
        window.clearTimeout(libraryPersistTimeoutRef.current);
        libraryPersistTimeoutRef.current = null;
      }
    };
  }, [library]);

  useEffect(() => {
    return () => {
      if (hasHydratedLibraryRef.current) {
        flushLibraryPersistence();
      }
    };
  }, []);

  useEffect(() => {
    if (activeCategoryFilter === 'all') return;

    const filterStillExists = library.some(episode =>
      getEpisodeCategories(episode).includes(activeCategoryFilter)
    );

    if (!filterStillExists) {
      setActiveCategoryFilter('all');
    }
  }, [library, activeCategoryFilter]);

  useEffect(() => {
    const el = initAudioElement();
    const handleEnd = () => {
      if (player.activeEpisode && player.currentChunkIndex < player.activeEpisode.chunkCount - 1) {
        void playChunk(player.activeEpisode, player.currentChunkIndex + 1);
      } else {
        if (player.activeEpisode) {
          saveBookmark(player.activeEpisode.id, 0, 0);
        }
        setPlayer(prev => ({ ...prev, isPlaying: false, currentTime: prev.duration }));
        setMediaSessionPlaybackState(false);
      }
    };
    el.addEventListener('ended', handleEnd);

    return () => el.removeEventListener('ended', handleEnd);
  }, [player.activeEpisode, player.currentChunkIndex]);

  const chunkText = (text: string) => {
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const chunks: string[] = [];
    let currentChunk = '';

    const pushCurrentChunk = () => {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
    };

    for (const paragraph of paragraphs) {
      if (paragraph.length <= MAX_CHUNK_CHARACTERS) {
        const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
        if (candidate.length > MAX_CHUNK_CHARACTERS && currentChunk) {
          pushCurrentChunk();
          currentChunk = paragraph;
        } else {
          currentChunk = candidate;
        }
        continue;
      }

      for (const sentence of splitParagraphIntoSentences(paragraph)) {
        const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
        if (candidate.length > MAX_CHUNK_CHARACTERS && currentChunk) {
          pushCurrentChunk();
        }

        if (sentence.length > MAX_CHUNK_CHARACTERS) {
          for (let index = 0; index < sentence.length; index += MAX_CHUNK_CHARACTERS) {
            const part = sentence.slice(index, index + MAX_CHUNK_CHARACTERS).trim();
            if (part) {
              chunks.push(part);
            }
          }
          currentChunk = '';
        } else {
          currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
        }
      }
    }

    pushCurrentChunk();
    return chunks;
  };

  const buildChunkAudio = async (textChunk: string) => {
    setRetryNotice(null);
    const base64 = await generateTTS(textChunk, selectedVoice as VoiceName, undefined, makeRetryOptions());
    setRetryNotice(null);
    const pcmBytes = decodeBase64ToUint8(base64);

    return {
      wavBuffer: pcmToWav(pcmBytes, AUDIO_SAMPLE_RATE),
      duration: calculateChunkDurationSeconds(pcmBytes, AUDIO_SAMPLE_RATE)
    };
  };

  const getImportChunkWindow = (sourceText: string, isComplete: boolean) => {
    const allChunks = chunkText(sourceText);
    const finalizedCount = isComplete ? allChunks.length : Math.max(0, allChunks.length - 1);

    return {
      allChunks,
      finalizedCount,
      projectedChunkCount: Math.max(finalizedCount, allChunks.length),
    };
  };

  const syncLiveGenerationProgress = (
    sourceText: string,
    generatedCount: number,
    notesCompleted: boolean,
    isComplete: boolean
  ) => {
    const projectedChunks = Math.max(1, getImportChunkWindow(sourceText, isComplete).projectedChunkCount);
    const total = projectedChunks + (notesCompleted ? 0 : 1);
    const current = Math.min(total, generatedCount + (notesCompleted ? 1 : 0));

    setGenerationProgress({
      current,
      total,
    });

    setGenerationSession(prev => prev ? {
      ...prev,
      totalSteps: total,
      estimatedSeconds: estimateGenerationSeconds(projectedChunks, !notesCompleted),
      notesCompleted,
    } : prev);
  };

  const pumpLiveGeneration = async () => {
    if (liveGenerationPumpRef.current) return;

    liveGenerationPumpRef.current = true;
    try {
      while (true) {
        const live = liveGenerationRef.current;
        const source = importSessionRef.current;

        if (!live || !source || source.id !== live.sourceSessionId) {
          break;
        }

        const trimmedText = composeImportedText(source.baseText, source.text).trim();
        if (!trimmedText) {
          if (source.isComplete) {
            liveGenerationRef.current = null;
            setIsGenerating(false);
            setGenerationSession(null);
          }
          break;
        }

        const { allChunks, finalizedCount, projectedChunkCount } = getImportChunkWindow(trimmedText, source.isComplete);
        const shouldGenerateNotes = trimmedText.length > 0;
        const requiredInitialReady = getRequiredLiveReadyChunks(allChunks, finalizedCount, source.isComplete);

        syncLiveGenerationProgress(trimmedText, live.generatedCount, false, source.isComplete);

        if (!live.episodeCreated) {
          if (finalizedCount < requiredInitialReady) {
            if (source.isComplete) {
              liveGenerationRef.current = null;
              setIsGenerating(false);
              setGenerationSession(null);
              setError('Det fanns inte tillräckligt med tolkad text för att starta podden.');
            }
            break;
          }

          for (let index = live.generatedCount; index < requiredInitialReady; index++) {
            const { wavBuffer, duration } = await buildChunkAudio(allChunks[index]);
            await saveAudioBlob(`${live.episodeId}_${index}`, wavBuffer);
            chunkCache.current.set(`${live.episodeId}_${index}`, wavBuffer);
            live.generatedDurations[index] = duration;
            live.generatedCount = index + 1;
            syncLiveGenerationProgress(trimmedText, live.generatedCount, false, source.isComplete);
          }

          const fallbackNotes = buildFallbackEpisodeNotes(trimmedText, inputNotes, userLang);
          const newEpisode: PodcastEpisode = {
            id: live.episodeId,
            title: live.title,
            text: trimmedText,
            notes: fallbackNotes,
            bookmarks: [],
            categories: [],
            date: Date.now(),
            voice: live.voice,
            audioBlobId: live.episodeId,
            chunkCount: Math.max(projectedChunkCount, live.generatedCount),
            readyChunkCount: live.generatedCount,
            generationStatus: shouldGenerateNotes ? 'processing' : 'ready',
            chunkDurations: [...live.generatedDurations],
            duration: estimateEpisodeDurationSeconds(trimmedText),
            playbackRate: 1,
          };

          updateLibrary(prev => [newEpisode, ...prev]);
          live.episodeCreated = true;

          try {
            await handlePlayEpisode(newEpisode, 0);
            live.startedPlayback = true;
          } catch (error) {
            console.error('Kunde inte starta uppspelningen direkt för live-generering', error);
          }

          continue;
        }

        patchEpisode(live.episodeId, {
          text: trimmedText,
          chunkCount: Math.max(projectedChunkCount, live.generatedCount),
          duration: source.isComplete
            ? Math.max(sumDurations(live.generatedDurations), estimateEpisodeDurationSeconds(trimmedText))
            : estimateEpisodeDurationSeconds(trimmedText),
        });

        if (live.generatedCount < finalizedCount) {
          const nextIndex = live.generatedCount;
          const { wavBuffer, duration } = await buildChunkAudio(allChunks[nextIndex]);
          await saveAudioBlob(`${live.episodeId}_${nextIndex}`, wavBuffer);
          chunkCache.current.set(`${live.episodeId}_${nextIndex}`, wavBuffer);
          live.generatedDurations[nextIndex] = duration;
          live.generatedCount = nextIndex + 1;

          patchEpisode(live.episodeId, {
            text: trimmedText,
            readyChunkCount: live.generatedCount,
            chunkCount: Math.max(projectedChunkCount, live.generatedCount),
            chunkDurations: [...live.generatedDurations],
            duration: source.isComplete
              ? Math.max(sumDurations(live.generatedDurations), estimateEpisodeDurationSeconds(trimmedText))
              : estimateEpisodeDurationSeconds(trimmedText),
          });

          syncLiveGenerationProgress(trimmedText, live.generatedCount, false, source.isComplete);
          continue;
        }

        if (!source.isComplete) {
          break;
        }

        patchEpisode(live.episodeId, {
          text: trimmedText,
          readyChunkCount: allChunks.length,
          chunkCount: allChunks.length,
          chunkDurations: [...live.generatedDurations],
          duration: sumDurations(live.generatedDurations),
          generationStatus: shouldGenerateNotes ? 'processing' : 'ready',
        });

        if (shouldGenerateNotes) {
          setIsGeneratingNotes(true);
          try {
            const generatedNotes = await generateNotes(buildNotesSourceText(trimmedText), makeRetryOptions());
            setRetryNotice(null);
            patchEpisode(live.episodeId, {
              notes: polishEpisodeNotes(generatedNotes, trimmedText, inputNotes, userLang),
              generationStatus: 'ready',
              duration: sumDurations(live.generatedDurations),
            });
          } catch (error) {
            console.error('Kunde inte generera anteckningar för live-import', error);
            patchEpisode(live.episodeId, {
              notes: buildFallbackEpisodeNotes(trimmedText, inputNotes, userLang),
              generationStatus: 'ready',
              duration: sumDurations(live.generatedDurations),
            });
          } finally {
            setIsGeneratingNotes(false);
          }
        }

        syncLiveGenerationProgress(trimmedText, allChunks.length, true, true);
        liveGenerationRef.current = null;
        setIsGenerating(false);
        setGenerationSession(null);
        setRetryNotice(null);
        break;
      }
    } catch (error) {
      console.error('Live-generering misslyckades', error);
      setError(error instanceof Error && error.message ? error.message : 'Kunde inte skapa podden från filströmmen.');
      liveGenerationRef.current = null;
      setIsGenerating(false);
      setIsGeneratingNotes(false);
      setGenerationSession(null);
      setRetryNotice(null);
    } finally {
      liveGenerationPumpRef.current = false;
    }
  };

  const handleGenerate = async () => {
    if (!inputText.trim() || isBusy) return;
    setIsGenerating(true);
    setError(null);
    setRetryNotice(null);

    try {
      const activeImportSession = importSessionRef.current;
      const activeImportText = activeImportSession
        ? composeImportedText(activeImportSession.baseText, activeImportSession.text).trim()
        : '';
      if (isScanning && activeImportSession && activeImportText) {
        const sourceText = activeImportText;
        const projectedChunks = Math.max(1, getImportChunkWindow(sourceText, activeImportSession.isComplete).projectedChunkCount);

        setGenerationProgress({ current: 0, total: projectedChunks + 1 });
        setGenerationSession({
          startedAt: Date.now(),
          estimatedSeconds: estimateGenerationSeconds(projectedChunks, true),
          totalSteps: projectedChunks + 1,
          notesIncluded: true,
          notesCompleted: false,
        });

        liveGenerationRef.current = {
          sourceSessionId: activeImportSession.id,
          episodeId: crypto.randomUUID(),
          episodeCreated: false,
          generatedCount: 0,
          generatedDurations: [],
          startedPlayback: false,
          voice: selectedVoice as VoiceName,
          title: sourceText.split('\n')[0].substring(0, 40) || 'Ny Produktion',
        };

        void pumpLiveGeneration();
        return;
      }

      const id = crypto.randomUUID();
      const chunks = chunkText(inputText);
      if (chunks.length === 0) return;

      const title = inputText.trim().split('\n')[0].substring(0, 40) || 'Ny Produktion';
      const shouldGenerateNotes = inputText.trim().length > 0;
      const notesSourceText = buildNotesSourceText(inputText);
      const fallbackNotes = buildFallbackEpisodeNotes(inputText, inputNotes, userLang);
      const totalSteps = chunks.length + (shouldGenerateNotes ? 1 : 0);
      const estimatedDuration = estimateEpisodeDurationSeconds(inputText);
      const initialBufferSize = Math.min(INITIAL_PLAYBACK_BUFFER, chunks.length);
      const generatedDurations: number[] = [];

      setGenerationProgress({ current: 0, total: totalSteps });
      setGenerationSession({
        startedAt: Date.now(),
        estimatedSeconds: estimateGenerationSeconds(chunks.length, shouldGenerateNotes),
        totalSteps,
        notesIncluded: shouldGenerateNotes,
        notesCompleted: !shouldGenerateNotes
      });

      for (let index = 0; index < initialBufferSize; index++) {
        const { wavBuffer, duration } = await buildChunkAudio(chunks[index]);
        await saveAudioBlob(`${id}_${index}`, wavBuffer);
        chunkCache.current.set(`${id}_${index}`, wavBuffer);
        generatedDurations[index] = duration;
        setGenerationProgress(prev => ({ ...prev, current: index + 1 }));
      }

      const newEpisode: PodcastEpisode = {
        id,
        title,
        text: inputText,
        date: Date.now(),
        bookmarks: [],
        categories: [],
        voice: selectedVoice,
        audioBlobId: id,
        chunkCount: chunks.length,
        readyChunkCount: initialBufferSize,
        generationStatus: chunks.length === initialBufferSize && !shouldGenerateNotes ? 'ready' : 'processing',
        chunkDurations: [...generatedDurations],
        duration: estimatedDuration,
        notes: fallbackNotes,
        playbackRate: 1
      };

      updateLibrary(prev => [newEpisode, ...prev]);
      await handlePlayEpisode(newEpisode, 0);

      for (let index = initialBufferSize; index < chunks.length; index++) {
        const { wavBuffer, duration } = await buildChunkAudio(chunks[index]);
        await saveAudioBlob(`${id}_${index}`, wavBuffer);
        chunkCache.current.set(`${id}_${index}`, wavBuffer);
        generatedDurations[index] = duration;
        patchEpisode(id, {
          readyChunkCount: index + 1,
          chunkDurations: [...generatedDurations]
        });
        setGenerationProgress(prev => ({ ...prev, current: index + 1 }));
      }

      patchEpisode(id, {
        readyChunkCount: chunks.length,
        generationStatus: shouldGenerateNotes ? 'processing' : 'ready',
        chunkDurations: [...generatedDurations],
        duration: sumDurations(generatedDurations)
      });

      if (shouldGenerateNotes) {
        setIsGeneratingNotes(true);
        try {
          const generatedNotes = await generateNotes(notesSourceText, makeRetryOptions());
          setRetryNotice(null);
          patchEpisode(id, {
            notes: polishEpisodeNotes(generatedNotes, inputText, inputNotes, userLang),
            generationStatus: 'ready',
            duration: sumDurations(generatedDurations)
          });
          setGenerationProgress({ current: totalSteps, total: totalSteps });
        } catch (e) {
          console.error("Kunde inte generera anteckningar", e);
          patchEpisode(id, {
            notes: fallbackNotes,
            generationStatus: 'ready',
            duration: sumDurations(generatedDurations)
          });
          setError("AI-anteckningarna kunde inte genereras, så snygga anteckningar skapades lokalt i stället.");
        } finally {
          setIsGeneratingNotes(false);
          setGenerationSession(prev => prev ? { ...prev, notesCompleted: true } : prev);
        }
      } else {
        setGenerationProgress({ current: totalSteps, total: totalSteps });
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : "Kunde inte starta podden.");
    }
    finally {
      if (!liveGenerationRef.current) {
        setIsGenerating(false);
        setIsGeneratingNotes(false);
        setGenerationSession(null);
        setRetryNotice(null);
      }
    }
  };

  const handleDownloadEpisode = async (episode: PodcastEpisode) => {
    if (isDownloading || episode.generationStatus === 'processing') return;
    setIsDownloading(episode.id);
    try {
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < episode.chunkCount; i++) {
        const b = await getAudioBlob(`${episode.audioBlobId}_${i}`);
        if (b) buffers.push(b);
      }
      if (buffers.length === 0) throw new Error("Ingen audio hittades.");
      
      const mp3Blob = await exportEpisodeAsMp3(buffers);
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${episode.title.replace(/\s+/g, '_')}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError("MP3-nedladdning misslyckades."); }
    finally { setIsDownloading(null); }
  };

  const handlePlaySummary = async (episode: PodcastEpisode) => {
    const summaryEl = summaryAudioRef.current;
    const summaryText = buildEpisodeSummaryPlaybackText(episode, userLang);
    if (!summaryEl || !summaryText) {
      setError(t('summary_audio_error'));
      return;
    }

    const isCurrentSummary = summaryPlayback.episodeId === episode.id;
    if (isCurrentSummary && summaryPlayback.isPlaying) {
      summaryEl.pause();
      return;
    }

    await unlockAudioPlayback();

    try {
      pauseEpisodePlaybackForSummary();

      if (isCurrentSummary && summaryEl.src) {
        const summaryEnded = summaryEl.duration > 0 && summaryEl.currentTime >= Math.max(0, summaryEl.duration - 0.25);
        if (summaryEnded) {
          summaryEl.currentTime = 0;
        }
        await summaryEl.play();
        return;
      }

      const requestId = ++summaryRequestRef.current;
      const blobId = getSummaryAudioBlobId(episode);
      setRetryNotice(null);
      setSummaryPlayback({
        episodeId: episode.id,
        isLoading: true,
        isPlaying: false
      });

      let wavBuffer = summaryChunkCache.current.get(blobId);
      if (!wavBuffer) {
        wavBuffer = await getAudioBlob(blobId) ?? undefined;
      }

      if (!wavBuffer) {
        const base64 = await generateTTS(summaryText, episode.voice as VoiceName, undefined, makeRetryOptions());
        setRetryNotice(null);
        const pcmBytes = decodeBase64ToUint8(base64);
        wavBuffer = pcmToWav(pcmBytes, AUDIO_SAMPLE_RATE);
        await saveAudioBlob(blobId, wavBuffer);
      }

      if (requestId !== summaryRequestRef.current) {
        return;
      }

      summaryChunkCache.current.set(blobId, wavBuffer);
      loadSummaryAudioBuffer(wavBuffer);
      summaryEl.currentTime = 0;
      await summaryEl.play();
    } catch (err) {
      console.error('Kunde inte spela upp sammanfattningen', err);
      setError(t('summary_audio_error'));
      setSummaryPlayback(prev => ({ ...prev, isPlaying: false }));
    } finally {
      setRetryNotice(null);
      setSummaryPlayback(prev =>
        prev.episodeId === episode.id
          ? { ...prev, isLoading: false }
          : prev
      );
    }
  };

  const waitForChunkData = async (episode: PodcastEpisode, index: number, requestId: number) => {
    const cacheKey = `${episode.audioBlobId}_${index}`;

    while (requestId === playRequestRef.current) {
      let data = chunkCache.current.get(cacheKey);
      if (!data) {
        data = await getAudioBlob(cacheKey);
      }

      if (data) {
        chunkCache.current.set(cacheKey, data);
        return data;
      }

      await sleep(800);
    }

    return null;
  };

  const playChunk = async (
    episode: PodcastEpisode,
    index: number,
    options?: { autoplay?: boolean; startTime?: number }
  ) => {
    const requestId = ++playRequestRef.current;
    const autoplay = options?.autoplay ?? true;
    const startTime = options?.startTime ?? 0;

    try {
      setIsLoadingChunk(true);
      const data = await waitForChunkData(episode, index, requestId);
      if (!data || requestId !== playRequestRef.current) {
        return;
      }

      loadAudioFromBuffer(data);
      await applyChunkStartTime(startTime);

      const episodeRate = episode.playbackRate || 1;
      setPlaybackRate(episodeRate);

      if (autoplay) {
        await playAudio();
      } else {
        pauseAudio();
      }

      if (requestId !== playRequestRef.current) {
        return;
      }

      const overallTime = getEpisodeOffset(episode, index) + startTime;
      setPlayer(prev => {
        const activeEpisode = prev.activeEpisode?.id === episode.id ? { ...episode, ...prev.activeEpisode } : episode;
        return {
          ...prev,
          activeEpisode,
          currentChunkIndex: index,
          currentTime: overallTime,
          duration: getEpisodeDuration(activeEpisode),
          playbackRate: episodeRate,
          isPlaying: autoplay
        };
      });
      setMediaSessionPlaybackState(autoplay);

      const nextIndex = index + 1;
      if (nextIndex < episode.chunkCount) {
        const nextKey = `${episode.audioBlobId}_${nextIndex}`;
        if (!chunkCache.current.has(nextKey)) {
          void getAudioBlob(nextKey).then(nextData => {
            if (nextData) chunkCache.current.set(nextKey, nextData);
          });
        }
      }

      if (index > 1) {
        chunkCache.current.delete(`${episode.audioBlobId}_${index - 2}`);
      }
    } catch (e) { 
      console.error("Fel vid uppspelning av chunk", e);
      setError("Fel vid uppspelning."); 
    } finally {
      if (requestId === playRequestRef.current) {
        setIsLoadingChunk(false);
      }
    }
  };

  const handlePlayEpisode = async (episode: PodcastEpisode, index: number = 0) => {
    stopSummaryPlayback();

    let startChunk = index;
    let startTime = 0;
    
    if (index === 0 && episode.lastPosition) {
      if (isEpisodeAtEnd(episode, episode.lastPosition.chunkIndex, episode.lastPosition.currentTime)) {
        patchEpisode(episode.id, { lastPosition: { chunkIndex: 0, currentTime: 0 } });
      } else {
        startChunk = episode.lastPosition.chunkIndex;
        startTime = episode.lastPosition.currentTime;
      }
    }

    await unlockAudioPlayback();

    const episodeRate = episode.playbackRate || 1;
    setRate(episodeRate);
    setPlaybackRate(episodeRate);
    setPlayer(prev => ({
      ...prev,
      activeEpisode: episode,
      currentChunkIndex: startChunk,
      currentTime: getEpisodeOffset(episode, startChunk) + startTime,
      duration: getEpisodeDuration(episode),
      isPlaying: true,
      playbackRate: episodeRate
    }));
    await playChunk(episode, startChunk, { autoplay: true, startTime });

    setupMediaSession(episode, {
      onPlay: () => { void handleTogglePlay(true); },
      onPause: () => { void handleTogglePlay(false); },
      onSeek: (delta) => { void handleSkip(delta); }
    });
  };

  const handleTogglePlay = async (force?: boolean) => {
    if (!player.activeEpisode) return;
    const shouldPlay = typeof force === 'boolean' ? force : !player.isPlaying;
    const el = initAudioElement();
    const liveCurrentTime = el.src
      ? getEpisodeOffset(player.activeEpisode, player.currentChunkIndex) + (el.currentTime || 0)
      : player.currentTime;
    
    if (shouldPlay) {
      stopSummaryPlayback();
      const currentEpisode = player.activeEpisode;
      const chunkOffset = getEpisodeOffset(currentEpisode, player.currentChunkIndex);
      const chunkTime = Math.max(0, liveCurrentTime - chunkOffset);
      const isAtEnd = isEpisodeAtEnd(currentEpisode, player.currentChunkIndex, chunkTime);

      await unlockAudioPlayback();

      if (isAtEnd) {
        await jumpToEpisodeTime(currentEpisode, 0, true);
        return;
      }

      try {
        const el = initAudioElement();
        if (!el.src) {
          await playChunk(currentEpisode, player.currentChunkIndex, { autoplay: true, startTime: chunkTime });
          return;
        }

        await playAudio();
      } catch (err) {
        console.error("Kunde inte återuppta uppspelningen", err);
        await playChunk(currentEpisode, player.currentChunkIndex, { autoplay: true, startTime: chunkTime });
        return;
      }
    } else {
      pauseAudio();
      saveBookmark(player.activeEpisode.id, player.currentChunkIndex, el.currentTime);
    }
    setMediaSessionPlaybackState(shouldPlay);
    setPlayer(prev => ({ ...prev, isPlaying: shouldPlay, currentTime: liveCurrentTime }));
  };

  const saveBookmark = (episodeId: string, chunkIndex: number, currentTime: number) => {
    updateLibrary(prev => prev.map(ep => {
      if (ep.id === episodeId) {
        return {
          ...ep,
          lastPosition: { chunkIndex, currentTime }
        };
      }
      return ep;
    }));

    setPlayer(prev => {
      if (prev.activeEpisode?.id !== episodeId) return prev;
      return {
        ...prev,
        activeEpisode: {
          ...prev.activeEpisode,
          lastPosition: { chunkIndex, currentTime }
        }
      };
    });
  };

  useEffect(() => {
    const persistBookmark = () => {
      if (!player.activeEpisode) return;
      const el = initAudioElement();
      saveBookmark(player.activeEpisode.id, player.currentChunkIndex, el.currentTime);
      flushLibraryPersistence();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistBookmark();
      }
    };

    window.addEventListener('pagehide', persistBookmark);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', persistBookmark);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [player.activeEpisode, player.currentChunkIndex]);

  const patchEpisode = (episodeId: string, patch: Partial<PodcastEpisode>) => {
    updateLibrary(prev => prev.map(ep => ep.id === episodeId ? { ...ep, ...patch } : ep));

    setPlayer(prev => {
      if (prev.activeEpisode?.id !== episodeId) return prev;
      return {
        ...prev,
        activeEpisode: {
          ...prev.activeEpisode,
          ...patch
        }
      };
    });
  };

  const handleDeleteEpisode = async (episode: PodcastEpisode) => {
    try {
      await deleteAudioBlobsByPrefix(`${episode.audioBlobId}_`);

      chunkCache.current.forEach((_, key) => {
        if (key.startsWith(`${episode.audioBlobId}_`)) {
          chunkCache.current.delete(key);
        }
      });

      summaryChunkCache.current.delete(getSummaryAudioBlobId(episode));

      if (summaryPlayback.episodeId === episode.id) {
        stopSummaryPlayback();
        setSummaryPlayback({
          episodeId: null,
          isLoading: false,
          isPlaying: false
        });
      }

      if (player.activeEpisode?.id === episode.id) {
        playRequestRef.current += 1;
        stopAudio();
        setMediaSessionPlaybackState(false);
        setPlayer(prev => ({
          ...prev,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          activeEpisode: null,
          currentChunkIndex: 0
        }));
      }

      if (showNotesModal?.id === episode.id) {
        setShowNotesModal(null);
      }

      if (editingCategoryEpisodeId === episode.id) {
        closeCategoryEditor();
      }

      updateLibrary(prev => prev.filter(x => x.id !== episode.id));
    } catch (err) {
      setError("Kunde inte radera avsnittet.");
    }
  };

  const jumpToEpisodeTime = async (episode: PodcastEpisode, targetTime: number, autoplay: boolean = player.isPlaying) => {
    if (autoplay) {
      stopSummaryPlayback();
    }

    const { chunkIndex, chunkTime } = locateChunkAtTime(episode, targetTime);
    const currentEpisodeId = player.activeEpisode?.id;

    if (currentEpisodeId === episode.id && chunkIndex === player.currentChunkIndex) {
      const el = initAudioElement();
      el.currentTime = chunkTime;
      if (autoplay && el.paused) {
        await playAudio();
      }
      if (!autoplay && !el.paused) {
        pauseAudio();
      }
      setMediaSessionPlaybackState(autoplay);
      setPlayer(prev => ({ ...prev, currentTime: targetTime, isPlaying: autoplay }));
    } else {
      await playChunk(episode, chunkIndex, { autoplay, startTime: chunkTime });
    }

    saveBookmark(episode.id, chunkIndex, chunkTime);
  };

  const getCurrentEpisodePlaybackTime = () => {
    if (!player.activeEpisode) return 0;
    const el = initAudioElement();
    return el.src
      ? getEpisodeOffset(player.activeEpisode, player.currentChunkIndex) + (el.currentTime || 0)
      : player.currentTime;
  };

  const handleAddEpisodeBookmark = () => {
    if (!player.activeEpisode) return;

    const bookmarkTime = clamp(
      getCurrentEpisodePlaybackTime(),
      0,
      getEpisodeDuration(player.activeEpisode)
    );

    const nextBookmark: EpisodeBookmark = {
      id: crypto.randomUUID(),
      time: bookmarkTime,
      createdAt: Date.now(),
    };

    const existingBookmarks = player.activeEpisode.bookmarks ?? [];
    const hasNearbyBookmark = existingBookmarks.some(bookmark => Math.abs(bookmark.time - bookmarkTime) < 2);
    if (hasNearbyBookmark) {
      return;
    }

    const updatedBookmarks = [...existingBookmarks, nextBookmark]
      .sort((a, b) => a.time - b.time)
      .slice(0, 24);

    patchEpisode(player.activeEpisode.id, {
      bookmarks: updatedBookmarks,
    });
  };

  const handleSeek = async (value: number) => {
    if (!player.activeEpisode) return;
    const targetTime = (value / 100) * getEpisodeDuration(player.activeEpisode);
    await jumpToEpisodeTime(player.activeEpisode, targetTime);
  };

  const handleSkip = async (delta: number) => {
    if (!player.activeEpisode) return;
    const el = initAudioElement();
    const liveCurrentTime = el.src
      ? getEpisodeOffset(player.activeEpisode, player.currentChunkIndex) + (el.currentTime || 0)
      : player.currentTime;
    const targetTime = clamp(
      liveCurrentTime + delta,
      0,
      getEpisodeDuration(player.activeEpisode)
    );
    await jumpToEpisodeTime(player.activeEpisode, targetTime);
  };

  const applyPlaybackRate = (rate: number) => {
    setRate(rate);
    setPlaybackRate(rate);
    setPlayer(prev => ({ ...prev, playbackRate: rate }));

    if (player.activeEpisode) {
      patchEpisode(player.activeEpisode.id, { playbackRate: rate });
    }
  };

  const streamIntoImportSession = async (
    sessionId: string,
    streamReader: (onChunk: (textChunk: string) => void) => Promise<void>,
    options?: { suffix?: string }
  ) => {
    let pendingText = '';

    const flushPendingText = () => {
      if (!pendingText) return;
      appendImportSessionText(sessionId, pendingText);
      pendingText = '';
    };

    await streamReader((textChunk) => {
      pendingText += textChunk;

      if (
        pendingText.length >= IMPORT_STREAM_FLUSH_CHARACTERS ||
        /[\n.!?]\s*$/.test(pendingText)
      ) {
        flushPendingText();
      }
    });

    flushPendingText();

    if (options?.suffix) {
      appendImportSessionText(sessionId, options.suffix);
    }
  };

  const processImages = async (
    rawFiles: File[],
    clearSource: () => void,
    source: 'camera' | 'images'
  ) => {
    if (rawFiles.length === 0) {
      clearSource();
      return;
    }

    const files = sortFilesForReading(rawFiles);
    const importSession = startImportSession(source);
    setScanSource(source);
    setRetryNotice(null);

    setScanSession({
      startedAt: Date.now(),
      totalItems: files.length,
      completedItems: 0,
      estimatedSeconds: estimateImageScanSeconds(files.length)
    });
    await waitForNextPaint();

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const cachedText = await readImportTextCache(file);
          if (cachedText?.trim()) {
            appendImportSessionText(importSession.id, cachedText);
            if (i < files.length - 1) {
              appendImportSessionText(importSession.id, '\n\n');
            }
          } else {
            const base64 = await readFileAsBase64(file);
            let extractedText = '';
            await streamIntoImportSession(importSession.id, async (onChunk) => {
              await streamTextFromImage(base64, file.type, (textChunk) => {
                extractedText += textChunk;
                onChunk(textChunk);
              });
            }, {
              suffix: i < files.length - 1 ? '\n\n' : '',
            });
            await writeImportTextCache(file, extractedText);
          }
          setRetryNotice(null);
        } catch (err) {
          throw new Error(`Bild ${i + 1} misslyckades.`);
        }
        setScanSession(prev => prev ? { ...prev, completedItems: i + 1 } : prev);
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Bildläsning misslyckades.");
    } finally {
      completeImportSession(importSession.id);
      setScanSource(null);
      setScanSession(null);
      setRetryNotice(null);
      clearSource();
    }
  };

  const processDocuments = async (
    rawFiles: File[],
    clearSource: () => void,
  ) => {
    if (rawFiles.length === 0) {
      clearSource();
      return;
    }

    const files = sortFilesForReading(rawFiles);
    const importSession = startImportSession('document');
    setScanSource('document');
    setRetryNotice(null);
    setScanSession({
      startedAt: Date.now(),
      totalItems: files.length,
      completedItems: 0,
      estimatedSeconds: estimateDocumentBatchScanSeconds(files)
    });
    await waitForNextPaint();

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const suffix = i < files.length - 1 ? '\n\n' : '';

        try {
          const cachedText = await readImportTextCache(file);
          if (cachedText?.trim()) {
            appendImportSessionText(importSession.id, cachedText);
            if (suffix) {
              appendImportSessionText(importSession.id, suffix);
            }
          } else if (isTextDocumentFile(file)) {
            let extractedText = '';
            await streamIntoImportSession(importSession.id, async (onChunk) => {
              await streamLocalDocumentText(file, (textChunk) => {
                extractedText += textChunk;
                onChunk(textChunk);
              });
            }, { suffix });
            await writeImportTextCache(file, extractedText);
          } else {
            const base64 = await readFileAsBase64(file);
            let extractedText = '';
            await streamIntoImportSession(importSession.id, async (onChunk) => {
              await streamTextFromPdf(base64, (textChunk) => {
                extractedText += textChunk;
                onChunk(textChunk);
              });
            }, { suffix });
            await writeImportTextCache(file, extractedText);
          }
          setRetryNotice(null);
        } catch (err) {
          throw new Error(`Dokument ${i + 1} misslyckades.`);
        }

        setScanSession(prev => prev ? { ...prev, completedItems: i + 1 } : prev);
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Dokumentläsning misslyckades.');
    } finally {
      completeImportSession(importSession.id);
      setScanSource(null);
      setScanSession(null);
      setRetryNotice(null);
      clearSource();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await processImages(Array.from(fileList) as File[], () => {
      e.target.value = '';
    }, 'images');
  };

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await processImages(Array.from(fileList) as File[], () => {
      e.target.value = '';
    }, 'camera');
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await processDocuments(Array.from(fileList) as File[], () => {
      e.target.value = '';
    });
  };

  const handleTranslate = async (lang: string) => {
    if (!inputText.trim() || isBusy) return;
    setIsTranslating(true);
    setShowLangMenu(false);
    setRetryNotice(null);
    setTranslateSession({
      startedAt: Date.now(),
      estimatedSeconds: estimateTranslationSeconds(inputText.length),
      targetLanguage: lang
    });
    try {
      const translated = await translateText(inputText, lang, makeRetryOptions());
      setRetryNotice(null);
      setInputText(translated);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Översättning misslyckades.");
    }
    finally {
      setIsTranslating(false);
      setTranslateSession(null);
      setRetryNotice(null);
    }
  };

  const handleSubmitAuth = async () => {
    if (!supabase || !authEmail.trim() || !authPassword.trim()) {
      return;
    }

    setIsAuthLoading(true);
    setAuthFeedback(null);

    try {
      if (authMode === 'signIn') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });

        if (error) {
          throw error;
        }

        setAuthSession(data.session);
        setAuthUser(data.user);
        setAuthPassword('');
        setAuthFeedback({
          kind: 'success',
          message: t('auth_success_signed_in'),
        });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });

      if (error) {
        throw error;
      }

      setAuthPassword('');
      setAuthSession(data.session);
      setAuthUser(data.user ?? null);
      setAuthFeedback({
        kind: 'success',
        message: data.session ? t('auth_email_confirmed') : t('auth_check_email'),
      });
    } catch (error) {
      console.error('Supabase auth misslyckades', error);
      const message = error instanceof Error ? error.message : 'Auth failed.';
      setAuthFeedback({
        kind: 'error',
        message: normalizeAuthErrorMessage(message, userLang),
      });
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }

    setIsAuthLoading(true);
    setAuthFeedback(null);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }

      setAuthSession(null);
      setAuthUser(null);
      setAuthPassword('');
      setAuthFeedback({
        kind: 'success',
        message: t('auth_success_signed_out'),
      });
    } catch (error) {
      console.error('Supabase signout misslyckades', error);
      const message = error instanceof Error ? error.message : 'Sign out failed.';
      setAuthFeedback({
        kind: 'error',
        message: normalizeAuthErrorMessage(message, userLang),
      });
    } finally {
      setIsAuthLoading(false);
    }
  };

  const activePrimaryButton = (() => {
    if (generationSession && (isGenerating || isGeneratingNotes)) {
      const progress = generationProgress.total > 0
        ? Math.max(0.08, generationProgress.current / generationProgress.total)
        : 0.08;
      return {
        label: t('creating_podcast'),
        remainingSeconds: Math.max(0, generationSession.estimatedSeconds * (1 - progress)),
        progress,
      };
    }

    if (isTranslating && translateSession) {
      const progress = Math.min(0.94, Math.max(0.12, (uiClock - translateSession.startedAt) / 1000 / translateSession.estimatedSeconds));
      return {
        label: t('translating_short'),
        remainingSeconds: Math.max(0, translateSession.estimatedSeconds * (1 - progress)),
        progress,
      };
    }

    if (scanSource && scanSession) {
      const progress = scanSession.totalItems > 0
        ? Math.max(0.08, scanSession.completedItems / scanSession.totalItems)
        : 0.08;
      return {
        label: t('loading_text'),
        remainingSeconds: Math.max(0, scanSession.estimatedSeconds * (1 - progress)),
        progress,
      };
    }

    return null;
  })();
  const resolvedModalNotes = normalizeEpisodeNotes(showNotesModal?.notes, userLang);
  const isModalSummaryLoading = showNotesModal
    ? summaryPlayback.episodeId === showNotesModal.id && summaryPlayback.isLoading
    : false;
  const isModalSummaryPlaying = showNotesModal
    ? summaryPlayback.episodeId === showNotesModal.id && summaryPlayback.isPlaying
    : false;
  const activeEpisodeBookmarks = player.activeEpisode?.bookmarks ?? [];
  const activeImportSession = importSessionRef.current;
  const canGenerateFromImportSession = (() => {
    if (!isScanning || !activeImportSession) return false;
    const sourceText = composeImportedText(activeImportSession.baseText, activeImportSession.text).trim();
    if (!sourceText) return false;
    const { allChunks, finalizedCount } = getImportChunkWindow(sourceText, activeImportSession.isComplete);
    return finalizedCount >= getRequiredLiveReadyChunks(allChunks, finalizedCount, activeImportSession.isComplete);
  })();
  const isInputLocked = isBusy || isScanning;
  const isGenerateDisabled = isBusy || !inputText.trim() || (isScanning && !canGenerateFromImportSession);
  const notesLabels = getNotesLabels(userLang);
  const authStatusEmail = authUser?.email || authSession?.user?.email || authEmail.trim();
  const isAuthSubmitDisabled = isAuthLoading || !authEmail.trim() || !authPassword.trim();
  const libraryCategories = Array.from<string>(
    new Set(library.flatMap(episode => getEpisodeCategories(episode)))
  ).sort((a, b) => imageNameCollator.compare(a, b));
  const displayedLibrary = sortLibraryEpisodes(
    library.filter(episode =>
      activeCategoryFilter === 'all' || getEpisodeCategories(episode).includes(activeCategoryFilter)
    ),
    librarySortMode
  );
  const categoryEditorEpisode = editingCategoryEpisodeId
    ? library.find(episode => episode.id === editingCategoryEpisodeId) ?? null
    : null;

  const openCategoryEditor = (episode: PodcastEpisode) => {
    setEditingCategoryEpisodeId(episode.id);
    setCategoryDraft(getEpisodeCategories(episode).join(', '));
  };

  const closeCategoryEditor = () => {
    setEditingCategoryEpisodeId(null);
    setCategoryDraft('');
  };

  const saveEpisodeCategories = () => {
    if (!editingCategoryEpisodeId) return;
    patchEpisode(editingCategoryEpisodeId, {
      categories: parseCategoryInput(categoryDraft),
    });
    closeCategoryEditor();
  };

  return (
    <div
      className="max-w-md w-full mx-auto h-[100dvh] flex flex-col overflow-y-auto bg-gray-50 font-sans text-gray-900 overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
    >
      <header className="p-6 bg-white border-b sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex flex-col text-left">
          <h1 className="text-xl font-black text-indigo-600 tracking-tighter">VoxPod AI</h1>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{t('app_subtitle')}</span>
        </div>
      </header>

      <main
        className="flex-1 p-5 space-y-6"
        style={{
          paddingBottom: `${contentBottomInset}px`,
          scrollPaddingBottom: `${contentBottomInset}px`
        }}
      >
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-xs font-bold border border-red-100 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xl px-2">×</button>
          </div>
        )}

        {isSupabaseConfigured && (
          <section className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="text-left">
                <h2 className="text-lg font-black text-gray-800">{t('auth_title')}</h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  {authUser ? t('auth_subtitle_signed_in') : t('auth_subtitle_signed_out')}
                </p>
              </div>

              {authUser && (
                <button
                  onClick={() => { void handleSignOut(); }}
                  disabled={isAuthLoading}
                  className="shrink-0 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-black text-indigo-600 disabled:text-gray-400"
                >
                  {t('auth_sign_out_btn')}
                </button>
              )}
            </div>

            {authFeedback && (
              <div
                className={`rounded-2xl border px-4 py-3 text-xs font-bold ${
                  authFeedback.kind === 'error'
                    ? 'border-red-100 bg-red-50 text-red-600'
                    : authFeedback.kind === 'success'
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                      : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                }`}
              >
                {authFeedback.message}
              </div>
            )}

            {authUser ? (
              <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-5 text-left">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('auth_signed_in_as')}</p>
                <p className="mt-2 break-all text-sm font-bold text-gray-800">{authStatusEmail}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-1">
                  <button
                    onClick={() => setAuthMode('signIn')}
                    className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                      authMode === 'signIn' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {t('auth_sign_in_tab')}
                  </button>
                  <button
                    onClick={() => setAuthMode('signUp')}
                    className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                      authMode === 'signUp' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {t('auth_sign_up_tab')}
                  </button>
                </div>

                <div className="grid gap-3">
                  <div className="space-y-1">
                    <label htmlFor="auth-email" className="text-[10px] font-black uppercase text-gray-400 ml-2">{t('auth_email_label')}</label>
                    <input
                      id="auth-email"
                      name="auth-email"
                      type="email"
                      autoComplete="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full rounded-2xl bg-gray-50 px-4 py-4 text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="auth-password" className="text-[10px] font-black uppercase text-gray-400 ml-2">{t('auth_password_label')}</label>
                    <input
                      id="auth-password"
                      name="auth-password"
                      type="password"
                      autoComplete={authMode === 'signIn' ? 'current-password' : 'new-password'}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full rounded-2xl bg-gray-50 px-4 py-4 text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>

                <button
                  onClick={() => { void handleSubmitAuth(); }}
                  disabled={isAuthSubmitDisabled}
                  className="w-full min-h-[64px] rounded-3xl font-black text-sm uppercase bg-indigo-600 text-white shadow-xl shadow-indigo-600/20 disabled:bg-gray-200 disabled:shadow-none active:scale-95 transition-all"
                >
                  {isAuthLoading
                    ? t('auth_loading')
                    : authMode === 'signIn'
                      ? t('auth_sign_in_btn')
                      : t('auth_sign_up_btn')}
                </button>
              </>
            )}
          </section>
        )}

        <div className="flex gap-2">
          <button onClick={() => documentInputRef.current?.click()} disabled={isInputLocked} className="flex-1 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-[11px] font-black text-indigo-600 active:scale-95 transition-all disabled:bg-gray-100 disabled:text-gray-400">
            {scanSource === 'document' ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : t('docs_btn')}
          </button>
          <button onClick={() => cameraInputRef.current?.click()} disabled={isInputLocked} className="flex-1 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-[11px] font-black text-indigo-600 active:scale-95 transition-all disabled:bg-gray-100 disabled:text-gray-400">
            {scanSource === 'camera' ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : t('camera_btn')}
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={isInputLocked} className="flex-1 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-[11px] font-black text-indigo-600 active:scale-95 transition-all disabled:bg-gray-100 disabled:text-gray-400">
            {scanSource === 'images' ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : t('images_btn')}
          </button>
          <label htmlFor="camera-upload" className="sr-only">{t('camera_btn')}</label>
          <input id="camera-upload" name="camera-upload" type="file" ref={cameraInputRef} onChange={handleCameraCapture} accept="image/*" capture="environment" className="hidden" aria-label={t('camera_btn')} />
          <label htmlFor="image-upload" className="sr-only">{t('images_btn')}</label>
          <input id="image-upload" name="image-upload" type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden" aria-label={t('images_btn')} />
          <label htmlFor="document-upload" className="sr-only">{t('docs_btn')}</label>
          <input id="document-upload" name="document-upload" type="file" ref={documentInputRef} onChange={handleDocumentUpload} accept={DOCUMENT_UPLOAD_ACCEPT} multiple className="hidden" aria-label={t('docs_btn')} />
        </div>
        <section className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-4">
          <div className="relative">
            <label htmlFor="podcast-text" className="sr-only">{t('placeholder_text')}</label>
            <textarea
              id="podcast-text"
              name="podcast-text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isInputLocked}
              placeholder={t('placeholder_text')}
              className="w-full h-32 p-5 bg-gray-50 rounded-t-3xl resize-none outline-none text-sm leading-relaxed focus:ring-2 focus:ring-indigo-100 transition-all border-b border-gray-100 disabled:text-gray-400"
            />
            <label htmlFor="personal-notes" className="sr-only">{t('placeholder_notes')}</label>
            <textarea
              id="personal-notes"
              name="personal-notes"
              value={inputNotes}
              onChange={(e) => setInputNotes(e.target.value)}
              disabled={isInputLocked}
              placeholder={t('placeholder_notes')}
              className="w-full h-20 p-5 bg-gray-50 rounded-b-3xl resize-none outline-none text-xs leading-relaxed focus:ring-2 focus:ring-indigo-100 transition-all disabled:text-gray-400"
            />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button 
                onClick={() => {
                  setInputText('');
                }} 
                disabled={!inputText || isInputLocked}
                className="px-4 py-2 bg-white shadow-md border border-gray-100 rounded-full text-[10px] font-black text-red-500 flex items-center gap-2 active:scale-90 transition-all disabled:text-gray-300"
              >
                {t('clear_btn')}
              </button>
              <div className="relative">
                <button 
                  onClick={() => setShowLangMenu(!showLangMenu)} 
                  disabled={isInputLocked || !inputText} 
                  className="px-4 py-2 bg-white shadow-md border border-gray-100 rounded-full text-[10px] font-black text-indigo-600 flex items-center gap-2 active:scale-90 transition-all"
                >
                  {isTranslating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></span>
                      {t('translating_short')}
                    </span>
                  ) : t('translate_btn')}
                </button>
                
                {showLangMenu && (
                  <div 
                    ref={langMenuRef}
                    onKeyDown={handleLangKeyDown}
                    tabIndex={0}
                    className="absolute top-full mt-2 right-0 bg-white border shadow-2xl rounded-2xl p-2 py-3 z-50 min-w-[180px] max-h-[280px] overflow-y-auto grid gap-1 outline-none custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-200"
                  >
                    {LANGUAGES.map((lang) => (
                      <button 
                        key={lang.code} 
                        onClick={() => handleTranslate(lang.code)} 
                        className="text-left px-4 py-2.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-colors focus:bg-indigo-50 hover:bg-indigo-50 active:bg-indigo-100 focus:outline-none text-gray-700"
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label htmlFor="voice-select" className="text-[10px] font-black uppercase text-gray-400 ml-2">{t('voice_label')}</label>
              <select id="voice-select" name="voice-select" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={isInputLocked} className="w-full p-4 bg-gray-50 rounded-2xl text-[11px] font-bold border-none appearance-none cursor-pointer disabled:text-gray-400">
                {PREMIUM_VOICES.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <button onClick={handleGenerate} disabled={isGenerateDisabled} className="w-full min-h-[78px] rounded-3xl font-black text-sm uppercase bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 disabled:bg-gray-200 active:scale-95 transition-all relative overflow-hidden px-5 py-4 text-left">
            {activePrimaryButton && (
              <div 
                className="absolute inset-y-0 left-0 bg-indigo-500 transition-all duration-500" 
                style={{ width: `${Math.min(100, activePrimaryButton.progress * 100)}%` }}
              />
            )}
            <div className="relative z-10">
              {activePrimaryButton ? (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                      {activePrimaryButton.label}
                    </span>
                    <span className="tabular-nums">{formatCountdown(activePrimaryButton.remainingSeconds)}</span>
                  </div>
                  {retryNotice && (
                    <div className="mt-2 text-[10px] font-bold normal-case tracking-normal text-white/85">
                      {retryNotice}
                    </div>
                  )}
                </>
              ) : (
                t('generate_btn')
              )}
            </div>
          </button>

        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-black px-2 text-gray-800 text-left">{t('library_title')}</h2>
          <div className="rounded-[2rem] border border-gray-100 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('sort_label')}</span>
              <select
                value={librarySortMode}
                onChange={(e) => setLibrarySortMode(e.target.value as LibrarySortMode)}
                className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-black text-gray-700"
              >
                <option value="newest">{t('sort_newest')}</option>
                <option value="oldest">{t('sort_oldest')}</option>
                <option value="title">{t('sort_title')}</option>
              </select>
            </div>

            {libraryCategories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveCategoryFilter('all')}
                  className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black transition-colors ${
                    activeCategoryFilter === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-50 text-gray-600 border border-gray-100'
                  }`}
                >
                  {t('all_categories')}
                </button>
                {libraryCategories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setActiveCategoryFilter(category)}
                    className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black transition-colors ${
                      activeCategoryFilter === category
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-50 text-gray-600 border border-gray-100'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 overflow-hidden">
            {displayedLibrary.map((ep) => (
              <div key={ep.id} onClick={() => handlePlayEpisode(ep)} className={`w-full min-w-0 p-4 rounded-[2rem] border transition-all flex items-center gap-3 cursor-pointer ${player.activeEpisode?.id === ep.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center font-bold ${player.activeEpisode?.id === ep.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  ✨
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <h3 className="text-sm font-black truncate">{ep.title}</h3>
                  <p className={`text-[9px] uppercase font-bold ${player.activeEpisode?.id === ep.id ? 'text-white/60' : 'text-gray-400'}`}>
                    {ep.generationStatus === 'processing' ? t('creating_podcast') : t('ai_voice_mode')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(getEpisodeCategories(ep).length > 0 ? getEpisodeCategories(ep) : [t('uncategorized_label')]).map((category) => (
                      <span
                        key={`${ep.id}-${category}`}
                        className={`rounded-full px-2.5 py-1 text-[9px] font-black ${
                          player.activeEpisode?.id === ep.id
                            ? 'bg-white/15 text-white/85'
                            : 'bg-indigo-50 text-indigo-600'
                        }`}
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openCategoryEditor(ep);
                    }}
                    className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                    title={t('edit_categories_btn')}
                  >
                    🏷️
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handlePlaySummary(ep); }}
                    className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                    title={summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying ? t('pause_summary_btn') : t('summary_button_title')}
                  >
                    {summaryPlayback.episodeId === ep.id && summaryPlayback.isLoading
                      ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                      : summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying
                        ? '❚❚'
                        : '🔊'}
                  </button>
                  {ep.notes && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowNotesModal(ep); }}
                      className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                      title={t('notes_title')}
                    >
                      📝
                    </button>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDownloadEpisode(ep); }}
                    disabled={ep.generationStatus === 'processing'}
                    className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                    title="Download MP3"
                  >
                    {isDownloading === ep.id || ep.generationStatus === 'processing'
                      ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                      : '📥'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); void handleDeleteEpisode(ep); }} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl opacity-30 hover:opacity-100 text-xl transition-opacity">×</button>
                </div>
              </div>
            ))}
            {library.length === 0 && (
              <p className="text-center py-10 text-[10px] font-bold text-gray-300 uppercase tracking-widest border-2 border-dashed border-gray-100 rounded-[2rem]">{t('empty_library')}</p>
            )}
            {library.length > 0 && displayedLibrary.length === 0 && (
              <p className="text-center py-10 text-[10px] font-bold text-gray-300 uppercase tracking-widest border-2 border-dashed border-gray-100 rounded-[2rem]">{t('empty_category_filter')}</p>
            )}
          </div>
        </section>

      </main>

      {player.activeEpisode && (
        <div ref={playerShellRef} className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-gray-100 p-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] z-40 rounded-t-[3.5rem] shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.1)] flex flex-col gap-4 animate-in slide-in-from-bottom-full duration-700 ease-out">
          <div className="max-w-md mx-auto w-full flex flex-col gap-4">
            <div className="flex justify-center">
              <button
                onClick={() => setIsPlayerCollapsed(prev => !prev)}
                className="flex h-7 w-12 items-center justify-center rounded-full border border-gray-100 bg-white text-sm font-black text-indigo-600 shadow-sm transition-colors hover:bg-indigo-50"
                title={isPlayerCollapsed ? t('player_show') : t('player_hide')}
                aria-label={isPlayerCollapsed ? t('player_show') : t('player_hide')}
              >
                {isPlayerCollapsed ? '↑' : '↓'}
              </button>
            </div>

            {isPlayerCollapsed ? (
              <div className="flex items-center gap-3 rounded-[2rem] border border-indigo-100 bg-white px-4 py-3 shadow-sm">
                <button
                  onClick={() => { void handleTogglePlay(); }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-lg text-white shadow-[0_10px_20px_-10px_rgba(79,70,229,0.45)]"
                >
                  {isLoadingChunk ? (
                    <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    player.isPlaying ? '❚❚' : '▶'
                  )}
                </button>
                <div className="min-w-0 flex-1 text-left">
                  <h4 className="truncate text-[13px] font-black text-gray-800">{player.activeEpisode.title}</h4>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500/80">
                    {formatTime(player.currentTime)} / {formatTime(player.duration)}
                  </p>
                </div>
                <button
                  onClick={() => setIsPlayerCollapsed(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-gray-50 text-indigo-600"
                  title={t('player_show')}
                >
                  ↑
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => setShowSpeedControls(prev => !prev)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-gray-100 bg-white px-3 py-2 text-[11px] font-black text-indigo-600 shadow-sm"
                    title={showSpeedControls ? t('speed_toggle_hide') : t('speed_toggle_show')}
                  >
                    <span className="text-base leading-none">⚙</span>
                    <span>{playbackRate.toFixed(1)}x</span>
                  </button>

                  <button
                    onClick={handleAddEpisodeBookmark}
                    className="inline-flex items-center gap-2 rounded-2xl border border-gray-100 bg-white px-3 py-2 text-[11px] font-black text-indigo-600 shadow-sm"
                    title={t('add_bookmark_btn')}
                  >
                    <span className="text-base leading-none">🔖</span>
                    <span>{t('add_bookmark_btn')}</span>
                  </button>
                </div>

                <div className="space-y-2 group">
                  <div className="relative h-2 w-full bg-indigo-50 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                      style={{ width: `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%` }}
                    />
                    <input 
                      id="playback-seek"
                      name="playback-seek"
                      type="range" 
                      min="0" 
                      max="100" 
                      step="0.1"
                      value={player.duration ? (player.currentTime / player.duration) * 100 : 0}
                      onChange={(e) => { void handleSeek(parseFloat(e.target.value)); }}
                      aria-label="Playback position"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                  </div>
                  <div className="flex justify-between px-1.5">
                    <span className="text-[10px] font-black tabular-nums text-indigo-600/80 tracking-tight">{formatTime(player.currentTime)}</span>
                    <span className="text-[10px] font-black tabular-nums text-gray-400/80 tracking-tight">-{formatTime(Math.max(0, player.duration - player.currentTime))}</span>
                  </div>
                </div>

                {showSpeedControls && (
                  <div className="rounded-[1.75rem] border border-indigo-100 bg-indigo-50/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <label htmlFor="player-speed-slider" className="text-[10px] font-black uppercase tracking-wide text-indigo-500">{t('speed_label')}</label>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-600 shadow-sm">{playbackRate.toFixed(1)}x</span>
                    </div>
                    <input
                      id="player-speed-slider"
                      name="player-speed-slider"
                      type="range"
                      min="0.4"
                      max="2.0"
                      step="0.1"
                      value={playbackRate}
                      onChange={(e) => applyPlaybackRate(parseFloat(e.target.value))}
                      className="mt-3 w-full h-1.5 bg-white rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>
                )}

                {activeEpisodeBookmarks.length > 0 && (
                  <div className="rounded-[1.75rem] border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-black uppercase tracking-wide text-indigo-500">{t('bookmarks_title')}</span>
                      <span className="text-[10px] font-bold text-gray-400">{activeEpisodeBookmarks.length}</span>
                    </div>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {activeEpisodeBookmarks.map((bookmark) => (
                        <button
                          key={bookmark.id}
                          onClick={() => { if (player.activeEpisode) void jumpToEpisodeTime(player.activeEpisode, bookmark.time); }}
                          className="shrink-0 rounded-full bg-indigo-50 px-3 py-2 text-[11px] font-black text-indigo-600 transition-colors hover:bg-indigo-100"
                        >
                          {formatTime(bookmark.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex-1 truncate mr-6 text-left">
                    <h4 className="text-[13px] font-black truncate text-gray-800 tracking-tight leading-tight">{player.activeEpisode.title}</h4>
                    <div className="flex items-center gap-2.5 mt-0.5">
                      <span className="text-[8px] font-black uppercase text-indigo-500/70 tracking-widest">{t('ai_voice_mode')}</span>
                      {player.activeEpisode.generationStatus === 'processing' && (
                        <span className="text-[8px] bg-indigo-50/50 text-indigo-600/70 px-2 py-0.5 rounded-full font-black border border-indigo-100/50">
                          {t('creating_podcast')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <button onClick={() => { void handleSkip(-15); }} className="text-gray-300 font-black text-[10px] hover:text-indigo-600 transition-colors active:scale-90 flex flex-col items-center gap-0.5">
                      <span className="text-lg">↺</span>
                      <span className="mt-[-4px]">15</span>
                    </button>
                    <button 
                      onClick={() => { void handleTogglePlay(); }} 
                      className="w-14 h-14 bg-indigo-600 text-white rounded-[1.75rem] flex items-center justify-center text-xl shadow-[0_10px_25px_-5px_rgba(79,70,229,0.4)] active:scale-95 transition-all relative hover:bg-indigo-700"
                    >
                      {isLoadingChunk ? (
                        <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        player.isPlaying ? '❚❚' : '▶'
                      )}
                    </button>
                    <button onClick={() => { void handleSkip(30); }} className="text-gray-300 font-black text-[10px] hover:text-indigo-600 transition-colors active:scale-90 flex flex-col items-center gap-0.5">
                      <span className="text-lg">↻</span>
                      <span className="mt-[-4px]">30</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showNotesModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-black text-gray-800">{t('notes_title')}</h3>
                <button onClick={() => setShowNotesModal(null)} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-4 pr-1">
                {resolvedModalNotes ? (
                  <>
                    <section className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 p-6 text-white shadow-lg">
                      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">{notesLabels.summary}</p>
                      <h4 className="mt-2 text-lg font-black leading-tight">{resolvedModalNotes.title}</h4>
                      <p className="mt-3 text-sm leading-relaxed text-white/85">{resolvedModalNotes.summary}</p>
                    </section>

                    <button
                      onClick={() => { if (showNotesModal) void handlePlaySummary(showNotesModal); }}
                      className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all ${
                        isModalSummaryPlaying
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                      }`}
                    >
                      {isModalSummaryLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {t('listen_summary_btn')}
                        </span>
                      ) : isModalSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                    </button>

                    {resolvedModalNotes.sections.map((section, index) => (
                      <section key={`${section.heading}-${index}`} className="rounded-3xl border border-gray-100 bg-gray-50 p-5 shadow-sm">
                        <h5 className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600">{section.heading}</h5>
                        <ul className="mt-3 space-y-2">
                          {section.bullets.map((bullet, bulletIndex) => (
                            <li key={`${section.heading}-${bulletIndex}`} className="flex items-start gap-3 text-sm leading-relaxed text-gray-700">
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </>
                ) : (
                  <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                    {t('no_notes')}
                  </div>
                )}
              </div>
              <button 
                onClick={() => setShowNotesModal(null)}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
              >
                {t('close_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {categoryEditorEpisode && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 space-y-5">
              <div className="flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-gray-800">{t('categories_title')}</h3>
                  <p className="mt-1 truncate text-xs font-bold text-gray-400">{categoryEditorEpisode.title}</p>
                </div>
                <button onClick={closeCategoryEditor} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
              </div>

              <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5 space-y-3">
                <label htmlFor="episode-categories" className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">
                  {t('categories_title')}
                </label>
                <input
                  id="episode-categories"
                  name="episode-categories"
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  placeholder={t('category_placeholder')}
                  className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-100"
                />
                <p className="text-xs leading-relaxed text-gray-500">{t('category_hint')}</p>
              </div>

              <button
                onClick={saveEpisodeCategories}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
              >
                {t('save_categories_btn')}
              </button>

              <button
                onClick={closeCategoryEditor}
                className="w-full py-4 bg-gray-100 text-gray-700 rounded-2xl font-black text-xs uppercase active:scale-95 transition-all"
              >
                {t('close_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4f46e5;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
};

export default App;
