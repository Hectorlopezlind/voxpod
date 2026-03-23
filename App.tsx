
import React, { useState, useEffect, useRef } from 'react';
import { VoiceName, ReadingSpeed, PodcastEpisode, PlayerState, EpisodeNotes } from './types';
import { generateTTS, translateText, extractTextFromImage, extractTextFromPdf, generateNotes } from './services/geminiService';
import { saveAudioBlob, getAudioBlob, deleteAudioBlobsByPrefix } from './services/dbService';
import { 
  initAudioElement, 
  loadAudioFromBuffer, 
  playAudio, 
  pauseAudio, 
  stopAudio,
  seekAudio, 
  setupMediaSession,
  pcmToWav,
  decodeBase64ToUint8,
  setPlaybackRate,
  setPlaybackPosition,
  exportEpisodeAsMp3
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

const TRANSLATIONS: Record<string, any> = {
  en: {
    app_subtitle: 'AI Podcast Streamer',
    pdf_btn: '📄 PDF',
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
    generate_btn: 'Start Reading ✨',
    generating_audio: 'Creating audio...',
    generating_notes: 'Creating notes...',
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
    step_label: 'Step'
  },
  sv: {
    app_subtitle: 'AI Podcast Streamer',
    pdf_btn: '📄 PDF',
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
    generate_btn: 'Starta uppläsning ✨',
    generating_audio: 'Skapar ljud...',
    generating_notes: 'Skapar anteckningar...',
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
    step_label: 'Steg'
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

const NOTES_UI_LABELS = {
  en: {
    title: 'Notes',
    summary: 'Summary',
    personal: 'Your notes',
    highlights: 'Highlights'
  },
  sv: {
    title: 'Anteckningar',
    summary: 'Sammanfattning',
    personal: 'Dina anteckningar',
    highlights: 'Höjdpunkter'
  }
} as const;

const cleanBulletText = (value: string) =>
  value
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[\).\s-]+/, '')
    .trim();

const normalizeEpisodeNotes = (
  notes: PodcastEpisode['notes'],
  userLang: string
): EpisodeNotes | null => {
  if (!notes) return null;

  if (typeof notes !== 'string') {
    return notes;
  }

  const labels = NOTES_UI_LABELS[userLang as keyof typeof NOTES_UI_LABELS] ?? NOTES_UI_LABELS.en;
  const lines = notes
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const bullets = lines
    .map(cleanBulletText)
    .filter(Boolean);

  return {
    title: labels.title,
    summary: bullets.slice(0, 2).join(' ').slice(0, 260) || notes.slice(0, 260),
    sections: [
      {
        heading: labels.highlights,
        bullets: bullets.length > 0 ? bullets : [notes.trim()]
      }
    ]
  };
};

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

const App: React.FC = () => {
  const [userLang] = useState(() => {
    const navLang = navigator.language.split('-')[0];
    return TRANSLATIONS[navLang] ? navLang : 'en';
  });

  const t = (key: string) => TRANSLATIONS[userLang][key] || key;
  const [library, setLibrary] = useState<PodcastEpisode[]>([]);
  const [inputText, setInputText] = useState(() => localStorage.getItem('voxpod_input_text') || '');
  const [inputNotes, setInputNotes] = useState(() => localStorage.getItem('voxpod_input_notes') || '');
  const [selectedVoice, setSelectedVoice] = useState<string>(PREMIUM_VOICES[0].name);
  const [playbackRate, setRate] = useState(1.0);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isScanning, setIsScanning] = useState<string | null>(null);
  const [isLoadingChunk, setIsLoadingChunk] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState<PodcastEpisode | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const [searchBuffer, setSearchBuffer] = useState('');
  const searchTimeoutRef = useRef<number | null>(null);
  const [uiClock, setUiClock] = useState(() => Date.now());
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [translateSession, setTranslateSession] = useState<TranslateSession | null>(null);
  const [generationSession, setGenerationSession] = useState<GenerationSession | null>(null);

  // Cache for pre-loaded chunks to prevent gaps
  const chunkCache = useRef<Map<string, ArrayBuffer>>(new Map());

  const [player, setPlayer] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    activeEpisode: null,
    currentChunkIndex: 0
  });

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
    localStorage.setItem('voxpod_input_text', inputText);
  }, [inputText]);

  useEffect(() => {
    localStorage.setItem('voxpod_input_notes', inputNotes);
  }, [inputNotes]);

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
    
    const syncTime = () => {
      setPlayer(prev => ({
        ...prev,
        currentTime: el.currentTime,
        duration: (el.duration && isFinite(el.duration)) ? el.duration : prev.duration
      }));
    };

    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('durationchange', syncTime);
    el.addEventListener('loadedmetadata', syncTime);
    el.addEventListener('play', syncTime);
    el.addEventListener('pause', syncTime);

    const interval = setInterval(() => {
      if (!el.paused) {
        syncTime();
        // Robustness check: if we are very close to the end and it's not paused, 
        // but the ended event hasn't fired yet, we might need to nudge it.
        if (el.currentTime > 0 && el.duration > 0 && el.currentTime >= el.duration - 0.2) {
          if (player.activeEpisode && player.currentChunkIndex < player.activeEpisode.chunkCount - 1) {
            playChunk(player.activeEpisode, player.currentChunkIndex + 1);
          }
        }
      }
    }, 500);

    return () => {
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('durationchange', syncTime);
      el.removeEventListener('loadedmetadata', syncTime);
      el.removeEventListener('play', syncTime);
      el.removeEventListener('pause', syncTime);
      clearInterval(interval);
    };
  }, [player.activeEpisode, player.currentChunkIndex]);

  useEffect(() => {
    const el = initAudioElement();
    const handleEnd = () => {
      if (player.activeEpisode && player.currentChunkIndex < player.activeEpisode.chunkCount - 1) {
        playChunk(player.activeEpisode, player.currentChunkIndex + 1);
      } else {
        setPlayer(prev => ({ ...prev, isPlaying: false }));
      }
    };
    el.addEventListener('ended', handleEnd);
    
    const saved = localStorage.getItem('voxpod_library');
    if (saved) {
      try { setLibrary(JSON.parse(saved)); } catch(e) { console.error(e); }
    }
    
    return () => el.removeEventListener('ended', handleEnd);
  }, [player.activeEpisode, player.currentChunkIndex]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const chunkText = (text: string) => {
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const chunks: string[] = [];
    let currentChunk = "";
    for (const p of paragraphs) {
      if ((currentChunk + p).length > 1200 && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = p;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + p;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  };

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setIsGenerating(true);
    setError(null);

    try {
      const id = crypto.randomUUID();
      const chunks = chunkText(inputText);
      const title = inputText.trim().split('\n')[0].substring(0, 40) || 'Ny Produktion';
      const shouldGenerateNotes = inputText.trim().length > 0;
      
      setGenerationProgress({ current: 0, total: chunks.length });
      setGenerationSession({
        startedAt: Date.now(),
        estimatedSeconds: estimateGenerationSeconds(chunks.length, shouldGenerateNotes),
        totalSteps: chunks.length + (shouldGenerateNotes ? 1 : 0),
        notesIncluded: shouldGenerateNotes,
        notesCompleted: !shouldGenerateNotes
      });

      const newEpisode: PodcastEpisode = {
        id, title, text: inputText, date: Date.now(),
        voice: selectedVoice, audioBlobId: id, 
        chunkCount: chunks.length, duration: 0,
        playbackRate
      };

      const firstChunkBase64 = await generateTTS(chunks[0], selectedVoice as VoiceName);
      const pcmBytes = decodeBase64ToUint8(firstChunkBase64);
      const wavBuffer = pcmToWav(pcmBytes, 24000);
      await saveAudioBlob(`${id}_0`, wavBuffer);
      setGenerationProgress(prev => ({ ...prev, current: 1 }));
      handlePlayEpisode(newEpisode, 0);
      let successfulChunkCount = 1;

      setLibrary(prev => {
        const updated = [newEpisode, ...prev];
        localStorage.setItem('voxpod_library', JSON.stringify(updated));
        return updated;
      });

      for (let i = 1; i < chunks.length; i++) {
        let chunkStored = false;
        try {
          const base64 = await generateTTS(chunks[i], selectedVoice as VoiceName);
          const pcm = decodeBase64ToUint8(base64);
          const wav = pcmToWav(pcm, 24000);
          await saveAudioBlob(`${id}_${i}`, wav);
          chunkStored = true;
        } catch (e) { 
          console.error(`Fel vid generering av chunk ${i}`, e);
          try {
            await new Promise(r => setTimeout(r, 2000));
            const base64 = await generateTTS(chunks[i], selectedVoice as VoiceName);
            const pcm = decodeBase64ToUint8(base64);
            const wav = pcmToWav(pcm, 24000);
            await saveAudioBlob(`${id}_${i}`, wav);
            chunkStored = true;
          } catch (e2) {
            console.error(`Retry misslyckades för chunk ${i}`, e2);
          }
        }

        if (!chunkStored) {
          break;
        }

        successfulChunkCount += 1;
        setGenerationProgress(prev => ({ ...prev, current: successfulChunkCount }));
      }

      if (successfulChunkCount !== chunks.length) {
        patchEpisode(id, { chunkCount: successfulChunkCount });
        setError("Podden skapades delvis. En ljuddel kunde inte genereras.");
      }

      if (shouldGenerateNotes) {
        setIsGeneratingNotes(true);
        try {
          const generatedNotes = await generateNotes(inputText);
          patchEpisode(id, {
            notes: mergeGeneratedAndPersonalNotes(generatedNotes, inputNotes, userLang)
          });
        } catch (e) {
          console.error("Kunde inte generera anteckningar", e);
          const personalNotesOnly = normalizeEpisodeNotes(inputNotes, userLang);
          if (personalNotesOnly) {
            patchEpisode(id, { notes: personalNotesOnly });
          }
          setError("Podden skapades, men anteckningarna kunde inte genereras.");
        } finally {
          setIsGeneratingNotes(false);
          setGenerationSession(prev => prev ? { ...prev, notesCompleted: true } : prev);
        }
      }
    } catch (err: any) { setError("Kunde inte starta podden."); }
    finally {
      setIsGenerating(false);
      setIsGeneratingNotes(false);
      setGenerationSession(null);
    }
  };

  const handleDownloadEpisode = async (episode: PodcastEpisode) => {
    if (isDownloading) return;
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

  const playChunk = async (episode: PodcastEpisode, index: number) => {
    try {
      setIsLoadingChunk(true);
      const cacheKey = `${episode.audioBlobId}_${index}`;
      let data = chunkCache.current.get(cacheKey);
      
      if (!data) {
        data = await getAudioBlob(cacheKey);
      }

      if (!data) {
        // If not found, wait and retry (maybe it's still generating)
        console.log(`Chunk ${index} inte klar än, väntar...`);
        setTimeout(() => playChunk(episode, index), 1000);
        return;
      }

      loadAudioFromBuffer(data);
      setPlaybackRate(playbackRate);
      await playAudio();
      setPlayer(prev => ({ ...prev, currentChunkIndex: index, isPlaying: true }));
      setIsLoadingChunk(false);
      
      // Pre-load next chunk
      const nextIndex = index + 1;
      if (nextIndex < episode.chunkCount) {
        const nextKey = `${episode.audioBlobId}_${nextIndex}`;
        if (!chunkCache.current.has(nextKey)) {
          getAudioBlob(nextKey).then(nextData => {
            if (nextData) chunkCache.current.set(nextKey, nextData);
          });
        }
      }
      
      // Clear old cache entries
      if (index > 1) {
        chunkCache.current.delete(`${episode.audioBlobId}_${index - 2}`);
      }
    } catch (e) { 
      console.error("Fel vid uppspelning av chunk", e);
      setError("Fel vid uppspelning."); 
    }
  };

  const handlePlayEpisode = async (episode: PodcastEpisode, index: number = 0) => {
    // If we're starting a new episode and it has a bookmark, use it
    let startChunk = index;
    let startTime = 0;
    
    if (index === 0 && episode.lastPosition) {
      startChunk = episode.lastPosition.chunkIndex;
      startTime = episode.lastPosition.currentTime;
    }

    setPlayer(prev => ({ ...prev, activeEpisode: episode, currentChunkIndex: startChunk, isPlaying: true }));
    await playChunk(episode, startChunk);
    
    if (startTime > 0) {
      const el = initAudioElement();
      el.currentTime = startTime;
    }

    setupMediaSession(episode, {
      onPlay: () => handleTogglePlay(true),
      onPause: () => handleTogglePlay(false),
      onSeek: (delta) => seekAudio(delta)
    });
  };

  const handleTogglePlay = async (force?: boolean) => {
    if (!player.activeEpisode) return;
    const shouldPlay = typeof force === 'boolean' ? force : !player.isPlaying;
    
    if (shouldPlay) {
      await playAudio();
    } else {
      pauseAudio();
      // Save bookmark when pausing
      const el = initAudioElement();
      saveBookmark(player.activeEpisode.id, player.currentChunkIndex, el.currentTime);
    }
    setPlayer(prev => ({ ...prev, isPlaying: shouldPlay }));
  };

  const saveBookmark = (episodeId: string, chunkIndex: number, currentTime: number) => {
    setLibrary(prev => {
      const updated = prev.map(ep => {
        if (ep.id === episodeId) {
          return {
            ...ep,
            lastPosition: { chunkIndex, currentTime }
          };
        }
        return ep;
      });
      localStorage.setItem('voxpod_library', JSON.stringify(updated));
      return updated;
    });
  };

  const patchEpisode = (episodeId: string, patch: Partial<PodcastEpisode>) => {
    setLibrary(prev => {
      const updated = prev.map(ep => ep.id === episodeId ? { ...ep, ...patch } : ep);
      localStorage.setItem('voxpod_library', JSON.stringify(updated));
      return updated;
    });

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

      if (player.activeEpisode?.id === episode.id) {
        stopAudio();
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

      setLibrary(prev => {
        const updated = prev.filter(x => x.id !== episode.id);
        localStorage.setItem('voxpod_library', JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      setError("Kunde inte radera avsnittet.");
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setPlaybackPosition(val);
    setPlayer(prev => ({ ...prev, currentTime: (val / 100) * prev.duration }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList) as File[];
    setScanSession({
      startedAt: Date.now(),
      totalItems: files.length,
      completedItems: 0,
      estimatedSeconds: estimateImageScanSeconds(files.length)
    });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setIsScanning(`Läser bild ${i + 1} av ${files.length}...`);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = () => reject(reader.error ?? new Error('Kunde inte läsa bildfilen.'));
            reader.readAsDataURL(file);
          });
          const extracted = await extractTextFromImage(base64, file.type);
          setInputText(prev => prev ? `${prev}\n\n${extracted}` : extracted);
        } catch (err) { 
          setError(`Bild ${i + 1} misslyckades.`); 
        }
        setScanSession(prev => prev ? { ...prev, completedItems: i + 1 } : prev);
      }
    } finally {
      setIsScanning(null);
      setScanSession(null);
      e.target.value = '';
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning("Läser PDF...");
    setScanSession({
      startedAt: Date.now(),
      totalItems: 1,
      completedItems: 0,
      estimatedSeconds: estimatePdfScanSeconds(file.size)
    });
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(reader.error ?? new Error('Kunde inte läsa PDF-filen.'));
        reader.readAsDataURL(file);
      });
      const extracted = await extractTextFromPdf(base64);
      setInputText(prev => prev ? `${prev}\n\n${extracted}` : extracted);
      setScanSession(prev => prev ? { ...prev, completedItems: 1 } : prev);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "PDF-läsning misslyckades.");
    } finally {
      setIsScanning(null);
      setScanSession(null);
      e.target.value = '';
    }
  };

  const handleTranslate = async (lang: string) => {
    if (!inputText.trim()) return;
    setIsTranslating(true);
    setShowLangMenu(false);
    setTranslateSession({
      startedAt: Date.now(),
      estimatedSeconds: estimateTranslationSeconds(inputText.length),
      targetLanguage: lang
    });
    try {
      const translated = await translateText(inputText, lang);
      setInputText(translated);
    } catch (err) { setError("Översättning misslyckades."); }
    finally {
      setIsTranslating(false);
      setTranslateSession(null);
    }
  };

  const activeStatus = (() => {
    if (generationSession) {
      const elapsedSeconds = Math.floor((uiClock - generationSession.startedAt) / 1000);
      const completedSteps = generationProgress.current + (generationSession.notesIncluded && generationSession.notesCompleted ? 1 : 0);
      const pendingSteps = Math.max(0, generationSession.totalSteps - completedSteps);
      const remainingSeconds = Math.max(
        pendingSteps > 0 ? 1 : 0,
        Math.ceil(generationSession.estimatedSeconds - elapsedSeconds),
        pendingSteps * 4
      );
      const progress = generationSession.totalSteps > 0
        ? Math.min(
            0.98,
            Math.max(
              completedSteps / generationSession.totalSteps,
              Math.min(0.92, elapsedSeconds / generationSession.estimatedSeconds)
            )
          )
        : 0;

      const isNotesStepActive = isGeneratingNotes && !generationSession.notesCompleted;
      const currentStep = isNotesStepActive
        ? generationSession.totalSteps
        : Math.max(1, completedSteps);

      return {
        title: isNotesStepActive ? t('generating_notes') : t('generating_audio'),
        detail: `${t('step_label')} ${currentStep} ${t('of_label')} ${generationSession.totalSteps}`,
        badge: generationSession.notesIncluded && !generationSession.notesCompleted
          ? t('notes_title')
          : `${generationProgress.current}/${generationProgress.total || 1}`,
        progress,
        remainingSeconds,
        eyebrow: t('countdown_label')
      };
    }

    if (isTranslating && translateSession) {
      const elapsedSeconds = Math.floor((uiClock - translateSession.startedAt) / 1000);
      const remainingSeconds = Math.max(1, Math.ceil(translateSession.estimatedSeconds - elapsedSeconds));
      const progress = Math.min(0.96, Math.max(0.1, elapsedSeconds / translateSession.estimatedSeconds));

      return {
        title: t('translating'),
        detail: `${t('target_label')}: ${translateSession.targetLanguage}`,
        badge: formatCountdown(remainingSeconds),
        progress,
        remainingSeconds,
        eyebrow: t('countdown_label')
      };
    }

    if (isScanning && scanSession) {
      const elapsedSeconds = Math.floor((uiClock - scanSession.startedAt) / 1000);
      const pendingItems = Math.max(0, scanSession.totalItems - scanSession.completedItems);
      const remainingSeconds = Math.max(
        pendingItems > 0 ? 1 : 0,
        Math.ceil(scanSession.estimatedSeconds - elapsedSeconds),
        pendingItems * 5
      );
      const progress = scanSession.totalItems > 0
        ? Math.min(
            0.98,
            Math.max(
              scanSession.completedItems / scanSession.totalItems,
              Math.min(0.9, elapsedSeconds / scanSession.estimatedSeconds)
            )
          )
        : 0;

      return {
        title: isScanning,
        detail: `${scanSession.completedItems}/${scanSession.totalItems} ${t('files_label')}`,
        badge: scanSession.totalItems > 1 ? `${scanSession.totalItems} ${t('files_label')}` : '1 PDF',
        progress,
        remainingSeconds,
        eyebrow: t('countdown_label')
      };
    }

    return null;
  })();
  const resolvedModalNotes = normalizeEpisodeNotes(showNotesModal?.notes, userLang);

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-gray-50 pb-56 font-sans text-gray-900 overflow-x-hidden">
      <header className="p-6 bg-white border-b sticky top-0 z-30 flex justify-between items-center shadow-sm">
        <div className="flex flex-col text-left">
          <h1 className="text-xl font-black text-indigo-600 tracking-tighter">VoxPod AI</h1>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{t('app_subtitle')}</span>
        </div>
      </header>

      <main className="p-5 space-y-6">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-xs font-bold border border-red-100 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xl px-2">×</button>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => pdfInputRef.current?.click()} disabled={!!isScanning} className="flex-1 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-[11px] font-black text-indigo-600 active:scale-95 transition-all">
            {isScanning === "Läser PDF..." ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : t('pdf_btn')}
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={!!isScanning} className="flex-1 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center gap-2 text-[11px] font-black text-indigo-600 active:scale-95 transition-all">
            {isScanning?.includes("bild") ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : t('images_btn')}
          </button>
          <label htmlFor="image-upload" className="sr-only">{t('images_btn')}</label>
          <input id="image-upload" name="image-upload" type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden" aria-label={t('images_btn')} />
          <label htmlFor="pdf-upload" className="sr-only">{t('pdf_btn')}</label>
          <input id="pdf-upload" name="pdf-upload" type="file" ref={pdfInputRef} onChange={handlePdfUpload} accept="application/pdf" className="hidden" aria-label={t('pdf_btn')} />
        </div>

        {activeStatus && (
          <section
            className="relative overflow-hidden rounded-[2rem] border border-indigo-100 p-5 shadow-[0_20px_45px_-25px_rgba(79,70,229,0.45)]"
            style={{ background: 'linear-gradient(135deg, rgba(238,242,255,1) 0%, rgba(255,255,255,1) 58%, rgba(224,242,254,1) 100%)' }}
          >
            <div className="absolute -top-8 right-0 h-24 w-24 rounded-full bg-indigo-200/50 blur-2xl" />
            <div className="absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-sky-200/60 blur-2xl" />

            <div className="relative flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-[1.75rem] border border-white/70 bg-white/80 text-center shadow-lg shadow-indigo-100/80 backdrop-blur">
                <span className="text-[26px] font-black tracking-tight text-indigo-600">{Math.max(1, activeStatus.remainingSeconds)}</span>
                <span className="text-[9px] font-black uppercase tracking-[0.22em] text-indigo-400">{t('sec_left')}</span>
              </div>

              <div className="min-w-0 flex-1 space-y-3 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.28em] text-indigo-500/80">{activeStatus.eyebrow}</p>
                    <h2 className="mt-1 text-sm font-black text-slate-900">{activeStatus.title}</h2>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">{activeStatus.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-indigo-100 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-indigo-600 shadow-sm">
                    {activeStatus.badge}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide">
                    <span className="text-slate-400">{t('progress_label')}</span>
                    <span className="text-indigo-600">{Math.round(activeStatus.progress * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/80 shadow-inner">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 transition-all duration-700"
                      style={{ width: `${Math.max(10, activeStatus.progress * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-semibold">
                  <span className="text-slate-500">
                    {activeStatus.remainingSeconds <= 2
                      ? t('almost_done')
                      : `${t('est_time')} ${formatCountdown(activeStatus.remainingSeconds)}`}
                  </span>
                  <span className="text-indigo-600">{formatCountdown(activeStatus.remainingSeconds)}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-4">
          <div className="relative">
            <label htmlFor="podcast-text" className="sr-only">{t('placeholder_text')}</label>
            <textarea
              id="podcast-text"
              name="podcast-text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t('placeholder_text')}
              className="w-full h-32 p-5 bg-gray-50 rounded-t-3xl resize-none outline-none text-sm leading-relaxed focus:ring-2 focus:ring-indigo-100 transition-all border-b border-gray-100"
            />
            <label htmlFor="personal-notes" className="sr-only">{t('placeholder_notes')}</label>
            <textarea
              id="personal-notes"
              name="personal-notes"
              value={inputNotes}
              onChange={(e) => setInputNotes(e.target.value)}
              placeholder={t('placeholder_notes')}
              className="w-full h-20 p-5 bg-gray-50 rounded-b-3xl resize-none outline-none text-xs leading-relaxed focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button 
                onClick={() => setInputText('')} 
                disabled={!inputText}
                className="px-4 py-2 bg-white shadow-md border border-gray-100 rounded-full text-[10px] font-black text-red-500 flex items-center gap-2 active:scale-90 transition-all"
              >
                {t('clear_btn')}
              </button>
              <div className="relative">
                <button 
                  onClick={() => setShowLangMenu(!showLangMenu)} 
                  disabled={isTranslating || !inputText} 
                  className="px-4 py-2 bg-white shadow-md border border-gray-100 rounded-full text-[10px] font-black text-indigo-600 flex items-center gap-2 active:scale-90 transition-all"
                >
                  {isTranslating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></span>
                      {t('translating')}
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
              <select id="voice-select" name="voice-select" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl text-[11px] font-bold border-none appearance-none cursor-pointer">
                {PREMIUM_VOICES.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div className="px-2 space-y-1">
            <div className="flex justify-between items-center">
              <label htmlFor="speed-slider" className="text-[10px] font-black uppercase text-gray-400">{t('speed_label')}</label>
              <span className="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{playbackRate}x</span>
            </div>
            <input 
              id="speed-slider"
              name="speed-slider"
              type="range" min="0.4" max="2.0" step="0.1" 
              value={playbackRate} 
              onChange={(e) => {
                const r = parseFloat(e.target.value);
                setRate(r);
                setPlaybackRate(r);
              }}
              className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>

          <button onClick={handleGenerate} disabled={isGenerating || isGeneratingNotes || !inputText} className="w-full py-5 rounded-3xl font-black text-sm uppercase bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 disabled:bg-gray-200 active:scale-95 transition-all relative overflow-hidden">
            <div className="relative z-10">
              {isGenerating ? t('generating_audio') : isGeneratingNotes ? t('generating_notes') : t('generate_btn')}
            </div>
            {isGenerating && (
              <div 
                className="absolute inset-0 bg-indigo-500 transition-all duration-500" 
                style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
              />
            )}
          </button>

        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-black px-2 text-gray-800 text-left">{t('library_title')}</h2>
          <div className="grid gap-3">
            {library.map((ep) => (
              <div key={ep.id} onClick={() => handlePlayEpisode(ep)} className={`p-5 rounded-[2rem] border transition-all flex items-center gap-4 cursor-pointer ${player.activeEpisode?.id === ep.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className={`w-10 h-10 flex-shrink-0 rounded-2xl flex items-center justify-center font-bold ${player.activeEpisode?.id === ep.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  ✨
                </div>
                <div className="flex-1 truncate text-left">
                  <h3 className="text-sm font-black truncate">{ep.title}</h3>
                  <p className={`text-[9px] uppercase font-bold ${player.activeEpisode?.id === ep.id ? 'text-white/60' : 'text-gray-400'}`}>{t('ai_voice_mode')}</p>
                </div>
                <div className="flex items-center gap-2">
                  {ep.notes && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowNotesModal(ep); }}
                      className={`w-8 h-8 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                      title={t('notes_title')}
                    >
                      📝
                    </button>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDownloadEpisode(ep); }}
                    className={`w-8 h-8 flex items-center justify-center rounded-xl bg-gray-50 text-indigo-600 hover:bg-indigo-100 transition-colors ${player.activeEpisode?.id === ep.id ? 'bg-white/10 text-white hover:bg-white/20' : ''}`}
                    title="Download MP3"
                  >
                    {isDownloading === ep.id ? <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> : '📥'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); void handleDeleteEpisode(ep); }} className="w-8 h-8 flex items-center justify-center rounded-xl opacity-30 hover:opacity-100 text-xl transition-opacity">×</button>
                </div>
              </div>
            ))}
            {library.length === 0 && (
              <p className="text-center py-10 text-[10px] font-bold text-gray-300 uppercase tracking-widest border-2 border-dashed border-gray-100 rounded-[2rem]">{t('empty_library')}</p>
            )}
          </div>
        </section>
      </main>

      {player.activeEpisode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-gray-100 p-6 pb-10 z-40 rounded-t-[3.5rem] shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.1)] flex flex-col gap-4 animate-in slide-in-from-bottom-full duration-700 ease-out">
          <div className="max-w-md mx-auto w-full flex flex-col gap-5">
            
            {/* --- PROGRESS BAR / SEEKER --- */}
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
                  onChange={handleSeek}
                  aria-label="Playback position"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </div>
              <div className="flex justify-between px-1.5">
                <span className="text-[10px] font-black tabular-nums text-indigo-600/80 tracking-tight">{formatTime(player.currentTime)}</span>
                <span className="text-[10px] font-black tabular-nums text-gray-400/80 tracking-tight">-{formatTime(Math.max(0, player.duration - player.currentTime))}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex-1 truncate mr-6 text-left">
                <h4 className="text-[13px] font-black truncate text-gray-800 tracking-tight leading-tight">{player.activeEpisode.title}</h4>
                <div className="flex items-center gap-2.5 mt-0.5">
                  <span className="text-[8px] font-black uppercase text-indigo-500/70 tracking-widest">{t('ai_voice_mode')}</span>
                  {player.activeEpisode.chunkCount > 1 && (
                    <span className="text-[8px] bg-indigo-50/50 text-indigo-600/70 px-2 py-0.5 rounded-full font-black border border-indigo-100/50">
                      {t('part_label')} {player.currentChunkIndex + 1} {t('of_label')} {player.activeEpisode.chunkCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-5">
                <button onClick={() => seekAudio(-15)} className="text-gray-300 font-black text-[10px] hover:text-indigo-600 transition-colors active:scale-90 flex flex-col items-center gap-0.5">
                  <span className="text-lg">↺</span>
                  <span className="mt-[-4px]">15</span>
                </button>
                <button 
                  onClick={() => handleTogglePlay()} 
                  className="w-14 h-14 bg-indigo-600 text-white rounded-[1.75rem] flex items-center justify-center text-xl shadow-[0_10px_25px_-5px_rgba(79,70,229,0.4)] active:scale-95 transition-all relative hover:bg-indigo-700"
                >
                  {isLoadingChunk ? (
                    <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    player.isPlaying ? '❚❚' : '▶'
                  )}
                </button>
                <button onClick={() => seekAudio(30)} className="text-gray-300 font-black text-[10px] hover:text-indigo-600 transition-colors active:scale-90 flex flex-col items-center gap-0.5">
                  <span className="text-lg">↻</span>
                  <span className="mt-[-4px]">30</span>
                </button>
              </div>
            </div>
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
                      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">{t('notes_title')}</p>
                      <h4 className="mt-2 text-lg font-black leading-tight">{resolvedModalNotes.title}</h4>
                      <p className="mt-3 text-sm leading-relaxed text-white/85">{resolvedModalNotes.summary}</p>
                    </section>

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
