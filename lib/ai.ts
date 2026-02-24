import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ""
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null as any

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is a rate limit error (429)
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  // Check for HTTP status code
  if (error.status === 429 || error.statusCode === 429) return true;
  
  // Check error message
  const message = String(error.message || error).toLowerCase();
  if (message.includes('429') || 
      message.includes('rate limit') || 
      message.includes('quota exceeded') ||
      message.includes('resource exhausted')) {
    return true;
  }
  
  return false;
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // If it's a rate limit error and we have retries left, wait and retry
      if (isRateLimitError(error) && attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`Rate limit hit (429). Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      
      // If it's not a rate limit error or we're out of retries, throw
      throw error;
    }
  }
  
  throw lastError;
}

export async function analyzeText(prompt: string) {
  if (!genAI){
    // Fallback heuristic
    const m = prompt.match(/min=([-.\d]+).*max=([-.\d]+).*mean=([-.\d]+)/i)
    if (!m) return 'No NDVI provided.'
    const mean = parseFloat(m[3])
    if (mean > 0.4) return 'Mostly healthy vegetation.\n- Continue routine monitoring.\n- Scout minor dips.\n- Ground-truth sample.'
    if (mean > 0.2) return 'Moderate vegetation.\n- Check irrigation.\n- Scout low-NDVI edges.\n- Consider soil test.'
    return 'Stressed or sparse vegetation.\n- Inspect low-NDVI zones in-field.\n- Verify water delivery.\n- Check for pests/disease.'
  }
  
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  try {
    const result = await retryWithBackoff(async () => {
      return await model.generateContent(prompt);
    }, 3, 1000); // 3 retries with 1s, 2s, 4s delays
    
    // @ts-ignore
    return result?.response?.text ? result.response.text() : (result as any)?.candidates?.[0]?.content?.[0]?.text || "";
  } catch (error: any) {
    // If it's still a rate limit error after retries, return a helpful message
    if (isRateLimitError(error)) {
      console.error('Rate limit exceeded after retries:', error);
      throw new Error('API rate limit exceeded. Please wait a moment and try again.');
    }
    
    // Re-throw other errors
    throw error;
  }
}
