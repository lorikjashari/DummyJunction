import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

interface Config {
  port: number;
  mode: 'demo' | 'prod';
  keys: {
    elevenLabs?: string;
    gemini?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    n8nWebhook?: string;
  };
}

/**
 * Reads API key from file in APIKEYSFORTOMORROW folder
 */
function readKeyFile(filename: string): string | undefined {
  try {
    const keysPath = path.join(__dirname, '..', '..', 'APIKEYSFORTOMORROW', filename);
    if (fs.existsSync(keysPath)) {
      const content = fs.readFileSync(keysPath, 'utf-8').trim();
      return content.length > 0 ? content : undefined;
    }
  } catch (error) {
    console.warn(`Could not read key file ${filename}:`, error);
  }
  return undefined;
}

/**
 * Load configuration with auto-detection of demo vs prod mode
 */
export function loadConfig(): Config {
  const keys = {
    elevenLabs: process.env.ELEVENLABS_API_KEY || readKeyFile('ElevenLabs.txt'),
    gemini: process.env.GEMINI_API_KEY || readKeyFile('FeatherlessAI.txt'),
    supabaseUrl: process.env.SUPABASE_URL || readKeyFile('supabase.txt')?.split('\n')[0],
    supabaseKey: process.env.SUPABASE_KEY || readKeyFile('supabase.txt')?.split('\n')[1],
    n8nWebhook: process.env.N8N_WEBHOOK_URL || readKeyFile('n8ns.txt'),
  };

  // Auto-detect mode: if we have at least one real API key, we're in prod mode
  const hasAnyKey = Object.values(keys).some(k => k && k.length > 0);
  const mode: 'demo' | 'prod' = hasAnyKey ? 'prod' : 'demo';

  const config: Config = {
    port: parseInt(process.env.PORT || '3000', 10),
    mode,
    keys,
  };

  console.log(`🌸 Amily starting in ${mode.toUpperCase()} mode`);
  if (mode === 'demo') {
    console.log('   Using placeholder responses (no API keys detected)');
  }

  return config;
}

export const config = loadConfig();
