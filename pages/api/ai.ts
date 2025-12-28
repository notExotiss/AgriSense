import type { NextApiRequest, NextApiResponse } from "next"
import { analyzeText } from "../../lib/ai"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { prompt } = req.body || {}
    const output = await analyzeText(String(prompt || ''))
    res.status(200).json({ output })
  } catch (err: any) {
    console.error('AI API error:', err)
    
    // Check if it's a rate limit error
    const errorMessage = String(err?.message || err).toLowerCase()
    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return res.status(429).json({ 
        error: "rate_limit_exceeded", 
        message: "API rate limit exceeded. Please wait a moment and try again.",
        retryAfter: 60 // Suggest retrying after 60 seconds
      })
    }
    
    res.status(500).json({ 
      error: "AI request failed",
      message: err?.message || "An unexpected error occurred"
    })
  }
}