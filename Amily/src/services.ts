/**
 * Service Integrations
 * 
 * Handles all external API calls with demo/prod mode support
 */

import { config } from './config';
import type { PlanJSON, MemoryJSON, SummaryJSON } from './schemas';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Demo audio counter for generating unique placeholder URLs
let demoAudioCounter = 1;

// Supabase client (only initialized in prod mode when keys are present)
let supabase: SupabaseClient | null = null;

if (config.keys.supabaseUrl && config.keys.supabaseKey) {
  try {
    supabase = createClient(config.keys.supabaseUrl, config.keys.supabaseKey, {
      auth: { persistSession: false },
    });
    console.log('💾 Supabase client initialized');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
  }
} else {
  console.warn('Supabase URL/key missing – database features will use demo logging only.');
}

/**
 * ElevenLabs TTS Integration
 */
export async function generateTTS(text: string): Promise<string> {
  if (config.mode === 'demo') {
    // Return placeholder audio URL in demo mode
    const audioUrl = `demo://audio${demoAudioCounter++}.mp3`;
    console.log(`🎵 [DEMO] Generated TTS: "${text.substring(0, 50)}..." → ${audioUrl}`);
    return audioUrl;
  }
  
  // Production: Call ElevenLabs API
  try {
    // Placeholder for actual ElevenLabs integration
    // const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/...', {
    //   method: 'POST',
    //   headers: {
    //     'xi-api-key': config.keys.elevenLabs!,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     text,
    //     voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    //   })
    // });
    
    console.log(`🎵 [PROD] Would call ElevenLabs API for: "${text.substring(0, 50)}..."`);
    return `https://storage.example.com/audio/${Date.now()}.mp3`;
  } catch (error) {
    console.error('ElevenLabs API error:', error);
    return `demo://audio-fallback-${demoAudioCounter++}.mp3`;
  }
}

/**
 * Gemini AI Integration for structured JSON generation
 */
export async function generateWithGemini<T>(
  prompt: string,
  schema: 'plan' | 'memory' | 'summary'
): Promise<T> {
  if (config.mode === 'demo') {
    // Return demo data matching the schema
    const demoData = getDemoData(schema);
    console.log(`🤖 [DEMO] Gemini response for ${schema}:`, demoData);
    return demoData as T;
  }
  
  // Production: Call Gemini API
  try {
    // Placeholder for actual Gemini integration
    // const response = await fetch('https://generativelanguage.googleapis.com/v1/...', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${config.keys.gemini}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({ prompt, schema })
    // });
    
    console.log(`🤖 [PROD] Would call Gemini API for ${schema}`);
    return getDemoData(schema) as T;
  } catch (error) {
    console.error('Gemini API error:', error);
    return getDemoData(schema) as T;
  }
}

/**
 * Get demo data for different schemas
 */
function getDemoData(schema: string): PlanJSON | MemoryJSON | SummaryJSON {
  switch (schema) {
    case 'plan':
      return {
        summary: "Let's take the day slowly… a little movement, some rest, and maybe a chat.",
        next_step: "How about a short walk after breakfast?",
        mood: 'ok' as const,
        tags: ['routine', 'mobility'],
      };
    
    case 'memory':
      return {
        title: "The Old Oak Tree",
        era: "Childhood, 1950s",
        story_3_sentences: "There was this big oak tree behind our house. My brother and I would climb it every summer. We'd sit up there for hours, watching the world go by.",
        tags: ['family', 'childhood'],
        quote: "We felt like we could see the whole world from up there.",
      };
    
    case 'summary':
      return {
        summary: "Your friend sent a warm hello… they're thinking of you today.",
        tone: 'warm' as const,
        suggestion: "Maybe send a little message back when you're ready?",
      };
    
    default:
      return {
        summary: "Everything looks good.",
        tone: 'warm' as const,
      };
  }
}

/**
 * Supabase Database Integration
 */
export async function saveToSupabase(table: string, data: any): Promise<boolean> {
  if (config.mode === 'demo' || !supabase) {
    console.log(`💾 [DEMO] Would save to Supabase table "${table}":`, data);
    return true;
  }
  
  // Production: Save to Supabase
  try {
    const { error } = await supabase.from(table).insert(data);
    if (error) {
      console.error(`Supabase insert error on table "${table}":`, error);
      return false;
    }

    console.log(`💾 [PROD] Saved record to Supabase table "${table}"`);
    return true;
  } catch (error) {
    console.error('Supabase error:', error);
    return false;
  }
}

/**
 * Supabase Auth: Sign up a new user with email/password
 */
export async function signUpUser(params: {
  email: string;
  password: string;
  fullName?: string;
  supportedPerson?: string;
}): Promise<{ success: boolean; userId?: string; error?: string }> {
  if (!supabase) {
    console.log('🔐 [DEMO] Would sign up user in Supabase:', {
      email: params.email,
      fullName: params.fullName,
      supportedPerson: params.supportedPerson,
    });
    return { success: true, userId: 'demo-user' };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: {
          full_name: params.fullName ?? null,
          supported_person: params.supportedPerson ?? null,
        },
      },
    });

    if (error) {
      console.error('Supabase signUp error:', error);
      return { success: false, error: error.message };
    }

    const userId = data.user?.id;

    // Optionally create a preferences row for this user
    if (userId) {
      await saveToSupabase('user_preferences', {
        user_id: userId,
        preferred_pace: 'slow',
        favorite_time: 'morning',
        interests: [],
        routine_notes: null,
      });
    }

    return { success: true, userId };
  } catch (error: any) {
    console.error('Unexpected signUp error:', error);
    return { success: false, error: 'Unable to sign up right now.' };
  }
}

/**
 * Supabase Auth: Log in an existing user with email/password
 */
export async function signInUser(params: {
  email: string;
  password: string;
}): Promise<{ success: boolean; userId?: string; error?: string }> {
  if (!supabase) {
    console.log('🔐 [DEMO] Would sign in user in Supabase:', { email: params.email });
    return { success: true, userId: 'demo-user' };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });

    if (error) {
      console.error('Supabase signIn error:', error);
      return { success: false, error: error.message };
    }

    const userId = data.user?.id;
    return { success: true, userId };
  } catch (error: any) {
    console.error('Unexpected signIn error:', error);
    return { success: false, error: 'Unable to log in right now.' };
  }
}

/**
 * n8n Webhook Integration for Care Circle notifications
 */
export async function triggerN8NWorkflow(
  event: string,
  payload: any
): Promise<boolean> {
  if (config.mode === 'demo') {
    console.log(`🔔 [DEMO] Would trigger n8n workflow "${event}":`, payload);
    return true;
  }
  
  // Production: Trigger n8n webhook
  try {
    // Placeholder for actual n8n integration
    // const response = await fetch(config.keys.n8nWebhook!, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ event, ...payload })
    // });
    
    console.log(`🔔 [PROD] Would trigger n8n webhook for "${event}"`);
    return true;
  } catch (error) {
    console.error('n8n webhook error:', error);
    return false;
  }
}

/**
 * Get user preferences from Supabase
 */
export async function getUserPreferences(userId: string): Promise<any> {
  if (config.mode === 'demo' || !supabase) {
    return {
      preferredPace: 'slow',
      favoriteTime: 'morning',
      interests: ['gardening', 'music'],
      routineNotes: 'Prefers gentle reminders, mornings are slow',
    };
  }
  
  // Production: Fetch from Supabase
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Failed to fetch user preferences from Supabase:', error);
      return {};
    }

    return data || {};
  } catch (error) {
    console.error('Failed to fetch user preferences:', error);
    return {};
  }
}
