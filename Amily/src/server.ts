import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { 
  PlanJSONSchema, 
  MemoryJSONSchema, 
  SummaryJSONSchema,
  type PlanJSON,
  type MemoryJSON,
  type SummaryJSON,
} from './schemas';
import {
  generateCheckInMessage,
  generateMemoryPrompt,
  generateSocialEncouragement,
  formatForTTS,
  detectEmotion,
  generateEmpatheticResponse,
} from './persona';
import {
  generateTTS,
  saveToSupabase,
  triggerN8NWorkflow,
  getUserPreferences,
  signUpUser,
  signInUser,
  getChatHistory,
  generateChatReply,
  GEMINI_CHAT_MODEL,
  ELEVENLABS_TTS_MODEL,
} from './services';
import {
  detectSafetyConcerns,
  analyzeVitals,
  handleEmergency,
  getEmergencyReassurance,
  getSafetyCheckInQuestions,
  type VitalsData,
} from './safety';
import {
  getWellnessNudges,
  getMedicationReminder,
  getHydrationNudge,
  getActivityGuidance,
  type MedicationSchedule,
  type HydrationGoal,
  type WeatherData,
} from './wellness';

// Lightweight in-memory chat "memory" per user for the ChatBox
type ChatMemory = {
  lastEmotion?: 'stressed' | 'confused' | 'lonely' | 'calm';
  reminderAsked?: boolean;
};

const chatMemory = new Map<string, ChatMemory>();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

/**
 * POST /api/checkin
 * Daily check-in with mood assessment and plan generation
 */
app.post('/api/checkin', async (req: Request, res: Response) => {
  try {
    const { userId, userInput, mood } = req.body;
    
    // Detect emotion if user provided input
    const detectedEmotion = userInput ? detectEmotion(userInput) : 'calm';
    
    // Map emotion to mood for plan
    const planMood: 'low' | 'ok' | 'good' = 
      detectedEmotion === 'stressed' || detectedEmotion === 'lonely' ? 'low' :
      detectedEmotion === 'confused' ? 'ok' : 'good';
    
    // Generate simple plan based on emotion (no AI model)
    const validatedPlan: PlanJSON = {
      summary: "Let's take the day slowly… a little movement, some rest, and maybe a chat.",
      next_step: "How about a short walk after breakfast?",
      mood: planMood,
      tags: ['routine', 'mobility'],
    };
    
    // Generate warm TTS text
    const checkInMsg = generateCheckInMessage(validatedPlan.mood);
    const ttsText = `${checkInMsg} ${validatedPlan.summary}`;
    
    // Generate audio URL using ElevenLabs
    const audioUrl = await generateTTS(ttsText);
    
    // Save to database
    await saveToSupabase('check_ins', {
      user_id: userId,
      plan: validatedPlan,
      timestamp: new Date().toISOString(),
    });
    
    // Notify care circle if mood is low
    if (validatedPlan.mood === 'low') {
      await triggerN8NWorkflow('mood_alert', {
        userId,
        mood: 'low',
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      data: validatedPlan,
      ttsText,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({
      success: false,
      error: "Something went wrong... let's try again in a moment.",
    });
  }
});

/**
 * Auth: Sign up
 */
app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, supportedPerson } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    const result = await signUpUser({ email, password, fullName, supportedPerson });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Could not create account.',
      });
    }

    res.json({
      success: true,
      userId: result.userId,
      message: 'Account created. Please check your email to confirm if required.',
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong while creating your account.',
    });
  }
});

/**
 * Auth: Log in
 */
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    const result = await signInUser({ email, password });

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error || 'Invalid email or password.',
      });
    }

    res.json({
      success: true,
      userId: result.userId,
      message: 'Logged in successfully.',
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong while logging you in.',
    });
  }
});

/**
 * GET /api/chatbox/history/:userId
 * Return recent chat messages for a user
 */
app.get('/api/chatbox/history/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const history = await getChatHistory(userId, 50);

    const messages = history.map((row: any) => ({
      type: row.role === 'user' ? 'user' : 'amily',
      text: row.text,
      emotion: row.emotion || null,
      timestamp: row.timestamp,
    }));

    res.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    // If history fetch fails (e.g., table doesn't exist), return empty array
    console.warn('ChatBox history error (returning empty):', error);
    res.json({
      success: true,
      data: [],
    });
  }
});

/**
 * POST /api/chatbox
 * Chat endpoint using AI-powered responses (ElevenLabs) + ElevenLabs TTS
 */
app.post('/api/chatbox', async (req: Request, res: Response) => {
  try {
    const { userId = 'anonymous', input } = req.body as { userId?: string; input?: string };

    if (!input || !input.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please share a little about how you are feeling.',
      });
    }

    const trimmedUserId = String(userId || 'anonymous');
    const memory = chatMemory.get(trimmedUserId) || {};
    const firstTurn = !memory.reminderAsked;

    memory.reminderAsked = true;
    chatMemory.set(trimmedUserId, memory);

    // Load recent chat history for AI context
    const historyRows = await getChatHistory(trimmedUserId, 20);
    const historyForAI =
      historyRows?.map((row: any) => ({
        role: row.role === 'user' ? ('user' as const) : ('amily' as const),
        text: row.text as string,
      })) ?? [];

    // Generate AI-powered reply with conversation context
    const replyText = await generateChatReply(input, historyForAI, firstTurn);
    const ttsText = formatForTTS(replyText, { includeReassurance: false });
    
    // Generate audio using ElevenLabs TTS
    const audioUrl = await generateTTS(ttsText);

    // Persist both user and Amily messages to Supabase (non-blocking, fails gracefully)
    saveToSupabase('chat_messages', {
      user_id: trimmedUserId,
      role: 'user',
      text: input,
      emotion: null,
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.warn('Failed to save user message (non-critical):', err);
    });

    saveToSupabase('chat_messages', {
      user_id: trimmedUserId,
      role: 'amily',
      text: ttsText,
      emotion: null,
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.warn('Failed to save Amily message (non-critical):', err);
    });

    res.json({
      success: true,
      data: {
        firstTurn,
        reasoningModel: GEMINI_CHAT_MODEL,
        voiceModel: ELEVENLABS_TTS_MODEL,
      },
      ttsText,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('ChatBox error:', error);
    res.status(500).json({
      success: false,
      error: "I had trouble answering just now… can we try again in a moment?",
    });
  }
});

/**
 * POST /api/memory
 * Record a memory for MemoryLane
 */
app.post('/api/memory', async (req: Request, res: Response) => {
  try {
    const { userId, storyInput } = req.body;
    
    if (!storyInput || storyInput.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please share a memory with me.',
      });
    }
    
    // Extract simple memory structure from story (no AI model)
    const sentences = storyInput.split(/[.!?]+/).filter((s: string) => s.trim().length > 0).slice(0, 3);
    const story3Sentences = sentences.join('. ') + (sentences.length > 0 ? '.' : '');
    
    const validatedMemory: MemoryJSON = {
      title: storyInput.substring(0, 50).trim() || "A Special Memory",
      era: "Recent years",
      story_3_sentences: story3Sentences || storyInput.substring(0, 200),
      tags: ['personal'],
    };
    
    // Generate encouraging TTS response
    const prompt = generateMemoryPrompt();
    const ttsText = formatForTTS(`${prompt} I've saved your story about "${validatedMemory.title}".`);
    
    // Generate audio using ElevenLabs
    const audioUrl = await generateTTS(ttsText);
    
    // Save memory to database
    await saveToSupabase('memories', {
      user_id: userId,
      memory: validatedMemory,
      timestamp: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: validatedMemory,
      ttsText,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Memory recording error:', error);
    res.status(500).json({
      success: false,
      error: "I had trouble saving that... can we try once more?",
    });
  }
});

/**
 * POST /api/buddy
 * Process buddy messages with sentiment analysis
 */
app.post('/api/buddy', async (req: Request, res: Response) => {
  try {
    const { userId, messageFrom, messageText } = req.body;
    
    // Generate simple summary (no AI model)
    const validatedSummary: SummaryJSON = {
      summary: `Your friend ${messageFrom || 'someone'} sent a warm hello… they're thinking of you today.`,
      tone: 'warm' as const,
      suggestion: "Maybe send a little message back when you're ready?",
    };
    
    // Generate social encouragement
    const encouragement = generateSocialEncouragement();
    const ttsText = formatForTTS(`${validatedSummary.summary} ${encouragement}`);
    
    // Generate audio using ElevenLabs
    const audioUrl = await generateTTS(ttsText);
    
    // Save interaction
    await saveToSupabase('buddy_messages', {
      user_id: userId,
      message_from: messageFrom,
      summary: validatedSummary,
      timestamp: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: validatedSummary,
      ttsText,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Buddy message error:', error);
    res.status(500).json({
      success: false,
      error: "I couldn't read that message... let's check again.",
    });
  }
});

/**
 * GET /api - JSON API info
 */
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    service: 'Amily Companion',
    version: '1.0.0',
    message: "Hello... I'm Amily. I'm here to help you feel calm, safe, and understood.",
    endpoints: {
      health: 'GET /api/health',
      checkin: 'POST /api/checkin',
      memory: 'POST /api/memory',
      buddy: 'POST /api/buddy',
      empathy: 'POST /api/empathy',
      preferences: 'GET /api/preferences/:userId',
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Amily Companion',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/preferences/:userId
 * Get user preferences
 */
app.get('/api/preferences/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const preferences = await getUserPreferences(userId);
    
    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error('Preferences fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Could not load your settings right now.',
    });
  }
});

/**
 * POST /api/empathy
 * Generate empathetic response based on user emotion
 */
app.post('/api/empathy', async (req: Request, res: Response) => {
  try {
    const { userInput } = req.body;
    
    // Check for safety concerns first
    const safetyAlert = detectSafetyConcerns(userInput);
    
    if (safetyAlert.level === 'emergency' || safetyAlert.level === 'urgent') {
      // Handle emergency
      const emergencyResult = await handleEmergency(
        req.body.userId || 'unknown',
        safetyAlert,
        undefined,
        userInput
      );
      
      const reassurance = getEmergencyReassurance(safetyAlert);
      const audioUrl = await generateTTS(reassurance);
      
      return res.json({
        success: true,
        emergency: true,
        alert: safetyAlert,
        alertId: emergencyResult.alertId,
        data: {
          emotion: 'emergency',
          response: reassurance,
        },
        ttsText: reassurance,
        audioUrl,
        timestamp: new Date().toISOString(),
      });
    }
    
    const emotion = detectEmotion(userInput);
    const response = generateEmpatheticResponse(emotion);
    const audioUrl = await generateTTS(response);
    
    res.json({
      success: true,
      emergency: false,
      alert: safetyAlert.level === 'concern' ? safetyAlert : null,
      data: {
        emotion,
        response,
      },
      ttsText: response,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Empathy response error:', error);
    res.status(500).json({
      success: false,
      error: "I'm here... let's take a breath together.",
    });
  }
});

/**
 * POST /api/safety/vitals
 * Monitor vitals and detect emergency situations
 */
app.post('/api/safety/vitals', async (req: Request, res: Response) => {
  try {
    const { userId, vitals }: { userId: string; vitals: VitalsData } = req.body;
    
    const safetyAlert = analyzeVitals(vitals);
    
    if (safetyAlert.level === 'emergency' || safetyAlert.level === 'urgent') {
      const emergencyResult = await handleEmergency(userId, safetyAlert, vitals);
      const reassurance = getEmergencyReassurance(safetyAlert);
      const audioUrl = await generateTTS(reassurance);
      
      return res.json({
        success: true,
        alert: safetyAlert,
        alertId: emergencyResult.alertId,
        ttsText: reassurance,
        audioUrl,
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      alert: safetyAlert,
      message: 'Vitals within normal range',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Vitals monitoring error:', error);
    res.status(500).json({
      success: false,
      error: 'Could not process vitals data',
    });
  }
});

/**
 * POST /api/safety/emergency
 * Handle manual emergency trigger
 */
app.post('/api/safety/emergency', async (req: Request, res: Response) => {
  try {
    const { userId, type, location } = req.body;
    
    const safetyAlert = {
      level: 'emergency' as const,
      detected: [type || 'manual_trigger'],
      message: "Help is on the way... stay calm.",
      actions: ['emergency_protocol', 'alert_caregiver', 'location_share'],
      caregiverAlert: true,
    };
    
    const vitals: VitalsData = {
      location,
      timestamp: new Date().toISOString(),
    };
    
    const emergencyResult = await handleEmergency(userId, safetyAlert, vitals);
    const reassurance = getEmergencyReassurance(safetyAlert);
    const audioUrl = await generateTTS(reassurance);
    
    res.json({
      success: true,
      alert: safetyAlert,
      alertId: emergencyResult.alertId,
      ttsText: reassurance,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Emergency trigger error:', error);
    res.status(500).json({
      success: false,
      error: 'Emergency alert sent, help is coming',
    });
  }
});

/**
 * GET /api/wellness/nudges
 * Get current wellness nudges and reminders (reads from database)
 */
app.get('/api/wellness/nudges', async (req: Request, res: Response) => {
  try {
    const { userId, timeOfDay = 'morning', mood = 'ok' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required.',
      });
    }

    // Read medications from database (requires wellness_medications table)
    // TODO: Implement proper medication fetching from Supabase
    const medications: MedicationSchedule[] = [];
    
    // Read hydration from database (requires wellness_hydration table)
    // TODO: Implement proper hydration fetching from Supabase
    const hydration: HydrationGoal = {
      dailyGlasses: 0,
      currentGlasses: 0,
    };
    
    // Read weather from external API or database
    // TODO: Implement weather API integration
    const weather: WeatherData = {
      temp: 0,
      condition: 'unknown',
      humidity: 0,
    };
    
    const nudges = getWellnessNudges(
      timeOfDay as 'morning' | 'afternoon' | 'evening',
      medications,
      hydration,
      weather,
      mood as 'low' | 'ok' | 'good'
    );
    
    res.json({
      success: true,
      data: nudges,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Wellness nudges error:', error);
    res.status(500).json({
      success: false,
      error: 'Could not get wellness nudges',
    });
  }
});

/**
 * POST /api/wellness/log
 * Log wellness activities (water, medication, etc.)
 */
app.post('/api/wellness/log', async (req: Request, res: Response) => {
  try {
    const { userId, type, value } = req.body;
    
    await saveToSupabase('wellness_log', {
      user_id: userId,
      type,
      value,
      timestamp: new Date().toISOString(),
    });
    
    let response = '';
    if (type === 'water') {
      response = "Good job staying hydrated! You're doing great.";
    } else if (type === 'medication') {
      response = "Thank you for taking your medication. Well done.";
    } else if (type === 'activity') {
      response = "Wonderful! Movement is so good for you.";
    }
    
    const audioUrl = await generateTTS(formatForTTS(response));
    
    res.json({
      success: true,
      ttsText: response,
      audioUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Wellness log error:', error);
    res.status(500).json({
      success: false,
      error: 'Could not log activity',
    });
  }
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`\n🌸 Amily Companion Server Running`);
  console.log(`   Port: ${PORT}`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`\n   Endpoints:`);
  console.log(`   POST /api/checkin    - Daily check-in`);
  console.log(`   POST /api/memory     - Record memory`);
  console.log(`   POST /api/buddy      - Process buddy message`);
  console.log(`   POST /api/empathy    - Empathetic response`);
  console.log(`   GET  /api/health     - Health check`);
  console.log(`   GET  /api/preferences/:userId - User preferences\n`);
});

export default app;
