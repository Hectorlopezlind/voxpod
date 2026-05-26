
import React, { useState, useEffect, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { VoiceName, PodcastEpisode, PlayerState, EpisodeNotes, EpisodeBookmark, GeminiGenerationUsage, EpisodeGenerationCost } from './types';
import { generateTTS, generatePublicDemoTTS, fetchPublicDemoConfiguration, translateText, generateNotes, GeminiRequestOptions, streamTextFromImage, streamTextFromPdf, extractWebPageText } from './services/geminiService';
import { saveAudioBlob, getAudioBlob, deleteAudioBlob, deleteAudioBlobsByPrefix, getImportTextCache, saveImportTextCache, getSummaryCache, saveSummaryCache } from './services/dbService';
import { DOCUMENT_UPLOAD_ACCEPT, isTextDocumentFile, streamLocalDocumentText } from './services/documentService';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import {
  deleteCloudEpisode,
  downloadCloudEpisodeChunk,
  downloadCloudSummaryAudio,
  fetchCloudEpisodes,
  isCloudPermissionError,
  isMissingCloudSchemaError,
  uploadCloudEpisodeChunk,
  uploadCloudSummaryAudio,
  upsertCloudEpisodes,
} from './services/cloudLibraryService';
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
import heroPreviewImage from './supabase/images/man.webp';

const PREMIUM_VOICES = [
  { name: VoiceName.Kore, label: 'Klara' },
  { name: VoiceName.Charon, label: 'Daniel' },
  { name: VoiceName.Fenrir, label: 'Peter' }
];

const VOICE_LABELS: Record<string, string> = {
  [VoiceName.Kore]: 'Klara',
  [VoiceName.Charon]: 'Daniel',
  [VoiceName.Fenrir]: 'Peter',
  [VoiceName.Puck]: 'Peter',
  [VoiceName.Zephyr]: 'Klara',
};

const getVoiceDisplayName = (voice: string) => VOICE_LABELS[voice] ?? voice;

const LANGUAGES = [
  // Prioriterade språk absolut överst
  { code: 'English', labels: { en: 'English', es: 'Inglés' } },
  { code: 'Spanish', labels: { en: 'Spanish', es: 'Español' } },
  { code: 'Swedish', labels: { en: 'Swedish', es: 'Sueco' } },
  // Europeiska språk (A-Ö)
  { code: 'Bulgarian', labels: { en: 'Bulgarian', es: 'Búlgaro' } },
  { code: 'Danish', labels: { en: 'Danish', es: 'Danés' } },
  { code: 'Finnish', labels: { en: 'Finnish', es: 'Finés' } },
  { code: 'French', labels: { en: 'French', es: 'Francés' } },
  { code: 'Greek', labels: { en: 'Greek', es: 'Griego' } },
  { code: 'Icelandic', labels: { en: 'Icelandic', es: 'Islandés' } },
  { code: 'Italian', labels: { en: 'Italian', es: 'Italiano' } },
  { code: 'Dutch', labels: { en: 'Dutch', es: 'Neerlandés' } },
  { code: 'Norwegian', labels: { en: 'Norwegian', es: 'Noruego' } },
  { code: 'Polish', labels: { en: 'Polish', es: 'Polaco' } },
  { code: 'Portuguese', labels: { en: 'Portuguese', es: 'Portugués' } },
  { code: 'Romanian', labels: { en: 'Romanian', es: 'Rumano' } },
  { code: 'Russian', labels: { en: 'Russian', es: 'Ruso' } },
  { code: 'Slovak', labels: { en: 'Slovak', es: 'Eslovaco' } },
  { code: 'Czech', labels: { en: 'Czech', es: 'Checo' } },
  { code: 'Turkish', labels: { en: 'Turkish', es: 'Turco' } },
  { code: 'German', labels: { en: 'German', es: 'Alemán' } },
  { code: 'Ukrainian', labels: { en: 'Ukrainian', es: 'Ucraniano' } },
  { code: 'Hungarian', labels: { en: 'Hungarian', es: 'Húngaro' } },
  // Globala språk (A-Ö)
  { code: 'Arabic', labels: { en: 'Arabic', es: 'Árabe' } },
  { code: 'Hindi', labels: { en: 'Hindi', es: 'Hindi' } },
  { code: 'Indonesian', labels: { en: 'Indonesian', es: 'Indonesio' } },
  { code: 'Japanese', labels: { en: 'Japanese', es: 'Japonés' } },
  { code: 'Chinese', labels: { en: 'Chinese', es: 'Chino' } },
  { code: 'Korean', labels: { en: 'Korean', es: 'Coreano' } },
  { code: 'Thai', labels: { en: 'Thai', es: 'Tailandés' } },
  { code: 'Vietnamese', labels: { en: 'Vietnamese', es: 'Vietnamita' } }
];

const EN_TRANSLATIONS = {
  app_subtitle: 'AI Podcast Streamer',
  docs_btn: 'Upload document',
  docs_btn_hint: 'PDF, text or rich document',
  camera_btn: 'Take photos',
  camera_btn_hint: 'Open camera',
  images_btn: 'Upload images',
  images_btn_hint: 'Import a full image set',
  link_btn: 'Import link',
  link_btn_hint: 'Paste a webpage or PDF link',
  link_placeholder: 'https://example.com/article',
  link_import_btn: 'Import',
  scanning_pdf: 'Reading PDF...',
  scanning_camera: 'Reading camera scan...',
  scanning_images: 'Reading images...',
  scanning_link: 'Reading link...',
  translating: 'Translating...',
  placeholder_text: 'Paste text, clean up an import, or write your own draft...',
  placeholder_notes: '',
  clear_btn: 'Clear',
  clear_btn_title: 'Clear the imported text and draft',
  translate_btn: 'Translate',
  translate_btn_hint: 'Rewrite the current text in another language',
  voice_label: 'Voice',
  speed_label: 'Speed',
  generate_btn: 'Create podcast',
  generate_btn_hint: 'Turn the current text into spoken audio',
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
  notes_title: 'Summary',
  no_notes: 'No summary available yet.',
  close_btn: 'Close',
  cancel_btn: 'Cancel',
  sec_left: 'sec left',
  scanning_progress: 'Importing text',
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
  summary_button_title: 'Play summary',
  add_bookmark_btn: 'Add bookmark',
  bookmarks_title: 'Bookmarks',
  speed_toggle_show: 'Show speed',
  speed_toggle_hide: 'Hide speed',
  player_hide: 'Hide player',
  player_show: 'Show player',
  player_close: 'Close player',
  play_btn: 'Play',
  pause_btn: 'Pause',
  skip_back_btn: 'Jump back 15 seconds',
  skip_forward_btn: 'Jump ahead 30 seconds',
  categories_title: 'Categories',
  category_placeholder: 'politics, novels, history',
  category_hint: 'Separate categories with commas.',
  save_categories_btn: 'Save categories',
  edit_categories_btn: 'Categories',
  all_categories: 'All',
  sort_label: 'Sort by',
  sort_newest: 'Newest',
  sort_oldest: 'Oldest',
  sort_title: 'Title',
  uncategorized_label: 'Uncategorized',
  empty_category_filter: 'No audio in this category yet.',
  auth_title: 'Account',
  auth_subtitle_signed_out: 'Unlock private sync and keep your library with you across signed-in devices.',
  auth_subtitle_signed_in: 'Your premium tools and private sync are active on this account.',
  auth_open_btn: 'Open account',
  auth_status_signed_in_short: 'Signed in',
  auth_email_label: 'Email',
  auth_password_label: 'Password',
  auth_sign_in_tab: 'Sign in',
  auth_sign_up_tab: 'Create account',
  auth_forgot_tab: 'Reset password',
  auth_sign_in_btn: 'Sign in',
  auth_sign_up_btn: 'Create account',
  auth_reset_btn: 'Send reset link',
  auth_sign_out_btn: 'Sign out',
  auth_signed_in_as: 'Signed in as',
  auth_success_signed_in: 'Signed in.',
  auth_success_signed_out: 'Signed out.',
  auth_reset_sent: 'Password reset link sent. Check your email.',
  auth_check_email: 'Account created. Check your email to verify it before signing in if verification is enabled.',
  auth_email_confirmed: 'Account created and signed in.',
  auth_loading: 'Connecting...',
  cloud_status_ready: 'Private cloud sync is active for this account.',
  cloud_status_syncing: 'Syncing your private audio library...',
  cloud_status_signed_out: 'Sign in to save audio privately and open it on any signed-in device.',
  cloud_status_setup_needed: 'Run the Supabase SQL setup before cloud sync can protect your files.',
  cloud_status_permission_error: 'Cloud sync is blocked by missing Supabase permissions or bucket rules.',
  cloud_status_cancelled: 'Cloud sync was stopped. New audio will try to sync again automatically.',
  cloud_status_timeout: 'Cloud sync timed out. Check the connection and try creating the audio again.',
  cloud_cancel_btn: 'Stop sync',
  hero_kicker: 'Private AI Audio Workspace',
  hero_title: 'Turn documents, images and notes into a library that follows you between devices.',
  hero_body: 'Create podcasts from text, PDFs, camera scans and image batches. When you are signed in, the library can be tied to your Supabase account instead of only this browser.',
  hero_feature_kicker: 'VOXPOD PREMIUM',
  hero_feature_title: 'Sign in for premium features.',
  hero_preview_label: 'Featured',
  hero_preview_title: 'Turn captured text into a polished listening session.',
  hero_preview_body: 'Import a document, a photo or a full image set, then shape the result before you press play.',
  hero_action_hint: '',
  imported_text_label: 'Text editor',
  import_status_ready: 'Ready to edit',
  edit_summary_btn: 'Edit summary',
  save_summary_btn: 'Save summary',
  summary_title_label: 'Summary title',
  summary_body_label: 'Summary text',
  now_playing_label: 'Now playing',
  runtime_label: 'Runtime',
  language_toggle_to_english: 'Switch to English',
  language_toggle_to_spanish: 'Cambiar a español',
  download_mp3_title: 'Download MP3',
  download_mp3_error: 'MP3 download failed.',
  import_replace_confirm: 'Do you want to delete the existing text? OK replaces it, Cancel adds the new text after it.',
  playback_position_label: 'Playback position',
  new_episode_title: 'New episode',
  image_import_failed: 'Image import failed.',
  image_import_partial_single: 'One image could not be imported: {name}. The rest of the batch was kept.',
  image_import_partial_multiple: '{count} images could not be imported. The rest of the batch was kept.',
  document_import_failed: 'Document import failed.',
  document_import_partial_single: 'One document could not be imported: {name}. The rest of the batch was kept.',
  document_import_partial_multiple: '{count} documents could not be imported. The rest of the batch was kept.',
  link_import_failed: 'Link import failed.',
  link_invalid_error: 'Enter a valid http or https link.',
  translation_failed: 'Translation failed.',
  playback_failed: 'Playback failed.',
  playback_chunk_waiting: 'The next audio part is still being created. Try play again in a moment.',
  playback_chunk_missing: 'This audio part is missing or could not be downloaded. Recreate the podcast or try again after sync finishes.',
  playback_stalled: 'Playback stalled. I paused the player so you can retry from the same spot.',
  delete_failed: 'Could not delete the episode.',
  delete_episode_confirm_title: 'Delete file?',
  delete_episode_confirm_body: 'Do you want to delete this file permanently?',
  delete_episode_confirm_btn: 'Delete permanently',
  speech_cleanup_label_on: 'Without codes',
  speech_cleanup_label_off: 'With codes',
  speech_cleanup_hint: 'Cleans noisy OCR fragments before speech and keeps English titles natural inside Swedish text.',
  speech_cleanup_on: 'Cleaning on',
  speech_cleanup_off: 'Read exact text',
  speech_cleanup_tooltip_on: 'Skip OCR codes, lone numbers, and symbol noise during speech.',
  speech_cleanup_tooltip_off: 'Read imported OCR text exactly as it appears, including codes and lone numbers.',
  speech_cleanup_empty_error: 'Nothing readable remained after speech cleanup. Turn it off or edit the text first.',
  open_episode_title: 'Open episode',
  delete_episode_title: 'Delete episode',
  edit_episode_btn: 'Edit',
  episode_editor_title: 'Edit episode',
  episode_title_label: 'Episode title',
  save_episode_btn: 'Save changes',
  camera_modal_title: 'Camera capture',
  camera_modal_body: 'Take several photos first, then import them together.',
  camera_permission_error: 'Camera access failed. Allow camera access or use the native camera picker.',
  camera_open_native_btn: 'Use native camera',
  camera_capture_btn: 'Take photo',
  camera_use_photos_btn: 'Use {count} photos',
  camera_remove_photo_btn: 'Remove photo',
  camera_shots_empty: 'No photos yet.',
  camera_starting: 'Starting camera...',
  camera_count_status: '{count} photos ready',
  camera_pending_title: 'Camera photos',
  camera_pending_hint: 'Each photo is saved right away. Take more, then press Done to import them together.',
  camera_take_next_btn: 'Take another photo',
  camera_done_btn: 'Done',
  layout_studio_title: 'Layout Studio',
  layout_studio_body: 'Compare four presentation shells. The active version is saved on this device.',
  layout_studio_current: 'Current layout',
  layout_studio_apply: 'Apply',
  layout_studio_selected: 'Selected',
  layout_dock_label: 'Layout'
} as const;

const ES_TRANSLATIONS: Record<keyof typeof EN_TRANSLATIONS, string> = {
  app_subtitle: 'Reproductor de podcasts con IA',
  docs_btn: 'Subir documento',
  docs_btn_hint: 'PDF, texto o documento enriquecido',
  camera_btn: 'Tomar fotos',
  camera_btn_hint: 'Abrir cámara',
  images_btn: 'Subir imágenes',
  images_btn_hint: 'Importa una serie completa de imágenes',
  link_btn: 'Importar enlace',
  link_btn_hint: 'Pega la URL de una web o un PDF',
  link_placeholder: 'https://example.com/article',
  link_import_btn: 'Importar',
  scanning_pdf: 'Leyendo PDF...',
  scanning_camera: 'Leyendo captura...',
  scanning_images: 'Leyendo imágenes...',
  scanning_link: 'Leyendo enlace...',
  translating: 'Traduciendo...',
  placeholder_text: 'Pega texto, corrige una importación o escribe tu propio borrador...',
  placeholder_notes: '',
  clear_btn: 'Borrar',
  clear_btn_title: 'Borra el texto importado y el borrador',
  translate_btn: 'Traducir',
  translate_btn_hint: 'Reescribe el texto actual en otro idioma',
  voice_label: 'Voz',
  speed_label: 'Velocidad',
  generate_btn: 'Crear podcast',
  generate_btn_hint: 'Convierte el texto actual en audio hablado',
  creating_podcast: 'Creando podcast',
  loading_text: 'Cargando texto',
  translating_short: 'Traduciendo',
  progress_label: 'Progreso',
  time_left: 'restante',
  library_title: 'Biblioteca',
  empty_library: 'Biblioteca vacía',
  ai_voice_mode: 'MODO DE VOZ IA',
  part_label: 'PARTE',
  of_label: 'DE',
  notes_title: 'Resumen',
  no_notes: 'Todavía no hay un resumen disponible.',
  close_btn: 'Cerrar',
  cancel_btn: 'Cancelar',
  sec_left: 's restantes',
  scanning_progress: 'Importando texto',
  est_time: 'est.',
  countdown_label: 'CUENTA ATRÁS',
  almost_done: 'Casi listo',
  target_label: 'Destino',
  files_label: 'archivos',
  step_label: 'Paso',
  image_order_title: 'Orden de imágenes',
  image_order_hint: 'La app lee las imágenes en este orden.',
  retrying: 'Reintentando automáticamente',
  waiting_for_network: 'Esperando conexión',
  listen_summary_btn: 'Escuchar resumen',
  pause_summary_btn: 'Pausar resumen',
  summary_audio_error: 'No se pudo reproducir el resumen.',
  summary_button_title: 'Reproducir resumen',
  add_bookmark_btn: 'Añadir marcador',
  bookmarks_title: 'Marcadores',
  speed_toggle_show: 'Mostrar velocidad',
  speed_toggle_hide: 'Ocultar velocidad',
  player_hide: 'Ocultar reproductor',
  player_show: 'Mostrar reproductor',
  player_close: 'Cerrar reproductor',
  play_btn: 'Reproducir',
  pause_btn: 'Pausar',
  skip_back_btn: 'Retroceder 15 segundos',
  skip_forward_btn: 'Avanzar 30 segundos',
  categories_title: 'Categorías',
  category_placeholder: 'política, novelas, historia',
  category_hint: 'Separa las categorías con comas.',
  save_categories_btn: 'Guardar categorías',
  edit_categories_btn: 'Categorías',
  all_categories: 'Todas',
  sort_label: 'Ordenar por',
  sort_newest: 'Más recientes',
  sort_oldest: 'Más antiguos',
  sort_title: 'Título',
  uncategorized_label: 'Sin categoría',
  empty_category_filter: 'Todavía no hay audio en esta categoría.',
  auth_title: 'Cuenta',
  auth_subtitle_signed_out: 'Desbloquea la sincronización privada y lleva tu biblioteca a cualquier dispositivo donde inicies sesión.',
  auth_subtitle_signed_in: 'Tus herramientas premium y la sincronización privada están activas en esta cuenta.',
  auth_open_btn: 'Abrir cuenta',
  auth_status_signed_in_short: 'Conectado',
  auth_email_label: 'Correo',
  auth_password_label: 'Contraseña',
  auth_sign_in_tab: 'Iniciar sesión',
  auth_sign_up_tab: 'Crear cuenta',
  auth_forgot_tab: 'Restablecer contraseña',
  auth_sign_in_btn: 'Iniciar sesión',
  auth_sign_up_btn: 'Crear cuenta',
  auth_reset_btn: 'Enviar enlace',
  auth_sign_out_btn: 'Cerrar sesión',
  auth_signed_in_as: 'Conectado como',
  auth_success_signed_in: 'Sesión iniciada.',
  auth_success_signed_out: 'Sesión cerrada.',
  auth_reset_sent: 'Enlace de restablecimiento enviado. Revisa tu correo.',
  auth_check_email: 'Cuenta creada. Revisa tu correo para verificarla antes de iniciar sesión si la verificación está activada.',
  auth_email_confirmed: 'Cuenta creada e inicio de sesión completado.',
  auth_loading: 'Conectando...',
  cloud_status_ready: 'La sincronización privada en la nube está activa para esta cuenta.',
  cloud_status_syncing: 'Sincronizando tu biblioteca de audio privada...',
  cloud_status_signed_out: 'Inicia sesión para guardar audio de forma privada y abrirlo en cualquier dispositivo con tu sesión.',
  cloud_status_setup_needed: 'Ejecuta la configuración SQL de Supabase antes de usar la sincronización protegida.',
  cloud_status_permission_error: 'La sincronización en la nube está bloqueada por permisos o reglas del bucket de Supabase.',
  cloud_status_cancelled: 'La sincronización en la nube se detuvo. El audio nuevo intentará sincronizarse otra vez automáticamente.',
  cloud_status_timeout: 'La sincronización en la nube agotó el tiempo de espera. Revisa la conexión y vuelve a crear el audio.',
  cloud_cancel_btn: 'Detener sync',
  hero_kicker: 'Espacio privado de audio con IA',
  hero_title: 'Convierte documentos, imágenes y notas en una biblioteca que te acompaña entre dispositivos.',
  hero_body: 'Crea podcasts desde texto, PDFs, capturas de cámara y lotes de imágenes. Cuando inicias sesión, la biblioteca puede vincularse a tu cuenta de Supabase en lugar de quedarse solo en este navegador.',
  hero_feature_kicker: 'VOXPOD PREMIUM',
  hero_feature_title: 'Inicia sesión para funciones premium.',
  hero_preview_label: 'Destacado',
  hero_preview_title: 'Convierte texto capturado en una sesión pulida para escuchar.',
  hero_preview_body: 'Importa un documento, una foto o una serie completa de imágenes y da forma al resultado antes de pulsar reproducir.',
  hero_action_hint: '',
  imported_text_label: 'Editor de texto',
  import_status_ready: 'Listo para editar',
  edit_summary_btn: 'Editar resumen',
  save_summary_btn: 'Guardar resumen',
  summary_title_label: 'Título del resumen',
  summary_body_label: 'Texto del resumen',
  now_playing_label: 'Sonando ahora',
  runtime_label: 'Duración',
  language_toggle_to_english: 'Switch to English',
  language_toggle_to_spanish: 'Cambiar a español',
  download_mp3_title: 'Descargar MP3',
  download_mp3_error: 'No se pudo descargar el MP3.',
  import_replace_confirm: '¿Quieres borrar el texto existente? OK lo reemplaza, Cancelar añade el texto nuevo después.',
  playback_position_label: 'Posición de reproducción',
  new_episode_title: 'Nuevo episodio',
  image_import_failed: 'La importación de imágenes falló.',
  image_import_partial_single: 'No se pudo importar una imagen: {name}. El resto del lote se conservó.',
  image_import_partial_multiple: 'No se pudieron importar {count} imágenes. El resto del lote se conservó.',
  document_import_failed: 'La importación del documento falló.',
  document_import_partial_single: 'No se pudo importar un documento: {name}. El resto del lote se conservó.',
  document_import_partial_multiple: 'No se pudieron importar {count} documentos. El resto del lote se conservó.',
  link_import_failed: 'La importación del enlace falló.',
  link_invalid_error: 'Introduce un enlace http o https válido.',
  translation_failed: 'La traducción falló.',
  playback_failed: 'La reproducción falló.',
  playback_chunk_waiting: 'La siguiente parte de audio todavía se está creando. Vuelve a pulsar reproducir en un momento.',
  playback_chunk_missing: 'Falta esta parte de audio o no se pudo descargar. Vuelve a crear el podcast o inténtalo cuando termine la sincronización.',
  playback_stalled: 'La reproducción se detuvo. Pausé el reproductor para que puedas reintentar desde el mismo punto.',
  delete_failed: 'No se pudo borrar el episodio.',
  delete_episode_confirm_title: '¿Borrar archivo?',
  delete_episode_confirm_body: '¿Quieres borrar este archivo permanentemente?',
  delete_episode_confirm_btn: 'Borrar permanentemente',
  speech_cleanup_label_on: 'Sin códigos',
  speech_cleanup_label_off: 'Con códigos',
  speech_cleanup_hint: 'Limpia fragmentos OCR ruidosos antes de leer y mantiene naturales los títulos en inglés dentro de texto sueco.',
  speech_cleanup_on: 'Limpieza activa',
  speech_cleanup_off: 'Leer texto exacto',
  speech_cleanup_tooltip_on: 'Omite códigos OCR, números sueltos y ruido de símbolos durante la lectura.',
  speech_cleanup_tooltip_off: 'Lee el texto OCR importado exactamente como aparece, incluidos códigos y números sueltos.',
  speech_cleanup_empty_error: 'No quedó texto legible después de limpiar la voz. Desactiva el filtro o edita el texto primero.',
  open_episode_title: 'Abrir episodio',
  delete_episode_title: 'Borrar episodio',
  edit_episode_btn: 'Editar',
  episode_editor_title: 'Editar episodio',
  episode_title_label: 'Título del episodio',
  save_episode_btn: 'Guardar cambios',
  camera_modal_title: 'Captura con cámara',
  camera_modal_body: 'Haz varias fotos primero y luego impórtalas juntas.',
  camera_permission_error: 'No se pudo acceder a la cámara. Permite el acceso o usa el selector nativo.',
  camera_open_native_btn: 'Usar cámara nativa',
  camera_capture_btn: 'Tomar foto',
  camera_use_photos_btn: 'Usar {count} fotos',
  camera_remove_photo_btn: 'Quitar foto',
  camera_shots_empty: 'Todavía no hay fotos.',
  camera_starting: 'Iniciando cámara...',
  camera_count_status: '{count} fotos listas',
  camera_pending_title: 'Fotos de cámara',
  camera_pending_hint: 'Cada foto se guarda al momento. Haz más y luego pulsa Listo para importarlas juntas.',
  camera_take_next_btn: 'Tomar otra foto',
  camera_done_btn: 'Listo',
  layout_studio_title: 'Estudio de diseño',
  layout_studio_body: 'Compara cuatro presentaciones. La versión activa se guarda en este dispositivo.',
  layout_studio_current: 'Diseño actual',
  layout_studio_apply: 'Aplicar',
  layout_studio_selected: 'Seleccionado',
  layout_dock_label: 'Diseño'
};

type SupportedLanguage = 'en' | 'es';
type TranslationKey = keyof typeof EN_TRANSLATIONS;

const TRANSLATIONS: Record<SupportedLanguage, Record<TranslationKey, string>> = {
  en: EN_TRANSLATIONS,
  es: ES_TRANSLATIONS
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

type ImportSource = 'document' | 'camera' | 'images' | 'link';

type ImportSessionState = {
  id: string;
  source: ImportSource;
  baseText: string;
  text: string;
  isComplete: boolean;
};

type CameraShot = {
  id: string;
  file: File;
  previewUrl: string;
};

type LibrarySortMode = 'newest' | 'oldest' | 'title';
type AuthMode = 'signIn' | 'signUp';

type AuthFeedback = {
  kind: 'error' | 'success' | 'info';
  message: string;
};

type AppErrorCode =
  | 'TOKEN_LIMIT'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'AUTH'
  | 'OCR_FAILED'
  | 'SUMMARY_FAILED'
  | 'TTS_TIMEOUT'
  | 'AUDIO_FAILED'
  | 'UNKNOWN';

type ClassifiedAppError = {
  code: AppErrorCode;
  title: string;
  message: string;
  actionLabel?: string;
  technicalDetails: string;
};

type AiRequestContext = {
  functionName: string;
  kind: 'OCR' | 'SUMMARY' | 'TTS' | 'SUMMARY_TTS' | 'IMPORT' | 'TRANSLATE' | 'WEB';
  textLength?: number;
  model?: string;
  provider?: string;
};

type LayoutPreset = {
  shellClassName: string;
  headerClassName: string;
  headerInnerClassName: string;
  brandClassName: string;
  subtitleClassName: string;
  statChipClassName: string;
  mainClassName: string;
  heroClassName: string;
  heroGlowClassName: string;
  heroGridClassName: string;
  heroMetricCardClassName: string;
  panelClassName: string;
  playerShellClassName: string;
};

const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const FORGOT_PASSWORD_PATH = '/forgot-password';
const DEFAULT_AUTHENTICATED_PATH = '/create-pod';
const PUBLIC_AUTH_PATHS = new Set([LOGIN_PATH, SIGNUP_PATH, FORGOT_PASSWORD_PATH]);

const getCurrentRoutePath = () =>
  typeof window === 'undefined' ? LOGIN_PATH : window.location.pathname || LOGIN_PATH;

const getCurrentRouteWithSearch = () =>
  typeof window === 'undefined'
    ? DEFAULT_AUTHENTICATED_PATH
    : `${window.location.pathname || DEFAULT_AUTHENTICATED_PATH}${window.location.search || ''}${window.location.hash || ''}`;

const isPublicAuthPath = (path: string) => PUBLIC_AUTH_PATHS.has(path);

const replaceRoute = (path: string) => {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', path);
};

const pushRoute = (path: string) => {
  if (typeof window === 'undefined') return;
  window.history.pushState(null, '', path);
};

const getRedirectParam = () => {
  if (typeof window === 'undefined') return null;
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  if (!redirect || isPublicAuthPath(redirect.split('?')[0])) {
    return null;
  }
  return redirect.startsWith('/') ? redirect : null;
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
  generationCost?: EpisodeGenerationCost;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

const stringifyTechnicalError = (error: unknown) => {
  if (error instanceof Error) {
    const status = 'status' in error ? `status=${String((error as { status?: unknown }).status)}` : '';
    return [error.name, error.message, status, error.stack].filter(Boolean).join('\n');
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

const formatAiRequestContext = (context?: string | AiRequestContext) => {
  const timestamp = new Date().toISOString();
  if (!context) {
    return `timestamp=${timestamp}`;
  }

  if (typeof context === 'string') {
    return [
      `function=${context}`,
      `timestamp=${timestamp}`,
    ].join('\n');
  }

  return [
    `function=${context.functionName}`,
    `kind=${context.kind}`,
    `provider=${context.provider ?? 'Gemini'}`,
    context.model ? `model=${context.model}` : null,
    typeof context.textLength === 'number' ? `textLength=${context.textLength}` : null,
    `timestamp=${timestamp}`,
  ].filter(Boolean).join('\n');
};

const withAiRequestContext = (error: unknown, context: AiRequestContext) => {
  const sourceMessage = error instanceof Error ? error.message : String(error ?? 'Unknown AI error');
  const wrappedError = new Error(`${sourceMessage}\n${formatAiRequestContext(context)}`);
  wrappedError.name = error instanceof Error ? error.name : 'AiRequestError';
  if (error instanceof Error && error.stack) {
    wrappedError.stack = error.stack;
  }
  if (error instanceof Error && 'status' in error) {
    (wrappedError as Error & { status?: unknown }).status = (error as Error & { status?: unknown }).status;
  }
  if (error instanceof Error && 'retryable' in error) {
    (wrappedError as Error & { retryable?: unknown }).retryable = (error as Error & { retryable?: unknown }).retryable;
  }
  return wrappedError;
};

const parseAppError = (error: unknown, context?: string | AiRequestContext): ClassifiedAppError => {
  const contextDetails = formatAiRequestContext(context);
  const technicalDetails = `${contextDetails}\n\n${stringifyTechnicalError(error)}`;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = `${contextDetails} ${message} ${technicalDetails}`.toLowerCase();
  const status = error instanceof Error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  const isLimitError = status === 402 ||
    status === 429 ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('free tier limit') ||
    normalized.includes('quota') ||
    normalized.includes('resource_exhausted') ||
    normalized.includes('generate_content_free_tier_requests') ||
    normalized.includes('no credits') ||
    normalized.includes('generation limit');

  if (isLimitError && (normalized.includes('kind=summary') || normalized.includes('function=summary generation'))) {
    return {
      code: 'SUMMARY_FAILED',
      title: 'Summary unavailable',
      message: 'Audio was created, but the summary could not be generated because the AI limit was reached.',
      actionLabel: 'Retry summary',
      technicalDetails,
    };
  }

  if (isLimitError && normalized.includes('kind=summary_tts')) {
    return {
      code: 'AUDIO_FAILED',
      title: 'Summary audio unavailable',
      message: 'The written summary is saved, but summary audio could not be generated because the AI limit was reached.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (status === 429 || normalized.includes('rate limit') || normalized.includes('too many requests') || normalized.includes('free tier limit')) {
    return {
      code: 'RATE_LIMIT',
      title: normalized.includes('tts') || normalized.includes('free tier limit') ? 'AI limit reached' : 'Too many requests',
      message: normalized.includes('tts') || normalized.includes('free tier limit')
        ? 'Continue listening to already generated audio. To create more, wait for the quota to reset, use a shorter text, or enable billing.'
        : 'Wait a moment and try again.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (status === 401 || (status === 403 && !normalized.includes('permission_denied')) || normalized.includes('session') || normalized.includes('inloggad') || normalized.includes('auth')) {
    return {
      code: 'AUTH',
      title: 'Session expired',
      message: 'Please sign in again.',
      actionLabel: 'Sign in',
      technicalDetails,
    };
  }

  if (
    status === 402 ||
    normalized.includes('no credits') ||
    normalized.includes('quota') ||
    normalized.includes('billing') ||
    normalized.includes('resource_exhausted') ||
    normalized.includes('consumer_suspended') ||
    normalized.includes('permission_denied')
  ) {
    return {
      code: 'TOKEN_LIMIT',
      title: 'AI limit reached',
      message: 'Continue listening to already generated audio. To create more, wait for the quota to reset, use a shorter text, or enable billing.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (status === 504 || normalized.includes('timeout') || normalized.includes('deadline') || normalized.includes('took too long')) {
    return {
      code: 'TTS_TIMEOUT',
      title: 'Generation took too long',
      message: 'Your podcast may still finish shortly.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (!navigator.onLine || normalized.includes('network') || normalized.includes('fetch') || normalized.includes('connection')) {
    return {
      code: 'NETWORK',
      title: 'Connection problem',
      message: 'Check your internet connection.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (normalized.includes('image import') || normalized.includes('ocr') || normalized.includes('could not decode the image') || normalized.includes('read the pages')) {
    return {
      code: 'OCR_FAILED',
      title: 'We couldn’t read the pages',
      message: 'Try clearer photos.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  if (normalized.includes('summary') || normalized.includes('notes')) {
    return {
      code: 'SUMMARY_FAILED',
      title: 'Summary unavailable',
      message: 'Audio was created but summary failed.',
      actionLabel: 'Retry summary',
      technicalDetails,
    };
  }

  if (normalized.includes('audio') || normalized.includes('ljud') || normalized.includes('playback') || normalized.includes('wav')) {
    return {
      code: 'AUDIO_FAILED',
      title: 'Playback interrupted',
      message: status === 400 ? 'Try shorter text or remove unusual characters.' : 'Resume from where you left off.',
      actionLabel: 'Retry',
      technicalDetails,
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'Something unexpected happened',
    message: 'Try again.',
    actionLabel: 'Retry',
    technicalDetails,
  };
};

const isAiLimitError = (error: unknown) => {
  const technicalDetails = stringifyTechnicalError(error).toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  const normalized = `${message} ${technicalDetails}`;
  const status = error instanceof Error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;

  return status === 402 ||
    status === 429 ||
    normalized.includes('resource_exhausted') ||
    normalized.includes('quota') ||
    normalized.includes('free tier limit') ||
    normalized.includes('generate_content_free_tier_requests') ||
    normalized.includes('ai limit reached') ||
    normalized.includes('tts free tier');
};

const formatTemplate = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{${key}}`).join(String(value)),
    template
  );

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
const MAX_NOTES_SOURCE_CHARACTERS = 30000;
const MAX_NOTE_SUMMARY_CHARACTERS = 1800;
const MAX_NOTE_SECTION_BULLETS = 8;
const MAX_NOTE_SECTIONS = 5;
const MAX_SUMMARY_AUDIO_CHARACTERS = 2600;
const MAX_SUMMARY_AUDIO_BULLETS = 12;
const LIVE_GENERATION_MIN_READY_CHUNKS = 2;
const LIVE_GENERATION_EARLY_START_CHARACTERS = 900;
const IMPORT_STREAM_FLUSH_CHARACTERS = 80;
const IMPORT_TEXT_CACHE_VERSION = 1;
const TTS_CONTENT_CACHE_VERSION = 1;
const SUMMARY_CONTENT_CACHE_VERSION = 1;
const TRANSLATION_CACHE_VERSION = 1;
const LEGACY_LIBRARY_STORAGE_KEY = 'voxpod_library';
const GUEST_LIBRARY_STORAGE_KEY = 'voxpod_library_guest';
const USER_LIBRARY_STORAGE_KEY_PREFIX = 'voxpod_library_user:';
const AI_USAGE_STORAGE_KEY_PREFIX = 'voxpod_ai_usage_user:';
const GUEST_AI_USAGE_STORAGE_KEY = 'voxpod_ai_usage_guest';
const USER_LANGUAGE_STORAGE_KEY = 'voxpod_ui_language';
const SPEECH_CLEANUP_STORAGE_KEY = 'voxpod_speech_cleanup';
const INPUT_TEXT_STORAGE_KEY = 'voxpod_input_text';
const LIBRARY_PERSIST_DELAY_MS = 180;
const CLOUD_UPLOAD_TIMEOUT_MS = 90_000;
const AUDIO_SAMPLE_RATE = 24000;
const ESTIMATED_CHARACTERS_PER_SECOND = 14;
const MAX_PODCAST_EPISODE_SECONDS = 60 * 60;
const MAX_PODCAST_EPISODE_CHARACTERS = MAX_PODCAST_EPISODE_SECONDS * ESTIMATED_CHARACTERS_PER_SECOND;
const PUBLIC_DEMO_MAX_SECONDS = 2 * 60;
const PUBLIC_DEMO_MAX_CHARACTERS = PUBLIC_DEMO_MAX_SECONDS * ESTIMATED_CHARACTERS_PER_SECOND;
const PUBLIC_DEMO_DEVICE_ID_KEY = 'voxpod_public_demo_device_id';
const CHUNK_POLL_INTERVAL_MS = 180;
const CHUNK_LOAD_TIMEOUT_MS = 45_000;
const CHUNK_GENERATION_LOAD_TIMEOUT_MS = 180_000;
const CHUNK_PLAY_RETRY_DELAY_MS = 260;
const MAX_CHUNK_PLAY_ATTEMPTS = 3;
const PLAYBACK_STALL_TIMEOUT_MS = 12_000;
const IMAGE_IMPORT_MAX_DIMENSION = 1800;
const IMAGE_IMPORT_COMPRESSED_MIME = 'image/jpeg';
const IMAGE_IMPORT_COMPRESSED_QUALITY = 0.82;
const IMAGE_IMPORT_COMPRESS_THRESHOLD_BYTES = 1_100_000;
const CAMERA_CAPTURE_FILENAME_PREFIX = 'voxpod-camera';

const LAYOUT_PRESET: LayoutPreset = {
  shellClassName: 'min-h-[100dvh] overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(119,99,190,0.26),_transparent_30%),radial-gradient(circle_at_bottom,_rgba(57,27,166,0.16),_transparent_38%),linear-gradient(180deg,#1f0f5d_0%,#30168c_48%,#4a2fa4_100%)] font-sans text-slate-50 antialiased',
  headerClassName: 'sticky top-0 z-30 bg-[linear-gradient(180deg,rgba(32,15,93,0.88),rgba(48,22,140,0.58)_62%,transparent)] backdrop-blur-sm',
  headerInnerClassName: 'mx-auto flex w-full max-w-[430px] items-center gap-4 px-4 py-2 md:max-w-[860px] md:px-5 md:py-2.5 lg:max-w-6xl lg:px-6',
  brandClassName: 'text-slate-50',
  subtitleClassName: 'text-[#d9d0ef]',
  statChipClassName: 'rounded-full border border-[#d8d0ed]/88 bg-[#f2f2f2]/92 px-4 py-2 text-[11px] font-black text-[#4d3d93] shadow-[0_18px_45px_-30px_rgba(32,15,93,0.34)] backdrop-blur',
  mainClassName: 'mx-auto grid w-full max-w-[430px] gap-3 px-4 pb-6 md:max-w-[860px] md:grid-cols-[minmax(0,1fr)_280px] md:gap-4 md:px-5 lg:max-w-6xl lg:grid-cols-[minmax(0,1.12fr)_380px] lg:gap-5 lg:px-6 xl:grid-cols-[minmax(0,1.16fr)_420px]',
  heroClassName: 'relative overflow-hidden rounded-[2.2rem] bg-transparent text-zinc-950 md:col-span-2',
  heroGlowClassName: 'absolute inset-0 z-[1] bg-[radial-gradient(circle_at_top_right,rgba(242,242,242,0.16),transparent_28%),linear-gradient(180deg,rgba(119,99,190,0.08),transparent_42%)]',
  heroGridClassName: 'relative flex min-h-[230px] items-end p-4 sm:min-h-[270px] sm:p-5 md:min-h-[310px] md:p-6 lg:min-h-[340px]',
  heroMetricCardClassName: 'rounded-[1.65rem] border border-[#d8d0ed]/88 bg-[rgba(242,242,242,0.16)] p-4 backdrop-blur',
  panelClassName: 'rounded-[2rem] border border-[#d8d0ed]/90 bg-[linear-gradient(180deg,rgba(242,242,242,0.98),rgba(229,223,245,0.96))] shadow-[0_24px_64px_-42px_rgba(32,15,93,0.42)] backdrop-blur-xl',
  playerShellClassName: 'pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-4 rounded-t-[3.2rem] border-t border-[#d8d0ed]/90 bg-[linear-gradient(180deg,rgba(242,242,242,0.98),rgba(229,223,245,0.97))] p-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] shadow-[0_-22px_54px_-22px_rgba(32,15,93,0.42)] backdrop-blur-2xl animate-in slide-in-from-bottom-full duration-700 ease-out md:bottom-4 md:left-1/2 md:right-auto md:w-[min(860px,calc(100vw-1.5rem))] md:-translate-x-1/2 md:rounded-[2.4rem] md:border lg:bottom-5 lg:w-[min(1180px,calc(100vw-2rem))] lg:rounded-[2.6rem]',
};

const getScopedLibraryStorageKey = (userId?: string | null) =>
  userId ? `${USER_LIBRARY_STORAGE_KEY_PREFIX}${userId}` : GUEST_LIBRARY_STORAGE_KEY;

type AiUsageKind = 'tts' | 'summary' | 'translate' | 'ocr' | 'web';

type AiUsageEntry = {
  id: string;
  kind: AiUsageKind;
  inputTokens: number;
  outputTokens: number;
  audioSeconds?: number;
  model: string;
  createdAt: number;
};

type AiUsageState = {
  monthKey: string;
  monthlyBudgetTokens: number;
  entries: AiUsageEntry[];
};

type PodcastGenerationPreview = {
  episodeTexts: string[];
  durationSeconds: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
};

type AiUsageStatus = 'green' | 'orange' | 'red' | 'empty';

const AI_USAGE_MONTHLY_BUDGET_TOKENS = 1_000_000;
const ESTIMATED_TOKENS_PER_PODCAST = 52_000;
const ESTIMATED_TOKENS_PER_SUMMARY = 12_000;
const ESTIMATED_AUDIO_TOKENS_PER_SECOND = 18;
const AI_USAGE_HISTORY_LIMIT = 240;

const getCurrentAiUsageMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const createEmptyAiUsageState = (): AiUsageState => ({
  monthKey: getCurrentAiUsageMonthKey(),
  monthlyBudgetTokens: AI_USAGE_MONTHLY_BUDGET_TOKENS,
  entries: [],
});

const getScopedAiUsageStorageKey = (userId?: string | null) =>
  userId ? `${AI_USAGE_STORAGE_KEY_PREFIX}${userId}` : GUEST_AI_USAGE_STORAGE_KEY;

const normalizeAiUsageState = (candidate: Partial<AiUsageState> | null | undefined): AiUsageState => {
  const monthKey = getCurrentAiUsageMonthKey();
  if (!candidate || candidate.monthKey !== monthKey) {
    return createEmptyAiUsageState();
  }

  return {
    monthKey,
    monthlyBudgetTokens: typeof candidate.monthlyBudgetTokens === 'number'
      ? Math.max(1, candidate.monthlyBudgetTokens)
      : AI_USAGE_MONTHLY_BUDGET_TOKENS,
    entries: Array.isArray(candidate.entries)
      ? candidate.entries
          .filter((entry): entry is AiUsageEntry =>
            Boolean(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.createdAt === 'number' &&
            typeof entry.inputTokens === 'number' &&
            typeof entry.outputTokens === 'number' &&
            typeof entry.model === 'string'
          )
          .slice(-AI_USAGE_HISTORY_LIMIT)
      : [],
  };
};

const readPersistedAiUsage = (userId?: string | null): AiUsageState => {
  try {
    const value = localStorage.getItem(getScopedAiUsageStorageKey(userId));
    return normalizeAiUsageState(value ? JSON.parse(value) as Partial<AiUsageState> : null);
  } catch (error) {
    console.error('Kunde inte läsa AI-användning', error);
    return createEmptyAiUsageState();
  }
};

const writePersistedAiUsage = (usage: AiUsageState, userId?: string | null) => {
  localStorage.setItem(getScopedAiUsageStorageKey(userId), JSON.stringify(usage));
};

const estimateTextTokens = (text: string) =>
  Math.max(1, Math.ceil(text.trim().length / 4));

const calculateEstimatedUsage = (entries: AiUsageEntry[]) => {
  const inputTokens = entries.reduce((total, entry) => total + entry.inputTokens, 0);
  const outputTokens = entries.reduce((total, entry) => total + entry.outputTokens, 0);
  const audioSeconds = entries.reduce((total, entry) => total + (entry.audioSeconds ?? 0), 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    audioSeconds,
  };
};

const estimateRemainingPodcasts = (remainingTokens: number) =>
  Math.max(0, Math.floor(remainingTokens / ESTIMATED_TOKENS_PER_PODCAST));

const formatTokenDisplay = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));

const formatUsdCost = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(Math.max(0, value));

const appendGenerationCost = (
  current: EpisodeGenerationCost | undefined,
  usage: GeminiGenerationUsage | undefined
): EpisodeGenerationCost | undefined => {
  if (!usage) return current;

  return {
    provider: usage.provider,
    model: usage.model,
    currency: 'USD',
    inputTokens: (current?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + usage.outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + usage.totalTokens,
    inputCostUsd: (current?.inputCostUsd ?? 0) + usage.inputCostUsd,
    outputCostUsd: (current?.outputCostUsd ?? 0) + usage.outputCostUsd,
    totalCostUsd: (current?.totalCostUsd ?? 0) + usage.totalCostUsd,
    billableRequests: (current?.billableRequests ?? 0) + 1,
    inputUsdPerMillionTokens: usage.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: usage.outputUsdPerMillionTokens,
    updatedAt: usage.recordedAt,
  };
};

const formatCompactDateTime = (timestamp?: number) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(timestamp))
    : 'Not updated yet';

const showUsageStatus = (remainingPercent: number): AiUsageStatus => {
  if (remainingPercent <= 0) return 'empty';
  if (remainingPercent <= 15) return 'red';
  if (remainingPercent <= 40) return 'orange';
  return 'green';
};

const getUsageStatusMessage = (remainingPercent: number) => {
  if (remainingPercent > 70) return 'You have plenty of AI available.';
  if (remainingPercent > 40) return 'Usage is healthy.';
  if (remainingPercent > 15) return 'Consider shorter podcasts.';
  if (remainingPercent > 0) return "You're running low. Optimize or upgrade.";
  return "You've reached your AI limit.";
};

const buildAiUsageSummary = (usage: AiUsageState) => {
  const totals = calculateEstimatedUsage(usage.entries);
  const remainingTokens = Math.max(0, usage.monthlyBudgetTokens - totals.totalTokens);
  const remainingPercent = Math.max(0, Math.min(100, Math.round((remainingTokens / usage.monthlyBudgetTokens) * 100)));
  const status = showUsageStatus(remainingPercent);
  const lastEntry = usage.entries.length > 0 ? usage.entries[usage.entries.length - 1] : null;

  return {
    ...totals,
    remainingTokens,
    remainingPercent,
    status,
    message: getUsageStatusMessage(remainingPercent),
    estimatedPodcastsLeft: estimateRemainingPodcasts(remainingTokens),
    estimatedSummariesLeft: Math.max(0, Math.floor(remainingTokens / ESTIMATED_TOKENS_PER_SUMMARY)),
    estimatedAudioMinutesLeft: Math.max(0, Math.floor((remainingTokens / ESTIMATED_AUDIO_TOKENS_PER_SECOND) / 60)),
    currentModel: lastEntry?.model ?? 'Gemini Flash',
    lastUpdate: lastEntry?.createdAt,
  };
};

const parsePersistedLibrary = (value: string | null) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PodcastEpisode[] : [];
  } catch (error) {
    console.error('Kunde inte läsa sparat bibliotek', error);
    return [];
  }
};

const readPersistedLibrary = (userId?: string | null) => {
  const scopedKey = getScopedLibraryStorageKey(userId);
  const scopedValue = localStorage.getItem(scopedKey);
  if (scopedValue !== null) {
    return parsePersistedLibrary(scopedValue);
  }

  if (userId) {
    return [];
  }

  const legacyValue = localStorage.getItem(LEGACY_LIBRARY_STORAGE_KEY);
  const legacyLibrary = parsePersistedLibrary(legacyValue);
  if (legacyValue !== null) {
    localStorage.setItem(GUEST_LIBRARY_STORAGE_KEY, JSON.stringify(legacyLibrary));
    localStorage.removeItem(LEGACY_LIBRARY_STORAGE_KEY);
  }

  return legacyLibrary;
};

const writePersistedLibrary = (episodes: PodcastEpisode[], userId?: string | null) => {
  localStorage.setItem(getScopedLibraryStorageKey(userId), JSON.stringify(episodes));

  if (!userId) {
    localStorage.removeItem(LEGACY_LIBRARY_STORAGE_KEY);
  }
};

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

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const waitForBrowserOnline = async () => {
  if (typeof navigator === 'undefined' || navigator.onLine) {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleOnline = () => {
      window.removeEventListener('online', handleOnline);
      resolve();
    };

    window.addEventListener('online', handleOnline, { once: true });
  });
};

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

const getReadyChunkCount = (episode: PodcastEpisode) =>
  typeof episode.readyChunkCount === 'number' ? episode.readyChunkCount : episode.chunkCount;

const isEpisodeChunkReady = (episode: PodcastEpisode, chunkIndex: number) =>
  chunkIndex < getReadyChunkCount(episode);

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
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image.'));
    image.src = src;
  });

const scaleDimensionsToFit = (width: number, height: number, maxDimension: number) => {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Could not encode the image.'));
    }, mimeType, quality);
  });

const optimizeImageForImport = async (file: File) => {
  const shouldCompress = file.size >= IMAGE_IMPORT_COMPRESS_THRESHOLD_BYTES || file.type === 'image/heic' || file.type === 'image/heif';
  if (!shouldCompress && file.type === IMAGE_IMPORT_COMPRESSED_MIME) {
    return file;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImageElement(dataUrl);
    const { width, height } = scaleDimensionsToFit(image.naturalWidth, image.naturalHeight, IMAGE_IMPORT_MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, IMAGE_IMPORT_COMPRESSED_MIME, IMAGE_IMPORT_COMPRESSED_QUALITY);

    if (!shouldCompress && blob.size >= file.size) {
      return file;
    }

    const nextName = file.name.replace(/\.[^.]+$/, '.jpg');
    return new File([blob], nextName || `${file.name}.jpg`, {
      type: IMAGE_IMPORT_COMPRESSED_MIME,
      lastModified: file.lastModified || Date.now(),
    });
  } catch (error) {
    console.warn('Could not optimize image before OCR, falling back to original file.', error);
    return file;
  }
};

const estimateSingleImageScanSeconds = (sizeBytes: number) =>
  clamp(Math.ceil(sizeBytes / 550_000) * 3, 3, 18);

const estimateDocumentScanSeconds = (file: File) =>
  isTextDocumentFile(file)
    ? clamp(Math.ceil(file.size / 250_000), 2, 8)
    : estimatePdfScanSeconds(file.size);

const estimateImageBatchScanSeconds = (files: File[]) =>
  clamp(files.reduce((total, file) => total + estimateSingleImageScanSeconds(file.size), 0), 4, 180);

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

const createStableHash = async (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const buildTtsContentCacheKey = async (text: string, voice: VoiceName, languageHint?: string) =>
  `tts-content:${TTS_CONTENT_CACHE_VERSION}:${voice}:${languageHint || 'auto'}:${await createStableHash(text)}`;

const buildSummaryContentCacheKey = async (text: string, userLang: string) =>
  `summary-content:${SUMMARY_CONTENT_CACHE_VERSION}:${userLang}:${await createStableHash(text)}`;

const buildTranslationCacheKey = async (text: string, targetLanguage: string) =>
  `translation:${TRANSLATION_CACHE_VERSION}:${targetLanguage}:${await createStableHash(text)}`;

const estimateWavDurationSeconds = (wavBuffer: ArrayBuffer, sampleRate: number = AUDIO_SAMPLE_RATE) =>
  wavBuffer.byteLength > 44
    ? (wavBuffer.byteLength - 44) / (sampleRate * 2)
    : 0;

const normalizeImportUrl = (value: string) => {
  const parsed = new URL(value.trim());
  parsed.hash = '';
  return parsed.toString();
};

const buildUrlImportCacheKey = (url: string) =>
  [
    'import-url',
    IMPORT_TEXT_CACHE_VERSION,
    normalizeImportUrl(url),
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

const splitLongTextPreservingWords = (text: string, maxChars: number) => {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const parts: string[] = [];
  let currentPart = '';

  for (const word of normalized.split(/\s+/)) {
    if (word.length > maxChars) {
      if (currentPart) {
        parts.push(currentPart);
        currentPart = '';
      }

      for (let index = 0; index < word.length; index += maxChars) {
        const slice = word.slice(index, index + maxChars).trim();
        if (slice) {
          parts.push(slice);
        }
      }
      continue;
    }

    const candidate = currentPart ? `${currentPart} ${word}` : word;
    if (candidate.length > maxChars && currentPart) {
      parts.push(currentPart);
      currentPart = word;
    } else {
      currentPart = candidate;
    }
  }

  if (currentPart) {
    parts.push(currentPart);
  }

  return parts;
};

const NOTES_UI_LABELS = {
  en: {
    title: 'Summary',
    summary: 'Summary',
    personal: 'Your notes',
    highlights: 'Highlights',
    keyPoints: 'Key points',
    details: 'Details'
  },
  es: {
    title: 'Resumen',
    summary: 'Resumen',
    personal: 'Tus notas',
    highlights: 'Aspectos clave',
    keyPoints: 'Puntos clave',
    details: 'Detalles'
  }
} as const;

const PERSONAL_NOTES_HEADINGS = new Set(
  Object.values(NOTES_UI_LABELS).map(labels => labels.personal.toLowerCase())
);

const STUDY_QUESTION_HEADINGS = new Set([
  'study questions',
  'questions',
  'quiz questions',
  'review questions',
  'kontrollfrågor',
  'studiefrågor',
  'frågor',
  'preguntas',
  'preguntas de estudio'
]);

const isStudyQuestionHeading = (heading: string) => {
  const normalized = normalizeInlineText(heading).toLowerCase();
  return STUDY_QUESTION_HEADINGS.has(normalized) || /(?:study|quiz|review).{0,16}questions?/.test(normalized);
};

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

const BULLET_LINE_PATTERN = /^(?:[-*•]\s+|\d+[\).\s-]+)/;

const isBulletLikeLine = (line: string) =>
  BULLET_LINE_PATTERN.test(line);

const looksLikeWrappedHeadingLine = (line: string) => {
  const normalized = normalizeInlineText(line);
  if (!normalized || normalized.length > 90) {
    return false;
  }

  if (isBulletLikeLine(normalized) || /[.!?]$/.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 9) {
    return false;
  }

  if (/[:)]$/.test(normalized)) {
    return true;
  }

  const titleCaseWords = words.filter(word => /^[A-ZÅÄÖÁÀÂÉÈÊÍÌÎÓÒÔÚÙÛÜÑ]/.test(word));
  return titleCaseWords.length >= Math.max(2, Math.ceil(words.length * 0.6));
};

const joinReflowLines = (currentLine: string, nextLine: string) => {
  if (
    /[\p{L}\d]-$/u.test(currentLine) &&
    /^[\p{L}\d]/u.test(nextLine)
  ) {
    return `${currentLine.slice(0, -1)}${nextLine}`;
  }

  return `${currentLine} ${nextLine}`;
};

const shouldJoinReflowLines = (currentLine: string, nextLine: string) => {
  if (!currentLine || !nextLine) {
    return false;
  }

  if (isBulletLikeLine(currentLine) || isBulletLikeLine(nextLine)) {
    return false;
  }

  if (looksLikeWrappedHeadingLine(currentLine) || looksLikeWrappedHeadingLine(nextLine)) {
    return false;
  }

  if (/[.!?]["')\]]?$/.test(currentLine)) {
    return false;
  }

  if (/[:;]["')\]]?$/.test(currentLine)) {
    return /^[a-zåäöáàâéèêíìîóòôúùûüñ(]/i.test(nextLine);
  }

  return true;
};

const reflowProcessedLines = (lines: string[]) => {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  const pushParagraph = () => {
    const normalized = normalizeInlineText(currentParagraph);
    if (normalized) {
      paragraphs.push(normalized);
    }
    currentParagraph = '';
  };

  lines.forEach((line) => {
    const normalizedLine = normalizeInlineText(line);
    if (!normalizedLine) {
      pushParagraph();
      return;
    }

    if (!currentParagraph) {
      currentParagraph = normalizedLine;
      return;
    }

    if (shouldJoinReflowLines(currentParagraph, normalizedLine)) {
      currentParagraph = joinReflowLines(currentParagraph, normalizedLine);
      return;
    }

    pushParagraph();
    currentParagraph = normalizedLine;
  });

  pushParagraph();
  return paragraphs.join('\n\n').trim();
};

const buildReadableSourceText = (text: string) =>
  reflowProcessedLines(
    text
      .split(/\r?\n/)
      .map(normalizeInlineText)
  );

const getOcrLineKey = (value: string) =>
  normalizeInlineText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

const isLikelyOcrPageMarker = (line: string) =>
  /^\d{1,4}$/.test(line) ||
  /^(?:page|sida|sid\.?|p\.?)\s*\d{1,4}\b/i.test(line) ||
  /^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(line);

const isLikelyOcrFragment = (line: string) => {
  const normalized = normalizeInlineText(line);
  if (!normalized) return true;

  const letters = countMatchingCharacters(normalized, /[\p{L}]/gu);
  const digits = countMatchingCharacters(normalized, /\d/g);
  const symbols = normalized.replace(/[\p{L}\d\s]/gu, '').length;
  const words = normalized.split(/\s+/).filter(Boolean);

  if (isLikelyOcrPageMarker(normalized)) return true;
  if (normalized.length <= 2) return true;
  if (words.length === 1 && normalized.length <= 4 && !/[.!?]$/.test(normalized)) return true;
  if (letters === 0 && digits > 0) return true;
  if (letters > 0 && digits + symbols > letters * 1.4 && letters < 12) return true;
  if (normalized.length >= 7 && letters / normalized.length < 0.35) return true;

  return false;
};

const removeRepeatedOcrPhrases = (text: string) =>
  text
    .replace(/\b(.{12,90}?)\s+\1\b/giu, '$1')
    .replace(/([^\n]{20,120})(?:\n\1){1,}/giu, '$1');

const cleanOcrText = (text: string) => {
  const lines = text
    .replace(/\r/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .split('\n')
    .map(normalizeInlineText);

  const lineCounts = new Map<string, number>();
  lines.forEach((line) => {
    const key = getOcrLineKey(line);
    if (key.length >= 4) {
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }
  });

  const seen = new Set<string>();
  const cleanedLines = lines.filter((line) => {
    const key = getOcrLineKey(line);
    if (!key) return false;
    if (isLikelyOcrFragment(line)) return false;
    if ((lineCounts.get(key) ?? 0) >= 3 && line.length <= 90) return false;
    if (seen.has(key) && line.length <= 180) return false;
    seen.add(key);
    return true;
  });

  return removeRepeatedOcrPhrases(cleanedLines.join('\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

type SpeechLanguage = 'Swedish' | 'English' | 'Spanish';

const SWEDISH_SPEECH_HINT_PATTERN = /[åäö]|\b(och|att|det|som|för|med|inte|är|ska|kan|till|från|har|vara|var|blir|blev|den|detta|dessa|också|finns|sker|själv|genom|mellan|under|över|efter|före|många|människor|samhälle|kunskap|exempel|kapitel|fråga|svar)\b/gi;
const ENGLISH_SPEECH_HINT_PATTERN = /\b(the|and|with|from|into|about|that|this|these|those|are|was|were|have|has|lecture|lesson|title|chapter|summary|overview|research|study|learning|introduction|method|results)\b/gi;
const SPANISH_SPEECH_HINT_PATTERN = /[ñáéíóúü]|\b(el|la|los|las|que|con|para|como|del|una|uno|esta|este|estos|estas|más|porque|también|entre|sobre|capítulo|resumen|estudio)\b/gi;
const ENGLISH_TITLE_KEYWORDS = new Set([
  'analysis',
  'chapter',
  'computer',
  'design',
  'english',
  'history',
  'introduction',
  'lecture',
  'learning',
  'machine',
  'methods',
  'model',
  'notes',
  'overview',
  'podcast',
  'research',
  'results',
  'science',
  'society',
  'summary',
  'systems',
  'theory',
  'vision'
]);

const countPatternMatches = (value: string, pattern: RegExp) =>
  value.match(pattern)?.length ?? 0;

const countMatchingCharacters = (value: string, pattern: RegExp) =>
  value.match(pattern)?.length ?? 0;

const detectSpeechLanguage = (text: string, minLead = 2): SpeechLanguage | undefined => {
  const sample = text.slice(0, 5000);
  const swedishScore = countPatternMatches(sample, SWEDISH_SPEECH_HINT_PATTERN) * 2
    + countMatchingCharacters(sample, /[åäö]/gi) * 3;
  const englishScore = countPatternMatches(sample, ENGLISH_SPEECH_HINT_PATTERN) * 2;
  const spanishScore = countPatternMatches(sample, SPANISH_SPEECH_HINT_PATTERN) * 2;

  if (swedishScore >= englishScore + minLead && swedishScore >= spanishScore + minLead) {
    return 'Swedish';
  }

  if (englishScore >= swedishScore + minLead && englishScore >= spanishScore + minLead) {
    return 'English';
  }

  if (spanishScore >= swedishScore + minLead && spanishScore >= englishScore + minLead) {
    return 'Spanish';
  }

  return undefined;
};

const detectPrimarySpeechLanguage = (text: string) => detectSpeechLanguage(text, 2);

const getSpeechLanguageTag = (language: SpeechLanguage) => {
  switch (language) {
    case 'Swedish':
      return 'sv';
    case 'English':
      return 'en';
    case 'Spanish':
      return 'es';
  }
};

const applyPronunciationDictionary = (text: string, language?: SpeechLanguage) => {
  if (language !== 'Swedish') {
    return text;
  }

  return text
    .replace(/\b[Dd]om\b/g, 'de')
    .replace(/\b[Dd]omarna\b/g, 'dommarna')
    .replace(/\b[Dd]omar\b/g, 'dommar')
    .replace(/\b[Dd]omen\b/g, 'dommen');
};

const isLikelyNoiseToken = (token: string) => {
  const cleanedToken = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!cleanedToken) {
    return true;
  }

  const letters = countMatchingCharacters(cleanedToken, /[\p{L}]/gu);
  const digits = countMatchingCharacters(cleanedToken, /\d/g);
  const symbols = Math.max(0, cleanedToken.length - letters - digits);

  if (letters === 0 && digits > 0) {
    return true;
  }

  if (digits >= 2 && digits >= letters) {
    return true;
  }

  if (letters <= 2 && digits + symbols >= 3) {
    return true;
  }

  return cleanedToken.length >= 7 && digits + symbols >= Math.ceil(cleanedToken.length * 0.5);
};

const isLikelyNoiseLine = (line: string) => {
  const normalized = normalizeInlineText(line);
  if (!normalized) return true;

  const letters = countMatchingCharacters(normalized, /[\p{L}]/gu);
  const digits = countMatchingCharacters(normalized, /\d/g);
  const symbols = normalized.replace(/[\p{L}\d\s]/gu, '').length;

  if (letters === 0 && digits > 0) {
    return true;
  }

  if (letters > 0) {
    return digits + symbols > letters * 1.5 && letters < 8;
  }

  return digits + symbols > 0;
};

const stripNoiseFromSpeechLine = (line: string) => {
  if (isLikelyNoiseLine(line)) {
    return '';
  }

  const filtered = line
    .split(/\s+/)
    .filter(token => !isLikelyNoiseToken(token))
    .join(' ');

  return normalizeInlineText(
    filtered
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([([{])\s+/g, '$1')
  );
};

const normalizeTextForTTS = (text: string, language?: SpeechLanguage) => {
  let normalized = text
    .replace(/\b([A-ZÅÄÖ])\s+(?=[A-ZÅÄÖ]\b)/g, '$1')
    .replace(/\b0CR\b/gi, 'OCR')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

	  if (language === 'Swedish') {
	    normalized = normalized
	      .replace(/\boch\/eller\b/gi, 'och eller')
	      .replace(/\bt\.ex\./gi, 'till exempel')
	      .replace(/\bdvs\./gi, 'det vill säga')
	      .replace(/\bbl\.a\./gi, 'bland annat')
	      .replace(/\bm\.m\./gi, 'med mera');
	  }

	  return applyPronunciationDictionary(normalized, language);
	};

const buildSpeechSourceText = (text: string, stripNoise: boolean) => {
  const normalizedLines = text
    .split(/\r?\n/)
    .map(line => stripNoise ? stripNoiseFromSpeechLine(line) : normalizeInlineText(line));

  return reflowProcessedLines(normalizedLines);
};

const looksLikeEnglishTitleLine = (line: string) => {
  const normalized = normalizeInlineText(line);
  if (!normalized || normalized.length > 90 || /[åäö]/i.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) {
    return false;
  }

  const englishScore = countPatternMatches(normalized, ENGLISH_SPEECH_HINT_PATTERN);
  if (englishScore >= 1) {
    return true;
  }

  const keywordHits = words.filter(word => ENGLISH_TITLE_KEYWORDS.has(word.toLowerCase())).length;
	  return keywordHits >= 2;
	};

const tagSpeechTextForPronunciation = (text: string, primaryLanguage?: SpeechLanguage) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return '';
      }

      if (primaryLanguage === 'Swedish' && looksLikeEnglishTitleLine(trimmedLine)) {
        return `<en>${normalizeTextForTTS(trimmedLine, 'English')}</en>`;
      }

      const lineLanguage = detectSpeechLanguage(trimmedLine, 1) ?? primaryLanguage;
      const normalizedLine = normalizeTextForTTS(trimmedLine, lineLanguage);
      if (!lineLanguage) {
        return normalizedLine;
      }

      const tag = getSpeechLanguageTag(lineLanguage);
      return `<${tag}>${normalizedLine}</${tag}>`;
    })
    .join('\n')
    .trim();

const buildSpeechRequestText = (text: string, stripNoise: boolean) => {
  const sourceText = buildSpeechSourceText(text, stripNoise);
  const languageHint = detectPrimarySpeechLanguage(sourceText);
  const speechText = tagSpeechTextForPronunciation(sourceText, languageHint);

  return {
    sourceText,
    speechText,
    languageHint,
  };
};

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
  'i', 'if', 'in', 'into', 'is', 'it', 'kan', 'med', 'men', 'not', 'och', 'om', 'on', 'or', 'para', 'por', 'på',
  'que', 'se', 'sin', 'så', 'som', 'su', 'sus', 'that', 'the', 'their', 'them', 'there', 'this', 'till', 'to',
  'una', 'uno', 'unos', 'unas', 'var', 'vi',
  'was', 'were', 'what', 'which', 'with'
]);

const tokenizeSummaryWords = (value: string) =>
  value
    .toLowerCase()
    .match(/[a-z0-9à-öø-ÿ]+/gi)
    ?.filter(word => word.length > 3 && !SUMMARY_STOP_WORDS.has(word)) ?? [];

const collectTextSentences = (text: string) =>
  buildReadableSourceText(text)
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

const uniqueNoteBullets = (values: string[], limit: number) =>
  Array.from(new Set(values.map(finalizeNoteBullet).filter(Boolean))).slice(0, limit);

const sanitizeNoteSectionHeading = (value: string, fallbackHeading: string) => {
  const heading = truncateText(value, 42) || fallbackHeading;
  return /^(section|sektion|del|part|punktlista|lista)\b/i.test(heading)
    ? fallbackHeading
    : heading;
};

const buildSummaryFallbackCore = (
  text: string,
  userLang: string,
  titleOverride?: string
): EpisodeNotes => {
  const labels = getNotesLabels(userLang);
  const readableText = buildReadableSourceText(cleanOcrText(text));
  const firstLine = titleOverride
    || readableText
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    || labels.title;
  const rankedSentences = selectSummarySentences(readableText, 12);
  const summarySentences = rankedSentences.slice(0, 6);
  const highlightBullets = uniqueNoteBullets(rankedSentences.slice(0, 4), MAX_NOTE_SECTION_BULLETS);
  const keyPointBullets = uniqueNoteBullets(rankedSentences.slice(4, 8), MAX_NOTE_SECTION_BULLETS);
  const detailBullets = uniqueNoteBullets(
    rankedSentences.slice(8).concat(collectTextSentences(readableText).slice(0, 6)),
    MAX_NOTE_SECTION_BULLETS
  );
  const summary = truncateText(summarySentences.join(' '), MAX_NOTE_SUMMARY_CHARACTERS)
    || truncateText(readableText, MAX_NOTE_SUMMARY_CHARACTERS)
    || labels.summary;

  return {
    title: truncateText(firstLine, 70) || labels.title,
    summary,
    sections: [
      {
        heading: labels.highlights,
        bullets: highlightBullets.length > 0 ? highlightBullets : [finalizeNoteBullet(summary) || summary]
      },
      ...(keyPointBullets.length > 0
        ? [{
            heading: labels.keyPoints,
            bullets: keyPointBullets,
          }]
        : []),
      ...(detailBullets.length > 0
        ? [{
            heading: labels.details,
            bullets: detailBullets,
          }]
        : [])
    ].slice(0, MAX_NOTE_SECTIONS)
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
  const fallback = buildSummaryFallbackCore(sourceText, userLang, notes.title);
  const personalSection = extractPersonalNotesSection(notes.sections, userLang);
  const seenBullets = new Set<string>();
  const mainSections = notes.sections
    .filter(section => !PERSONAL_NOTES_HEADINGS.has(normalizeInlineText(section.heading).toLowerCase()))
    .filter(section => !isStudyQuestionHeading(section.heading))
    .map((section, index) => {
      const fallbackHeading = fallback.sections[index]?.heading
        ?? (index === 0 ? getNotesLabels(userLang).highlights : getNotesLabels(userLang).details);
      const bullets = section.bullets
        .map(finalizeNoteBullet)
        .filter(Boolean)
        .filter((bullet) => {
          if (seenBullets.has(bullet)) {
            return false;
          }

          seenBullets.add(bullet);
          return true;
        })
        .slice(0, MAX_NOTE_SECTION_BULLETS);

      if (bullets.length === 0) {
        return null;
      }

      return {
        heading: sanitizeNoteSectionHeading(section.heading, fallbackHeading),
        bullets,
      };
    })
    .filter((section): section is EpisodeNotes['sections'][number] => Boolean(section))
    .slice(0, MAX_NOTE_SECTIONS);

  return {
    title: truncateText(notes.title || fallback.title, 70) || fallback.title,
    summary: truncateText(notes.summary || fallback.summary, MAX_NOTE_SUMMARY_CHARACTERS) || fallback.summary,
    sections: [
      ...(mainSections.length > 0 ? mainSections : fallback.sections),
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
  const trimmed = buildReadableSourceText(cleanOcrText(text));
  if (trimmed.length <= MAX_NOTES_SOURCE_CHARACTERS) {
    return trimmed;
  }

  const segmentLength = Math.max(2600, Math.floor(MAX_NOTES_SOURCE_CHARACTERS / 3));
  const head = trimmed.slice(0, segmentLength).trim();
  const middleStart = Math.max(0, Math.floor((trimmed.length - segmentLength) / 2));
  const middle = trimmed.slice(middleStart, middleStart + segmentLength).trim();
  const tail = trimmed.slice(-segmentLength).trim();

  return [head, middle, tail]
    .filter(Boolean)
    .join('\n\n[...]\n\n');
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

const normalizeCategoryKey = (value: string) =>
  normalizeCategoryName(value).toLocaleLowerCase();

const parseCategoryInput = (value: string) => {
  const uniqueCategories = new Map<string, string>();

  value
    .split(',')
    .map(normalizeCategoryName)
    .filter(Boolean)
    .forEach((category) => {
      const key = normalizeCategoryKey(category);
      if (!uniqueCategories.has(key)) {
        uniqueCategories.set(key, category);
      }
    });

  return Array.from(uniqueCategories.values()).slice(0, 8);
};

const getEpisodeCategories = (episode: PodcastEpisode) =>
  parseCategoryInput((episode.categories ?? []).join(', '));

const collectLibraryCategories = (episodes: PodcastEpisode[]) => {
  const uniqueCategories = new Map<string, string>();

  episodes.forEach((episode) => {
    getEpisodeCategories(episode).forEach((category) => {
      const key = normalizeCategoryKey(category);
      if (!uniqueCategories.has(key)) {
        uniqueCategories.set(key, category);
      }
    });
  });

  return Array.from(uniqueCategories.values()).sort((a, b) => imageNameCollator.compare(a, b));
};

const episodeMatchesCategory = (episode: PodcastEpisode, category: string) => {
  const targetKey = normalizeCategoryKey(category);
  return getEpisodeCategories(episode).some((candidate) => normalizeCategoryKey(candidate) === targetKey);
};

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
    return userLang === 'es'
      ? 'Correo o contraseña incorrectos.'
      : 'Incorrect email or password.';
  }

  if (normalized.includes('email not confirmed')) {
    return userLang === 'es'
      ? 'Confirma tu dirección de correo antes de iniciar sesión.'
      : 'Confirm your email address before signing in.';
  }

  if (normalized.includes('user already registered')) {
    return userLang === 'es'
      ? 'Ya existe una cuenta con este correo.'
      : 'An account with this email already exists.';
  }

  if (normalized.includes('password should be at least')) {
    return userLang === 'es'
      ? 'La contraseña debe tener al menos 6 caracteres.'
      : 'Password must be at least 6 characters.';
  }

  return message;
};

const normalizeCloudSyncErrorMessage = (error: unknown, userLang: SupportedLanguage) => {
  if (isMissingCloudSchemaError(error)) {
    return userLang === 'es'
      ? 'Faltan la tabla de Supabase y las reglas RLS. Ejecuta el archivo supabase/voxpod_cloud_sync.sql en el editor SQL de Supabase.'
      : 'The Supabase table and RLS rules are missing. Run supabase/voxpod_cloud_sync.sql in the Supabase SQL Editor.';
  }

  if (isCloudPermissionError(error)) {
    return userLang === 'es'
      ? 'Supabase está bloqueando el acceso. Asegúrate de que el bucket Audio sea privado y de que las políticas RLS del archivo SQL estén activas.'
      : 'Supabase is blocking access. Make sure the Audio bucket is private and the SQL file RLS policies are active.';
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return message || (userLang === 'es' ? 'La sincronización en la nube falló.' : 'Cloud sync failed.');
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
    return '';
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

class ChunkLoadError extends Error {
  markEpisodeFailed: boolean;

  constructor(message: string, markEpisodeFailed: boolean) {
    super(message);
    this.name = 'ChunkLoadError';
    this.markEpisodeFailed = markEpisodeFailed;
  }
}

const App: React.FC = () => {
  const [userLang, setUserLang] = useState<SupportedLanguage>(() => {
    if (typeof window === 'undefined') {
      return 'en';
    }

    return window.localStorage.getItem(USER_LANGUAGE_STORAGE_KEY) === 'es' ? 'es' : 'en';
  });
  const t = (key: TranslationKey) => TRANSLATIONS[userLang][key];
  const [library, setLibrary] = useState<PodcastEpisode[]>([]);
  const [inputText, setInputText] = useState(() => localStorage.getItem(INPUT_TEXT_STORAGE_KEY) || '');
  const inputNotes = '';
  const [selectedVoice, setSelectedVoice] = useState<string>(PREMIUM_VOICES[0].name);
  const [playbackRate, setRate] = useState(1.0);
  const [useSpeechCleanup, setUseSpeechCleanup] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(SPEECH_CLEANUP_STORAGE_KEY) === '1';
  });
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [isDeletingEpisodeId, setIsDeletingEpisodeId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [scanSource, setScanSource] = useState<ImportSource | null>(null);
  const [isLoadingChunk, setIsLoadingChunk] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showUsagePanel, setShowUsagePanel] = useState(false);
  const [showUsageDetails, setShowUsageDetails] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState<PodcastEpisode | null>(null);
  const [summaryGenerationEpisodeId, setSummaryGenerationEpisodeId] = useState<string | null>(null);
  const [pendingDeleteEpisode, setPendingDeleteEpisode] = useState<PodcastEpisode | null>(null);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryTitleDraft, setSummaryTitleDraft] = useState('');
  const [summaryBodyDraft, setSummaryBodyDraft] = useState('');
  const [showSpeedControls, setShowSpeedControls] = useState(false);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [episodeTitleDraft, setEpisodeTitleDraft] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [episodeTextDraft, setEpisodeTextDraft] = useState('');
  const [episodeEditorTab, setEpisodeEditorTab] = useState<'details' | 'text'>('details');
  const [linkImportUrl, setLinkImportUrl] = useState('');
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('newest');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signIn');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback | null>(null);
  const [cloudFeedback, setCloudFeedback] = useState<AuthFeedback | null>(
    isSupabaseConfigured
      ? {
          kind: 'info',
          message: t('cloud_status_signed_out'),
        }
      : null
  );
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(!isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [appError, setAppError] = useState<ClassifiedAppError | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageState>(() => readPersistedAiUsage(null));
  const [playerInset, setPlayerInset] = useState(0);
  const [isPlayerCollapsed, setIsPlayerCollapsed] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [cameraShots, setCameraShots] = useState<CameraShot[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraBooting, setIsCameraBooting] = useState(false);
  const [isCameraImporting, setIsCameraImporting] = useState(false);
  const [currentRoutePath, setCurrentRoutePath] = useState(getCurrentRoutePath);
  const [pendingGenerationPreview, setPendingGenerationPreview] = useState<PodcastGenerationPreview | null>(null);
  const [demoText, setDemoText] = useState('');
  const [demoTurnstileSiteKey, setDemoTurnstileSiteKey] = useState('');
  const [demoTurnstileToken, setDemoTurnstileToken] = useState('');
  const [demoError, setDemoError] = useState<string | null>(null);
  const [isGeneratingDemo, setIsGeneratingDemo] = useState(false);
  const [demoAudioUrl, setDemoAudioUrl] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraShotsRef = useRef<CameraShot[]>([]);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const voiceMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const usagePanelRef = useRef<HTMLDivElement>(null);
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
  const languageToggleTarget = userLang === 'en' ? 'es' : 'en';
  const languageToggleFlag = languageToggleTarget === 'es' ? '🇪🇸' : '🇬🇧';
  const languageToggleLabel = languageToggleTarget === 'es'
    ? t('language_toggle_to_spanish')
    : t('language_toggle_to_english');

  // Cache for pre-loaded chunks to prevent gaps
  const chunkCache = useRef<Map<string, ArrayBuffer>>(new Map());
  const summaryChunkCache = useRef<Map<string, ArrayBuffer>>(new Map());
  const summaryGenerationRequestsRef = useRef<Map<string, Promise<PodcastEpisode | null>>>(new Map());
  const summaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const summaryBlobUrlRef = useRef<string | null>(null);
  const summaryRequestRef = useRef(0);
  const libraryRef = useRef<PodcastEpisode[]>([]);
  const playerRef = useRef<PlayerState | null>(null);
  const isLoadingChunkRef = useRef(false);
  const isSwitchingChunkRef = useRef(false);
  const chunkSwitchTimeoutRef = useRef<number | null>(null);
  const libraryPersistTimeoutRef = useRef<number | null>(null);
  const cloudSyncTimeoutRef = useRef<number | null>(null);
  const cloudUploadRunRef = useRef(0);
  const pendingCloudUploadsRef = useRef(0);
  const hasHydratedLibraryRef = useRef(false);
  const importSessionRef = useRef<ImportSessionState | null>(null);
  const liveGenerationRef = useRef<LiveGenerationState | null>(null);
  const liveGenerationPumpRef = useRef(false);
  const intendedRouteRef = useRef(DEFAULT_AUTHENTICATED_PATH);
  const demoTurnstileContainerRef = useRef<HTMLDivElement>(null);
  const demoTurnstileWidgetIdRef = useRef<string | null>(null);

  const [player, setPlayer] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    activeEpisode: null,
    currentChunkIndex: 0
  });

	  useEffect(() => {
	    playerRef.current = player;
	  }, [player]);

  useEffect(() => () => {
    if (demoAudioUrl) {
      URL.revokeObjectURL(demoAudioUrl);
    }
  }, [demoAudioUrl]);

  useEffect(() => {
    if (authUser || !isAuthReady) {
      return;
    }
    void fetchPublicDemoConfiguration()
      .then((configuration) => setDemoTurnstileSiteKey(configuration.turnstileSiteKey || ''))
      .catch(() => setDemoTurnstileSiteKey(''));
  }, [authUser, isAuthReady]);

  useEffect(() => {
    if (authUser || !isAuthReady || !demoTurnstileSiteKey || !demoTurnstileContainerRef.current) {
      return;
    }

    let cancelled = false;
    const renderWidget = () => {
      if (cancelled || !window.turnstile || !demoTurnstileContainerRef.current || demoTurnstileWidgetIdRef.current) {
        return;
      }
      demoTurnstileWidgetIdRef.current = window.turnstile.render(demoTurnstileContainerRef.current, {
        sitekey: demoTurnstileSiteKey,
        theme: 'light',
        callback: setDemoTurnstileToken,
        'expired-callback': () => setDemoTurnstileToken(''),
        'error-callback': () => setDemoTurnstileToken(''),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-voxpod-turnstile]');
    if (existingScript) {
      if (window.turnstile) {
        renderWidget();
      } else {
        existingScript.addEventListener('load', renderWidget, { once: true });
      }
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.voxpodTurnstile = 'true';
      script.addEventListener('load', renderWidget, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (demoTurnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(demoTurnstileWidgetIdRef.current);
        demoTurnstileWidgetIdRef.current = null;
      }
    };
  }, [authUser, isAuthReady, demoTurnstileSiteKey]);

	  useEffect(() => {
	    setAiUsage(readPersistedAiUsage(authUser?.id ?? null));
	    setShowUsagePanel(false);
	    setShowUsageDetails(false);
	  }, [authUser?.id]);

	  useEffect(() => {
	    writePersistedAiUsage(aiUsage, authUser?.id ?? null);
	  }, [aiUsage, authUser?.id]);

  useEffect(() => {
    isLoadingChunkRef.current = isLoadingChunk;
  }, [isLoadingChunk]);

  const navigateToAuthRoute = (path: string) => {
    pushRoute(path);
    setCurrentRoutePath(getCurrentRoutePath());
  };

  const replaceWithRoute = (path: string) => {
    replaceRoute(path);
    setCurrentRoutePath(getCurrentRoutePath());
  };

  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const revokeCameraShotPreviews = (shots: CameraShot[]) => {
    shots.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
  };

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
      setShowSortMenu(false);
    }
  }, [player.activeEpisode?.id]);

  useEffect(() => {
    if (isPlayerCollapsed) {
      setShowSpeedControls(false);
    }
  }, [isPlayerCollapsed]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoutePath(getCurrentRoutePath());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (currentRoutePath === SIGNUP_PATH) {
      setAuthMode('signUp');
    } else if (currentRoutePath === LOGIN_PATH) {
      setAuthMode('signIn');
    }
  }, [currentRoutePath]);

  useEffect(() => {
    if (!isAuthReady) return;

    if (!authUser) {
      if (!isPublicAuthPath(currentRoutePath)) {
        const intendedRoute = getCurrentRouteWithSearch();
        intendedRouteRef.current = intendedRoute;
        replaceWithRoute(`${LOGIN_PATH}?redirect=${encodeURIComponent(intendedRoute)}`);
        return;
      }

      const redirect = getRedirectParam();
      if (redirect) {
        intendedRouteRef.current = redirect;
      }
      setShowAuthPanel(false);
      return;
    }

    if (isPublicAuthPath(currentRoutePath)) {
      const redirect = getRedirectParam() ?? intendedRouteRef.current ?? DEFAULT_AUTHENTICATED_PATH;
      replaceWithRoute(redirect);
    }
  }, [authUser, currentRoutePath, isAuthReady]);

  useEffect(() => {
    if (!supabase) {
      setIsAuthReady(true);
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
        setIsAuthReady(true);
        return;
      }

      setAuthSession(data.session);
      setAuthUser(data.session?.user ?? null);
      setIsAuthReady(true);
    };

    void bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setAuthSession(session);
      setAuthUser(session?.user ?? null);
      setIsAuthReady(true);
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

      if (voiceMenuRef.current && !voiceMenuRef.current.contains(event.target as Node)) {
        setShowVoiceMenu(false);
      }

	      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
	        setShowSortMenu(false);
	      }

	      if (usagePanelRef.current && !usagePanelRef.current.contains(event.target as Node)) {
	        setShowUsagePanel(false);
	      }
	    };
	    if (showLangMenu || showVoiceMenu || showSortMenu || showUsagePanel) {
	      document.addEventListener('mousedown', handleClickOutside);
	    }
	    return () => document.removeEventListener('mousedown', handleClickOutside);
	  }, [showLangMenu, showVoiceMenu, showSortMenu, showUsagePanel]);

  // Focus the menu when it opens to enable keyboard shortcuts
  useEffect(() => {
    if (showLangMenu && langMenuRef.current) {
      const timer = setTimeout(() => {
        langMenuRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showLangMenu]);

  useEffect(() => {
    const notes = normalizeEpisodeNotes(showNotesModal?.notes, userLang);
    if (!showNotesModal || !notes) {
      setIsEditingSummary(false);
      setSummaryTitleDraft('');
      setSummaryBodyDraft('');
      return;
    }

    setIsEditingSummary(false);
    setSummaryTitleDraft(notes.title);
    setSummaryBodyDraft(notes.summary);
  }, [showNotesModal?.id, showNotesModal?.notes, userLang]);

	  useEffect(() => {
	    if (!editingEpisodeId) {
	      setEpisodeTitleDraft('');
	      setCategoryDraft('');
	      setEpisodeTextDraft('');
	      setEpisodeEditorTab('details');
	      return;
	    }

	    const episode = library.find((candidate) => candidate.id === editingEpisodeId);
	    if (!episode) {
	      setEditingEpisodeId(null);
	      setEpisodeTitleDraft('');
	      setCategoryDraft('');
	      setEpisodeTextDraft('');
	      setEpisodeEditorTab('details');
	      return;
	    }

	    setEpisodeTitleDraft(episode.title);
	    setCategoryDraft(getEpisodeCategories(episode).join(', '));
	    setEpisodeTextDraft(episode.text);
	  }, [editingEpisodeId, library]);

  useEffect(() => {
    if (activeCategoryFilter === 'all') {
      return;
    }

    const hasActiveCategory = library.some((episode) => episodeMatchesCategory(episode, activeCategoryFilter));
    if (!hasActiveCategory) {
      setActiveCategoryFilter('all');
    }
  }, [activeCategoryFilter, library]);

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
        l.labels[userLang].toLowerCase().startsWith(newBuffer)
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
    localStorage.setItem(USER_LANGUAGE_STORAGE_KEY, userLang);
  }, [userLang]);

  useEffect(() => {
    localStorage.setItem(SPEECH_CLEANUP_STORAGE_KEY, useSpeechCleanup ? '1' : '0');
  }, [useSpeechCleanup]);

  useEffect(() => {
    localStorage.setItem(INPUT_TEXT_STORAGE_KEY, inputText);
  }, [inputText]);

  useEffect(() => {
    cameraShotsRef.current = cameraShots;
  }, [cameraShots]);

  useEffect(() => {
    if (!showCameraCapture) {
      stopCameraStream();
      setIsCameraBooting(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(TRANSLATIONS[userLang].camera_permission_error);
      setIsCameraBooting(false);
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setIsCameraBooting(true);

    const startCamera = async () => {
      try {
        let stream: MediaStream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        const video = cameraVideoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('autoplay', 'true');
          await video.play().catch(() => undefined);
        }
        setIsCameraBooting(false);
      } catch (error) {
        console.error('Could not start the camera stream', error);
        if (!cancelled) {
          setCameraError(TRANSLATIONS[userLang].camera_permission_error);
          setIsCameraBooting(false);
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [showCameraCapture, userLang]);

  useEffect(() => {
    return () => {
      stopCameraStream();
      revokeCameraShotPreviews(cameraShotsRef.current);
      if (chunkSwitchTimeoutRef.current !== null) {
        window.clearTimeout(chunkSwitchTimeoutRef.current);
        chunkSwitchTimeoutRef.current = null;
      }
    };
  }, []);

  const isScanning = scanSource !== null;
  const isBusy = isGenerating || isGeneratingNotes || isTranslating;
  const contentBottomInset = player.activeEpisode ? playerInset + 24 : 32;

  const makeRetryOptions = (): GeminiRequestOptions => ({
    onRetry: ({ online }) => {
      setRetryNotice(online ? t('retrying') : t('waiting_for_network'));
    }
  });

  const showParsedError = (errorValue: unknown, context?: string | AiRequestContext) => {
    const parsed = parseAppError(errorValue, context);
    console.error('VoxPod classified error', parsed, errorValue);
    setAppError(parsed);
    setError(parsed.message);
    return parsed;
  };

  const copyAppErrorDetails = async () => {
    if (!appError || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(
      [
        `Code: ${appError.code}`,
        `Title: ${appError.title}`,
        `Message: ${appError.message}`,
        '',
        appError.technicalDetails
      ].join('\n')
    );
  };

  const retryAppErrorAction = () => {
    const code = appError?.code;
    setAppError(null);
    setError(null);

    if (code === 'AUTH') {
      void handleSignOut();
      return;
    }

	    if (inputText.trim() && !isBusy) {
	      void handleGenerate();
	    }
	  };

	  const useSmallerPodcastFromError = () => {
	    const trimmedText = inputText.trim();
	    if (trimmedText.length > 0) {
	      setInputText(truncateText(trimmedText, 1400));
	    }
	    setAppError(null);
	    setError(null);
	  };

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

  const readUrlImportCache = async (url: string) => {
    try {
      return await getImportTextCache(buildUrlImportCacheKey(url));
    } catch (error) {
      console.warn('Kunde inte läsa länkcache', error);
      return null;
    }
  };

  const writeUrlImportCache = async (url: string, text: string) => {
    if (!text.trim()) return;

    try {
      await saveImportTextCache(buildUrlImportCacheKey(url), text);
    } catch (error) {
      console.warn('Kunde inte skriva länkcache', error);
    }
  };

  const setCloudFeedbackMessage = (feedback: AuthFeedback | null) => {
    setCloudFeedback(feedback);
  };

  const handleCloudSyncError = (cloudError: unknown) => {
    console.error('Supabase cloud sync misslyckades', cloudError);
    setIsCloudSyncing(false);
    setCloudFeedbackMessage({
      kind: 'error',
      message: normalizeCloudSyncErrorMessage(cloudError, userLang),
    });
  };

  const markCloudSyncing = () => {
    if (!authUser) return;
    setIsCloudSyncing(true);
    setCloudFeedbackMessage({
      kind: 'info',
      message: t('cloud_status_syncing'),
    });
  };

  const markCloudReady = () => {
    if (!authUser) return;
    if (pendingCloudUploadsRef.current > 0) return;

    setIsCloudSyncing(false);
    setCloudFeedbackMessage({
      kind: 'success',
      message: t('cloud_status_ready'),
    });
  };

  const beginCloudUpload = () => {
    const userId = authUser?.id;
    if (!userId) return null;

    pendingCloudUploadsRef.current += 1;
    markCloudSyncing();
    return {
      userId,
      runId: cloudUploadRunRef.current,
    };
  };

  const completeCloudUpload = (runId: number) => {
    if (runId !== cloudUploadRunRef.current) return;

    pendingCloudUploadsRef.current = Math.max(0, pendingCloudUploadsRef.current - 1);
    if (pendingCloudUploadsRef.current === 0) {
      markCloudReady();
    }
  };

  const failCloudUpload = (runId: number, cloudError: unknown) => {
    if (runId !== cloudUploadRunRef.current) return;

    cloudUploadRunRef.current += 1;
    pendingCloudUploadsRef.current = 0;
    handleCloudSyncError(cloudError);
  };

  const cancelCloudSync = () => {
    cloudUploadRunRef.current += 1;
    pendingCloudUploadsRef.current = 0;
    setIsCloudSyncing(false);
    setCloudFeedbackMessage({
      kind: 'info',
      message: t('cloud_status_cancelled'),
    });
  };

  const persistLibrarySnapshot = (episodes: PodcastEpisode[]) => {
    writePersistedLibrary(episodes, authUser?.id);
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

	  const logPlayback = (event: string, details?: Record<string, unknown>) => {
	    console.info(`[VoxPod playback] ${event}`, details ?? {});
	  };

	  const markEpisodePartiallyReady = (
	    episodeId: string,
	    generatedCount: number,
	    generatedDurations: number[]
	  ) => {
	    if (generatedCount <= 0) {
	      patchEpisode(episodeId, {
	        generationStatus: 'failed',
	        readyChunkCount: 0,
	      });
	      return;
	    }

	    const readyDurations = generatedDurations.slice(0, generatedCount);
	    patchEpisode(episodeId, {
	      generationStatus: 'ready',
	      readyChunkCount: generatedCount,
	      chunkCount: generatedCount,
	      chunkDurations: readyDurations,
	      duration: sumDurations(readyDurations),
	    });
	  };

	  const beginChunkSwitch = (event: string, details?: Record<string, unknown>) => {
    if (chunkSwitchTimeoutRef.current !== null) {
      window.clearTimeout(chunkSwitchTimeoutRef.current);
    }

    isSwitchingChunkRef.current = true;
    logPlayback(event, details);
    chunkSwitchTimeoutRef.current = window.setTimeout(() => {
      isSwitchingChunkRef.current = false;
      chunkSwitchTimeoutRef.current = null;
    }, 8000);
  };

  const endChunkSwitch = (event: string, details?: Record<string, unknown>) => {
    if (chunkSwitchTimeoutRef.current !== null) {
      window.clearTimeout(chunkSwitchTimeoutRef.current);
      chunkSwitchTimeoutRef.current = null;
    }

    isSwitchingChunkRef.current = false;
    logPlayback(event, details);
  };

  const getChunkLoadTimeoutMs = (episode: PodcastEpisode, index: number) =>
    episode.generationStatus === 'processing' && !isEpisodeChunkReady(episode, index)
      ? CHUNK_GENERATION_LOAD_TIMEOUT_MS
      : CHUNK_LOAD_TIMEOUT_MS;

  const uploadEpisodeChunkToCloud = (audioBlobId: string, index: number, wavBuffer: ArrayBuffer) => {
    const upload = beginCloudUpload();
    if (!upload) return;

    void withTimeout(
      uploadCloudEpisodeChunk(upload.userId, audioBlobId, index, wavBuffer),
      CLOUD_UPLOAD_TIMEOUT_MS,
      t('cloud_status_timeout')
    )
      .then(() => {
        completeCloudUpload(upload.runId);
      })
      .catch((cloudError) => {
        failCloudUpload(upload.runId, cloudError);
      });
  };

  const uploadSummaryToCloud = (audioBlobId: string, wavBuffer: ArrayBuffer) => {
    const upload = beginCloudUpload();
    if (!upload) return;

    void withTimeout(
      uploadCloudSummaryAudio(upload.userId, audioBlobId, wavBuffer),
      CLOUD_UPLOAD_TIMEOUT_MS,
      t('cloud_status_timeout')
    )
      .then(() => {
        completeCloudUpload(upload.runId);
      })
      .catch((cloudError) => {
        failCloudUpload(upload.runId, cloudError);
      });
  };

  const loadChunkFromLocalOrCloud = async (episode: PodcastEpisode, index: number) => {
    const cacheKey = `${episode.audioBlobId}_${index}`;
    logPlayback('chunk requested', {
      episodeId: episode.id,
      index,
      readyChunkCount: episode.readyChunkCount,
      chunkCount: episode.chunkCount,
      status: episode.generationStatus,
    });
    let data = chunkCache.current.get(cacheKey);
    if (!data) {
      data = await getAudioBlob(cacheKey) ?? undefined;
    }

    if (!data && authUser?.id) {
      data = await downloadCloudEpisodeChunk(authUser.id, episode.audioBlobId, index) ?? undefined;
      if (data) {
        await saveAudioBlob(cacheKey, data);
      }
    }

    if (data) {
      chunkCache.current.set(cacheKey, data);
      logPlayback('chunk loaded', {
        episodeId: episode.id,
        index,
        bytes: data.byteLength,
      });
      return data;
    }

    logPlayback('chunk unavailable', {
      episodeId: episode.id,
      index,
      readyChunkCount: episode.readyChunkCount,
      chunkCount: episode.chunkCount,
      status: episode.generationStatus,
    });
    return null;
  };

  const getLatestEpisodeSnapshot = (episode: PodcastEpisode) =>
    libraryRef.current.find(candidate => candidate.id === episode.id) ?? episode;

  const pauseForUnavailableChunk = (episode: PodcastEpisode, index: number, message: string, markFailed = false) => {
    const nextChunkIndex = clamp(index, 0, Math.max(0, episode.chunkCount - 1));
    logPlayback('playback paused for unavailable chunk', {
      episodeId: episode.id,
      requestedIndex: index,
      nextChunkIndex,
      message,
      markFailed,
      readyChunkCount: episode.readyChunkCount,
      chunkCount: episode.chunkCount,
      status: episode.generationStatus,
    });
    pauseAudio();
    setMediaSessionPlaybackState(false);
    setPlayer(prev => ({
      ...prev,
      isPlaying: false,
      currentChunkIndex: nextChunkIndex,
      currentTime: getEpisodeOffset(episode, nextChunkIndex),
      activeEpisode: prev.activeEpisode?.id === episode.id
        ? {
            ...prev.activeEpisode,
            ...(markFailed ? { generationStatus: 'failed' as const } : {})
          }
        : prev.activeEpisode
    }));

    if (markFailed) {
      patchEpisode(episode.id, {
        generationStatus: 'failed',
        readyChunkCount: Math.min(getReadyChunkCount(episode), index),
      });
    }

    setError(message);
  };

  const shouldReplaceExistingImportText = () => {
    if (!inputText.trim()) {
      return false;
    }

    return window.confirm(t('import_replace_confirm'));
  };

  const startImportSession = (source: ImportSource, replaceExistingText: boolean = false) => {
    const session: ImportSessionState = {
      id: crypto.randomUUID(),
      source,
      baseText: replaceExistingText ? '' : inputText,
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
    if (el.readyState < 1) {
      await new Promise<void>(resolve => {
        const handleLoaded = () => {
          resolve();
        };

        el.addEventListener('loadedmetadata', handleLoaded, { once: true });
      });
    }

    el.currentTime = Math.max(0, timeInChunk);

    if (el.readyState < 2) {
      await new Promise<void>(resolve => {
        const handleCanPlay = () => {
          resolve();
        };

        el.addEventListener('canplay', handleCanPlay, { once: true });
      });
    }
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
      }
    }, 250);

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
    const el = initAudioElement();
    let lastObservedTime = el.currentTime || 0;
    let lastProgressAt = Date.now();

    const markProgress = () => {
      const currentTime = el.currentTime || 0;
      if (Math.abs(currentTime - lastObservedTime) > 0.05) {
        lastObservedTime = currentTime;
        lastProgressAt = Date.now();
      }
    };

    const handleAudioError = () => {
      const currentPlayer = playerRef.current;
      if (!currentPlayer?.activeEpisode) return;
      logPlayback('audio error', {
        episodeId: currentPlayer.activeEpisode.id,
        currentChunkIndex: currentPlayer.currentChunkIndex,
        error: el.error?.message,
        code: el.error?.code,
      });
      pauseForUnavailableChunk(
        getLatestEpisodeSnapshot(currentPlayer.activeEpisode),
        currentPlayer.currentChunkIndex,
        t('playback_failed')
      );
    };

    const handleUnexpectedPause = () => {
      window.setTimeout(() => {
        const currentPlayer = playerRef.current;
        if (
          !currentPlayer?.activeEpisode ||
          !currentPlayer.isPlaying ||
          isLoadingChunkRef.current ||
          isSwitchingChunkRef.current ||
          !el.paused
        ) {
          return;
        }

        const chunkTime = el.currentTime || 0;
        if (isEpisodeAtEnd(currentPlayer.activeEpisode, currentPlayer.currentChunkIndex, chunkTime)) {
          return;
        }

        logPlayback('stalled from unexpected pause', {
          episodeId: currentPlayer.activeEpisode.id,
          currentChunkIndex: currentPlayer.currentChunkIndex,
          chunkTime,
        });
        pauseForUnavailableChunk(
          getLatestEpisodeSnapshot(currentPlayer.activeEpisode),
          currentPlayer.currentChunkIndex,
          t('playback_stalled')
        );
      }, 300);
    };

    const watchdog = window.setInterval(() => {
      const currentPlayer = playerRef.current;
      if (!currentPlayer?.activeEpisode || el.paused || isLoadingChunkRef.current || isSwitchingChunkRef.current) {
        lastObservedTime = el.currentTime || 0;
        lastProgressAt = Date.now();
        return;
      }

      markProgress();
      if (Date.now() - lastProgressAt < PLAYBACK_STALL_TIMEOUT_MS) {
        return;
      }

      logPlayback('stalled from watchdog', {
        episodeId: currentPlayer.activeEpisode.id,
        currentChunkIndex: currentPlayer.currentChunkIndex,
        elapsedMs: Date.now() - lastProgressAt,
        currentTime: el.currentTime || 0,
      });
      pauseForUnavailableChunk(
        getLatestEpisodeSnapshot(currentPlayer.activeEpisode),
        currentPlayer.currentChunkIndex,
        t('playback_stalled')
      );
    }, 1000);

    el.addEventListener('timeupdate', markProgress);
    el.addEventListener('playing', markProgress);
    el.addEventListener('canplay', markProgress);
    el.addEventListener('error', handleAudioError);
    el.addEventListener('stalled', handleUnexpectedPause);
    el.addEventListener('waiting', handleUnexpectedPause);
    el.addEventListener('pause', handleUnexpectedPause);

    return () => {
      window.clearInterval(watchdog);
      el.removeEventListener('timeupdate', markProgress);
      el.removeEventListener('playing', markProgress);
      el.removeEventListener('canplay', markProgress);
      el.removeEventListener('error', handleAudioError);
      el.removeEventListener('stalled', handleUnexpectedPause);
      el.removeEventListener('waiting', handleUnexpectedPause);
      el.removeEventListener('pause', handleUnexpectedPause);
    };
  }, [userLang]);

  useEffect(() => {
    if (!isAuthReady) return;

    if (!authUser || !supabase) {
      libraryRef.current = [];
      setLibrary([]);
      hasHydratedLibraryRef.current = false;
      cloudUploadRunRef.current += 1;
      pendingCloudUploadsRef.current = 0;
      setIsCloudSyncing(false);
      setCloudFeedbackMessage(
        isSupabaseConfigured
          ? {
              kind: 'info',
              message: t('cloud_status_signed_out'),
            }
          : null
      );
      return;
    }

    const cachedLibrary = readPersistedLibrary(authUser.id);
    libraryRef.current = cachedLibrary;
    setLibrary(cachedLibrary);
    hasHydratedLibraryRef.current = true;

    let cancelled = false;
    setIsCloudSyncing(true);
    setCloudFeedbackMessage({
      kind: 'info',
      message: t('cloud_status_syncing'),
    });

    void (async () => {
      try {
        const remoteLibrary = await fetchCloudEpisodes(authUser.id);
        if (cancelled) return;

        libraryRef.current = remoteLibrary;
        setLibrary(remoteLibrary);
        writePersistedLibrary(remoteLibrary, authUser.id);
        setCloudFeedbackMessage({
          kind: 'success',
          message: t('cloud_status_ready'),
        });
      } catch (cloudError) {
        if (cancelled) return;
        handleCloudSyncError(cloudError);
      } finally {
        if (!cancelled) {
          setIsCloudSyncing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, isAuthReady, userLang]);

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
    if (!hasHydratedLibraryRef.current || !authUser || !isAuthReady) return;

    if (cloudSyncTimeoutRef.current) {
      window.clearTimeout(cloudSyncTimeoutRef.current);
    }

    cloudSyncTimeoutRef.current = window.setTimeout(() => {
      const runId = cloudUploadRunRef.current;
      markCloudSyncing();
      void withTimeout(
        upsertCloudEpisodes(authUser.id, libraryRef.current),
        CLOUD_UPLOAD_TIMEOUT_MS,
        t('cloud_status_timeout')
      )
        .then(() => {
          if (runId !== cloudUploadRunRef.current) return;
          markCloudReady();
        })
        .catch((cloudError) => {
          if (runId !== cloudUploadRunRef.current) return;
          handleCloudSyncError(cloudError);
        });
      cloudSyncTimeoutRef.current = null;
    }, 900);

    return () => {
      if (cloudSyncTimeoutRef.current) {
        window.clearTimeout(cloudSyncTimeoutRef.current);
        cloudSyncTimeoutRef.current = null;
      }
    };
  }, [library, authUser?.id, isAuthReady, userLang]);

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
      const currentPlayer = playerRef.current;
      const activeEpisode = currentPlayer?.activeEpisode;
      if (!activeEpisode) {
        return;
      }

      logPlayback('ended', {
        episodeId: activeEpisode.id,
        currentChunkIndex: currentPlayer.currentChunkIndex,
        chunkCount: activeEpisode.chunkCount,
      });

      if (currentPlayer.currentChunkIndex < activeEpisode.chunkCount - 1) {
        const latestEpisode = getLatestEpisodeSnapshot(activeEpisode);
        const nextIndex = currentPlayer.currentChunkIndex + 1;
        if (latestEpisode.generationStatus === 'processing' && !isEpisodeChunkReady(latestEpisode, nextIndex)) {
          logPlayback('ended waiting for next generated chunk', {
            episodeId: latestEpisode.id,
            nextIndex,
            readyChunkCount: latestEpisode.readyChunkCount,
            chunkCount: latestEpisode.chunkCount,
          });
          pauseForUnavailableChunk(latestEpisode, nextIndex, t('playback_chunk_waiting'));
          return;
        }

        beginChunkSwitch('ended switching chunk', {
          episodeId: latestEpisode.id,
          fromIndex: currentPlayer.currentChunkIndex,
          toIndex: nextIndex,
        });
        void playChunk(latestEpisode, nextIndex);
      } else {
        saveBookmark(activeEpisode.id, 0, 0);
        setPlayer(prev => ({ ...prev, isPlaying: false, currentTime: prev.duration }));
        setMediaSessionPlaybackState(false);
      }
    };
    el.addEventListener('ended', handleEnd);

    return () => el.removeEventListener('ended', handleEnd);
  }, [userLang]);

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
          for (const part of splitLongTextPreservingWords(sentence, MAX_CHUNK_CHARACTERS)) {
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

	  const buildChunkAudio = async (
	    textChunk: string,
	    voice: VoiceName,
	    usageContext?: {
	      episodeId: string;
	      chunkIndex: number;
	    }
	  ) => {
	    const speechRequest = buildSpeechRequestText(textChunk, false);
	    if (!speechRequest.speechText) {
	      throw new Error(t('speech_cleanup_empty_error'));
	    }

	    const contentCacheKey = await buildTtsContentCacheKey(speechRequest.speechText, voice, speechRequest.languageHint);
	    const cachedWavBuffer = await getAudioBlob(contentCacheKey);
	    if (cachedWavBuffer) {
	      return {
	        wavBuffer: cachedWavBuffer,
	        duration: estimateWavDurationSeconds(cachedWavBuffer) || estimateEpisodeDurationSeconds(speechRequest.speechText),
	        usage: undefined,
	      };
	    }

    setRetryNotice(null);
    let ttsResult: Awaited<ReturnType<typeof generateTTS>>;
    try {
      ttsResult = await generateTTS(
        speechRequest.speechText,
        voice,
        undefined,
        {
          ...makeRetryOptions(),
          languageHint: speechRequest.languageHint,
          usageContext: usageContext
            ? {
                ...usageContext,
                usageCategory: 'podcast_audio',
              }
            : undefined,
        }
      );
    } catch (error) {
      throw withAiRequestContext(error, {
        functionName: 'podcast_tts_chunk',
        kind: 'TTS',
        provider: 'Gemini',
        model: 'gemini-2.5-flash-preview-tts',
        textLength: speechRequest.speechText.length,
      });
    }
    setRetryNotice(null);
    const pcmBytes = decodeBase64ToUint8(ttsResult.audio);

	    const duration = calculateChunkDurationSeconds(pcmBytes, AUDIO_SAMPLE_RATE);
	    const wavBuffer = pcmToWav(pcmBytes, AUDIO_SAMPLE_RATE);
	    recordAiUsage('tts', speechRequest.speechText, {
	      audioSeconds: duration,
	      model: 'gemini-2.5-flash-preview-tts',
	    });
	    await saveAudioBlob(contentCacheKey, wavBuffer);

	    return {
	      wavBuffer,
	      duration,
	      usage: ttsResult.usage,
	    };
	  };

	  const recordAiUsage = (
	    kind: AiUsageKind,
	    inputTextValue: string,
	    options?: {
	      outputTextValue?: string;
	      audioSeconds?: number;
	      model?: string;
	    }
	  ) => {
	    const audioSeconds = Math.max(0, options?.audioSeconds ?? 0);
	    const outputTokens = options?.outputTextValue
	      ? estimateTextTokens(options.outputTextValue)
	      : audioSeconds > 0
	        ? Math.ceil(audioSeconds * ESTIMATED_AUDIO_TOKENS_PER_SECOND)
	        : Math.max(250, Math.ceil(estimateTextTokens(inputTextValue) * 0.35));

	    const entry: AiUsageEntry = {
	      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
	      kind,
	      inputTokens: estimateTextTokens(inputTextValue),
	      outputTokens,
	      audioSeconds: audioSeconds || undefined,
	      model: options?.model ?? (kind === 'tts' ? 'gemini-2.5-flash-preview-tts' : 'gemini-3-flash-preview'),
	      createdAt: Date.now(),
	    };

	    setAiUsage((current) => {
	      const normalized = normalizeAiUsageState(current);
	      return {
	        ...normalized,
	        entries: [...normalized.entries, entry].slice(-AI_USAGE_HISTORY_LIMIT),
	      };
	    });
	  };

  const getImportChunkWindow = (sourceText: string, isComplete: boolean) => {
    const narrationText = buildSpeechSourceText(sourceText, useSpeechCleanup);
    const allChunks = chunkText(narrationText);
    const finalizedCount = isComplete ? allChunks.length : Math.max(0, allChunks.length - 1);

    return {
      narrationText,
      allChunks,
      finalizedCount,
      projectedChunkCount: Math.max(finalizedCount, allChunks.length),
    };
  };

  const syncLiveGenerationProgress = (
    sourceText: string,
    generatedCount: number,
    isComplete: boolean
  ) => {
    const projectedChunks = Math.max(1, getImportChunkWindow(sourceText, isComplete).projectedChunkCount);
    const total = projectedChunks;
    const current = Math.min(total, generatedCount);

    setGenerationProgress({
      current,
      total,
    });

    setGenerationSession(prev => prev ? {
      ...prev,
      totalSteps: total,
      estimatedSeconds: estimateGenerationSeconds(projectedChunks, false),
      notesIncluded: false,
      notesCompleted: true,
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

        const { narrationText, allChunks, finalizedCount, projectedChunkCount } = getImportChunkWindow(trimmedText, source.isComplete);

        if (!narrationText) {
          if (source.isComplete) {
            liveGenerationRef.current = null;
            setIsGenerating(false);
            setGenerationSession(null);
            setError(t('speech_cleanup_empty_error'));
          }
          break;
        }

        const requiredInitialReady = getRequiredLiveReadyChunks(allChunks, finalizedCount, source.isComplete);

        syncLiveGenerationProgress(trimmedText, live.generatedCount, source.isComplete);

        if (!live.episodeCreated) {
          if (finalizedCount < requiredInitialReady) {
            if (source.isComplete) {
              liveGenerationRef.current = null;
              setIsGenerating(false);
              setGenerationSession(null);
              setError('There was not enough imported text to start the podcast.');
            }
            break;
          }

          for (let index = live.generatedCount; index < requiredInitialReady; index++) {
            const { wavBuffer, duration, usage } = await buildChunkAudio(allChunks[index], live.voice, {
              episodeId: live.episodeId,
              chunkIndex: index,
            });
            await saveAudioBlob(`${live.episodeId}_${index}`, wavBuffer);
            chunkCache.current.set(`${live.episodeId}_${index}`, wavBuffer);
            uploadEpisodeChunkToCloud(live.episodeId, index, wavBuffer);
            live.generatedDurations[index] = duration;
            live.generatedCount = index + 1;
            live.generationCost = appendGenerationCost(live.generationCost, usage);
            syncLiveGenerationProgress(trimmedText, live.generatedCount, source.isComplete);
          }

          const newEpisode: PodcastEpisode = {
            id: live.episodeId,
            title: live.title,
            text: trimmedText,
            bookmarks: [],
            categories: [],
            date: Date.now(),
            voice: live.voice,
            audioBlobId: live.episodeId,
            chunkCount: Math.max(projectedChunkCount, live.generatedCount),
            readyChunkCount: live.generatedCount,
            generationStatus: 'ready',
            generationCost: live.generationCost,
            chunkDurations: [...live.generatedDurations],
            duration: estimateEpisodeDurationSeconds(narrationText),
            playbackRate: 1,
          };

          updateLibrary(prev => [newEpisode, ...prev]);
          live.episodeCreated = true;

          try {
            await handlePlayEpisode(newEpisode, 0);
            live.startedPlayback = true;
          } catch (error) {
            console.error('Could not start playback immediately for live generation', error);
          }

          continue;
        }

        patchEpisode(live.episodeId, {
          text: trimmedText,
          chunkCount: Math.max(projectedChunkCount, live.generatedCount),
          duration: source.isComplete
            ? Math.max(sumDurations(live.generatedDurations), estimateEpisodeDurationSeconds(narrationText))
            : estimateEpisodeDurationSeconds(narrationText),
        });

        if (live.generatedCount < finalizedCount) {
          const nextIndex = live.generatedCount;
          const { wavBuffer, duration, usage } = await buildChunkAudio(allChunks[nextIndex], live.voice, {
            episodeId: live.episodeId,
            chunkIndex: nextIndex,
          });
          await saveAudioBlob(`${live.episodeId}_${nextIndex}`, wavBuffer);
          chunkCache.current.set(`${live.episodeId}_${nextIndex}`, wavBuffer);
          uploadEpisodeChunkToCloud(live.episodeId, nextIndex, wavBuffer);
          live.generatedDurations[nextIndex] = duration;
          live.generatedCount = nextIndex + 1;
          live.generationCost = appendGenerationCost(live.generationCost, usage);

          patchEpisode(live.episodeId, {
            text: trimmedText,
            readyChunkCount: live.generatedCount,
            chunkCount: Math.max(projectedChunkCount, live.generatedCount),
            chunkDurations: [...live.generatedDurations],
            generationCost: live.generationCost,
            duration: source.isComplete
              ? Math.max(sumDurations(live.generatedDurations), estimateEpisodeDurationSeconds(narrationText))
              : estimateEpisodeDurationSeconds(narrationText),
          });

          syncLiveGenerationProgress(trimmedText, live.generatedCount, source.isComplete);
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
          generationStatus: 'ready',
        });

        syncLiveGenerationProgress(trimmedText, allChunks.length, true);
        liveGenerationRef.current = null;
        setIsGenerating(false);
        setGenerationSession(null);
        setRetryNotice(null);
        break;
      }
	    } catch (error) {
	      console.error('Live generation failed', error);
	      const live = liveGenerationRef.current;
	      if (live?.episodeCreated) {
	        if (isAiLimitError(error)) {
	          markEpisodePartiallyReady(live.episodeId, live.generatedCount, live.generatedDurations);
	        } else {
	          patchEpisode(live.episodeId, {
	            generationStatus: 'failed',
	            readyChunkCount: live.generatedCount,
	            chunkDurations: [...live.generatedDurations],
	            duration: sumDurations(live.generatedDurations),
	          });
	        }
	      }
	      showParsedError(error, 'live podcast generation');
      liveGenerationRef.current = null;
      setIsGenerating(false);
      setIsGeneratingNotes(false);
      setGenerationSession(null);
      setRetryNotice(null);
    } finally {
      liveGenerationPumpRef.current = false;
    }
  };

  const generatePodcastEpisode = async (sourceTextOverride: string, titleSuffix: string = '', autoplay: boolean = true) => {
    if (!sourceTextOverride.trim() || isBusy) return;
    setIsGenerating(true);
    setError(null);
	    setAppError(null);
	    setRetryNotice(null);
	    let createdEpisodeId: string | null = null;
	    let partialEpisodeDraft: PodcastEpisode | null = null;
	    let activeGeneratedCount = 0;
	    let activeGeneratedDurations: number[] = [];
	    let activeGenerationCost: EpisodeGenerationCost | undefined;

    try {
      const activeImportSession = importSessionRef.current;
      const activeImportText = activeImportSession
        ? composeImportedText(activeImportSession.baseText, activeImportSession.text).trim()
        : '';
      if (isScanning && activeImportSession && activeImportText) {
        const sourceText = activeImportText;
        const { narrationText, projectedChunkCount } = getImportChunkWindow(sourceText, activeImportSession.isComplete);
        if (!narrationText) {
          setError(t('speech_cleanup_empty_error'));
          setIsGenerating(false);
          return;
        }
        const projectedChunks = Math.max(1, projectedChunkCount);

        setGenerationProgress({ current: 0, total: projectedChunks });
        setGenerationSession({
          startedAt: Date.now(),
          estimatedSeconds: estimateGenerationSeconds(projectedChunks, false),
          totalSteps: projectedChunks,
          notesIncluded: false,
          notesCompleted: true,
        });

        liveGenerationRef.current = {
          sourceSessionId: activeImportSession.id,
          episodeId: crypto.randomUUID(),
          episodeCreated: false,
          generatedCount: 0,
          generatedDurations: [],
          startedPlayback: false,
          voice: selectedVoice as VoiceName,
          title: sourceText.split('\n')[0].substring(0, 40) || t('new_episode_title'),
        };

        void pumpLiveGeneration();
        return;
      }

	      const id = crypto.randomUUID();
	      createdEpisodeId = id;
	      const narrationText = buildSpeechSourceText(sourceTextOverride, useSpeechCleanup);
	      const chunks = chunkText(narrationText);
      if (chunks.length === 0) {
        setError(t('speech_cleanup_empty_error'));
        return;
      }

      const baseTitle = sourceTextOverride.trim().split('\n')[0].substring(0, 40) || t('new_episode_title');
      const title = titleSuffix ? `${baseTitle} ${titleSuffix}` : baseTitle;
      const totalSteps = chunks.length;
      const estimatedDuration = estimateEpisodeDurationSeconds(narrationText);
      const initialBufferSize = Math.min(INITIAL_PLAYBACK_BUFFER, chunks.length);
	      const generatedDurations: number[] = [];
	      activeGeneratedDurations = generatedDurations;

      setGenerationProgress({ current: 0, total: totalSteps });
	      setGenerationSession({
        startedAt: Date.now(),
        estimatedSeconds: estimateGenerationSeconds(chunks.length, false),
        totalSteps,
        notesIncluded: false,
        notesCompleted: true
		      });

	      partialEpisodeDraft = {
	        id,
	        title,
	        text: sourceTextOverride,
	        date: Date.now(),
	        bookmarks: [],
	        categories: [],
	        voice: selectedVoice,
	        audioBlobId: id,
	        chunkCount: chunks.length,
	        readyChunkCount: 0,
		        generationStatus: 'processing',
		        chunkDurations: [],
		        duration: estimatedDuration,
		        playbackRate: 1
		      };

	      for (let index = 0; index < initialBufferSize; index++) {
	        const { wavBuffer, duration, usage } = await buildChunkAudio(chunks[index], selectedVoice as VoiceName, {
	          episodeId: id,
	          chunkIndex: index,
	        });
        await saveAudioBlob(`${id}_${index}`, wavBuffer);
        chunkCache.current.set(`${id}_${index}`, wavBuffer);
	        uploadEpisodeChunkToCloud(id, index, wavBuffer);
	        generatedDurations[index] = duration;
	        activeGeneratedCount = index + 1;
	        activeGenerationCost = appendGenerationCost(activeGenerationCost, usage);
	        setGenerationProgress(prev => ({ ...prev, current: index + 1 }));
	      }

      const newEpisode: PodcastEpisode = {
        id,
        title,
        text: sourceTextOverride,
        date: Date.now(),
        bookmarks: [],
        categories: [],
        voice: selectedVoice,
	        audioBlobId: id,
	        chunkCount: chunks.length,
	        readyChunkCount: initialBufferSize,
	        generationStatus: chunks.length === initialBufferSize ? 'ready' : 'processing',
	        generationCost: activeGenerationCost,
	        chunkDurations: [...generatedDurations],
	        duration: estimatedDuration,
	        playbackRate: 1
	      };

	      updateLibrary(prev => [newEpisode, ...prev]);
	      if (autoplay) {
	        await handlePlayEpisode(newEpisode, 0);
	      }

      for (let index = initialBufferSize; index < chunks.length; index++) {
        const { wavBuffer, duration, usage } = await buildChunkAudio(chunks[index], selectedVoice as VoiceName, {
          episodeId: id,
          chunkIndex: index,
        });
        await saveAudioBlob(`${id}_${index}`, wavBuffer);
        chunkCache.current.set(`${id}_${index}`, wavBuffer);
	        uploadEpisodeChunkToCloud(id, index, wavBuffer);
	        generatedDurations[index] = duration;
	        activeGeneratedCount = index + 1;
	        activeGenerationCost = appendGenerationCost(activeGenerationCost, usage);
	        patchEpisode(id, {
          readyChunkCount: index + 1,
          chunkDurations: [...generatedDurations],
          generationCost: activeGenerationCost,
        });
        setGenerationProgress(prev => ({ ...prev, current: index + 1 }));
      }

	      patchEpisode(id, {
	        readyChunkCount: chunks.length,
	        generationStatus: 'ready',
	        chunkDurations: [...generatedDurations],
	        generationCost: activeGenerationCost,
	        duration: sumDurations(generatedDurations)
	      });

	      setGenerationProgress({ current: totalSteps, total: totalSteps });
	    } catch (err) {
	      console.error(err);
	      if (createdEpisodeId) {
	        if (isAiLimitError(err)) {
	          const episodeExists = libraryRef.current.some((episode) => episode.id === createdEpisodeId);
	          if (!episodeExists && partialEpisodeDraft && activeGeneratedCount > 0) {
	            const readyDurations = activeGeneratedDurations.slice(0, activeGeneratedCount);
	            updateLibrary(prev => [{
	              ...partialEpisodeDraft,
	              generationStatus: 'ready',
	              readyChunkCount: activeGeneratedCount,
	              chunkCount: activeGeneratedCount,
	              chunkDurations: readyDurations,
	              generationCost: activeGenerationCost,
	              duration: sumDurations(readyDurations),
	            }, ...prev]);
	          } else {
	            markEpisodePartiallyReady(createdEpisodeId, activeGeneratedCount, activeGeneratedDurations);
	          }
	        } else {
	          patchEpisode(createdEpisodeId, { generationStatus: 'failed' });
	        }
	      }
	      showParsedError(err, 'podcast generation');
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

  const createGenerationPreview = (sourceText: string): PodcastGenerationPreview => {
    const episodeTexts = splitLongTextPreservingWords(sourceText.trim(), MAX_PODCAST_EPISODE_CHARACTERS);
    const estimates = episodeTexts.map((episodeText) => {
      const narrationText = buildSpeechSourceText(episodeText, useSpeechCleanup);
      const durationSeconds = estimateEpisodeDurationSeconds(narrationText);
      const inputTokens = estimateTextTokens(narrationText);
      const outputTokens = Math.ceil(durationSeconds * ESTIMATED_AUDIO_TOKENS_PER_SECOND);
      return {
        durationSeconds,
        requestCount: Math.max(1, chunkText(narrationText).length),
        inputTokens,
        outputTokens,
      };
    });
    const inputTokens = estimates.reduce((sum, estimate) => sum + estimate.inputTokens, 0);
    const outputTokens = estimates.reduce((sum, estimate) => sum + estimate.outputTokens, 0);

    return {
      episodeTexts,
      durationSeconds: estimates.reduce((sum, estimate) => sum + estimate.durationSeconds, 0),
      requestCount: estimates.reduce((sum, estimate) => sum + estimate.requestCount, 0),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalCostUsd: (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 10,
    };
  };

  const handleGenerate = () => {
    if (!inputText.trim() || isBusy) return;
    if (isScanning) {
      void generatePodcastEpisode(inputText);
      return;
    }
    setPendingGenerationPreview(createGenerationPreview(inputText));
  };

  const confirmPodcastGeneration = async () => {
    const preview = pendingGenerationPreview;
    if (!preview) return;
    setPendingGenerationPreview(null);
    for (let index = 0; index < preview.episodeTexts.length; index++) {
      const suffix = preview.episodeTexts.length > 1 ? `(${index + 1}/${preview.episodeTexts.length})` : '';
      await generatePodcastEpisode(preview.episodeTexts[index], suffix, index === 0);
    }
  };

  const handleGeneratePublicDemo = async () => {
    const text = demoText.trim();
    if (!text || isGeneratingDemo) return;
    if (text.length > PUBLIC_DEMO_MAX_CHARACTERS) {
      setDemoError('Gratisprovet är begränsat till cirka 2 minuter. Korta texten innan du provar.');
      return;
    }
    if (!demoTurnstileToken) {
      setDemoError('Bekräfta först att du är mänsklig.');
      return;
    }

    setDemoError(null);
    setIsGeneratingDemo(true);
    try {
      let deviceId = localStorage.getItem(PUBLIC_DEMO_DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem(PUBLIC_DEMO_DEVICE_ID_KEY, deviceId);
      }
      const result = await generatePublicDemoTTS(text, {
        turnstileToken: demoTurnstileToken,
        deviceId,
      });
      const wavBuffer = pcmToWav(decodeBase64ToUint8(result.audio), AUDIO_SAMPLE_RATE);
      setDemoAudioUrl(URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' })));
      setDemoTurnstileToken('');
      if (demoTurnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.reset(demoTurnstileWidgetIdRef.current);
      }
    } catch (demoGenerationError) {
      setDemoError(demoGenerationError instanceof Error ? demoGenerationError.message : 'Demon kunde inte skapas.');
    } finally {
      setIsGeneratingDemo(false);
    }
  };

  const handleDownloadEpisode = async (episode: PodcastEpisode) => {
    if (isDownloading || episode.generationStatus === 'processing') return;
    if (episode.generationStatus === 'failed') {
      setError(t('playback_chunk_missing'));
      return;
    }
    setIsDownloading(episode.id);
    try {
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < episode.chunkCount; i++) {
        let b = await getAudioBlob(`${episode.audioBlobId}_${i}`);
        if (!b && authUser?.id) {
          b = await downloadCloudEpisodeChunk(authUser.id, episode.audioBlobId, i);
          if (b) {
            await saveAudioBlob(`${episode.audioBlobId}_${i}`, b);
          }
        }
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
    } catch (err) { setError(t('download_mp3_error')); }
    finally { setIsDownloading(null); }
  };

  const ensureEpisodeSummary = async (episode: PodcastEpisode) => {
    const latestEpisode = getLatestEpisodeSnapshot(episode);
    const existingNotes = normalizeEpisodeNotes(latestEpisode.notes, userLang);
    if (existingNotes) {
      return latestEpisode;
    }

    const activeRequest = summaryGenerationRequestsRef.current.get(latestEpisode.id);
    if (activeRequest) {
      return activeRequest;
    }

    const sourceText = buildNotesSourceText(latestEpisode.text);
    if (!sourceText.trim()) {
      setError(t('no_notes'));
      return null;
    }

    const summaryCacheKey = await buildSummaryContentCacheKey(sourceText, userLang);
    const cachedNotes = await getSummaryCache(summaryCacheKey).catch((error) => {
      console.warn('Could not read summary cache', error);
      return null;
    });
    if (cachedNotes) {
      const polishedCachedNotes = polishEpisodeNotes(cachedNotes, latestEpisode.text, inputNotes, userLang);
      const updatedEpisode = {
        ...latestEpisode,
        notes: polishedCachedNotes,
      };
      patchEpisode(latestEpisode.id, { notes: polishedCachedNotes });
      return updatedEpisode;
    }

    const request = (async () => {
      setSummaryGenerationEpisodeId(latestEpisode.id);
      setIsGeneratingNotes(true);

      try {
        let generatedNotes: EpisodeNotes;
        try {
          generatedNotes = await generateNotes(sourceText, makeRetryOptions());
        } catch (error) {
          throw withAiRequestContext(error, {
            functionName: 'summary_generation',
            kind: 'SUMMARY',
            provider: 'Gemini',
            model: 'gemini-3-flash-preview',
            textLength: sourceText.length,
          });
        }
        setRetryNotice(null);
        recordAiUsage('summary', sourceText, {
          outputTextValue: [
            generatedNotes.title,
            generatedNotes.summary,
            ...generatedNotes.sections.flatMap(section => [section.heading, ...section.bullets]),
          ].join('\n'),
          model: 'gemini-3-flash-preview',
        });

        const polishedNotes = polishEpisodeNotes(generatedNotes, latestEpisode.text, inputNotes, userLang);
        const updatedEpisode = {
          ...latestEpisode,
          notes: polishedNotes,
        };
        patchEpisode(latestEpisode.id, { notes: polishedNotes });
        await saveSummaryCache(summaryCacheKey, polishedNotes).catch((error) => {
          console.warn('Could not write summary cache', error);
        });
        return updatedEpisode;
      } catch (error) {
        console.error('Could not generate summary on demand', error);
        showParsedError(error, 'summary generation');
        return null;
      } finally {
        summaryGenerationRequestsRef.current.delete(latestEpisode.id);
        setIsGeneratingNotes(false);
        setSummaryGenerationEpisodeId(current => current === latestEpisode.id ? null : current);
      }
    })();

    summaryGenerationRequestsRef.current.set(latestEpisode.id, request);
    return request;
  };

  const handleOpenSummary = async (episode: PodcastEpisode) => {
    const episodeWithSummary = await ensureEpisodeSummary(episode);
    if (episodeWithSummary) {
      setShowNotesModal(episodeWithSummary);
    }
  };

  const handlePlaySummary = async (episode: PodcastEpisode) => {
    const summaryEl = summaryAudioRef.current;
    if (!summaryEl) {
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
      const episodeWithSummary = await ensureEpisodeSummary(episode);
      if (!episodeWithSummary) {
        return;
      }

      const summaryText = buildEpisodeSummaryPlaybackText(episodeWithSummary, userLang);
      if (!summaryText) {
        setError(t('summary_audio_error'));
        return;
      }

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
      const blobId = getSummaryAudioBlobId(episodeWithSummary);
      setRetryNotice(null);
      setSummaryPlayback({
        episodeId: episodeWithSummary.id,
        isLoading: true,
        isPlaying: false
      });

      let wavBuffer = summaryChunkCache.current.get(blobId);
      if (!wavBuffer) {
        wavBuffer = await getAudioBlob(blobId) ?? undefined;
      }

      if (!wavBuffer && authUser?.id) {
        wavBuffer = await downloadCloudSummaryAudio(authUser.id, episodeWithSummary.audioBlobId) ?? undefined;
        if (wavBuffer) {
          await saveAudioBlob(blobId, wavBuffer);
        }
      }

      if (!wavBuffer) {
        const speechRequest = buildSpeechRequestText(summaryText, useSpeechCleanup);
        const summaryContentCacheKey = await buildTtsContentCacheKey(
          speechRequest.speechText,
          episodeWithSummary.voice as VoiceName,
          speechRequest.languageHint
        );
        wavBuffer = await getAudioBlob(summaryContentCacheKey) ?? undefined;
        if (!wavBuffer) {
	          let ttsResult: Awaited<ReturnType<typeof generateTTS>>;
	          try {
	            ttsResult = await generateTTS(
	              speechRequest.speechText,
	              episodeWithSummary.voice as VoiceName,
	              undefined,
	              {
	                ...makeRetryOptions(),
	                languageHint: speechRequest.languageHint,
	                usageContext: {
	                  episodeId: episodeWithSummary.id,
	                  chunkIndex: 0,
	                  usageCategory: 'summary_audio',
	                },
	              }
	            );
          } catch (error) {
            throw withAiRequestContext(error, {
              functionName: 'summary_tts',
              kind: 'SUMMARY_TTS',
              provider: 'Gemini',
              model: 'gemini-2.5-flash-preview-tts',
              textLength: speechRequest.speechText.length,
            });
		        }
		        setRetryNotice(null);
		        const pcmBytes = decodeBase64ToUint8(ttsResult.audio);
	        wavBuffer = pcmToWav(pcmBytes, AUDIO_SAMPLE_RATE);
	        recordAiUsage('tts', speechRequest.speechText, {
	          audioSeconds: calculateChunkDurationSeconds(pcmBytes, AUDIO_SAMPLE_RATE),
	          model: 'gemini-2.5-flash-preview-tts',
          });
          await saveAudioBlob(summaryContentCacheKey, wavBuffer);
        }
        await saveAudioBlob(blobId, wavBuffer);
        uploadSummaryToCloud(episodeWithSummary.audioBlobId, wavBuffer);
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
    const startedAt = Date.now();
    let activeTimeoutMs = getChunkLoadTimeoutMs(getLatestEpisodeSnapshot(episode), index);

    while (requestId === playRequestRef.current) {
      const latestEpisode = getLatestEpisodeSnapshot(episode);
      activeTimeoutMs = Math.max(activeTimeoutMs, getChunkLoadTimeoutMs(latestEpisode, index));
      if (latestEpisode.generationStatus === 'failed') {
        throw new ChunkLoadError(t('playback_chunk_missing'), true);
      }

      const data = await loadChunkFromLocalOrCloud(latestEpisode, index);
      if (data) {
        return data;
      }

      if (Date.now() - startedAt >= activeTimeoutMs) {
        const isStillGenerating = latestEpisode.generationStatus === 'processing' && !isEpisodeChunkReady(latestEpisode, index);
        logPlayback('chunk timeout', {
          episodeId: latestEpisode.id,
          index,
          elapsedMs: Date.now() - startedAt,
          timeoutMs: activeTimeoutMs,
          isStillGenerating,
          readyChunkCount: latestEpisode.readyChunkCount,
          chunkCount: latestEpisode.chunkCount,
        });
        throw new ChunkLoadError(
          isStillGenerating ? t('playback_chunk_waiting') : t('playback_chunk_missing'),
          !isStillGenerating
        );
      }

      await sleep(CHUNK_POLL_INTERVAL_MS);
    }

    logPlayback('chunk request cancelled', { episodeId: episode.id, index, requestId });
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
    const episodeRate = episode.playbackRate || 1;

    try {
      logPlayback('playChunk requested', {
        episodeId: episode.id,
        index,
        requestId,
        autoplay,
        startTime,
      });
      isLoadingChunkRef.current = true;
      setIsLoadingChunk(true);
      const data = await waitForChunkData(episode, index, requestId);
      if (!data || requestId !== playRequestRef.current) {
        return;
      }

      beginChunkSwitch('switching chunk', {
        episodeId: episode.id,
        index,
        requestId,
        startTime,
      });

      for (let attempt = 1; attempt <= MAX_CHUNK_PLAY_ATTEMPTS; attempt++) {
        loadAudioFromBuffer(data);
        await applyChunkStartTime(startTime);
        setPlaybackRate(episodeRate);

        try {
          if (autoplay) {
            await playAudio();
          } else {
            pauseAudio();
          }
          endChunkSwitch('play started', {
            episodeId: episode.id,
            index,
            requestId,
            attempt,
            autoplay,
          });
          break;
        } catch (playError) {
          logPlayback('play retry', {
            episodeId: episode.id,
            index,
            requestId,
            attempt,
            error: playError instanceof Error ? playError.message : String(playError),
          });
          if (!autoplay || attempt >= MAX_CHUNK_PLAY_ATTEMPTS || requestId !== playRequestRef.current) {
            throw playError;
          }

          await sleep(CHUNK_PLAY_RETRY_DELAY_MS * attempt);
        }
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
          void loadChunkFromLocalOrCloud(episode, nextIndex).then(nextData => {
            if (nextData) chunkCache.current.set(nextKey, nextData);
          });
        }
      }

      if (index > 1) {
        chunkCache.current.delete(`${episode.audioBlobId}_${index - 2}`);
      }
    } catch (e) { 
      console.error('Chunk playback failed', e);
      endChunkSwitch('chunk switch failed', {
        episodeId: episode.id,
        index,
        requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof ChunkLoadError) {
        pauseForUnavailableChunk(
          getLatestEpisodeSnapshot(episode),
          index,
          e.message,
          e.markEpisodeFailed
        );
      } else {
        pauseAudio();
        setMediaSessionPlaybackState(false);
        setPlayer(prev => ({ ...prev, isPlaying: false }));
        setError(t('playback_failed'));
      }
    } finally {
      if (requestId === playRequestRef.current) {
        isLoadingChunkRef.current = false;
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

  const handleClosePlayer = () => {
    const activeEpisode = player.activeEpisode;
    if (activeEpisode) {
      const el = initAudioElement();
      const chunkOffset = getEpisodeOffset(activeEpisode, player.currentChunkIndex);
      const chunkTime = el.src
        ? el.currentTime || 0
        : Math.max(0, player.currentTime - chunkOffset);

      saveBookmark(activeEpisode.id, player.currentChunkIndex, chunkTime);
      flushLibraryPersistence();
    }

    stopSummaryPlayback();
    playRequestRef.current += 1;
    stopAudio();
    setMediaSessionPlaybackState(false);
    setIsLoadingChunk(false);
    setShowSpeedControls(false);
    setIsPlayerCollapsed(false);
    setPlayer(prev => ({
      ...prev,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      activeEpisode: null,
      currentChunkIndex: 0
    }));
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
      console.error('Could not resume playback', err);
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
    setIsDeletingEpisodeId(episode.id);
    try {
      if (authUser?.id) {
        markCloudSyncing();
        await deleteCloudEpisode(authUser.id, episode);
        markCloudReady();
      }

      await deleteAudioBlobsByPrefix(`${episode.audioBlobId}_`);
      await deleteAudioBlob(getSummaryAudioBlobId(episode));

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

      if (editingEpisodeId === episode.id) {
        closeEpisodeEditor();
      }

      updateLibrary(prev => prev.filter(x => x.id !== episode.id));
      setPendingDeleteEpisode((current) => current?.id === episode.id ? null : current);
    } catch (err) {
      setError('Could not delete the episode.');
    } finally {
      setIsDeletingEpisodeId(null);
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

  const buildImportFailureMessage = (
    kind: 'image' | 'document',
    failedNames: string[],
    successfulCount: number
  ) => {
    if (failedNames.length === 0) {
      return null;
    }

    if (successfulCount === 0) {
      return kind === 'image' ? t('image_import_failed') : t('document_import_failed');
    }

    if (failedNames.length === 1) {
      return kind === 'image'
        ? formatTemplate(t('image_import_partial_single'), { name: failedNames[0] })
        : formatTemplate(t('document_import_partial_single'), { name: failedNames[0] });
    }

    return kind === 'image'
      ? formatTemplate(t('image_import_partial_multiple'), { count: failedNames.length })
      : formatTemplate(t('document_import_partial_multiple'), { count: failedNames.length });
  };

  const processImages = async (
    rawFiles: File[],
    clearSource: () => void,
    source: 'camera' | 'images',
    replaceExistingText: boolean = false
  ) => {
    if (rawFiles.length === 0) {
      clearSource();
      return;
    }

    const files = sortFilesForReading(rawFiles);
    const importSession = startImportSession(source, replaceExistingText);
    setScanSource(source);
    setRetryNotice(null);
    setError(null);

    setScanSession({
      startedAt: Date.now(),
      totalItems: files.length,
      completedItems: 0,
      estimatedSeconds: estimateImageBatchScanSeconds(files)
    });
    await waitForNextPaint();

    const failedNames: string[] = [];
    let successfulCount = 0;
    let hasInsertedSeparator = false;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const cachedText = await readImportTextCache(file);
          if (cachedText?.trim()) {
            if (hasInsertedSeparator) {
              appendImportSessionText(importSession.id, '\n\n');
            }
            appendImportSessionText(importSession.id, cachedText);
            hasInsertedSeparator = true;
          } else {
            const optimizedFile = await optimizeImageForImport(file);
            const base64 = await readFileAsBase64(optimizedFile);
            let extractedText = '';
            if (hasInsertedSeparator) {
              appendImportSessionText(importSession.id, '\n\n');
            }
		            await streamIntoImportSession(importSession.id, async (onChunk) => {
		              try {
		                await streamTextFromImage(base64, optimizedFile.type || IMAGE_IMPORT_COMPRESSED_MIME, (textChunk) => {
		                  extractedText += textChunk;
		                  onChunk(textChunk);
		                });
		              } catch (error) {
		                throw withAiRequestContext(error, {
		                  functionName: source === 'camera' ? 'camera_ocr' : 'image_ocr',
		                  kind: 'OCR',
		                  provider: 'Gemini',
		                  model: 'gemini-3-flash-preview',
		                  textLength: file.size,
		                });
		              }
		            });
	            recordAiUsage('ocr', file.name, {
	              outputTextValue: extractedText,
	              model: 'gemini-3-flash-preview',
	            });
	            await writeImportTextCache(file, extractedText);
	            hasInsertedSeparator = true;
	          }
          successfulCount += 1;
          setRetryNotice(null);
        } catch (error) {
          console.error('Image import failed', file.name, error);
          failedNames.push(file.name);
        }
        setScanSession(prev => prev ? { ...prev, completedItems: i + 1 } : prev);
      }
    } finally {
      completeImportSession(importSession.id);
      setScanSource(null);
      setScanSession(null);
      setRetryNotice(null);
      clearSource();
    }

    const failureMessage = buildImportFailureMessage('image', failedNames, successfulCount);
    if (failureMessage) {
      setError(failureMessage);
    }
  };

  const processDocuments = async (
    rawFiles: File[],
    clearSource: () => void,
    replaceExistingText: boolean = false
  ) => {
    if (rawFiles.length === 0) {
      clearSource();
      return;
    }

    const files = sortFilesForReading(rawFiles);
    const importSession = startImportSession('document', replaceExistingText);
    setScanSource('document');
    setRetryNotice(null);
    setError(null);
    setScanSession({
      startedAt: Date.now(),
      totalItems: files.length,
      completedItems: 0,
      estimatedSeconds: estimateDocumentBatchScanSeconds(files)
    });
    await waitForNextPaint();

    const failedNames: string[] = [];
    let successfulCount = 0;
    let hasInsertedSeparator = false;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
          const cachedText = await readImportTextCache(file);
          if (cachedText?.trim()) {
            if (hasInsertedSeparator) {
              appendImportSessionText(importSession.id, '\n\n');
            }
            appendImportSessionText(importSession.id, cachedText);
            hasInsertedSeparator = true;
          } else if (isTextDocumentFile(file)) {
            let extractedText = '';
            if (hasInsertedSeparator) {
              appendImportSessionText(importSession.id, '\n\n');
            }
            await streamIntoImportSession(importSession.id, async (onChunk) => {
              await streamLocalDocumentText(file, (textChunk) => {
                extractedText += textChunk;
                onChunk(textChunk);
              });
            });
            await writeImportTextCache(file, extractedText);
            hasInsertedSeparator = true;
          } else {
            const base64 = await readFileAsBase64(file);
            let extractedText = '';
            if (hasInsertedSeparator) {
              appendImportSessionText(importSession.id, '\n\n');
            }
		            await streamIntoImportSession(importSession.id, async (onChunk) => {
		              try {
		                await streamTextFromPdf(base64, (textChunk) => {
		                  extractedText += textChunk;
		                  onChunk(textChunk);
		                });
		              } catch (error) {
		                throw withAiRequestContext(error, {
		                  functionName: 'pdf_ocr',
		                  kind: 'OCR',
		                  provider: 'Gemini',
		                  model: 'gemini-2.5-flash',
		                  textLength: file.size,
		                });
		              }
		            });
	            recordAiUsage('ocr', file.name, {
	              outputTextValue: extractedText,
	              model: 'gemini-2.5-flash',
	            });
	            await writeImportTextCache(file, extractedText);
	            hasInsertedSeparator = true;
	          }
          successfulCount += 1;
          setRetryNotice(null);
        } catch (error) {
          console.error('Document import failed', file.name, error);
          failedNames.push(file.name);
        }

        setScanSession(prev => prev ? { ...prev, completedItems: i + 1 } : prev);
      }
    } finally {
      completeImportSession(importSession.id);
      setScanSource(null);
      setScanSession(null);
      setRetryNotice(null);
      clearSource();
    }

    const failureMessage = buildImportFailureMessage('document', failedNames, successfulCount);
    if (failureMessage) {
      setError(failureMessage);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const replaceExistingText = shouldReplaceExistingImportText();
    await processImages(Array.from(fileList) as File[], () => {
      e.target.value = '';
    }, 'images', replaceExistingText);
  };

  const appendFilesToCameraShots = (rawFiles: File[]) => {
    if (rawFiles.length === 0) {
      return;
    }

    const nextShots = rawFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setCameraShots((currentShots) => [...currentShots, ...nextShots]);
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }

    appendFilesToCameraShots(Array.from(fileList) as File[]);
    e.target.value = '';
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const replaceExistingText = shouldReplaceExistingImportText();
    await processDocuments(Array.from(fileList) as File[], () => {
      e.target.value = '';
    }, replaceExistingText);
  };

  const handleLinkImport = async () => {
    if (isInputLocked) {
      return;
    }

    const rawUrl = linkImportUrl.trim();
    if (!rawUrl) {
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeImportUrl(rawUrl);
    } catch {
      setError(t('link_invalid_error'));
      return;
    }

    setError(null);
    setRetryNotice(null);
    setScanSource('link');
    setScanSession({
      startedAt: Date.now(),
      totalItems: 1,
      completedItems: 0,
      estimatedSeconds: 8,
    });
    await waitForNextPaint();

    const importSession = startImportSession('link');

    try {
	      const cachedText = await readUrlImportCache(normalizedUrl);
		      const wasCached = Boolean(cachedText?.trim());
		      let extractedText = cachedText;
		      if (!wasCached) {
		        try {
		          extractedText = await extractWebPageText(normalizedUrl, makeRetryOptions());
		        } catch (error) {
		          throw withAiRequestContext(error, {
		            functionName: 'link_import',
		            kind: /\.pdf(?:$|[?#])/i.test(normalizedUrl) ? 'OCR' : 'WEB',
		            provider: 'Gemini',
		            model: /\.pdf(?:$|[?#])/i.test(normalizedUrl) ? 'gemini-2.5-flash' : 'local-html-extract',
		            textLength: normalizedUrl.length,
		          });
		        }
		      }

	      if (!wasCached && /\.pdf(?:$|[?#])/i.test(normalizedUrl)) {
	        recordAiUsage('web', normalizedUrl, {
	          outputTextValue: extractedText,
	          model: 'gemini-2.5-flash',
	        });
	      }

      replaceImportSessionText(importSession.id, extractedText);
      completeImportSession(importSession.id);
      await writeUrlImportCache(normalizedUrl, extractedText);
      setScanSession(prev => prev ? { ...prev, completedItems: 1 } : prev);
      setLinkImportUrl('');
      setRetryNotice(null);
    } catch (error) {
      console.error('Link import failed', error);
      setError(error instanceof Error && error.message ? error.message : t('link_import_failed'));
      completeImportSession(importSession.id);
    } finally {
      setScanSource(null);
      setScanSession(null);
      setRetryNotice(null);
    }
  };

  const openCameraCapture = () => {
    if (isBusy || isCameraImporting) {
      return;
    }

    setError(null);
    setCameraError(null);
    setShowCameraCapture(true);
  };

  const hideCameraCapture = () => {
    stopCameraStream();
    setCameraError(null);
    setIsCameraBooting(false);
    setShowCameraCapture(false);
  };

  const closeCameraCapture = () => {
    hideCameraCapture();
    revokeCameraShotPreviews(cameraShots);
    setCameraShots([]);
    setIsCameraImporting(false);
  };

  const handleOpenNativeCamera = () => {
    setCameraError(null);
    cameraInputRef.current?.click();
  };

  const handleCaptureCameraShot = async () => {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError(t('camera_permission_error'));
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('No canvas context available.');
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, IMAGE_IMPORT_COMPRESSED_MIME, 0.92);
      const timestamp = Date.now();
      const file = new File([blob], `${CAMERA_CAPTURE_FILENAME_PREFIX}-${timestamp}.jpg`, {
        type: IMAGE_IMPORT_COMPRESSED_MIME,
        lastModified: timestamp,
      });

      setCameraShots(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(blob),
        }
      ]);
      setCameraError(null);
    } catch (error) {
      console.error('Could not capture the camera frame', error);
      setCameraError(t('camera_permission_error'));
    }
  };

  const removeCameraShot = (shotId: string) => {
    setCameraShots((currentShots) => {
      const shot = currentShots.find((candidate) => candidate.id === shotId);
      if (shot) {
        URL.revokeObjectURL(shot.previewUrl);
      }

      return currentShots.filter((candidate) => candidate.id !== shotId);
    });
  };

  const handleImportCameraShots = async () => {
    if (cameraShots.length === 0 || isCameraImporting) {
      return;
    }

    const shotsToImport = [...cameraShots];
    const replaceExistingText = shouldReplaceExistingImportText();
    setIsCameraImporting(true);
    hideCameraCapture();

    try {
      await processImages(shotsToImport.map((shot) => shot.file), () => {}, 'camera', replaceExistingText);
    } finally {
      revokeCameraShotPreviews(shotsToImport);
      setCameraShots([]);
      setIsCameraImporting(false);
    }
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
		      const translationCacheKey = await buildTranslationCacheKey(inputText, lang);
		      const cachedTranslation = await getImportTextCache(translationCacheKey).catch((error) => {
		        console.warn('Could not read translation cache', error);
		        return null;
		      });
		      let translated = cachedTranslation?.trim() ? cachedTranslation : '';
		      if (!translated) {
		        try {
		          translated = await translateText(inputText, lang, makeRetryOptions());
		        } catch (error) {
		          throw withAiRequestContext(error, {
		            functionName: 'translate_text',
		            kind: 'TRANSLATE',
		            provider: 'Gemini',
		            model: 'gemini-3-flash-preview',
		            textLength: inputText.length,
		          });
		        }
		      }
		      setRetryNotice(null);
		      if (!cachedTranslation?.trim()) {
		        recordAiUsage('translate', inputText, {
		          outputTextValue: translated,
		          model: 'gemini-3-flash-preview',
		        });
		        await saveImportTextCache(translationCacheKey, translated).catch((error) => {
		          console.warn('Could not write translation cache', error);
		        });
		      }
		      setInputText(translated);
		    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Translation failed.');
    }
    finally {
      setIsTranslating(false);
      setTranslateSession(null);
      setRetryNotice(null);
    }
  };

  const redirectAfterAuth = () => {
    const redirect = getRedirectParam() ?? intendedRouteRef.current ?? DEFAULT_AUTHENTICATED_PATH;
    replaceWithRoute(redirect);
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
        setShowAuthPanel(false);
        redirectAfterAuth();
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
      if (data.session) {
        setShowAuthPanel(false);
        redirectAfterAuth();
      }
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

  const handleSendPasswordReset = async () => {
    if (!supabase || !authEmail.trim()) {
      return;
    }

    setIsAuthLoading(true);
    setAuthFeedback(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}${LOGIN_PATH}` : undefined,
      });

      if (error) {
        throw error;
      }

      setAuthFeedback({
        kind: 'success',
        message: t('auth_reset_sent'),
      });
    } catch (error) {
      console.error('Supabase reset password misslyckades', error);
      const message = error instanceof Error ? error.message : 'Password reset failed.';
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
      libraryRef.current = [];
      setLibrary([]);
      hasHydratedLibraryRef.current = false;
      handleClosePlayer();
      setAuthPassword('');
      setAuthFeedback({
        kind: 'success',
        message: t('auth_success_signed_out'),
      });
      replaceWithRoute(LOGIN_PATH);
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
        label: scanSource === 'camera'
          ? t('scanning_camera')
          : scanSource === 'images'
            ? t('scanning_images')
            : scanSource === 'link'
              ? t('scanning_link')
              : t('scanning_pdf'),
        remainingSeconds: Math.max(0, scanSession.estimatedSeconds * (1 - progress)),
        progress,
      };
    }

    return null;
  })();
  const resolvedModalNotes = normalizeEpisodeNotes(showNotesModal?.notes, userLang);
  const isModalSummaryGenerating = showNotesModal
    ? summaryGenerationEpisodeId === showNotesModal.id
    : false;
  const isModalSummaryLoading = showNotesModal
    ? (summaryPlayback.episodeId === showNotesModal.id && summaryPlayback.isLoading) || isModalSummaryGenerating
    : false;
  const isModalSummaryPlaying = showNotesModal
    ? summaryPlayback.episodeId === showNotesModal.id && summaryPlayback.isPlaying
    : false;
  const activeEpisodeBookmarks = player.activeEpisode?.bookmarks ?? [];
  const isActiveEpisodeNotesGenerating = player.activeEpisode
    ? summaryGenerationEpisodeId === player.activeEpisode.id
    : false;
  const isActiveEpisodeSummaryLoading = player.activeEpisode
    ? (summaryPlayback.episodeId === player.activeEpisode.id && summaryPlayback.isLoading) || isActiveEpisodeNotesGenerating
    : false;
  const isActiveEpisodeSummaryPlaying = player.activeEpisode
    ? summaryPlayback.episodeId === player.activeEpisode.id && summaryPlayback.isPlaying
    : false;
	  const activeEpisodeRuntime = player.activeEpisode
	    ? formatTime(getEpisodeDuration(player.activeEpisode))
	    : formatTime(player.duration);
	  const isAiLimitAppError = appError?.code === 'TOKEN_LIMIT' ||
	    (appError?.code === 'RATE_LIMIT' && /ai|tts|limit/i.test(`${appError.title} ${appError.message}`));
	  const activePrimaryButtonProgressPercent = activePrimaryButton
    ? Math.max(8, Math.min(100, Math.round(activePrimaryButton.progress * 100)))
    : 0;
	  const activeImportSession = importSessionRef.current;
	  const usageSummary = buildAiUsageSummary(aiUsage);
	  const hasReachedEstimatedAiLimit = usageSummary.remainingPercent <= 0;
	  const canGenerateFromImportSession = (() => {
	    if (!isScanning || !activeImportSession) return false;
	    const sourceText = composeImportedText(activeImportSession.baseText, activeImportSession.text).trim();
	    if (!sourceText) return false;
	    const { allChunks, finalizedCount } = getImportChunkWindow(sourceText, activeImportSession.isComplete);
	    return finalizedCount >= getRequiredLiveReadyChunks(allChunks, finalizedCount, activeImportSession.isComplete);
	  })();
	  const isInputLocked = isBusy || isScanning;
	  const isGenerateDisabled = isBusy || !inputText.trim() || (isScanning && !canGenerateFromImportSession) || hasReachedEstimatedAiLimit;
	  const hasPodcastText = inputText.trim().length > 0;
	  const usageBarClass = usageSummary.status === 'green'
	    ? 'bg-emerald-400'
	    : usageSummary.status === 'orange'
	      ? 'bg-amber-400'
	      : usageSummary.status === 'red'
	        ? 'bg-red-400'
	        : 'bg-zinc-400';
	  const usageToneClass = usageSummary.status === 'green'
	    ? 'border-emerald-200/70 bg-emerald-50/94 text-emerald-800'
	    : usageSummary.status === 'orange'
	      ? 'border-amber-200/80 bg-amber-50/95 text-amber-800'
	      : 'border-red-200/80 bg-red-50/95 text-red-800';
  const notesLabels = getNotesLabels(userLang);
  const authStatusEmail = authUser?.email || authSession?.user?.email || authEmail.trim();
  const isAuthSubmitDisabled = isAuthLoading || !authEmail.trim() || !authPassword.trim();
  const libraryCategories = collectLibraryCategories(library);
  const displayedLibrary = sortLibraryEpisodes(
    library.filter(episode =>
      activeCategoryFilter === 'all' || episodeMatchesCategory(episode, activeCategoryFilter)
    ),
    librarySortMode
  );
  const editingEpisode = editingEpisodeId
    ? library.find(episode => episode.id === editingEpisodeId) ?? null
    : null;
  const cloudFeedbackTone = cloudFeedback?.kind === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : cloudFeedback?.kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-[#d8d0ed] bg-[#eee9f8] text-[#4d3d93]';
  const importStatusLabel = scanSource
    ? t('scanning_progress')
    : inputText.trim()
      ? t('import_status_ready')
      : null;
  const speechCleanupTooltip = useSpeechCleanup
    ? t('speech_cleanup_tooltip_on')
    : t('speech_cleanup_tooltip_off');
  const speechCleanupButtonLabel = useSpeechCleanup
    ? t('speech_cleanup_label_on')
    : t('speech_cleanup_label_off');
  const cameraCountStatus = formatTemplate(t('camera_count_status'), { count: cameraShots.length });
  const selectedVoiceLabel = getVoiceDisplayName(selectedVoice);
  const librarySortLabel = librarySortMode === 'oldest'
    ? t('sort_oldest')
    : librarySortMode === 'title'
      ? t('sort_title')
      : t('sort_newest');
  const isSummaryDirty = resolvedModalNotes
    ? summaryTitleDraft.trim() !== resolvedModalNotes.title || summaryBodyDraft.trim() !== resolvedModalNotes.summary
    : false;
  const activeLayoutPreset = LAYOUT_PRESET;
  const subtleLabelClass = 'text-[10px] font-black uppercase tracking-[0.22em] text-[#5f5497]';
  const darkFieldClass = 'w-full rounded-2xl border border-[#d8d0ed] bg-white px-4 py-4 text-sm font-semibold text-zinc-900 outline-none shadow-[0_12px_28px_-22px_rgba(32,15,93,0.22)] focus:ring-2 focus:ring-[#7763BE]/22';
  const darkButtonClass = 'rounded-2xl border border-[#d8d0ed] bg-white text-zinc-900 shadow-[0_18px_36px_-28px_rgba(32,15,93,0.18)] transition-colors hover:bg-[#f7f4fc]';
  const accentButtonClass = 'bg-gradient-to-r from-[#391BA6] via-[#30168C] to-[#7763BE] text-white shadow-[0_20px_38px_-20px_rgba(57,27,166,0.42)]';
  const libraryItemIdleClass = 'bg-[linear-gradient(180deg,rgba(242,242,242,0.98),rgba(232,226,246,0.96))] border-[#d8d0ed] text-zinc-900 shadow-[0_26px_64px_-46px_rgba(32,15,93,0.28)] backdrop-blur';
  const libraryItemActiveClass = 'bg-gradient-to-br from-[#391BA6] via-[#30168C] to-[#7763BE] text-white border-transparent shadow-[0_24px_60px_-36px_rgba(57,27,166,0.34)]';

	  const openEpisodeEditor = (episode: PodcastEpisode) => {
	    setEditingEpisodeId(episode.id);
	    setEpisodeTitleDraft(episode.title);
	    setCategoryDraft(getEpisodeCategories(episode).join(', '));
	    setEpisodeTextDraft(episode.text);
	    setEpisodeEditorTab('details');
	  };

	  const closeEpisodeEditor = () => {
	    setEditingEpisodeId(null);
	    setEpisodeTitleDraft('');
	    setCategoryDraft('');
	    setEpisodeTextDraft('');
	    setEpisodeEditorTab('details');
	  };

  const saveEpisodeEdits = () => {
    if (!editingEpisode) return;
	    patchEpisode(editingEpisode.id, {
	      title: truncateText(episodeTitleDraft, 70) || editingEpisode.title,
	      categories: parseCategoryInput(categoryDraft),
	      text: episodeTextDraft,
	    });
    closeEpisodeEditor();
  };

  const saveSummaryEdits = () => {
    if (!showNotesModal || !resolvedModalNotes) return;

    const updatedNotes: EpisodeNotes = {
      ...resolvedModalNotes,
      title: truncateText(summaryTitleDraft, 70) || resolvedModalNotes.title,
      summary: truncateText(summaryBodyDraft, MAX_NOTE_SUMMARY_CHARACTERS) || resolvedModalNotes.summary,
    };

    patchEpisode(showNotesModal.id, { notes: updatedNotes });
    setShowNotesModal((current) => current ? { ...current, notes: updatedNotes } : current);
    setIsEditingSummary(false);
  };

  const isForgotPasswordRoute = currentRoutePath === FORGOT_PASSWORD_PATH;
  const isAuthGateSubmitDisabled = isAuthLoading || !authEmail.trim() || (!isForgotPasswordRoute && !authPassword.trim());

  if (!isAuthReady) {
    return (
      <div lang={userLang} className={activeLayoutPreset.shellClassName}>
        <main className="flex min-h-[100dvh] items-center justify-center px-6">
          <div className="rounded-[2rem] border border-[#d8d0ed]/90 bg-white/95 px-6 py-5 text-center shadow-[0_24px_64px_-42px_rgba(32,15,93,0.42)]">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#d8d0ed] border-t-[#391BA6]" />
            <p className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-[#4d3d93]">{t('auth_loading')}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        lang={userLang}
        className={activeLayoutPreset.shellClassName}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
      >
        <header className={activeLayoutPreset.headerClassName}>
          <div className={classNames(activeLayoutPreset.headerInnerClassName, 'justify-between')}>
            <h1 className={classNames('text-[0.88rem] font-black tracking-[0.01em] text-slate-100/88 md:text-[0.92rem]', activeLayoutPreset.brandClassName)}>VoxPod</h1>
            <button
              onClick={() => setUserLang(languageToggleTarget)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/16 bg-white/10 text-sm shadow-[0_10px_24px_-18px_rgba(0,0,0,0.28)] transition-colors hover:bg-white/16"
              aria-label={languageToggleLabel}
              title={languageToggleLabel}
            >
              <span aria-hidden="true">{languageToggleFlag}</span>
            </button>
          </div>
        </header>

        <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-start justify-center px-4 py-6 lg:items-center lg:px-8 lg:py-10">
          <div className="grid w-full gap-4 lg:grid-cols-[minmax(360px,1.05fr)_minmax(340px,0.95fr)] lg:items-start">
            {!isForgotPasswordRoute && (
              <section className={classNames('order-1 w-full overflow-hidden p-0', activeLayoutPreset.panelClassName)}>
                <div className="relative h-44 overflow-hidden sm:h-52">
                  <img
                    src={heroPreviewImage}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-[center_24%]"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(242,242,242,0.02),rgba(57,27,166,0.12)_28%,rgba(32,15,93,0.72)_100%)]" />
                  <div className="absolute bottom-4 left-5 right-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/72">Prova gratis</p>
                    <h2 className="mt-1 max-w-[18ch] text-2xl font-black leading-tight tracking-tight text-white">
                      Skapa ljud direkt från text
                    </h2>
                  </div>
                </div>

                <div className="space-y-3 p-5 text-left sm:p-6">
                  <div>
                    <p className={subtleLabelClass}>Prova gratis</p>
                    <h3 className="mt-1 text-lg font-black text-zinc-950">Skapa upp till 2 minuter ljud</h3>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                      En provgenerering utan konto. Logga in för att skapa och spara fullständiga poddar.
                    </p>
                  </div>
                  <textarea
                    value={demoText}
                    onChange={(event) => {
                      setDemoText(event.target.value.slice(0, PUBLIC_DEMO_MAX_CHARACTERS));
                      setDemoError(null);
                    }}
                    placeholder="Klistra in en kort text att provlyssna på..."
                    className="h-28 w-full resize-none rounded-2xl border border-[#d8d0ed] bg-white p-3 text-sm leading-relaxed text-zinc-800 outline-none focus:ring-2 focus:ring-[#7763BE]/22"
                  />
                  <div className="flex justify-between text-[10px] font-bold text-zinc-500">
                    <span>Max cirka {formatTime(PUBLIC_DEMO_MAX_SECONDS)}</span>
                    <span>{demoText.length} / {PUBLIC_DEMO_MAX_CHARACTERS}</span>
                  </div>
                  {demoTurnstileSiteKey ? (
                    <div ref={demoTurnstileContainerRef} className="min-h-[65px]" />
                  ) : (
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      Gratisprovet är inte aktiverat ännu. Du kan fortfarande logga in och använda VoxPod.
                    </p>
                  )}
                  {demoError && (
                    <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                      {demoError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => { void handleGeneratePublicDemo(); }}
                    disabled={!demoTurnstileSiteKey || !demoText.trim() || !demoTurnstileToken || isGeneratingDemo}
                    className={classNames('w-full min-h-[52px] rounded-2xl px-4 text-xs font-black text-white transition-all active:scale-95 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none', accentButtonClass)}
                  >
                    {isGeneratingDemo ? 'Skapar provljud...' : 'Prova VoxPod'}
                  </button>
                  {demoAudioUrl && (
                    <audio controls src={demoAudioUrl} className="w-full" aria-label="Provljud" />
                  )}
                </div>
              </section>
            )}

            <section
              className={classNames(
                'order-2 w-full space-y-4 p-5 text-left sm:p-6',
                activeLayoutPreset.panelClassName,
                isForgotPasswordRoute && 'mx-auto max-w-[430px] lg:col-span-2'
              )}
            >
              <div>
                <p className={subtleLabelClass}>VoxPod</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-zinc-950">
                  {isForgotPasswordRoute ? t('auth_forgot_tab') : authMode === 'signUp' ? t('auth_sign_up_tab') : t('auth_sign_in_tab')}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">Turn pages into podcasts - and keep your entire library synced wherever life takes you.</p>
              </div>

              {!isForgotPasswordRoute && (
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#ede8f8]/92 p-1">
                  <button
                    onClick={() => {
                      setAuthMode('signIn');
                      navigateToAuthRoute(LOGIN_PATH);
                    }}
                    title={t('auth_sign_in_tab')}
                    aria-label={t('auth_sign_in_tab')}
                    className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                      authMode === 'signIn' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
                    }`}
                  >
                    {t('auth_sign_in_tab')}
                  </button>
                  <button
                    onClick={() => {
                      setAuthMode('signUp');
                      navigateToAuthRoute(SIGNUP_PATH);
                    }}
                    title={t('auth_sign_up_tab')}
                    aria-label={t('auth_sign_up_tab')}
                    className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                      authMode === 'signUp' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
                    }`}
                  >
                    {t('auth_sign_up_tab')}
                  </button>
                </div>
              )}

              {authFeedback && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`rounded-2xl border px-4 py-3 text-xs font-bold ${
                    authFeedback.kind === 'error'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : authFeedback.kind === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-[#d8d0ed] bg-[#eee9f8] text-[#4d3d93]'
                  }`}
                >
                  {authFeedback.message}
                </div>
              )}

              <div className="grid gap-3">
                <div className="space-y-1">
                  <label htmlFor="auth-gate-email" className={classNames(subtleLabelClass, 'ml-2')}>{t('auth_email_label')}</label>
                  <input
                    id="auth-gate-email"
                    name="auth-gate-email"
                    type="email"
                    autoComplete="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className={darkFieldClass}
                  />
                </div>

                {!isForgotPasswordRoute && (
                  <div className="space-y-1">
                    <label htmlFor="auth-gate-password" className={classNames(subtleLabelClass, 'ml-2')}>{t('auth_password_label')}</label>
                    <input
                      id="auth-gate-password"
                      name="auth-gate-password"
                      type="password"
                      autoComplete={authMode === 'signIn' ? 'current-password' : 'new-password'}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className={darkFieldClass}
                    />
                  </div>
                )}
              </div>

              <button
                onClick={() => { void (isForgotPasswordRoute ? handleSendPasswordReset() : handleSubmitAuth()); }}
                disabled={isAuthGateSubmitDisabled}
                title={isForgotPasswordRoute ? t('auth_reset_btn') : authMode === 'signIn' ? t('auth_sign_in_btn') : t('auth_sign_up_btn')}
                aria-label={isForgotPasswordRoute ? t('auth_reset_btn') : authMode === 'signIn' ? t('auth_sign_in_btn') : t('auth_sign_up_btn')}
                className={classNames('w-full min-h-[64px] rounded-3xl font-black text-sm disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none active:scale-95 transition-all', accentButtonClass)}
              >
                {isAuthLoading
                  ? t('auth_loading')
                  : isForgotPasswordRoute
                  ? t('auth_reset_btn')
                  : authMode === 'signIn'
                  ? t('auth_sign_in_btn')
                  : t('auth_sign_up_btn')}
              </button>

              <div className="flex flex-wrap justify-center gap-3 text-[11px] font-black text-[#4d3d93]">
                {isForgotPasswordRoute ? (
                  <button onClick={() => navigateToAuthRoute(LOGIN_PATH)} className="underline decoration-[#7763BE]/40 underline-offset-4">
                    {t('auth_sign_in_tab')}
                  </button>
                ) : (
                  <button onClick={() => navigateToAuthRoute(FORGOT_PASSWORD_PATH)} className="underline decoration-[#7763BE]/40 underline-offset-4">
                    {t('auth_forgot_tab')}
                  </button>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      lang={userLang}
      className={activeLayoutPreset.shellClassName}
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
    >
      <header className={activeLayoutPreset.headerClassName}>
        <div className={classNames(activeLayoutPreset.headerInnerClassName, 'justify-between')}>
          <div className="flex items-center gap-2 text-left">
            <h1 className={classNames('text-[0.88rem] font-black tracking-[0.01em] text-slate-100/88 md:text-[0.92rem]', activeLayoutPreset.brandClassName)}>VoxPod</h1>
          </div>

	          <div className="flex items-center gap-2">
	            <div className="relative" ref={usagePanelRef}>
	              <button
	                type="button"
	                onMouseDown={(event) => event.stopPropagation()}
	                onClick={() => {
	                  setShowUsagePanel((current) => !current);
	                  setShowLangMenu(false);
	                  setShowVoiceMenu(false);
	                  setShowSortMenu(false);
	                }}
	                className={classNames(
	                  'inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-[10px] font-black shadow-[0_10px_24px_-18px_rgba(0,0,0,0.28)] transition-colors',
	                  usageSummary.status === 'green'
	                    ? 'border-emerald-200/28 bg-emerald-300/12 text-emerald-100 hover:bg-emerald-300/18'
	                    : usageSummary.status === 'orange'
	                      ? 'border-amber-200/30 bg-amber-300/14 text-amber-100 hover:bg-amber-300/20'
	                      : 'border-red-200/30 bg-red-300/14 text-red-100 hover:bg-red-300/20'
	                )}
	                aria-label="AI Remaining"
	                title="AI Remaining"
	              >
	                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.9]" aria-hidden="true">
	                  <path d="M9 3a3 3 0 0 0-3 3v1.2A3.5 3.5 0 0 0 4 10.4v.2a3.5 3.5 0 0 0 2 3.2V15a3 3 0 0 0 3 3" />
	                  <path d="M15 3a3 3 0 0 1 3 3v1.2a3.5 3.5 0 0 1 2 3.2v.2a3.5 3.5 0 0 1-2 3.2V15a3 3 0 0 1-3 3" />
	                  <path d="M9 3v18" />
	                  <path d="M15 3v18" />
	                  <path d="M9 9H7" />
	                  <path d="M15 9h2" />
	                  <path d="M9 15H7" />
	                  <path d="M15 15h2" />
	                </svg>
	                <span className="hidden sm:inline">AI Remaining</span>
	                <span>{usageSummary.remainingPercent}%</span>
	              </button>

	              {showUsagePanel && (
	                <div className="animate-in fade-in slide-in-from-top-2 absolute right-0 top-full z-50 mt-2 w-[min(330px,calc(100vw-2rem))] overflow-hidden rounded-[1.65rem] border border-[#d8d0ed]/90 bg-[linear-gradient(180deg,rgba(242,242,242,0.98),rgba(229,223,245,0.97))] p-4 text-zinc-900 shadow-[0_28px_72px_-34px_rgba(20,10,55,0.44)] backdrop-blur-xl duration-200">
	                  <div className="flex items-start justify-between gap-3">
	                    <div>
	                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5f5497]">AI Usage</p>
	                      <p className="mt-1 text-2xl font-black tracking-tight text-zinc-950">{usageSummary.remainingPercent}% remaining</p>
	                    </div>
	                    <span className={classNames('rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em]', usageToneClass)}>
	                      Estimated
	                    </span>
	                  </div>

	                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/80 shadow-inner">
	                    <div
	                      className={classNames('h-full rounded-full transition-all duration-500', usageBarClass)}
	                      style={{ width: `${usageSummary.remainingPercent}%` }}
	                    />
	                  </div>

	                  <div className="mt-4 grid grid-cols-2 gap-2">
	                    <div className="rounded-2xl border border-white/70 bg-white/72 p-3">
	                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Podcasts left</p>
	                      <p className="mt-1 text-lg font-black text-zinc-950">≈ {usageSummary.estimatedPodcastsLeft}</p>
	                    </div>
	                    <div className="rounded-2xl border border-white/70 bg-white/72 p-3">
	                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">This month</p>
	                      <p className="mt-1 text-lg font-black text-zinc-950">{formatTokenDisplay(usageSummary.totalTokens)}</p>
	                    </div>
	                  </div>

	                  <p className="mt-3 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-xs font-bold leading-relaxed text-zinc-700">
	                    {usageSummary.message}
	                  </p>

	                  {usageSummary.remainingPercent <= 10 && (
	                    <div className={classNames('mt-3 rounded-2xl border px-3 py-2 text-xs font-black', usageToneClass)}>
	                      {usageSummary.remainingPercent <= 5 ? 'Optimize usage before starting a long podcast.' : 'AI usage is below 10%.'}
	                    </div>
	                  )}

	                  {usageSummary.remainingPercent <= 5 && usageSummary.remainingPercent > 0 && (
	                    <button
	                      type="button"
	                      onClick={() => setUseSpeechCleanup(true)}
	                      className="mt-3 w-full rounded-2xl bg-[#391BA6] px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white shadow-[0_18px_36px_-26px_rgba(57,27,166,0.42)]"
	                    >
	                      Optimize usage
	                    </button>
	                  )}

	                  <button
	                    type="button"
	                    onClick={() => setShowUsageDetails((current) => !current)}
	                    className="mt-3 flex w-full items-center justify-between rounded-2xl border border-[#d8d0ed] bg-white/80 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#391BA6]"
	                  >
	                    <span>Details</span>
	                    <span aria-hidden="true">{showUsageDetails ? '−' : '+'}</span>
	                  </button>

	                  {showUsageDetails && (
	                    <div className="mt-3 grid gap-2 rounded-2xl border border-white/70 bg-white/62 p-3 text-xs font-bold text-zinc-700">
	                      <div className="flex justify-between gap-3"><span>Tokens used</span><span>{formatTokenDisplay(usageSummary.totalTokens)} / {formatTokenDisplay(aiUsage.monthlyBudgetTokens)}</span></div>
	                      <div className="flex justify-between gap-3"><span>Tokens remaining</span><span>{formatTokenDisplay(usageSummary.remainingTokens)}</span></div>
	                      <div className="flex justify-between gap-3"><span>Summaries left</span><span>≈ {usageSummary.estimatedSummariesLeft}</span></div>
	                      <div className="flex justify-between gap-3"><span>Audio minutes left</span><span>≈ {usageSummary.estimatedAudioMinutesLeft}</span></div>
	                      <div className="flex justify-between gap-3"><span>Current model</span><span className="max-w-[150px] truncate text-right">{usageSummary.currentModel}</span></div>
	                      <div className="flex justify-between gap-3"><span>Last update</span><span>{formatCompactDateTime(usageSummary.lastUpdate)}</span></div>
	                    </div>
	                  )}
	                </div>
	              )}
	            </div>

	            <button
	              onClick={() => setUserLang(languageToggleTarget)}
	              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/16 bg-white/10 text-sm shadow-[0_10px_24px_-18px_rgba(0,0,0,0.28)] transition-colors hover:bg-white/16"
              aria-label={languageToggleLabel}
              title={languageToggleLabel}
            >
              <span aria-hidden="true">{languageToggleFlag}</span>
            </button>

          {isSupabaseConfigured && (
            <button
              onClick={() => setShowAuthPanel((current) => !current)}
              className={classNames(
                'inline-flex items-center gap-2 rounded-full px-1.5 py-1 text-[10px] font-black transition-colors',
                authUser
                  ? 'text-emerald-200/95 hover:bg-white/10 hover:text-emerald-100'
                  : 'text-slate-200 hover:bg-white/10 hover:text-white'
              )}
              aria-label={t('auth_open_btn')}
              title={t('auth_open_btn')}
            >
              {authUser ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  <span className="hidden sm:inline">{t('auth_status_signed_in_short')}</span>
                </>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                  <path d="M4 20a8 8 0 0 1 16 0" />
                </svg>
              )}
            </button>
          )}
          </div>
        </div>
      </header>

      <main
        className={activeLayoutPreset.mainClassName}
        style={{
          paddingBottom: `${contentBottomInset + 32}px`,
          scrollPaddingBottom: `${contentBottomInset + 32}px`
        }}
      >
	        {error && (
	          <div role="alert" aria-live="assertive" className="md:col-span-2 flex items-center justify-between rounded-[1.75rem] border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-700 shadow-[0_18px_45px_-32px_rgba(239,68,68,0.18)]">
	            <span>{error}</span>
	            <button onClick={() => { setError(null); setAppError(null); }} className="px-2 text-xl text-red-500" title={t('close_btn')} aria-label={t('close_btn')}>×</button>
	          </div>
	        )}

	        {usageSummary.remainingPercent <= 10 && (
	          <div role="status" aria-live="polite" className={classNames('md:col-span-2 rounded-[1.75rem] border p-4 text-xs font-black shadow-[0_18px_45px_-32px_rgba(32,15,93,0.2)]', usageToneClass)}>
	            {usageSummary.remainingPercent <= 0
	              ? "You've reached your AI limit."
	              : usageSummary.remainingPercent <= 5
	                ? 'AI usage is nearly exhausted. Use shorter text or optimize usage.'
	                : 'AI usage is below 10%.'}
	          </div>
	        )}

	        <section className={activeLayoutPreset.heroClassName}>
          <img
            src={heroPreviewImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[center_24%]"
          />
          <div className={activeLayoutPreset.heroGlowClassName} />
          <div className={activeLayoutPreset.heroGridClassName}>
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(242,242,242,0.02),rgba(57,27,166,0.12)_24%,rgba(32,15,93,0.86)_100%)]" />
            <div className="relative z-[2] text-left">
              <h3 className="max-w-[17ch] text-[1.45rem] font-black leading-[1.02] tracking-tight text-white sm:text-[1.6rem] md:text-[1.78rem]">
                {t('hero_preview_title')}
              </h3>
            </div>
          </div>
        </section>

        <label htmlFor="camera-upload" className="sr-only">{t('camera_btn')}</label>
        <input id="camera-upload" name="camera-upload" type="file" ref={cameraInputRef} onChange={handleCameraCapture} accept="image/*" capture="environment" multiple className="hidden" aria-label={t('camera_btn')} />
        <label htmlFor="image-upload" className="sr-only">{t('images_btn')}</label>
        <input id="image-upload" name="image-upload" type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden" aria-label={t('images_btn')} />
        <label htmlFor="document-upload" className="sr-only">{t('docs_btn')}</label>
        <input id="document-upload" name="document-upload" type="file" ref={documentInputRef} onChange={handleDocumentUpload} accept={DOCUMENT_UPLOAD_ACCEPT} multiple className="hidden" aria-label={t('docs_btn')} />

        <div className="order-2 space-y-3 md:col-start-1 md:row-start-2 md:order-none">
          <section className={classNames('space-y-4 p-4 sm:p-5', activeLayoutPreset.panelClassName)}>
            <div className="flex items-center justify-between gap-3">
              <span className={subtleLabelClass}>{t('imported_text_label')}</span>
              <div className="flex items-center gap-2">
                {importStatusLabel && (
                  <span role="status" aria-live="polite" className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">
                    {importStatusLabel}
                  </span>
                )}
                <button
                  onClick={() => {
                    setInputText('');
                  }}
                  disabled={!inputText || isInputLocked}
                  title={t('clear_btn_title')}
                  aria-label={t('clear_btn_title')}
                  className="rounded-full border border-[#d8d0ed] bg-white px-3.5 py-1.5 text-[10px] font-black text-zinc-800 shadow-[0_14px_28px_-24px_rgba(32,15,93,0.18)] transition-colors hover:bg-[#f7f4fc] disabled:bg-zinc-100 disabled:text-zinc-400"
                >
                  {t('clear_btn')}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-[#d8d0ed] bg-[#ede8f8]/88 p-2.5 shadow-[0_18px_36px_-34px_rgba(32,15,93,0.22)] backdrop-blur">
              <div className="grid grid-cols-3 gap-2.5">
              <button
                onClick={() => documentInputRef.current?.click()}
                disabled={isInputLocked}
                title={t('docs_btn_hint')}
                aria-label={t('docs_btn_hint')}
                className="flex min-w-0 h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-[#d8d0ed] bg-white px-3 text-[10px] font-black text-zinc-900 shadow-[0_16px_30px_-24px_rgba(32,15,93,0.18)] transition-all hover:bg-[#f7f4fc] active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                {scanSource === 'document' ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#391BA6]" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                    <path d="M8 4h6l4 4v12H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
                    <path d="M14 4v4h4" />
                    <path d="M9 13h6" />
                    <path d="M9 17h6" />
                  </svg>
                )}
                <span>{t('docs_btn')}</span>
              </button>
              <button
                onClick={openCameraCapture}
                disabled={isInputLocked}
                title={t('camera_btn_hint')}
                aria-label={t('camera_btn_hint')}
                className="flex min-w-0 h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-[#d8d0ed] bg-white px-3 text-[10px] font-black text-zinc-800 shadow-[0_16px_30px_-24px_rgba(32,15,93,0.18)] transition-all hover:bg-[#f7f4fc] active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                {scanSource === 'camera' ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#391BA6]" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                    <path d="M5 8h3l1.4-2h5.2L16 8h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
                    <circle cx="12" cy="13" r="3.2" />
                  </svg>
                )}
                <span>{t('camera_btn')}</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isInputLocked}
                title={t('images_btn_hint')}
                aria-label={t('images_btn_hint')}
                className="flex min-w-0 h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-[#d8d0ed] bg-white px-3 text-[10px] font-black text-zinc-800 shadow-[0_16px_30px_-24px_rgba(32,15,93,0.18)] transition-all hover:bg-[#f7f4fc] active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                {scanSource === 'images' ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-[#391BA6]" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="m7 15 3-3 3 2 4-4 2 2" />
                    <circle cx="9" cy="9" r="1.2" />
                  </svg>
                )}
                <span>{t('images_btn')}</span>
              </button>
              </div>

              <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <label htmlFor="link-import" className="sr-only">{t('link_btn_hint')}</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-zinc-400">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                      <path d="M10 14 7 17a3 3 0 1 1-4-4l3-3a3 3 0 0 1 4 0" />
                      <path d="m14 10 3-3a3 3 0 1 1 4 4l-3 3a3 3 0 0 1-4 0" />
                      <path d="m8 16 8-8" />
                    </svg>
                  </span>
                  <input
                    id="link-import"
                    name="link-import"
                    value={linkImportUrl}
                    onChange={(event) => setLinkImportUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleLinkImport();
                      }
                    }}
                    disabled={isInputLocked}
                    placeholder={t('link_placeholder')}
                    aria-label={t('link_btn_hint')}
                    className="w-full rounded-2xl border border-[#d8d0ed] bg-white py-3 pl-11 pr-4 text-sm font-semibold text-zinc-900 outline-none shadow-[0_12px_28px_-22px_rgba(32,15,93,0.18)] focus:ring-2 focus:ring-[#7763BE]/22 disabled:bg-zinc-100 disabled:text-zinc-400"
                  />
                </div>
                <button
                  onClick={() => { void handleLinkImport(); }}
                  disabled={isInputLocked || !linkImportUrl.trim()}
                  title={t('link_btn_hint')}
                  aria-label={t('link_btn_hint')}
                  className={classNames('min-h-[50px] rounded-2xl px-4 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-all active:scale-[0.98] disabled:bg-zinc-300 disabled:text-zinc-500', accentButtonClass)}
                >
                  {scanSource === 'link' ? t('loading_text') : t('link_import_btn')}
                </button>
              </div>
            </div>

            {(cameraShots.length > 0 || isCameraImporting) && (
              <div className="space-y-3 rounded-3xl border border-[#d8d0ed] bg-white/92 p-4 shadow-[0_18px_36px_-34px_rgba(32,15,93,0.18)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={subtleLabelClass}>{t('camera_pending_title')}</p>
                    <p className="mt-1 text-sm font-black text-zinc-900">{cameraCountStatus}</p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">{t('camera_pending_hint')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={openCameraCapture}
                      disabled={isCameraImporting}
                      title={t('camera_take_next_btn')}
                      aria-label={t('camera_take_next_btn')}
                      className={classNames('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all active:scale-[0.98]', darkButtonClass)}
                    >
                      {t('camera_take_next_btn')}
                    </button>
                    <button
                      onClick={closeCameraCapture}
                      disabled={isCameraImporting}
                      title={t('cancel_btn')}
                      aria-label={t('cancel_btn')}
                      className={classNames('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400', darkButtonClass)}
                    >
                      {t('cancel_btn')}
                    </button>
                    <button
                      onClick={() => { void handleImportCameraShots(); }}
                      disabled={cameraShots.length === 0 || isCameraImporting}
                      title={t('camera_done_btn')}
                      aria-label={t('camera_done_btn')}
                      className={classNames('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-all active:scale-[0.98] disabled:bg-zinc-300 disabled:text-zinc-500', accentButtonClass)}
                    >
                      {isCameraImporting ? t('loading_text') : t('camera_done_btn')}
                    </button>
                  </div>
                </div>

                {cameraShots.length > 0 && (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {cameraShots.map((shot, index) => (
                      <div key={shot.id} className="relative w-24 shrink-0 overflow-hidden rounded-[1.3rem] border border-[#d8d0ed] bg-[#f8f6fc]">
                        <img src={shot.previewUrl} alt="" className="h-24 w-full object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">#{index + 1}</span>
                          <button
                            onClick={() => removeCameraShot(shot.id)}
                            disabled={isCameraImporting}
                            title={t('camera_remove_photo_btn')}
                            aria-label={t('camera_remove_photo_btn')}
                            className="text-[10px] font-black text-[#391BA6] disabled:text-zinc-400"
                          >
                            {t('camera_remove_photo_btn')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-hidden rounded-3xl border border-[#d8d0ed] bg-white/96">
              <label htmlFor="podcast-text" className="sr-only">{t('placeholder_text')}</label>
              <textarea
                id="podcast-text"
                name="podcast-text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isInputLocked}
                placeholder={t('placeholder_text')}
                className="h-32 w-full resize-none bg-transparent p-4 text-sm leading-relaxed text-zinc-800 outline-none transition-all placeholder:text-zinc-400 focus:ring-2 focus:ring-[#7763BE]/22 disabled:text-zinc-400 lg:h-52"
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className={classNames(subtleLabelClass, 'ml-2')}>{t('voice_label')}</label>
                <div className="relative">
                  <button
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => {
                    setShowVoiceMenu((current) => !current);
                    setShowLangMenu(false);
                    setShowSortMenu(false);
                  }}
                  disabled={isInputLocked}
                  title={t('voice_label')}
                  aria-label={t('voice_label')}
                    className="flex w-full items-center justify-between rounded-2xl border border-[#d8d0ed] bg-white px-4 py-3.5 text-[11px] font-black text-zinc-900 shadow-[0_16px_34px_-28px_rgba(32,15,93,0.18)] transition-colors hover:bg-[#f7f4fc] disabled:bg-zinc-100 disabled:text-zinc-400"
                  >
                    <span>{selectedVoiceLabel}</span>
                    <span
                      className={classNames(
                        'ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d8d0ed] bg-[#eee9f8] text-[#391BA6] shadow-[0_12px_24px_-18px_rgba(57,27,166,0.28)] transition-transform',
                        showVoiceMenu && 'rotate-180'
                      )}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[2.4]">
                        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>

                  {showVoiceMenu && (
                    <div
                      ref={voiceMenuRef}
                      className="custom-scrollbar animate-in fade-in slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2 grid max-h-[260px] min-w-full gap-1 overflow-y-auto rounded-2xl border border-[#d8d0ed] bg-[#f3effb] p-2 py-3 shadow-[0_22px_52px_-32px_rgba(32,15,93,0.24)] outline-none duration-200"
                    >
                      {PREMIUM_VOICES.map((voice) => {
                        const isSelected = voice.name === selectedVoice;

                        return (
                          <button
                            key={voice.name}
                            type="button"
                            onClick={() => {
                              setSelectedVoice(voice.name);
                              setShowVoiceMenu(false);
                            }}
                            title={voice.label}
                            aria-label={voice.label}
                            className={classNames(
                              'flex items-center justify-between rounded-2xl px-4 py-3 text-left text-[11px] font-semibold transition-colors',
                              isSelected ? 'bg-[#ece5fb] text-zinc-900' : 'text-zinc-700 hover:bg-[#eee9f8]'
                            )}
                          >
                            <span>{voice.label}</span>
                            <span className={classNames('text-xs', isSelected ? 'text-[#391BA6]' : 'text-transparent')}>✓</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setUseSpeechCleanup((current) => !current)}
                  aria-pressed={useSpeechCleanup}
                  aria-label={speechCleanupTooltip}
                  title={speechCleanupTooltip}
                  className={classNames(
                    'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold shadow-[0_14px_28px_-24px_rgba(32,15,93,0.16)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7763BE]/30',
                    useSpeechCleanup
                      ? 'border-[#cfc5ea] bg-[#eee9f8] text-[#391BA6] hover:bg-[#e8e0fa]'
                      : 'border-[#d8d0ed] bg-white text-zinc-500 hover:bg-[#f7f4fc] hover:text-zinc-800'
                  )}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]" aria-hidden="true">
                    <path d="M4 6h16" />
                    <path d="M7 12h10" />
                    <path d="M10 18h4" />
                    {useSpeechCleanup && <path d="m5 5 14 14" />}
                  </svg>
                  <span>{speechCleanupButtonLabel}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="relative">
                <button
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    setShowLangMenu((current) => !current);
                    setShowVoiceMenu(false);
                    setShowSortMenu(false);
                  }}
                  disabled={isInputLocked || !inputText}
                  title={t('translate_btn_hint')}
                  aria-label={t('translate_btn_hint')}
                  className={classNames('flex min-w-0 min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#391BA6] px-3 text-[10px] font-black text-white shadow-[0_18px_36px_-24px_rgba(57,27,166,0.42)] transition-all active:scale-[0.98] disabled:bg-zinc-200 disabled:text-zinc-500 sm:text-[11px]', !isInputLocked && inputText ? 'hover:bg-[#30168C]' : '')}
                >
                  {isTranslating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                      {t('translating_short')}
                    </span>
                  ) : t('translate_btn')}
                </button>

                {showLangMenu && (
                  <div
                    ref={langMenuRef}
                    onKeyDown={handleLangKeyDown}
                    tabIndex={0}
                    className="custom-scrollbar animate-in fade-in slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2 grid max-h-[280px] min-w-[180px] gap-1 overflow-y-auto rounded-2xl border border-[#d8d0ed] bg-[#f3effb] p-2 py-3 shadow-[0_22px_52px_-32px_rgba(32,15,93,0.24)] outline-none duration-200"
                  >
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => handleTranslate(lang.code)}
                        title={lang.labels[userLang]}
                        aria-label={lang.labels[userLang]}
                        className="whitespace-nowrap rounded-2xl px-4 py-2.5 text-left text-[11px] font-black text-zinc-700 transition-colors hover:bg-[#eee9f8] focus:bg-[#eee9f8] focus:outline-none active:bg-[#ece5fb]"
                      >
                        {lang.labels[userLang]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerateDisabled}
                title={t('generate_btn_hint')}
                aria-label={t('generate_btn_hint')}
	                className={classNames(
	                  'relative min-w-0 min-h-[58px] overflow-hidden rounded-2xl px-4 py-3 text-left text-[11px] font-black text-white transition-all active:scale-95 disabled:text-white',
	                  hasPodcastText
	                    ? 'bg-gradient-to-r from-[#391BA6] via-[#30168C] to-[#7763BE] shadow-[0_20px_38px_-20px_rgba(57,27,166,0.42)] disabled:bg-gradient-to-r disabled:from-[#391BA6] disabled:via-[#30168C] disabled:to-[#7763BE]'
	                    : 'bg-[#7763BE] shadow-[0_18px_36px_-24px_rgba(119,99,190,0.38)] disabled:bg-[#7763BE]',
	                  isGenerateDisabled && !hasPodcastText
	                    ? 'disabled:opacity-70 disabled:shadow-[0_18px_36px_-24px_rgba(119,99,190,0.28)]'
	                    : 'disabled:opacity-100 disabled:shadow-[0_20px_38px_-20px_rgba(57,27,166,0.42)]'
	                )}
              >
                {activePrimaryButton && (
                  <div
                    className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgba(57,27,166,0.96),rgba(83,57,190,0.92))] transition-all duration-500"
                    style={{ width: `${Math.min(100, activePrimaryButton.progress * 100)}%` }}
                  />
                )}
                {activePrimaryButton && (
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04))]" />
                )}
                <div className="relative z-10">
                  {activePrimaryButton ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.18em] text-white/80">
                        <span>{t('progress_label')}</span>
                        <span>{activePrimaryButtonProgressPercent}%</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
                          <span className="truncate">{activePrimaryButton.label}</span>
                        </span>
                        <span className="shrink-0 text-right tabular-nums">
                          {formatCountdown(activePrimaryButton.remainingSeconds)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                        <div
                          className="h-full rounded-full bg-white transition-all duration-500"
                          style={{ width: `${activePrimaryButtonProgressPercent}%` }}
                        />
                      </div>
                      {retryNotice && (
                        <div className="mt-2 text-[10px] font-bold normal-case tracking-normal text-white/85">
                          {retryNotice}
                        </div>
                      )}
                    </div>
	                  ) : hasReachedEstimatedAiLimit ? (
	                    "You've reached your AI limit."
	                  ) : (
	                    t('generate_btn')
	                  )}
                </div>
              </button>
            </div>

          </section>
        </div>

        <section className="order-3 relative space-y-4 md:col-start-2 md:row-start-2 md:order-none md:self-start">
          <div className="flex items-center justify-between gap-3 px-2">
            <h2 className="min-w-0 text-left text-lg font-black text-slate-100">{t('library_title')}</h2>
            <div className="relative z-30 shrink-0" ref={sortMenuRef}>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setShowSortMenu((current) => !current);
                  setShowLangMenu(false);
                  setShowVoiceMenu(false);
                }}
                title={t('sort_label')}
                aria-label={t('sort_label')}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d8d0ed] bg-white px-3 text-[10px] font-black text-zinc-900 shadow-[0_16px_30px_-26px_rgba(32,15,93,0.2)] transition-colors hover:bg-[#f7f4fc]"
              >
                <span>{t('sort_label')}</span>
                <span className="max-w-[72px] truncate text-[#391BA6]">{librarySortLabel}</span>
                <span aria-hidden="true">▾</span>
              </button>

              {showSortMenu && (
                <div
                  className="custom-scrollbar animate-in fade-in slide-in-from-top-2 absolute right-0 top-full z-[35] mt-2 grid min-w-[150px] gap-1 overflow-hidden rounded-2xl border border-[#d8d0ed] bg-[linear-gradient(180deg,rgba(242,242,242,0.99),rgba(234,229,248,0.97))] p-2 shadow-[0_28px_64px_-36px_rgba(32,15,93,0.3)] duration-200"
                >
                  {(['newest', 'oldest', 'title'] as LibrarySortMode[]).map((mode) => {
                    const label = mode === 'oldest' ? t('sort_oldest') : mode === 'title' ? t('sort_title') : t('sort_newest');
                    const isSelected = librarySortMode === mode;

                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setLibrarySortMode(mode);
                          setShowSortMenu(false);
                        }}
                        title={label}
                        aria-label={label}
                        className={classNames(
                          'flex items-center justify-between rounded-2xl px-4 py-3 text-left text-[11px] font-black transition-colors',
                          isSelected ? 'bg-[#ece5fb] text-zinc-900 shadow-[0_14px_28px_-26px_rgba(57,27,166,0.26)]' : 'text-zinc-700 hover:bg-[#eee9f8]'
                        )}
                      >
                        <span>{label}</span>
                        <span className={classNames('text-xs', isSelected ? 'text-[#391BA6]' : 'text-transparent')}>✓</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className={classNames('relative z-20 space-y-3 p-4', activeLayoutPreset.panelClassName)}>

            {libraryCategories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveCategoryFilter('all')}
                    title={t('all_categories')}
                    aria-label={t('all_categories')}
                    className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black transition-colors ${
                    activeCategoryFilter === 'all'
                      ? 'bg-[#391BA6] text-white'
                      : 'border border-[#d8d0ed] bg-white text-zinc-800'
                  }`}
                >
                  {t('all_categories')}
                </button>
                {libraryCategories.map((category) => (
                  <button
                    key={category}
                  onClick={() => setActiveCategoryFilter(category)}
                  title={category}
                  aria-label={category}
                  className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-black transition-colors ${
                    normalizeCategoryKey(activeCategoryFilter) === normalizeCategoryKey(category)
                      ? 'bg-[#391BA6] text-white'
                      : 'border border-[#d8d0ed] bg-white text-zinc-800'
                  }`}
                >
                  {category}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative z-10 grid gap-3">
            {displayedLibrary.map((ep) => {
              const isActiveEpisode = player.activeEpisode?.id === ep.id;
              const episodeCategories = getEpisodeCategories(ep);
              const episodeVoice = getVoiceDisplayName(ep.voice);
              const episodeRuntime = formatTime(getEpisodeDuration(ep));
              const libraryActionClass = isActiveEpisode
                ? 'border-white/15 bg-white/12 text-white hover:bg-white/18'
                : 'border-[#d8d0ed] bg-white/96 text-slate-600 hover:bg-[#f7f4fc] hover:text-slate-900';

              return (
                <div
                  key={ep.id}
                  onClick={() => handlePlayEpisode(ep)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handlePlayEpisode(ep);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={`${t('open_episode_title')}: ${ep.title}`}
                  aria-label={`${t('open_episode_title')}: ${ep.title}`}
                  className={classNames(
                    'relative w-full min-w-0 cursor-pointer rounded-[2rem] border p-4 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7763BE]/35 sm:p-5',
                    isActiveEpisode ? libraryItemActiveClass : libraryItemIdleClass
                  )}
                >
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDeleteEpisode(ep);
                    }}
                    disabled={isDeletingEpisodeId === ep.id}
                    title={t('delete_episode_title')}
                    aria-label={t('delete_episode_title')}
                    className={classNames(
                      'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-2xl border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      isActiveEpisode
                        ? 'border-white/12 bg-white/8 text-white/86 hover:bg-white/16'
                        : 'border-[#d8d0ed] bg-white/96 text-slate-500 hover:bg-[#f7f4fc] hover:text-slate-900'
                    )}
                  >
                    {isDeletingEpisodeId === ep.id ? (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-current/25 border-t-current animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                        <path d="M5 7h14" />
                        <path d="M9 7V5h6v2" />
                        <path d="m8 10 1 8h6l1-8" />
                      </svg>
                    )}
                  </button>

                  <div className="flex items-start gap-3">
                    <div className={classNames(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                      isActiveEpisode ? 'bg-white/18 text-white' : 'bg-white text-[#391BA6] shadow-[0_16px_28px_-24px_rgba(57,27,166,0.24)]'
                    )}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-[1.8]">
                        <path d="M4 14v-4" />
                        <path d="M8 17V11" />
                        <path d="M12 20V8" />
                        <path d="M16 15v-6" />
                        <path d="M20 13v-2" />
                      </svg>
                    </div>

                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-start justify-between gap-3 pr-12">
                        <div className="min-w-0">
                          <h3 className="truncate text-[15px] font-black tracking-tight">{ep.title}</h3>
                        </div>
                        <span className={classNames(
                          'shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black',
                          isActiveEpisode ? 'bg-white/14 text-white/90' : 'border border-[#d8d0ed] bg-[#eee9f8] text-[#4d3d93]'
                        )}>
                          {episodeRuntime}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
	                        <span className={classNames(
	                          'rounded-full px-2.5 py-1 text-[9px] font-black',
	                          isActiveEpisode ? 'bg-white/14 text-white/88' : 'border border-[#d8d0ed] bg-white text-[#4d3d93]'
	                        )}>
	                          {t('voice_label')}: {episodeVoice}
	                        </span>
	                        {ep.generationCost && (
	                          <span
	                            className={classNames(
	                              'rounded-full px-2.5 py-1 text-[9px] font-black',
	                              isActiveEpisode ? 'bg-white/14 text-white/88' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
	                            )}
	                            title={`Calculated from Gemini API reported usage: ${formatTokenDisplay(ep.generationCost.totalTokens)} tokens across ${ep.generationCost.billableRequests} audio request(s), using paid-tier pricing.`}
	                          >
	                            Paid-tier cost: {formatUsdCost(ep.generationCost.totalCostUsd)}
	                          </span>
	                        )}
	                        {ep.generationCost && (
	                          <span className={classNames(
	                            'rounded-full px-2.5 py-1 text-[9px] font-black',
	                            isActiveEpisode ? 'bg-white/12 text-white/84' : 'bg-[#ede8f8] text-[#5f5497]'
	                          )}>
	                            {formatTokenDisplay(ep.generationCost.totalTokens)} API tokens
	                          </span>
	                        )}
	                        {(episodeCategories.length > 0 ? episodeCategories : [t('uncategorized_label')]).map((category) => (
                          <span
                            key={`${ep.id}-${category}`}
                            className={classNames(
                              'rounded-full px-2.5 py-1 text-[9px] font-black',
                              isActiveEpisode ? 'bg-white/12 text-white/84' : 'bg-[#ede8f8] text-[#5f5497]'
                            )}
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openEpisodeEditor(ep);
                      }}
                      className={classNames('inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-2 text-[10px] font-black transition-colors', libraryActionClass)}
                      title={t('edit_episode_btn')}
                      aria-label={t('edit_episode_btn')}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                        <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                        <path d="m12 6 4 4" />
                      </svg>
                      <span>{t('edit_episode_btn')}</span>
                    </button>
	                    <button
	                      onClick={(event) => {
	                        event.stopPropagation();
	                        void handlePlaySummary(ep);
	                      }}
	                      className={classNames('inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-2 text-[10px] font-black transition-colors', libraryActionClass)}
	                      title={summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
	                      aria-label={summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
	                    >
	                      {(summaryPlayback.episodeId === ep.id && summaryPlayback.isLoading) || summaryGenerationEpisodeId === ep.id ? (
	                        <div className="h-3.5 w-3.5 rounded-full border-2 border-[#d8d0ed] border-t-[#391BA6] animate-spin" />
	                      ) : summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying ? (
	                        <span className="text-[11px] font-black">II</span>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                          <path d="M5 10v4" />
                          <path d="M9 8v8" />
                          <path d="M13 6v12" />
                          <path d="M17 9v6" />
	                          <path d="M21 11v2" />
	                        </svg>
	                      )}
	                      <span>{summaryPlayback.episodeId === ep.id && summaryPlayback.isPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}</span>
	                    </button>
	                    <button
	                      onClick={(event) => {
	                        event.stopPropagation();
	                        void handleOpenSummary(ep);
	                      }}
	                      className={classNames('inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-2 text-[10px] font-black transition-colors', libraryActionClass)}
	                      title={t('notes_title')}
	                      aria-label={t('notes_title')}
	                    >
	                      {summaryGenerationEpisodeId === ep.id ? (
	                        <div className="h-3.5 w-3.5 rounded-full border-2 border-[#d8d0ed] border-t-[#391BA6] animate-spin" />
	                      ) : (
	                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
	                          <path d="M7 4h10a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z" />
	                          <path d="M9 9h6" />
	                          <path d="M9 12h6" />
	                        </svg>
	                      )}
	                      <span>{t('notes_title')}</span>
	                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDownloadEpisode(ep);
                      }}
                      disabled={ep.generationStatus === 'processing' || ep.generationStatus === 'failed'}
                      className={classNames('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40', libraryActionClass)}
                      title={t('download_mp3_title')}
                      aria-label={t('download_mp3_title')}
                    >
                      {isDownloading === ep.id || ep.generationStatus === 'processing' ? (
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-[#d8d0ed] border-t-[#391BA6] animate-spin" />
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                          <path d="M12 4v10" />
                          <path d="m8 10 4 4 4-4" />
                          <path d="M5 19h14" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
            {library.length === 0 && (
              <p className="rounded-[2rem] border-2 border-dashed border-[#d8d0ed] py-10 text-center text-[10px] font-bold uppercase tracking-widest text-[#d9d0ef]">{t('empty_library')}</p>
            )}
            {library.length > 0 && displayedLibrary.length === 0 && (
              <p className="rounded-[2rem] border-2 border-dashed border-[#d8d0ed] py-10 text-center text-[10px] font-bold uppercase tracking-widest text-[#d9d0ef]">{t('empty_category_filter')}</p>
            )}
          </div>
        </section>

      </main>

      {pendingGenerationPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.24)] p-5 backdrop-blur-sm animate-in fade-in duration-200">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="generation-preview-title"
            className="w-full max-w-[440px] space-y-4 rounded-[2.2rem] border border-[#d8d0ed] bg-[#f1edf9] p-5 text-left shadow-[0_36px_90px_-54px_rgba(32,15,93,0.42)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={subtleLabelClass}>Innan du skapar</p>
                <h2 id="generation-preview-title" className="mt-2 text-xl font-black tracking-tight text-zinc-950">
                  {pendingGenerationPreview.episodeTexts.length > 1
                    ? `Texten delas upp i ${pendingGenerationPreview.episodeTexts.length} poddar`
                    : 'Skapa denna podd?'}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                  Beräkningen är en uppskattning. Faktiska tokens och kostnad loggas efter skapandet.
                </p>
              </div>
              <button
                onClick={() => setPendingGenerationPreview(null)}
                className="text-2xl leading-none text-zinc-400 hover:text-zinc-700"
                aria-label="Stäng"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm font-bold text-zinc-800">
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">Längd</p>
                <p className="mt-1 text-base font-black">{formatTime(pendingGenerationPreview.durationSeconds)}</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">API-anrop</p>
                <p className="mt-1 text-base font-black">{pendingGenerationPreview.requestCount}</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">Tokens behövs</p>
                <p className="mt-1 text-base font-black">ca {formatTokenDisplay(pendingGenerationPreview.totalTokens)}</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500">Betalpris</p>
                <p className="mt-1 text-base font-black">ca {formatUsdCost(pendingGenerationPreview.totalCostUsd)}</p>
              </div>
            </div>

            <p className="rounded-2xl border border-[#d8d0ed] bg-white/65 px-3 py-2 text-xs font-bold text-zinc-700">
              Din visade tokenbudget efter skapandet: cirka {formatTokenDisplay(Math.max(0, usageSummary.remainingTokens - pendingGenerationPreview.totalTokens))} tokens kvar.
            </p>

            {pendingGenerationPreview.episodeTexts.length > 1 && (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                Ett avsnitt begränsas till cirka 1 timme för stabil skapning och uppspelning.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingGenerationPreview(null)}
                className={classNames('min-h-[50px] rounded-2xl px-4 text-xs font-black', darkButtonClass)}
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => { void confirmPodcastGeneration(); }}
                className={classNames('min-h-[50px] rounded-2xl px-4 text-xs font-black', accentButtonClass)}
              >
                {pendingGenerationPreview.episodeTexts.length > 1
                  ? `Skapa ${pendingGenerationPreview.episodeTexts.length} poddar`
                  : 'Skapa podd'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isSupabaseConfigured && showAuthPanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.16)] backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowAuthPanel(false)}
          />
          <div className="fixed inset-x-0 top-0 z-50 px-4 pt-16 md:px-5 lg:px-6">
            <div className="mx-auto flex max-w-[430px] justify-end md:max-w-[860px] lg:max-w-6xl">
              <section
                className={classNames('w-full max-w-[380px] space-y-4 p-5 animate-in fade-in slide-in-from-top-2 slide-in-from-right-4 duration-300', activeLayoutPreset.panelClassName)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="account-panel-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="text-left">
                    <h2 id="account-panel-title" className="text-lg font-black text-zinc-950">{t('auth_title')}</h2>
                    {!authUser && (
                      <p className="mt-2 text-base font-black tracking-tight text-zinc-950">
                        {t('hero_feature_title')}
                      </p>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                      {authUser ? t('auth_subtitle_signed_in') : t('auth_subtitle_signed_out')}
                    </p>
                  </div>

                  <button
                    onClick={() => setShowAuthPanel(false)}
                    className="text-2xl text-zinc-400 transition-colors hover:text-zinc-700"
                    aria-label={t('close_btn')}
                    title={t('close_btn')}
                  >
                    ×
                  </button>
                </div>

                {cloudFeedback && (
                  <div role="status" aria-live="polite" className={`rounded-2xl border px-4 py-3 text-xs font-bold ${cloudFeedbackTone}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span>{isCloudSyncing ? t('cloud_status_syncing') : cloudFeedback.message}</span>
                      {isCloudSyncing && (
                        <button
                          type="button"
                          onClick={cancelCloudSync}
                          className="shrink-0 rounded-full border border-current/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] transition-colors hover:bg-white/60"
                          title={t('cloud_cancel_btn')}
                          aria-label={t('cloud_cancel_btn')}
                        >
                          {t('cloud_cancel_btn')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {authFeedback && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded-2xl border px-4 py-3 text-xs font-bold ${
                      authFeedback.kind === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : authFeedback.kind === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-[#d8d0ed] bg-[#eee9f8] text-[#4d3d93]'
                    }`}
                  >
                    {authFeedback.message}
                  </div>
                )}

                {authUser ? (
                  <>
                    <div className="rounded-3xl border border-[#d8d0ed] bg-[#eee9f8]/88 p-5 text-left">
                      <p className={subtleLabelClass}>{t('auth_signed_in_as')}</p>
                      <p className="mt-2 break-all text-sm font-bold text-zinc-900">{authStatusEmail}</p>
                    </div>

                    <button
                      onClick={() => { void handleSignOut(); }}
                      disabled={isAuthLoading}
                      title={t('auth_sign_out_btn')}
                      aria-label={t('auth_sign_out_btn')}
                      className={classNames('w-full min-h-[58px] rounded-3xl font-black text-sm disabled:bg-zinc-200 disabled:text-zinc-500 active:scale-95 transition-all', darkButtonClass)}
                    >
                      {t('auth_sign_out_btn')}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#ede8f8]/92 p-1">
                      <button
                        onClick={() => setAuthMode('signIn')}
                        title={t('auth_sign_in_tab')}
                        aria-label={t('auth_sign_in_tab')}
                        className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                          authMode === 'signIn' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
                        }`}
                      >
                        {t('auth_sign_in_tab')}
                      </button>
                      <button
                        onClick={() => setAuthMode('signUp')}
                        title={t('auth_sign_up_tab')}
                        aria-label={t('auth_sign_up_tab')}
                        className={`rounded-2xl px-4 py-3 text-[11px] font-black transition-colors ${
                          authMode === 'signUp' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
                        }`}
                      >
                        {t('auth_sign_up_tab')}
                      </button>
                    </div>

                    <div className="grid gap-3">
                      <div className="space-y-1">
                        <label htmlFor="auth-email" className={classNames(subtleLabelClass, 'ml-2')}>{t('auth_email_label')}</label>
                        <input
                          id="auth-email"
                          name="auth-email"
                          type="email"
                          autoComplete="email"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          className={darkFieldClass}
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="auth-password" className={classNames(subtleLabelClass, 'ml-2')}>{t('auth_password_label')}</label>
                        <input
                          id="auth-password"
                          name="auth-password"
                          type="password"
                          autoComplete={authMode === 'signIn' ? 'current-password' : 'new-password'}
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          className={darkFieldClass}
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => { void handleSubmitAuth(); }}
                      disabled={isAuthSubmitDisabled}
                      title={authMode === 'signIn' ? t('auth_sign_in_btn') : t('auth_sign_up_btn')}
                      aria-label={authMode === 'signIn' ? t('auth_sign_in_btn') : t('auth_sign_up_btn')}
                      className={classNames('w-full min-h-[64px] rounded-3xl font-black text-sm disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none active:scale-95 transition-all', accentButtonClass)}
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
            </div>
          </div>
        </>
      )}

      {appError && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.22)] p-5 backdrop-blur-sm animate-in fade-in duration-200">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-error-title"
            aria-describedby="app-error-message"
            className="w-full max-w-[420px] space-y-4 rounded-[2.2rem] border border-red-100 bg-[#fef7f7] p-5 text-left shadow-[0_36px_90px_-54px_rgba(127,29,29,0.42)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500">{appError.code}</p>
                <h3 id="app-error-title" className="mt-2 text-xl font-black tracking-tight text-zinc-950">{appError.title}</h3>
                <p id="app-error-message" className="mt-2 text-sm leading-relaxed text-zinc-600">{appError.message}</p>
              </div>
              <button
                onClick={() => {
                  setAppError(null);
                  setError(null);
                }}
                className="text-2xl leading-none text-zinc-400 transition-colors hover:text-zinc-700"
                title={t('close_btn')}
                aria-label={t('close_btn')}
              >
                ×
              </button>
            </div>

	            <div className="grid gap-2 sm:grid-cols-2">
	              <button
	                onClick={retryAppErrorAction}
	                className={classNames('min-h-[48px] rounded-2xl px-4 text-xs font-black uppercase tracking-[0.12em] transition-all active:scale-95', accentButtonClass)}
	              >
	                {appError.actionLabel ?? 'Retry'}
	              </button>
	              {isAiLimitAppError && (
	                <button
	                  onClick={useSmallerPodcastFromError}
	                  className={classNames('min-h-[48px] rounded-2xl px-4 text-xs font-black uppercase tracking-[0.12em] transition-all active:scale-95', darkButtonClass)}
	                >
	                  Use shorter text
	                </button>
	              )}
	              <button
	                onClick={() => { void copyAppErrorDetails(); }}
	                className={classNames('min-h-[48px] rounded-2xl px-4 text-xs font-black uppercase tracking-[0.12em] transition-all active:scale-95', isAiLimitAppError ? 'sm:col-span-2' : '', darkButtonClass)}
	              >
	                Copy technical details
              </button>
            </div>
          </section>
        </div>
      )}

      {player.activeEpisode && (
        <div ref={playerShellRef} className={activeLayoutPreset.playerShellClassName}>
          <div className="pointer-events-auto mx-auto flex w-full max-w-5xl flex-col gap-4">
            {isPlayerCollapsed ? (
              <div className="flex items-center gap-3 rounded-[2rem] border border-[#d8d0ed] bg-white/92 px-4 py-3 shadow-[0_22px_40px_-32px_rgba(32,15,93,0.26)]">
                <button
                  onClick={() => { void handleTogglePlay(); }}
                  title={player.isPlaying ? t('pause_btn') : t('play_btn')}
                  aria-label={player.isPlaying ? t('pause_btn') : t('play_btn')}
                  className={classNames('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg text-white', accentButtonClass)}
                >
                  {isLoadingChunk ? (
                    <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    player.isPlaying ? '❚❚' : '▶'
                  )}
                </button>
                <div className="min-w-0 flex-1 text-left">
                  <h4 className="truncate text-[13px] font-black text-zinc-900">{player.activeEpisode.title}</h4>
                  <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {t('now_playing_label')} · {formatTime(player.currentTime)} / {activeEpisodeRuntime}
                  </p>
                </div>
                <button
                  onClick={() => setIsPlayerCollapsed(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#d8d0ed] bg-white text-zinc-700 shadow-[0_14px_28px_-24px_rgba(32,15,93,0.22)]"
                  title={t('player_show')}
                  aria-label={t('player_show')}
                >
                  ↑
                </button>
                <button
                  onClick={handleClosePlayer}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#d8d0ed] bg-white text-xl leading-none text-zinc-700 shadow-[0_14px_28px_-24px_rgba(32,15,93,0.22)] transition-colors hover:bg-[#f7f4fc]"
                  title={t('player_close')}
                  aria-label={t('player_close')}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="rounded-[2.25rem] border border-[#d8d0ed] bg-white/88 p-4 shadow-[0_28px_54px_-40px_rgba(32,15,93,0.32)] sm:p-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={subtleLabelClass}>{t('now_playing_label')}</p>
                        <span className="rounded-full border border-[#d8d0ed] bg-[#eee9f8] px-3 py-1.5 text-[10px] font-black text-[#4d3d93]">
                          {t('runtime_label')}: {activeEpisodeRuntime}
                        </span>
                      </div>
                      <h4 className="mt-2 truncate text-[15px] font-black tracking-tight text-zinc-950 sm:text-[16px]">
                        {player.activeEpisode.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsPlayerCollapsed(true)}
                        className={classNames('flex h-10 w-10 items-center justify-center rounded-2xl text-lg font-black', darkButtonClass)}
                        title={t('player_hide')}
                        aria-label={t('player_hide')}
                      >
                        ↓
                      </button>

                      <button
                        onClick={handleClosePlayer}
                        className={classNames('flex h-10 w-10 items-center justify-center rounded-2xl text-xl leading-none', darkButtonClass)}
                        title={t('player_close')}
                        aria-label={t('player_close')}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <div className="ml-auto grid min-w-0 grid-cols-[auto_auto_2.5rem_2.5rem_2.5rem] items-center gap-1.5 max-[380px]:grid-cols-[auto_auto_2.25rem_2.25rem_2.25rem] sm:flex sm:flex-wrap sm:gap-2">
	                      {player.activeEpisode && (
	                        <>
	                          <button
	                            onClick={() => { if (player.activeEpisode) void handleOpenSummary(player.activeEpisode); }}
	                            title={t('notes_title')}
	                            aria-label={t('notes_title')}
	                            className={classNames('whitespace-nowrap rounded-2xl px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.08em] sm:px-3 sm:text-[10px] sm:tracking-[0.12em]', darkButtonClass)}
	                          >
	                            {isActiveEpisodeNotesGenerating ? t('loading_text') : t('notes_title')}
	                          </button>
                          <button
                            onClick={() => { if (player.activeEpisode) void handlePlaySummary(player.activeEpisode); }}
                            title={isActiveEpisodeSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                            aria-label={isActiveEpisodeSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                            className={classNames('whitespace-nowrap rounded-2xl px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-white disabled:bg-zinc-300 disabled:text-zinc-500 sm:px-3 sm:text-[10px] sm:tracking-[0.12em]', accentButtonClass)}
                          >
                            {isActiveEpisodeSummaryLoading ? t('loading_text') : isActiveEpisodeSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => setShowSpeedControls(prev => !prev)}
                        className={classNames('inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-black max-[380px]:h-9 max-[380px]:w-9', darkButtonClass)}
                        title={showSpeedControls ? t('speed_toggle_hide') : t('speed_toggle_show')}
                        aria-label={showSpeedControls ? t('speed_toggle_hide') : t('speed_toggle_show')}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                          <path d="M5 16a7 7 0 0 1 14 0" />
                          <path d="M12 16l4-5" />
                          <path d="M8 20h8" />
                        </svg>
                      </button>

                      <button
                        onClick={handleAddEpisodeBookmark}
                        className={classNames('inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-black max-[380px]:h-9 max-[380px]:w-9', darkButtonClass)}
                        title={t('add_bookmark_btn')}
                        aria-label={t('add_bookmark_btn')}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                          <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" />
                        </svg>
                      </button>

                      <button
                        onClick={() => { if (player.activeEpisode) void handleDownloadEpisode(player.activeEpisode); }}
                        disabled={isDownloading === player.activeEpisode.id || player.activeEpisode.generationStatus === 'processing' || player.activeEpisode.generationStatus === 'failed'}
                        className={classNames('inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-50 max-[380px]:h-9 max-[380px]:w-9', darkButtonClass)}
                        title={t('download_mp3_title')}
                        aria-label={t('download_mp3_title')}
                      >
                        {isDownloading === player.activeEpisode.id ? (
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-current/25 border-t-current animate-spin" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                            <path d="M12 4v10" />
                            <path d="m8 10 4 4 4-4" />
                            <path d="M5 19h14" />
                          </svg>
                        )}
                      </button>

                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/90 shadow-inner">
                    <div
                      className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-[#391BA6] via-[#30168C] to-[#7763BE] transition-all duration-300 ease-out shadow-[0_0_12px_rgba(57,27,166,0.28)]"
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
                      aria-label={t('playback_position_label')}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-10"
                    />
                  </div>
                  <div className="flex justify-between px-1.5">
                    <span className="text-[10px] font-black tabular-nums tracking-tight text-zinc-800">{formatTime(player.currentTime)}</span>
                    <span className="text-[10px] font-black tabular-nums tracking-tight text-zinc-500">-{formatTime(Math.max(0, player.duration - player.currentTime))}</span>
                  </div>
                </div>

                {showSpeedControls && (
                  <div className="mt-4 rounded-[1.75rem] border border-[#d8d0ed] bg-[#eee9f8]/92 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <label htmlFor="player-speed-slider" className={subtleLabelClass}>{t('speed_label')}</label>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-zinc-900 shadow-[0_14px_26px_-22px_rgba(15,23,42,0.2)]">{playbackRate.toFixed(1)}x</span>
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
                      className="mt-3 h-1.5 w-full appearance-none cursor-pointer rounded-lg bg-slate-200 accent-[#391BA6]"
                    />
                  </div>
                )}

                {activeEpisodeBookmarks.length > 0 && (
                  <div className="mt-4 rounded-[1.75rem] border border-[#d8d0ed] bg-[#eee9f8]/92 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className={subtleLabelClass}>{t('bookmarks_title')}</span>
                      <span className="text-[10px] font-black text-zinc-500">{activeEpisodeBookmarks.length}</span>
                    </div>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {activeEpisodeBookmarks.map((bookmark) => (
                        <button
                          key={bookmark.id}
                          onClick={() => { if (player.activeEpisode) void jumpToEpisodeTime(player.activeEpisode, bookmark.time); }}
                          title={formatTime(bookmark.time)}
                          aria-label={formatTime(bookmark.time)}
                          className="shrink-0 rounded-full border border-[#d8d0ed] bg-white px-3 py-2 text-[11px] font-black text-zinc-900 transition-colors hover:bg-[#f7f4fc]"
                        >
                          {formatTime(bookmark.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 rounded-[1.9rem] border border-[#d8d0ed] bg-[#eee9f8]/94 px-4 py-4 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => { void handleSkip(-15); }}
                      title={t('skip_back_btn')}
                      aria-label={t('skip_back_btn')}
                      className="flex min-w-[64px] flex-col items-center gap-0.5 rounded-2xl px-2 py-2 text-[10px] font-black text-zinc-600 transition-colors active:scale-90 hover:text-zinc-900"
                    >
                      <span className="text-lg">↺</span>
                      <span className="mt-[-4px]">15</span>
                    </button>
                    <button
                      onClick={() => { void handleTogglePlay(); }}
                      title={player.isPlaying ? t('pause_btn') : t('play_btn')}
                      aria-label={player.isPlaying ? t('pause_btn') : t('play_btn')}
                      className={classNames('relative flex h-16 w-16 items-center justify-center rounded-full text-xl text-white transition-all active:scale-95', accentButtonClass)}
                    >
                      {isLoadingChunk ? (
                        <div className="h-5 w-5 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                      ) : (
                        player.isPlaying ? '❚❚' : '▶'
                      )}
                    </button>
                    <button
                      onClick={() => { void handleSkip(30); }}
                      title={t('skip_forward_btn')}
                      aria-label={t('skip_forward_btn')}
                      className="flex min-w-[64px] flex-col items-center gap-0.5 rounded-2xl px-2 py-2 text-[10px] font-black text-zinc-600 transition-colors active:scale-90 hover:text-zinc-900"
                    >
                      <span className="text-lg">↻</span>
                      <span className="mt-[-4px]">30</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showCameraCapture && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgba(15,23,42,0.28)] p-0 backdrop-blur-sm md:items-center md:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="camera-capture-title" aria-describedby="camera-capture-description" className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-[#f1edf9] shadow-none md:h-auto md:max-w-xl md:rounded-[2.2rem] md:border md:border-[#d8d0ed] md:shadow-[0_36px_90px_-54px_rgba(32,15,93,0.36)]">
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 id="camera-capture-title" className="text-lg font-black text-zinc-950">{t('camera_modal_title')}</h3>
                  <p id="camera-capture-description" className="mt-1 text-sm leading-relaxed text-zinc-500">{t('camera_modal_body')}</p>
                </div>
                <button onClick={hideCameraCapture} className="text-2xl text-zinc-400 hover:text-zinc-700" title={t('close_btn')} aria-label={t('close_btn')}>×</button>
              </div>

              <div className="overflow-hidden rounded-[2rem] border border-[#d8d0ed] bg-zinc-950 shadow-inner">
                {cameraError ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-10 text-center">
                    <p className="max-w-sm text-sm leading-relaxed text-white/82">{cameraError}</p>
                    <button
                      onClick={handleOpenNativeCamera}
                      title={t('camera_open_native_btn')}
                      aria-label={t('camera_open_native_btn')}
                      className={classNames('rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all active:scale-95', accentButtonClass)}
                    >
                      {t('camera_open_native_btn')}
                    </button>
                  </div>
                ) : isCameraBooting ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-white">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    <p className="text-sm font-semibold text-white/78">{t('camera_starting')}</p>
                  </div>
                ) : (
                  <video
                    ref={cameraVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-[54dvh] w-full bg-zinc-950 object-cover sm:h-[440px]"
                  />
                )}
              </div>

              <div className="rounded-2xl border border-[#d8d0ed] bg-white/92 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className={subtleLabelClass}>{t('camera_pending_title')}</p>
                    <p className="mt-1 text-sm font-black text-zinc-900">
                      {cameraShots.length > 0 ? cameraCountStatus : t('camera_shots_empty')}
                    </p>
                  </div>
                  <button
                    onClick={handleOpenNativeCamera}
                    title={t('camera_open_native_btn')}
                    aria-label={t('camera_open_native_btn')}
                    className={classNames('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all active:scale-[0.98]', darkButtonClass)}
                  >
                    {t('camera_open_native_btn')}
                  </button>
                </div>

                {cameraShots.length > 0 && (
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {cameraShots.map((shot, index) => (
                      <div key={shot.id} className="relative w-24 shrink-0 overflow-hidden rounded-[1.3rem] border border-[#d8d0ed] bg-[#f8f6fc]">
                        <img src={shot.previewUrl} alt="" className="h-24 w-full object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">#{index + 1}</span>
                          <button
                            onClick={() => removeCameraShot(shot.id)}
                            disabled={isCameraImporting}
                            title={t('camera_remove_photo_btn')}
                            aria-label={t('camera_remove_photo_btn')}
                            className="text-[10px] font-black text-[#391BA6] disabled:text-zinc-400"
                          >
                            {t('camera_remove_photo_btn')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <button
                  onClick={closeCameraCapture}
                  disabled={isCameraImporting}
                  title={t('cancel_btn')}
                  aria-label={t('cancel_btn')}
                  className={classNames('w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all active:scale-95 disabled:bg-zinc-100 disabled:text-zinc-400', darkButtonClass)}
                >
                  {t('cancel_btn')}
                </button>

                <button
                  onClick={() => { void handleCaptureCameraShot(); }}
                  disabled={Boolean(cameraError) || isCameraBooting || isCameraImporting}
                  title={t('camera_capture_btn')}
                  aria-label={t('camera_capture_btn')}
                  className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-[linear-gradient(135deg,#391BA6,#7763BE)] text-white shadow-[0_28px_48px_-28px_rgba(57,27,166,0.55)] transition-all active:scale-95 disabled:border-zinc-200 disabled:bg-zinc-300 disabled:text-zinc-500"
                >
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current stroke-[1.8]">
                    <path d="M5 8h3l1.4-2h5.2L16 8h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
                    <circle cx="12" cy="13" r="3.2" />
                  </svg>
                </button>

                <button
                  onClick={() => { void handleImportCameraShots(); }}
                  disabled={cameraShots.length === 0 || isCameraImporting}
                  title={t('camera_done_btn')}
                  aria-label={t('camera_done_btn')}
                  className={classNames('w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition-all active:scale-95 disabled:bg-zinc-300 disabled:text-zinc-500', accentButtonClass)}
                >
                  {isCameraImporting ? t('loading_text') : t('camera_done_btn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNotesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.16)] p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div role="dialog" aria-modal="true" aria-labelledby="notes-modal-title" className="w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-[#d8d0ed] bg-[#f1edf9] shadow-[0_36px_90px_-54px_rgba(32,15,93,0.34)] animate-in zoom-in-95 duration-300">
            <div className="p-8 space-y-4">
              <div className="flex justify-between items-center">
                <h3 id="notes-modal-title" className="text-lg font-black text-zinc-950">{t('notes_title')}</h3>
                <button onClick={() => setShowNotesModal(null)} className="text-2xl text-zinc-400 hover:text-zinc-700" title={t('close_btn')} aria-label={t('close_btn')}>×</button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-4 pr-1">
                {resolvedModalNotes ? (
                  <>
                    <section className="rounded-3xl bg-gradient-to-br from-[#391BA6] via-[#30168C] to-[#7763BE] p-6 text-white shadow-lg">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">{notesLabels.summary}</p>
                        {!isEditingSummary && (
                          <button
                            onClick={() => setIsEditingSummary(true)}
                            title={t('edit_summary_btn')}
                            aria-label={t('edit_summary_btn')}
                            className="rounded-2xl border border-white/18 bg-white/12 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/18"
                          >
                            {t('edit_summary_btn')}
                          </button>
                        )}
                      </div>
                      {isEditingSummary ? (
                        <div className="mt-3 space-y-3">
                          <div className="space-y-1">
                            <label htmlFor="summary-title" className="text-[10px] font-black uppercase tracking-[0.22em] text-white/70">
                              {t('summary_title_label')}
                            </label>
                            <input
                              id="summary-title"
                              name="summary-title"
                              value={summaryTitleDraft}
                              onChange={(event) => setSummaryTitleDraft(event.target.value)}
                              className="w-full rounded-2xl border border-white/18 bg-white/14 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-white/20"
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="summary-body" className="text-[10px] font-black uppercase tracking-[0.22em] text-white/70">
                              {t('summary_body_label')}
                            </label>
                            <textarea
                              id="summary-body"
                              name="summary-body"
                              value={summaryBodyDraft}
                              onChange={(event) => setSummaryBodyDraft(event.target.value)}
                              className="min-h-[200px] w-full resize-none rounded-2xl border border-white/18 bg-white/14 px-4 py-3 text-sm leading-relaxed text-white outline-none focus:ring-2 focus:ring-white/20"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <h4 className="mt-3 text-lg font-black leading-tight">{resolvedModalNotes.title}</h4>
                          <p className="mt-3 text-sm leading-relaxed text-white/85">{resolvedModalNotes.summary}</p>
                        </>
                      )}
                    </section>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {isEditingSummary ? (
                        <>
                          <button
                            onClick={() => {
                              setSummaryTitleDraft(resolvedModalNotes.title);
                              setSummaryBodyDraft(resolvedModalNotes.summary);
                              setIsEditingSummary(false);
                            }}
                            title={t('cancel_btn')}
                            aria-label={t('cancel_btn')}
                            className={classNames('w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all active:scale-95', darkButtonClass)}
                          >
                            {t('cancel_btn')}
                          </button>
                          <button
                            onClick={saveSummaryEdits}
                            disabled={!isSummaryDirty}
                            title={t('save_summary_btn')}
                            aria-label={t('save_summary_btn')}
                            className={classNames('w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all active:scale-95 disabled:bg-zinc-200 disabled:text-zinc-500', accentButtonClass)}
                          >
                            {t('save_summary_btn')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { if (showNotesModal) void handlePlaySummary(showNotesModal); }}
                          title={isModalSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                          aria-label={isModalSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                          className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all sm:col-span-2 ${
                            isModalSummaryPlaying
                              ? 'border border-[#d8d0ed] bg-white/92 text-zinc-700'
                              : 'bg-gradient-to-r from-[#391BA6] to-[#7763BE] text-white shadow-lg shadow-[#391BA6]/20'
                            }`}
                        >
                          {isModalSummaryLoading ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              {t('listen_summary_btn')}
                            </span>
                          ) : isModalSummaryPlaying ? t('pause_summary_btn') : t('listen_summary_btn')}
                        </button>
                      )}
                    </div>

                    {resolvedModalNotes.sections.map((section, index) => (
                      <section key={`${section.heading}-${index}`} className="rounded-3xl border border-[#d8d0ed] bg-white/92 p-5 shadow-sm">
                        <h5 className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">{section.heading}</h5>
                        <ul className="mt-3 space-y-2">
                          {section.bullets.map((bullet, bulletIndex) => (
                            <li key={`${section.heading}-${bulletIndex}`} className="flex items-start gap-3 text-sm leading-relaxed text-zinc-700">
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#391BA6]" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </>
                ) : (
                  <div className="rounded-3xl border border-dashed border-[#d8d0ed] bg-white/92 p-6 text-sm text-zinc-500">
                    {t('no_notes')}
                  </div>
                )}
              </div>
              <button 
                onClick={() => setShowNotesModal(null)}
                title={t('close_btn')}
                aria-label={t('close_btn')}
                className={classNames('w-full rounded-2xl py-4 text-xs font-black uppercase text-white transition-all active:scale-95', accentButtonClass)}
              >
                {t('close_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteEpisode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.18)] p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-episode-title" className="w-full max-w-md overflow-hidden rounded-[2.3rem] border border-red-200 bg-[#fff7f6] shadow-[0_36px_90px_-54px_rgba(127,29,29,0.28)] animate-in zoom-in-95 duration-300">
            <div className="space-y-5 p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 id="delete-episode-title" className="text-lg font-black text-zinc-950">{t('delete_episode_confirm_title')}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{t('delete_episode_confirm_body')}</p>
                  <p className="mt-3 truncate rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-zinc-900">
                    {pendingDeleteEpisode.title}
                  </p>
                </div>
                <button
                  onClick={() => setPendingDeleteEpisode(null)}
                  disabled={isDeletingEpisodeId === pendingDeleteEpisode.id}
                  className="text-2xl text-zinc-400 hover:text-zinc-700 disabled:text-zinc-300"
                  title={t('close_btn')}
                  aria-label={t('close_btn')}
                >
                  ×
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => setPendingDeleteEpisode(null)}
                  disabled={isDeletingEpisodeId === pendingDeleteEpisode.id}
                  title={t('cancel_btn')}
                  aria-label={t('cancel_btn')}
                  className={classNames('w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all active:scale-95 disabled:bg-zinc-100 disabled:text-zinc-400', darkButtonClass)}
                >
                  {t('cancel_btn')}
                </button>
                <button
                  onClick={() => { void handleDeleteEpisode(pendingDeleteEpisode); }}
                  disabled={isDeletingEpisodeId === pendingDeleteEpisode.id}
                  title={t('delete_episode_confirm_btn')}
                  aria-label={t('delete_episode_confirm_btn')}
                  className="w-full rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-wide text-white shadow-[0_20px_38px_-20px_rgba(220,38,38,0.42)] transition-all active:scale-95 disabled:bg-red-200 disabled:text-red-50"
                >
                  {isDeletingEpisodeId === pendingDeleteEpisode.id ? t('loading_text') : t('delete_episode_confirm_btn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingEpisode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.16)] p-6 backdrop-blur-sm animate-in fade-in duration-300">
	          <div role="dialog" aria-modal="true" aria-labelledby="category-editor-title" className="max-h-[calc(100dvh-3rem)] w-full max-w-lg overflow-y-auto rounded-[2.5rem] border border-[#d8d0ed] bg-[#f1edf9] shadow-[0_36px_90px_-54px_rgba(32,15,93,0.34)] animate-in zoom-in-95 duration-300">
            <div className="p-8 space-y-5">
              <div className="flex justify-between items-center gap-4">
                <div className="min-w-0">
                  <h3 id="category-editor-title" className="text-lg font-black text-zinc-950">{t('episode_editor_title')}</h3>
                  <p className="mt-1 truncate text-xs font-bold text-zinc-500">{editingEpisode.title}</p>
                </div>
                <button onClick={closeEpisodeEditor} className="text-2xl text-zinc-400 hover:text-zinc-700" title={t('close_btn')} aria-label={t('close_btn')}>×</button>
              </div>

	              <div className="space-y-4 rounded-3xl border border-[#d8d0ed] bg-white/92 p-5">
	                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#ede8f8]/92 p-1">
	                  <button
	                    type="button"
	                    onClick={() => setEpisodeEditorTab('details')}
	                    className={classNames(
	                      'rounded-2xl px-4 py-3 text-[11px] font-black transition-colors',
	                      episodeEditorTab === 'details' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
	                    )}
	                  >
	                    {t('categories_title')}
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => setEpisodeEditorTab('text')}
	                    className={classNames(
	                      'rounded-2xl px-4 py-3 text-[11px] font-black transition-colors',
	                      episodeEditorTab === 'text' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'
	                    )}
	                  >
	                    Hela texten
	                  </button>
	                </div>

	                {episodeEditorTab === 'details' ? (
	                  <>
	                    <div className="space-y-3">
	                      <label htmlFor="episode-title" className={subtleLabelClass}>
	                        {t('episode_title_label')}
	                      </label>
	                      <input
	                        id="episode-title"
	                        name="episode-title"
	                        value={episodeTitleDraft}
	                        onChange={(e) => setEpisodeTitleDraft(e.target.value)}
	                        className="w-full rounded-2xl border border-[#d8d0ed] bg-white/92 px-4 py-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-[#7763BE]/22"
	                      />
	                    </div>

	                    <div className="space-y-3">
	                      <label htmlFor="episode-categories" className={subtleLabelClass}>
	                        {t('categories_title')}
	                      </label>
	                      <input
	                        id="episode-categories"
	                        name="episode-categories"
	                        value={categoryDraft}
	                        onChange={(e) => setCategoryDraft(e.target.value)}
	                        placeholder={t('category_placeholder')}
	                        className="w-full rounded-2xl border border-[#d8d0ed] bg-white/92 px-4 py-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-[#7763BE]/22"
	                      />
	                      <p className="text-xs leading-relaxed text-zinc-400">{t('category_hint')}</p>
	                    </div>
	                  </>
	                ) : (
	                  <div className="space-y-3">
	                    <label htmlFor="episode-full-text" className={subtleLabelClass}>
	                      Hela texten
	                    </label>
	                    <textarea
	                      id="episode-full-text"
	                      name="episode-full-text"
	                      value={episodeTextDraft}
	                      onChange={(e) => setEpisodeTextDraft(e.target.value)}
	                      className="min-h-[320px] w-full resize-y rounded-2xl border border-[#d8d0ed] bg-white/92 px-4 py-3 text-sm leading-relaxed text-zinc-900 outline-none focus:ring-2 focus:ring-[#7763BE]/22"
	                    />
	                  </div>
	                )}
	              </div>

              <button
                onClick={saveEpisodeEdits}
                title={t('save_episode_btn')}
                aria-label={t('save_episode_btn')}
                className={classNames('w-full rounded-2xl py-4 text-xs font-black uppercase text-white transition-all active:scale-95', accentButtonClass)}
              >
                {t('save_episode_btn')}
              </button>

              <button
                onClick={closeEpisodeEditor}
                title={t('close_btn')}
                aria-label={t('close_btn')}
                className={classNames('w-full rounded-2xl py-4 text-xs font-black uppercase transition-all active:scale-95', darkButtonClass)}
              >
                {t('close_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        button:focus-visible,
        [role="button"]:focus-visible,
        input:focus-visible,
        textarea:focus-visible {
          outline: 3px solid rgba(57, 27, 166, 0.9);
          outline-offset: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.18);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #2563eb 0%, #06b6d4 100%);
          border-radius: 10px;
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
};

export default App;
