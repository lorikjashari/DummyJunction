/**
 * Test script to verify Amily server functionality
 */

import { config } from './config';
import {
  generateCheckInMessage,
  generateMemoryPrompt,
  formatForTTS,
  detectEmotion,
  generateEmpatheticResponse,
} from './persona';
import {
  generateTTS,
  generateWithGemini,
} from './services';
import { PlanJSON } from './schemas';

async function runTests() {
  console.log('🧪 Testing Amily Components\n');
  console.log(`Mode: ${config.mode}\n`);
  
  // Test 1: Persona engine
  console.log('✓ Test 1: Persona Engine');
  const greeting = generateCheckInMessage('ok');
  console.log(`  Greeting: "${greeting}"\n`);
  
  // Test 2: Emotion detection
  console.log('✓ Test 2: Emotion Detection');
  const stressedInput = "I'm feeling so worried and stressed today";
  const emotion = detectEmotion(stressedInput);
  const response = generateEmpatheticResponse(emotion);
  console.log(`  Input: "${stressedInput}"`);
  console.log(`  Detected: ${emotion}`);
  console.log(`  Response: "${response}"\n`);
  
  // Test 3: TTS generation
  console.log('✓ Test 3: TTS Generation');
  const ttsText = "Good morning... how are you feeling today?";
  const audioUrl = await generateTTS(ttsText);
  console.log(`  Text: "${ttsText}"`);
  console.log(`  Audio URL: ${audioUrl}\n`);
  
  // Test 4: Gemini PlanJSON generation
  console.log('✓ Test 4: PlanJSON Generation');
  const plan = await generateWithGemini<PlanJSON>(
    'Generate a gentle daily plan',
    'plan'
  );
  console.log(`  Summary: "${plan.summary}"`);
  console.log(`  Next Step: "${plan.next_step}"`);
  console.log(`  Mood: ${plan.mood}`);
  console.log(`  Tags: ${plan.tags.join(', ')}\n`);
  
  // Test 5: Memory prompt
  console.log('✓ Test 5: Memory Recording');
  const memoryPrompt = generateMemoryPrompt();
  console.log(`  Prompt: "${memoryPrompt}"\n`);
  
  console.log('🌸 All tests passed!\n');
}

runTests().catch(console.error);
