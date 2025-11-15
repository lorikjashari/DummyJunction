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
  generateWithGemini,
  saveToSupabase,
  triggerN8NWorkflow,
  getUserPreferences,
  signUpUser,
  signInUser,
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
    
    // Generate PlanJSON using Gemini (or demo data)
    const planData = await generateWithGemini<PlanJSON>(
      `Generate a gentle daily plan for an elderly user who seems ${detectedEmotion}`,
      'plan'
    );
    
    // Validate against schema
    const validatedPlan = PlanJSONSchema.parse(planData);
    
    // Generate warm TTS text
    const checkInMsg = generateCheckInMessage(validatedPlan.mood);
    const ttsText = `${checkInMsg} ${validatedPlan.summary}`;
    
    // Generate audio URL
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
      mode: config.mode,
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
 * POST /api/chatbox
 * Unified chat endpoint for reminders, emotion detection, suggestions & lightweight memory
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

    // Emotion detection (text-based proxy for voice emotion)
    const emotion = detectEmotion(input);
    memory.lastEmotion = emotion;
    memory.reminderAsked = true;
    chatMemory.set(trimmedUserId, memory);

    // Build reminder question on first turn
    const reminderQuestion = firstTurn
      ? "Before we talk more… may I gently check: have you taken your pills, had something to eat, and had some water today?"
      : '';

    // Suggestions based on emotion
    const suggestions: string[] = [];
    if (emotion === 'lonely') {
      suggestions.push(
        'We could save a special story together in MemoryLane.',
        'We might send a little voice message to a buddy so you feel less alone.'
      );
    } else if (emotion === 'stressed') {
      suggestions.push(
        'We can try a very short breathing moment together.',
        'If you feel up to it, a tiny walk or stretch could help your body relax.'
      );
    } else if (emotion === 'confused') {
      suggestions.push(
        'We can keep today simple and walk through things one by one.',
        'If you like, we could record a note in MemoryLane so you do not have to remember everything yourself.'
      );
    } else {
      suggestions.push(
        'Maybe we could check in together about how your day is going.',
        'If you wish, we could reach out to a buddy or look at a happy memory.'
      );
    }

    const suggestionText = suggestions.join(' ');

    // Core empathetic response
    const baseResponse = generateEmpatheticResponse(emotion);

    let fullResponse = baseResponse;
    if (firstTurn) {
      fullResponse += ' ' + reminderQuestion;
    }
    fullResponse += ' ' + suggestionText;

    const ttsText = formatForTTS(fullResponse, { includeReassurance: true });
    const audioUrl = await generateTTS(ttsText);

    res.json({
      success: true,
      mode: config.mode,
      data: {
        emotion,
        firstTurn,
        reminderQuestion: firstTurn ? reminderQuestion : null,
        suggestions,
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
    
    // Generate MemoryJSON using Gemini
    const memoryData = await generateWithGemini<MemoryJSON>(
      `Extract a structured memory from this story: "${storyInput}"`,
      'memory'
    );
    
    // Validate against schema
    const validatedMemory = MemoryJSONSchema.parse(memoryData);
    
    // Generate encouraging TTS response
    const prompt = generateMemoryPrompt();
    const ttsText = formatForTTS(`${prompt} I've saved your story about "${validatedMemory.title}".`);
    
    // Generate audio
    const audioUrl = await generateTTS(ttsText);
    
    // Save memory to database
    await saveToSupabase('memories', {
      user_id: userId,
      memory: validatedMemory,
      timestamp: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      mode: config.mode,
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
    
    // Generate SummaryJSON using Gemini
    const summaryData = await generateWithGemini<SummaryJSON>(
      `Summarize this message warmly: "${messageText}"`,
      'summary'
    );
    
    // Validate against schema
    const validatedSummary = SummaryJSONSchema.parse(summaryData);
    
    // Generate social encouragement
    const encouragement = generateSocialEncouragement();
    const ttsText = formatForTTS(`${validatedSummary.summary} ${encouragement}`);
    
    // Generate audio
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
      mode: config.mode,
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
    mode: config.mode,
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
    mode: config.mode,
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
        mode: config.mode,
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
      mode: config.mode,
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
        mode: config.mode,
        alert: safetyAlert,
        alertId: emergencyResult.alertId,
        ttsText: reassurance,
        audioUrl,
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      mode: config.mode,
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
      mode: config.mode,
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
 * Get current wellness nudges and reminders
 */
app.get('/api/wellness/nudges', async (req: Request, res: Response) => {
  try {
    const { userId, timeOfDay = 'morning', mood = 'ok' } = req.query;
    
    // Demo data
    const medications: MedicationSchedule[] = [
      {
        id: '1',
        name: 'Morning Vitamins',
        dosage: 'one tablet',
        times: ['08:00'],
        withFood: true,
      },
    ];
    
    const hydration: HydrationGoal = {
      dailyGlasses: 8,
      currentGlasses: 3,
    };
    
    const weather: WeatherData = {
      temp: 72,
      condition: 'sunny',
      humidity: 45,
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
      mode: config.mode,
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
      mode: config.mode,
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
  console.log(`   Mode: ${config.mode.toUpperCase()}`);
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
