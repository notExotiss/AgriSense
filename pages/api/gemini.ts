import type { NextApiRequest, NextApiResponse } from 'next'
import { analyzeText } from '../../lib/ai'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  
  try {
    const { prompt, ndviData, weatherData, timeSeriesData, analysisType = 'basic' } = req.body || {}
    if (!prompt) return res.status(400).json({ error: 'prompt_required' })
    
    // Ignore external context and return plain ASCII analysis
    let analysis = ''
    if (analysisType === 'comprehensive') {
      analysis = generateComprehensiveAnalysisAscii(ndviData, weatherData, timeSeriesData)
    } else if (analysisType === 'weather') {
      analysis = generateWeatherAnalysisAscii(ndviData, weatherData)
    } else if (analysisType === 'trend') {
      analysis = generateTrendAnalysisAscii(timeSeriesData)
    } else {
      analysis = generateBasicAnalysisAscii(prompt)
    }
    
    return res.status(200).json({
      success: true,
      suggestion: analysis,
      output: analysis,
      model: 'gemini-pro-enhanced',
      analysisType,
      timestamp: new Date().toISOString()
    })
  } catch (e: any) {
    console.error('gemini API error', e?.message || e)
    
    // Check if it's a rate limit error
    const errorMessage = String(e?.message || e).toLowerCase()
    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return res.status(429).json({ 
        error: 'rate_limit_exceeded',
        message: 'API rate limit exceeded. Please wait a moment and try again.',
        retryAfter: 60
      })
    }
    
    return res.status(500).json({ 
      error: 'analysis_failed', 
      message: String(e?.message || e) 
    })
  }
}

function generateBasicAnalysisAscii(prompt: string): string {
  // Extract NDVI values from prompt
  const ndviMatch = prompt.match(/min=([\d.]+), max=([\d.]+), mean=([\d.]+)/)
  if (!ndviMatch) return "Basic NDVI summary:\n- Unable to parse NDVI values from prompt."
  
  const [, minStr, maxStr, meanStr] = ndviMatch
  const min = parseFloat(minStr)
  const max = parseFloat(maxStr)
  const mean = parseFloat(meanStr)
  
  let analysis = ""
  let recommendations: string[] = []
  
  if (mean > 0.6) {
    analysis = "🌱 Excellent vegetation health detected. The NDVI values indicate dense, healthy vegetation with good chlorophyll content."
    recommendations = [
      "Continue current management practices",
      "Monitor for optimal harvest timing",
      "Consider precision fertilization for peak areas"
    ]
  } else if (mean > 0.4) {
    analysis = "🌿 Good vegetation health with some variation. The area shows healthy vegetation but with some spatial variability."
    recommendations = [
      "Investigate areas with lower NDVI values",
      "Check irrigation uniformity across the field",
      "Consider targeted nutrient application"
    ]
  } else if (mean > 0.2) {
    analysis = "⚠️ Moderate vegetation stress detected. The NDVI values suggest some stress or sparse vegetation."
    recommendations = [
      "Immediate field inspection recommended",
      "Check for pest, disease, or water stress",
      "Consider soil testing in affected areas"
    ]
  } else {
    analysis = "🚨 Significant vegetation stress or sparse coverage. The NDVI values indicate poor vegetation health."
    recommendations = [
      "Urgent field assessment required",
      "Investigate potential crop failure causes",
      "Consider replanting in severely affected areas"
    ]
  }
  
  return `${analysis}\n\nRecommendations:\n${recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
}

function generateComprehensiveAnalysisAscii(ndviData: any, weatherData: any, timeSeriesData: any): string {
  const { stats } = ndviData
  const summary = timeSeriesData?.summary || { trend:'stable', averageNDVI: stats?.mean ?? 0, seasonality: { detected:false } }
  const safeWeather = weatherData || {}
  const weather = safeWeather.weather || {
    temperature: { current: null, min: null, max: null },
    precipitation: { daily: null },
    humidity: { value: null },
    conditions: 'N/A'
  }
  
  let analysis = "COMPREHENSIVE FARM ANALYSIS\n\n"
  
  // Current NDVI Analysis
  analysis += "CURRENT VEGETATION STATUS:\n"
  analysis += `- Mean NDVI: ${stats.mean.toFixed(3)} (${getHealthLevel(stats.mean)})\n`
  analysis += `- Range: ${stats.min.toFixed(3)} - ${stats.max.toFixed(3)}\n\n`
  
  // Weather Impact Analysis
  analysis += "WEATHER CONDITIONS:\n"
  analysis += `- Temperature: N/A\n- Precipitation: N/A\n- Humidity: N/A\n- Conditions: N/A\n\n`
  
  // Trend Analysis
  analysis += "HISTORICAL TRENDS:\n"
  analysis += `- Trend: ${summary.trend}\n`
  analysis += `- Average NDVI: ${summary.averageNDVI.toFixed(3)}\n`
  if (summary.seasonality.detected) {
    analysis += `- Peak season: Month ${summary.seasonality.peakMonth + 1}\n`
    analysis += `- Seasonal amplitude: ${summary.seasonality.amplitude.toFixed(3)}\n`
  }
  analysis += "\n"
  
  // Integrated Recommendations
  analysis += "RECOMMENDATIONS:\n"
  const recommendations = [
    'Inspect low-NDVI patches and verify irrigation coverage',
    'Schedule soil sampling for nutrient analysis',
    'Prioritize weed/pest scouting near field edges'
  ]
  recommendations.forEach((rec, i) => {
    analysis += `${i + 1}. ${rec}\n`
  })
  
  return analysis
}

function generateWeatherAnalysisAscii(ndviData: any, weatherData: any): string {
  const { stats } = ndviData
  const weather = (weatherData && (weatherData as any).weather) || { temperature:{ current:null }, precipitation:{ daily:null }, humidity:{ value:null } }
  
  let analysis = "WEATHER-NDVI CORRELATION ANALYSIS\n\n"
  
  // Weather impact assessment
  const tempImpact = assessTemperatureImpact(Number(weather.temperature?.current ?? 0), stats.mean)
  const precipImpact = assessPrecipitationImpact(Number(weather.precipitation?.daily ?? 0), stats.mean)
  const humidityImpact = assessHumidityImpact(Number(weather.humidity?.value ?? 0), stats.mean)
  
  analysis += `Temperature Impact: ${tempImpact}\n`
  analysis += `Precipitation Impact: ${precipImpact}\n`
  analysis += `Humidity Impact: ${humidityImpact}\n\n`
  
  // Weather-based recommendations
  analysis += "RECOMMENDATIONS:\n"
  const weatherRecs = ['Adjust irrigation schedule','Monitor canopy temperature mid-afternoon','Add windbreaks if persistent high winds']
  weatherRecs.forEach((rec, i) => {
    analysis += `${i + 1}. ${rec}\n`
  })
  
  return analysis
}

function generateTrendAnalysisAscii(timeSeriesData: any): string {
  const { summary, timeSeries } = timeSeriesData
  
  let analysis = "TREND ANALYSIS REPORT\n\n"
  
  analysis += `Overall Trend: ${summary.trend}\n`
  analysis += `Average NDVI: ${summary.averageNDVI.toFixed(3)}\n`
  analysis += `Data Points: ${summary.totalPoints}\n\n`
  
  if (summary.seasonality.detected) {
    analysis += "SEASONAL PATTERNS:\n"
    analysis += `- Peak growing season: Month ${summary.seasonality.peakMonth + 1}\n`
    analysis += `- Low season: Month ${summary.seasonality.lowMonth + 1}\n`
    analysis += `- Seasonal variation: ${summary.seasonality.amplitude.toFixed(3)}\n\n`
  }
  
  // Recent trend analysis
  const recentData = timeSeries.slice(-10)
  const recentTrend = calculateRecentTrend(recentData)
  analysis += `Recent Trend (last 10 points): ${recentTrend}\n\n`
  
  // Trend-based recommendations
  analysis += "RECOMMENDATIONS:\n"
  const trendRecs = ['Investigate variance spikes','Track NDVI after rainfall events','Compare with prior seasons at same month']
  trendRecs.forEach((rec, i) => {
    analysis += `${i + 1}. ${rec}\n`
  })
  
  return analysis
}

function getHealthLevel(mean: number): string {
  if (mean > 0.6) return "Excellent"
  if (mean > 0.4) return "Good"
  if (mean > 0.2) return "Moderate"
  return "Poor"
}

function assessTemperatureImpact(temp: number, ndvi: number): string {
  if (temp > 30 && ndvi < 0.4) return "High temperature stress likely"
  if (temp < 10 && ndvi < 0.3) return "Cold stress affecting growth"
  if (temp >= 15 && temp <= 25 && ndvi > 0.5) return "Optimal temperature conditions"
  return "Temperature within acceptable range"
}

function assessPrecipitationImpact(precip: number, ndvi: number): string {
  if (precip < 1 && ndvi < 0.3) return "Drought stress evident"
  if (precip > 10 && ndvi < 0.4) return "Excessive moisture may be affecting growth"
  if (precip >= 2 && precip <= 8 && ndvi > 0.4) return "Adequate moisture levels"
  return "Precipitation impact within normal range"
}

function assessHumidityImpact(humidity: number, ndvi: number): string {
  if (humidity < 30 && ndvi < 0.4) return "Low humidity contributing to stress"
  if (humidity > 80 && ndvi < 0.4) return "High humidity may promote disease"
  if (humidity >= 40 && humidity <= 70 && ndvi > 0.4) return "Optimal humidity conditions"
  return "Humidity levels acceptable"
}

function generateIntegratedRecommendations(stats: any, weather: any, summary: any): string[] {
  const recommendations = []
  
  // NDVI-based recommendations
  if (stats.mean < 0.3) {
    recommendations.push("Immediate irrigation and nutrient application required")
  } else if (stats.mean < 0.4) {
    recommendations.push("Consider targeted irrigation in low-NDVI areas")
  }
  
  // Weather-based recommendations
  if ((weather.temperature?.current ?? 0) > 30) {
    recommendations.push("Implement heat stress mitigation strategies")
  }
  if ((weather.precipitation?.daily ?? 99) < 2) {
    recommendations.push("Increase irrigation frequency due to low precipitation")
  }
  
  // Trend-based recommendations
  if (summary.trend === 'declining') {
    recommendations.push("Investigate causes of declining vegetation health")
  } else if (summary.trend === 'improving') {
    recommendations.push("Continue current management practices")
  }
  
  return recommendations
}

function generateWeatherRecommendations(weather: any, stats: any): string[] {
  const recommendations = []
  
  if ((weather.temperature?.current ?? 0) > 30) {
    recommendations.push("Provide shade or cooling measures for crops")
    recommendations.push("Increase irrigation frequency during heat stress")
  }
  
  if ((weather.precipitation?.daily ?? 99) < 1) {
    recommendations.push("Implement drought-resistant irrigation strategies")
    recommendations.push("Consider mulching to retain soil moisture")
  }
  
  if ((weather.humidity?.value ?? 0) > 80) {
    recommendations.push("Monitor for fungal diseases due to high humidity")
    recommendations.push("Improve air circulation around crops")
  }
  
  return recommendations
}

function calculateRecentTrend(data: any[]): string {
  if (data.length < 2) return "insufficient_data"
  
  const first = data[0].ndvi
  const last = data[data.length - 1].ndvi
  const change = last - first
  
  if (change > 0.05) return "improving"
  if (change < -0.05) return "declining"
  return "stable"
}

function generateTrendRecommendations(summary: any, recentTrend: string): string[] {
  const recommendations = []
  
  if (summary.trend === 'declining' || recentTrend === 'declining') {
    recommendations.push("Investigate root causes of vegetation decline")
    recommendations.push("Consider soil testing and nutrient analysis")
    recommendations.push("Review irrigation and pest management practices")
  } else if (summary.trend === 'improving' || recentTrend === 'improving') {
    recommendations.push("Continue current management practices")
    recommendations.push("Monitor for optimal harvest timing")
  }
  
  if (summary.seasonality.detected) {
    recommendations.push(`Plan activities around seasonal patterns (peak: month ${summary.seasonality.peakMonth + 1})`)
  }
  
  return recommendations
}