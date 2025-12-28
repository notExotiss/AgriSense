import React, { useState, useRef, useEffect } from "react"
import NDVIUploader from "../components/NDVIUploader"
import NDVICanvas from "../components/NDVICanvas"
import NDVIProcessor from "../components/NDVIProcessor"
import TimeSeriesChart from "../components/TimeSeriesChart"
import WeatherWidget from "../components/WeatherWidget"
import NavBar from "../components/NavBar"
import Chatbot from "../components/Chatbot"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Leaf, Satellite, TrendingUp, AlertTriangle, Upload, MapPin, Download, Layers, AlertCircle, BarChart3, Cloud, Globe, Plus } from "lucide-react"
import { auth } from "../lib/firebaseClient"
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithRedirect } from 'firebase/auth'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'

const MapView = dynamic(() => import('../components/MapView'), { ssr: false })
const InteractiveMap = dynamic(() => import('../components/InteractiveMap'), { ssr: false })

type NDVIState = {
  ndvi: Float32Array
  width: number
  height: number
  stats: { min: number; max: number; mean: number }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("auto-ingest")
  const [state, setState] = useState<NDVIState | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState("")
  const [savedId, setSavedId] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Auto-ingest states
  const [query, setQuery] = useState('Edison, New Jersey')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [bboxStr, setBboxStr] = useState('')
  const [date, setDate] = useState('2025-08-01/2025-08-10')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [polygon, setPolygon] = useState<any[]>([])
  const [ndviData, setNdviData] = useState<any>(null)
  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lon: number, name: string} | null>({ lat: 40.5187, lon: -74.4121, name: 'Edison, NJ' })
  const [locationName, setLocationName] = useState<string>('Edison, NJ')

  // Layer states
  const [activeLayer, setActiveLayer] = useState<'ndvi' | 'soil' | 'et'>('ndvi')
  const [soilData, setSoilData] = useState<any>(null)
  const [etData, setEtData] = useState<any>(null)
  const [activeResultLayer, setActiveResultLayer] = useState<'ndvi'|'soil'|'et'>('ndvi')
  const [layerLoading, setLayerLoading] = useState(false)

  // Alert states
  const [alerts, setAlerts] = useState<any[]>([])

  // Phase 2 states
  const [timeSeriesData, setTimeSeriesData] = useState<any>(null)
  const [weatherData, setWeatherData] = useState<any>(null)
  const [analysisType, setAnalysisType] = useState<'basic' | 'weather' | 'trend' | 'comprehensive'>('basic')
  const [showInteractiveMap, setShowInteractiveMap] = useState(false)
  const [timeSeriesLoading, setTimeSeriesLoading] = useState(false)
  const [typedAnalysis, setTypedAnalysis] = useState('')
  const [zonesOn, setZonesOn] = useState(false)
  const [zoneInfoOpen, setZoneInfoOpen] = useState(false)

  // Fetch weather for selected location to enable Weather Analysis
  useEffect(()=>{
    const load = async()=>{
      try{
        if (!selectedLocation) return
        const r = await fetch('/api/weather', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ location: selectedLocation }) })
        const j = await r.json().catch(()=>null)
        if (j) setWeatherData(j)
      } catch {}
    }
    load()
  }, [selectedLocation?.lat, selectedLocation?.lon])

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  // Push alerts to NavBar popup
  useEffect(()=>{
    try{
      const withPlot = alerts.map(a=> ({ ...a, plotId: savedId || result?.imagery?.id || 'Current AOI', plotName: locationName || selectedLocation?.name || 'Current AOI' }))
      window.dispatchEvent(new CustomEvent('agrisense:alerts', { detail: withPlot }))
    } catch {}
  }, [JSON.stringify(alerts), savedId, result?.imagery?.id, locationName, selectedLocation?.name])

  // Typewriter for AI analysis
  useEffect(()=>{
    if (!aiAnalysis) { setTypedAnalysis(''); return }
    let i = 0
    setTypedAnalysis('')
    const id = window.setInterval(()=>{
      i++
      setTypedAnalysis(aiAnalysis.slice(0, i))
      if (i >= aiAnalysis.length) window.clearInterval(id)
    }, 15)
    return ()=> window.clearInterval(id)
  }, [aiAnalysis])

  async function ensureSignedIn(){
    if (auth.currentUser) return auth.currentUser
    const provider = new GoogleAuthProvider()
    try{ const cred = await signInWithPopup(auth, provider); return cred.user } catch {
      try{ await signInWithRedirect(auth, provider) } catch {}
      throw new Error('Sign-in required')
    }
  }

  function capturePreview(): string | null {
    try{
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return null
      const dataUrl = canvas.toDataURL('image/png')
      return dataUrl.replace('data:image/png;base64,','')
    } catch { return null }
  }

  async function savePlot() {
    if (!state) return
    setSaving(true)
    try {
      const previewPng = capturePreview()
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: locationName || `Farm Plot ${new Date().toLocaleDateString()}`,
          ndviStats: state.stats,
          width: state.width,
          height: state.height,
          previewPng,
          timestamp: new Date().toISOString(),
          locationName: locationName || selectedLocation?.name
        }),
      })
      const result = await response.json()
      setSavedId(result.id)
      toast.success("Analysis saved successfully!")
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function getAIAnalysis() {
    if (!state) return
    setAiAnalysis("Analyzing vegetation health...")

    const prompt = `Analyze farm health based on NDVI data: min=${state.stats.min.toFixed(3)}, max=${state.stats.max.toFixed(3)}, mean=${state.stats.mean.toFixed(3)}. Provide health assessment and 3 actionable recommendations.`

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
      
      // Handle rate limit errors
      if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}))
        setAiAnalysis(errorData.message || 'Rate limit exceeded. Please wait a moment and try again.')
        return
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        setAiAnalysis(errorData.message || `Error: ${response.statusText}. Using fallback analysis.`)
        return
      }
      
      const result = await response.json()
      setAiAnalysis(result.suggestion || result.output || "Analysis completed")
    } catch (error) {
      console.error('AI Analysis error:', error)
      const errorMessage = (error as any)?.message || ''
      if (errorMessage.includes('rate limit')) {
        setAiAnalysis('Rate limit exceeded. Please wait a moment and try again.')
      } else {
        setAiAnalysis(generateLocalAnalysis(state.stats))
      }
    }
  }

  function generateLocalAnalysis(stats: { min: number; max: number; mean: number }) {
    const { min, max, mean } = stats
    let healthStatus = ""
    let recommendations: string[] = []

    if (mean > 0.6) {
      healthStatus = "🌱 Excellent vegetation health detected"
      recommendations = [
        "Continue current management practices",
        "Monitor for optimal harvest timing",
        "Consider precision fertilization for peak areas",
      ]
    } else if (mean > 0.4) {
      healthStatus = "🌿 Good vegetation health with some variation"
      recommendations = [
        "Investigate areas with lower NDVI values",
        "Check irrigation uniformity across the field",
        "Consider targeted nutrient application",
      ]
    } else if (mean > 0.2) {
      healthStatus = "⚠️ Moderate vegetation stress detected"
      recommendations = [
        "Immediate field inspection recommended",
        "Check for pest, disease, or water stress",
        "Consider soil testing in affected areas",
      ]
    } else {
      healthStatus = "🚨 Significant vegetation stress or sparse coverage"
      recommendations = [
        "Urgent field assessment required",
        "Investigate potential crop failure causes",
        "Consider replanting in severely affected areas",
      ]
    }

    return `${healthStatus}\n\nRecommendations:\n${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
  }

  function getHealthBadge(mean: number) {
    if (mean > 0.6) return <Badge className="bg-green-500 text-white">Excellent</Badge>
    if (mean > 0.4) return <Badge className="bg-yellow-500 text-white">Good</Badge>
    if (mean > 0.2) return <Badge className="bg-orange-500 text-white">Moderate</Badge>
    return <Badge className="bg-red-500 text-white">Poor</Badge>
  }

  // Convert encoded JSON image from soil/et APIs into a colored PNG base64 for overlay
  async function transformOverlayFromEncoded(apiData: any, kind: 'soil' | 'et') {
    try {
      // If server already returned an image/png base64, pass through
      if (apiData?.soilMoisture && apiData.soilMoisture.startsWith('iVBOR')) {
        return { ...apiData, overlayPng: apiData.soilMoisture }
      }
      if (apiData?.evapotranspiration && apiData.evapotranspiration.startsWith('iVBOR')) {
        return { ...apiData, overlayPng: apiData.evapotranspiration }
      }

      const encoded = kind === 'soil' ? apiData?.soilMoisture : apiData?.evapotranspiration
      if (!encoded) return apiData
      const json = JSON.parse(typeof window !== 'undefined' ? atob(encoded) : Buffer.from(encoded,'base64').toString('utf-8'))
      const width = json.width || 256
      const height = json.height || 256
      const arr: number[] = json.data || []
      let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY
      for (const v of arr){ if (v < min) min = v; if (v > max) max = v }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const img = ctx.createImageData(width, height)

      const colorize = (val:number): [number,number,number,number] => {
        const t = (val - min) / ((max - min) || 1)
        if (kind === 'soil') {
          // dry -> wet : brown -> blue
          const r = Math.round(150 - 150*t)
          const g = Math.round(90 + 100*t)
          const b = Math.round(40 + 180*t)
          return [r,g,b,255]
        } else {
          // low ET -> high ET : green -> red
          const r = Math.round(50 + 200*t)
          const g = Math.round(200 - 140*t)
          const b = Math.round(80 - 60*t)
          return [r,g,b,255]
        }
      }

      for (let i=0;i<arr.length;i++){
        const [r,g,b,a] = colorize(arr[i])
        const p = i*4
        img.data[p]=r; img.data[p+1]=g; img.data[p+2]=b; img.data[p+3]=a
      }
      ctx.putImageData(img,0,0)
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.replace('data:image/png;base64,','')
      return { ...apiData, overlayPng: base64 }
    } catch {
      return apiData
    }
  }

  // Auto-ingest functions
  async function geocode() {
    setLoading(true)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
      if (!r.ok) throw new Error('Geocode failed')
      const j = await r.json()
      setSuggestions(j.places || [])
      toast.success('Found places')
    } catch (e: any) {
      toast.error(e?.message || 'Geocoding error')
    } finally {
      setLoading(false)
    }
  }

  function selectPlace(p: any) {
    if (p?.bbox?.length === 4) {
      const [south, north, west, east] = p.bbox
      setBboxStr(`${west},${south},${east},${north}`)
    }
    
    // Set the selected location for weather data
    if (p?.lat && p?.lon) {
      setSelectedLocation({
        lat: p.lat,
        lon: p.lon,
        name: p.display_name || p.name || 'Selected Location'
      })
    }
    
    setSuggestions([])
  }

  function polygonToBbox(coords: any[]) {
    if (!coords || !Array.isArray(coords) || coords.length === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    
    // Handle different coordinate formats
    const flatCoords = coords.flat()
    for (let i = 0; i < flatCoords.length; i += 2) {
      const lng = flatCoords[i]
      const lat = flatCoords[i + 1]
      if (typeof lng === 'number' && typeof lat === 'number') {
        if (lng < minX) minX = lng
        if (lng > maxX) maxX = lng
        if (lat < minY) minY = lat
        if (lat > maxY) maxY = lat
      }
    }
    
    if (minX !== Infinity && minY !== Infinity && maxX !== -Infinity && maxY !== -Infinity) {
      setBboxStr(`${minX},${minY},${maxX},${maxY}`)
    }
  }

  async function autoFetchNDVI() {
    if (!bboxStr) return toast.error('Please set a bounding box first')
    setLoading(true)
    setResult(null)
    setNdviData(null)
    setSoilData(null)
    setEtData(null)
    
    try {
      const bbox = bboxStr.split(',').map(s => Number(s.trim()))
      
      // Fetch NDVI data
      const ndviResponse = await fetch('/api/ingest/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, date })
      })
      if (!ndviResponse.ok) throw new Error('NDVI fetch failed')
      const ndviResult = await ndviResponse.json()
      setResult(ndviResult)
      
      // Automatically fetch soil moisture data
      try {
        const soilResponse = await fetch('/api/soil', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox })
        })
        if (soilResponse.ok) {
          const soilResult = await soilResponse.json()
          const transformed = await transformOverlayFromEncoded(soilResult.data, 'soil')
          setSoilData(transformed)
        }
      } catch (soilError) {
        console.warn('Soil data fetch failed:', soilError)
      }
      
      // Automatically fetch ET data
      try {
        const etResponse = await fetch('/api/et', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox })
        })
        if (etResponse.ok) {
          const etResult = await etResponse.json()
          const transformedET = await transformOverlayFromEncoded(etResult.data, 'et')
          setEtData(transformedET)
        }
      } catch (etError) {
        console.warn('ET data fetch failed:', etError)
      }
      
      toast.success('All data layers fetched successfully')
    } catch (e: any) {
      toast.error(e?.message || 'Data fetch error')
    } finally {
      setLoading(false)
    }
  }

  async function saveAutoIngestPlot() {
    if (!ndviData) return toast.error('No NDVI data to save')
    setSaving(true)
    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: locationName || `NDVI Analysis ${new Date().toLocaleDateString()}`,
          description: `Auto-ingested NDVI analysis for ${result?.imagery?.id || 'unknown imagery'}`,
          ndviStats: ndviData.stats,
          width: ndviData.width,
          height: ndviData.height,
          previewPng: ndviData.previewPng,
          locationName: locationName || selectedLocation?.name,
          geojson: result?.bbox ? {
            type: "Polygon",
            coordinates: [[
              [result.bbox[0], result.bbox[1]],
              [result.bbox[2], result.bbox[1]],
              [result.bbox[2], result.bbox[3]],
              [result.bbox[0], result.bbox[3]],
              [result.bbox[0], result.bbox[1]]
            ]]
          } : null
        }),
      })
      if (response.status === 401){
        toast.error('Please sign in to save plots.')
        await ensureSignedIn()
        setSaving(false)
        return
      }
      const result_data = await response.json()
      toast.success(`Plot saved with ID: ${result_data.id}`)
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Layer fetching functions
  async function fetchSoilMoisture() {
    if (!bboxStr) return toast.error('Please set a bounding box first')
    setLayerLoading(true)
    try {
      const bbox = bboxStr.split(',').map(s => Number(s.trim()))
      const response = await fetch('/api/soil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox })
      })
      if (!response.ok) throw new Error('Soil moisture fetch failed')
      const data = await response.json()
      const transformed = await transformOverlayFromEncoded(data.data, 'soil')
      setSoilData(transformed)
      toast.success('Soil moisture data loaded')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to fetch soil moisture')
    } finally {
      setLayerLoading(false)
    }
  }

  async function fetchEvapotranspiration() {
    if (!bboxStr) return toast.error('Please set a bounding box first')
    setLayerLoading(true)
    try {
      const bbox = bboxStr.split(',').map(s => Number(s.trim()))
      const response = await fetch('/api/et', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox })
      })
      if (!response.ok) throw new Error('ET fetch failed')
      const data = await response.json()
      const transformed = await transformOverlayFromEncoded(data.data, 'et')
      setEtData(transformed)
      toast.success('Evapotranspiration data loaded')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to fetch evapotranspiration')
    } finally {
      setLayerLoading(false)
    }
  }

  // Export functions
  async function exportPNG() {
    const currentData = state || ndviData
    if (!currentData) return toast.error('No NDVI data to export')
    
    try {
      const response = await fetch('/api/export/png', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ndviData: currentData,
          soilData: soilData,
          etData: etData,
          bbox: result?.bbox,
          location: query || 'Unknown Location',
          layerType: activeLayer
        })
      })
      
      if (!response.ok) throw new Error('PNG export failed')
      
      const exportResult = await response.json()
      
      // Create download link
      const link = document.createElement('a')
      link.href = `data:image/png;base64,${exportResult.image}`
      link.download = exportResult.filename
      link.click()
      
      toast.success('PNG exported successfully')
    } catch (e: any) {
      toast.error(e?.message || 'PNG export failed')
    }
  }

  async function exportPDF() {
    const currentData = state || ndviData
    if (!currentData) return toast.error('No NDVI data to export')
    
    try {
      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ndviData: currentData,
          soilData: soilData,
          etData: etData,
          weatherData: weatherData,
          bbox: result?.bbox,
          location: query || 'Unknown Location'
        })
      })
      
      if (!response.ok) throw new Error('PDF export failed')
      
      const exportResult = await response.json()
      
      // Open report in new window
      const newWindow = window.open('', '_blank')
      if (newWindow) {
        newWindow.document.write(exportResult.html)
        newWindow.document.close()
      }
      
      toast.success('PDF report generated successfully')
    } catch (e: any) {
      toast.error(e?.message || 'PDF export failed')
    }
  }

  // Alert checking function
  function checkThresholds(ndviStats: { min: number; max: number; mean: number }) {
    const newAlerts: any[] = [];
    const timestamp = new Date().toISOString();
    
    // NDVI Threshold Alerts
    if (ndviStats.mean < 0.3) {
      newAlerts.push({
        id: `ndvi-low-${timestamp}`,
        type: 'critical',
        message: 'Low NDVI Detected',
        details: `Mean NDVI (${ndviStats.mean.toFixed(3)}) is below critical threshold (0.3). Vegetation may be stressed.`,
        timestamp,
        category: 'vegetation',
        severity: 'high'
      });
    } else if (ndviStats.mean < 0.4) {
      newAlerts.push({
        id: `ndvi-moderate-${timestamp}`,
        type: 'warning',
        message: 'Moderate NDVI Alert',
        details: `Mean NDVI (${ndviStats.mean.toFixed(3)}) is below optimal threshold (0.4). Monitor vegetation health.`,
        timestamp,
        category: 'vegetation',
        severity: 'medium'
      });
    }
    
    if (ndviStats.min < 0.1) {
      newAlerts.push({
        id: `ndvi-min-${timestamp}`,
        type: 'warning',
        message: 'Very Low NDVI Areas Detected',
        details: `Minimum NDVI (${ndviStats.min.toFixed(3)}) indicates severely stressed vegetation in some areas.`,
        timestamp,
        category: 'vegetation',
        severity: 'medium'
      });
    }
    
    // Soil Moisture Threshold Alerts
    if (soilData?.stats?.mean < 0.2) {
      newAlerts.push({
        id: `soil-dry-${timestamp}`,
        type: 'critical',
        message: 'Low Soil Moisture',
        details: `Soil moisture (${soilData.stats.mean.toFixed(3)} m³/m³) is critically low. Irrigation recommended.`,
        timestamp,
        category: 'soil',
        severity: 'high'
      });
    } else if (soilData?.stats?.mean < 0.25) {
      newAlerts.push({
        id: `soil-moderate-${timestamp}`,
        type: 'warning',
        message: 'Moderate Soil Moisture',
        details: `Soil moisture (${soilData.stats.mean.toFixed(3)} m³/m³) is below optimal. Consider irrigation.`,
        timestamp,
        category: 'soil',
        severity: 'medium'
      });
    }
    
    // Evapotranspiration Threshold Alerts
    if (etData?.stats?.mean > 7) {
      newAlerts.push({
        id: `et-high-${timestamp}`,
        type: 'warning',
        message: 'High Evapotranspiration',
        details: `ET rate (${etData.stats.mean.toFixed(2)} mm/day) is high. Monitor water usage closely.`,
        timestamp,
        category: 'water',
        severity: 'medium'
      });
    }
    
    // Weather-based Alerts
    if (weatherData?.current?.temperature > 35) {
      newAlerts.push({
        id: `temp-high-${timestamp}`,
        type: 'warning',
        message: 'High Temperature Alert',
        details: `Temperature (${weatherData.current.temperature}°C) is very high. Increase irrigation frequency.`,
        timestamp,
        category: 'weather',
        severity: 'medium'
      });
    }
    
    if (weatherData?.current?.humidity < 30) {
      newAlerts.push({
        id: `humidity-low-${timestamp}`,
        type: 'warning',
        message: 'Low Humidity Alert',
        details: `Humidity (${weatherData.current.humidity}%) is very low. Monitor plant stress.`,
        timestamp,
        category: 'weather',
        severity: 'medium'
      });
    }
    
    // Predictive Irrigation Alert
    if (ndviStats.mean < 0.35 && soilData?.stats?.mean < 0.25 && 
        weatherData?.forecast && !hasRainInForecast(weatherData.forecast)) {
      newAlerts.push({
        id: `irrigation-predictive-${timestamp}`,
        type: 'critical',
        message: 'Predictive Irrigation Alert',
        details: 'Low NDVI and soil moisture detected with no rain forecast. Immediate irrigation recommended.',
        timestamp,
        category: 'irrigation',
        severity: 'high'
      });
    }
    
    setAlerts(prev => [...prev, ...newAlerts]);
    
    // Show toast notifications for critical alerts
    newAlerts.forEach(alert => {
      if (alert.type === 'critical') {
        toast.error(alert.message, { description: alert.details });
      } else if (alert.type === 'warning') {
        toast.warning(alert.message, { description: alert.details });
      }
    });
    
    return newAlerts;
  }
  
  function hasRainInForecast(forecast: any[]): boolean {
    return forecast.some(day => 
      day.condition?.toLowerCase().includes('rain') || 
      day.precipitation > 5
    );
  }

  // Phase 2 functions
  async function fetchTimeSeries() {
    if (!bboxStr) return toast.error('Please set a bounding box first')
    setTimeSeriesLoading(true)
    try {
      const bbox = bboxStr.split(',').map(s => Number(s.trim()))
      const response = await fetch('/api/timeseries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          bbox, 
          startDate: '2024-01-01',
          endDate: new Date().toISOString().split('T')[0],
          interval: 'monthly'
        })
      })
      if (!response.ok) throw new Error('Time series fetch failed')
      const data = await response.json()
      setTimeSeriesData(data.data)
      toast.success('Time series data loaded')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to fetch time series data')
    } finally {
      setTimeSeriesLoading(false)
    }
  }

  async function getEnhancedAIAnalysis() {
    const currentData = state || ndviData
    if (!currentData) return toast.error('No NDVI data to analyze')
    
    setAiAnalysis("Running enhanced analysis...")
    
    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Analyze farm health based on NDVI data: min=${currentData.stats.min.toFixed(3)}, max=${currentData.stats.max.toFixed(3)}, mean=${currentData.stats.mean.toFixed(3)}. Provide health assessment and 3 actionable recommendations.`,
          ndviData: currentData,
          weatherData: weatherData,
          timeSeriesData: timeSeriesData,
          analysisType: analysisType
        }),
      })
      
      // Handle rate limit errors
      if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}))
        setAiAnalysis(errorData.message || 'Rate limit exceeded. Please wait a moment and try again.')
        return
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        setAiAnalysis(errorData.message || `Error: ${response.statusText}. Using fallback analysis.`)
        return
      }
      
      const result = await response.json()
      console.log('AI Analysis result:', result)
      setAiAnalysis(result.suggestion || result.output || "Analysis completed")
    } catch (error) {
      console.error('Enhanced AI Analysis error:', error)
      const errorMessage = (error as any)?.message || ''
      if (errorMessage.includes('rate limit')) {
        setAiAnalysis('Rate limit exceeded. Please wait a moment and try again.')
      } else {
        setAiAnalysis(generateLocalAnalysis(currentData.stats))
      }
    }
  }

  const hotspots = (ndviData?.previewPng && result?.bbox)
    ? [{
        position: [
          (result.bbox[1] + result.bbox[3]) / 2,
          (result.bbox[0] + result.bbox[2]) / 2
        ],
        label: 'Center of AOI'
      }]
    : []

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      <NavBar />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Satellite className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-blue-600 dark:from-green-400 dark:to-blue-400 bg-clip-text text-transparent">
              AgriSense Dashboard
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload satellite imagery or auto-ingest from Sentinel-2 to analyze vegetation health with NDVI
          </p>
        </div>

        {/* Simple Tab Navigation */}
        <div className="mb-8">
          <div className="flex space-x-1 bg-muted p-1 rounded-lg w-fit mx-auto">
            <button
              onClick={() => setActiveTab("auto-ingest")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "auto-ingest"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapPin className="h-4 w-4 inline mr-2" />
              Auto Ingest
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "upload"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Upload className="h-4 w-4 inline mr-2" />
              Upload Analysis
            </button>
            </div>
        </div>

        {/* Upload Tab Content */}
        {activeTab === "upload" && (
          <div className="space-y-8">
            <div className="grid lg:grid-cols-2 gap-8">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Leaf className="h-5 w-5 text-green-600 dark:text-green-400" />
                    Upload & Analyze
                  </CardTitle>
                  <CardDescription>Upload a Sentinel GeoTIFF with Red (B4) and NIR (B8) bands</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <NDVIUploader onNDVIReady={(data) => {
                    setState(data)
                    checkThresholds(data.stats)
                  }} />

                  {state && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Health Status:</span>
                        {getHealthBadge(state.stats.mean)}
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="font-semibold text-red-600 dark:text-red-400">{state.stats.min.toFixed(3)}</div>
                          <div className="text-xs text-muted-foreground">Min NDVI</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="font-semibold text-blue-600 dark:text-blue-400">{state.stats.mean.toFixed(3)}</div>
                          <div className="text-xs text-muted-foreground">Mean NDVI</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="font-semibold text-green-600 dark:text-green-400">{state.stats.max.toFixed(3)}</div>
                          <div className="text-xs text-muted-foreground">Max NDVI</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={savePlot} disabled={!state || saving} className="flex-1">
                      {saving ? "Saving..." : "Save Analysis"}
                    </Button>
                    <Button variant="outline" onClick={getAIAnalysis} disabled={!state} className="flex-1">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      AI Analysis
                    </Button>
                  </div>

                  {state && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={exportPNG} className="flex-1">
                        <Download className="h-4 w-4 mr-2" />
                        Export PNG
                      </Button>
                      <Button variant="outline" onClick={exportPDF} className="flex-1">
                        <Download className="h-4 w-4 mr-2" />
                        Export PDF
                      </Button>
                    </div>
                  )}

                  {savedId && (
                    <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-2 rounded">
                      ✓ Analysis saved with ID: {savedId}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>NDVI Heatmap</CardTitle>
                  <CardDescription>Green = Healthy vegetation, Red = Stressed/sparse vegetation</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center min-h-[400px]">
                  {state ? (
                    <div className="space-y-4">
                      <NDVICanvas ndvi={state.ndvi} width={state.width} height={state.height} />
                      <div className="flex items-center justify-center gap-4 text-xs">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 bg-red-500 rounded"></div>
                          <span>Stressed</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 bg-yellow-500 rounded"></div>
                          <span>Moderate</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 bg-green-500 rounded"></div>
                          <span>Healthy</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Satellite className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Upload satellite imagery to view NDVI heatmap</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {aiAnalysis && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                    AI Health Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">{typedAnalysis}</div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

         {/* Auto-Ingest Tab Content */}
        {activeTab === "auto-ingest" && (
          <div className="space-y-8">
            {/* Main Map Layout */}
            <div className="grid gap-8">
               {/* Main Map Area */}
               <div>
                 <Card>
                   <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                       <MapPin className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                       Location Selection Map
                     </CardTitle>
                     <CardDescription>
                       Search a location, draw an area of interest, then fetch data automatically
                     </CardDescription>
                   </CardHeader>
                   <CardContent>
                   <div className="rounded-lg border bg-card overflow-hidden" style={{ height: '600px', zIndex: 0 }}>
                       <MapView
                         bbox={bboxStr ? (bboxStr.split(',').map(Number) as any) : undefined}
                         onBboxChange={b => setBboxStr(b.join(','))}
                         polygon={polygon as any}
                         onPolygonChange={(coords) => {
                           try {
                             setPolygon(coords as any)
                             polygonToBbox(coords as any)
                           } catch (error) {
                             console.warn('Error processing polygon coordinates:', error)
                           }
                         }}
                         ndviPng={null}
                         ndviBounds={result?.bbox}
                         hotspots={hotspots as any}
                       />
                     </div>
                     {/* Search and Controls */}
                    <div className="grid md:grid-cols-4 gap-3 items-end">
                       <div>
                         <label className="text-xs text-muted-foreground">Search place</label>
                         <div className="flex gap-2">
                           <input
                             className="border rounded px-2 py-1 w-full bg-background text-foreground"
                             value={query}
                             onChange={e => setQuery(e.target.value)}
                             placeholder="e.g., Iowa City"
                           />
                           <Button
                             variant="secondary"
                             onClick={geocode}
                             disabled={loading}
                           >
                             {loading ? 'Searching…' : 'Find'}
                           </Button>
                         </div>
                         {suggestions.length > 0 && (
                           <div className="mt-2 border rounded bg-background text-sm max-h-48 overflow-auto">
                             {suggestions.map((s: any) => (
                               <div
                                 key={s.display_name}
                                 className="px-2 py-1 hover:bg-accent cursor-pointer"
                                 onClick={() => selectPlace(s)}
                               >
                                 {s.display_name}
                               </div>
                             ))}
                           </div>
                         )}
                       </div>
                       <div>
                         <label className="text-xs text-muted-foreground">
                           BBox [minx,miny,maxx,maxy]
                         </label>
                         <input
                           className="border rounded px-2 py-1 w-full bg-background text-foreground"
                           value={bboxStr}
                           onChange={e => setBboxStr(e.target.value)}
                           placeholder="-122.52,37.70,-122.35,37.83"
                         />
                      </div>
                       <div>
                         <label className="text-xs text-muted-foreground">
                           Date range (ISO/ISO)
                         </label>
                         <input
                           className="border rounded px-2 py-1 w-full bg-background text-foreground"
                           value={date}
                           onChange={e => setDate(e.target.value)}
                           placeholder="2025-08-01/2025-08-10"
                         />
                       </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Location name</label>
                        <input
                          className="border rounded px-2 py-1 w-full bg-background text-foreground"
                          value={locationName}
                          onChange={e => {
                            setLocationName(e.target.value)
                            setSelectedLocation(prev => prev ? { ...prev, name: e.target.value } : null)
                          }}
                          placeholder="e.g., North Field"
                        />
                      </div>
                     </div>
                     <div className="mt-3 flex gap-2">
                       <Button
                         onClick={autoFetchNDVI}
                         disabled={loading || !bboxStr}
                         className="flex-1"
                       >
                         {loading ? 'Fetching…' : 'Fetch Data'}
                       </Button>
                       <Button
                         variant="outline"
                         onClick={() => {
                           setBboxStr('')
                           setPolygon([])
                           setResult(null)
                           setNdviData(null)
                           setSoilData(null)
                           setEtData(null)
                           setActiveLayer('ndvi')
                         }}
                         className="px-3"
                       >
                         <Plus className="h-4 w-4" />
                       </Button>
                     </div>
                   </CardContent>
                 </Card>
               </div>
              
             </div>

             {/* Weather Widget - Below Map */}
             <WeatherWidget 
               bbox={bboxStr ? (bboxStr.split(',').map(Number) as any) : undefined}
               date={date}
               searchLocation={selectedLocation}
             />

            {result && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Imagery Found</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div className="break-words overflow-hidden">Imagery: <span className="break-all">{result.imagery?.id}</span></div>
                      <div className="break-words overflow-hidden">Date: <span className="break-all">{result.imagery?.date}</span></div>
                      <div className="break-words overflow-hidden">Cloud Cover: {result.imagery?.cloudCover?.toFixed(1)}%</div>
                      <div className="break-words overflow-hidden">Platform: <span className="break-all">{result.imagery?.platform}</span></div>
                    </div>
                    
                    {result.message && (
                      <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-800 dark:text-blue-200 break-words overflow-hidden">
                        {result.message}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {result.assets && (
                  <Card>
                    <CardHeader className="pb-4">
                      <CardTitle className="text-lg">NDVI Processing</CardTitle>
                      <CardDescription>
                        Process satellite imagery to generate NDVI heatmap
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <NDVIProcessor 
                        assets={result.assets} 
                        onNDVIReady={(data) => {
                          setNdviData(data)
                          setActiveResultLayer('ndvi')
                          // Load the other layers automatically once NDVI is ready
                          fetchSoilMoisture()
                          fetchEvapotranspiration()
                          checkThresholds(data.stats)
                          toast.success('NDVI analysis completed! Loaded Soil & ET layers.')
                        }}
                      />
                      {ndviData && (
                        <div className="space-y-4">
                          {/* Show toggles only when soil & ET are both ready so all appear simultaneously */}
                          {soilData && etData && (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant={activeResultLayer==='ndvi' ? 'default' : 'outline'} onClick={()=>setActiveResultLayer('ndvi')}>NDVI</Button>
                              <Button size="sm" variant={activeResultLayer==='soil' ? 'default' : 'outline'} onClick={()=>setActiveResultLayer('soil')}>Soil Moisture</Button>
                              <Button size="sm" variant={activeResultLayer==='et' ? 'default' : 'outline'} onClick={()=>setActiveResultLayer('et')}>Evapotranspiration</Button>
                            </div>
                          )}
                          <div className="grid md:grid-cols-2 gap-4 items-start">
                            {/* Left: active layer image */}
                            <div className="relative border rounded-lg p-2 bg-muted/30">
                              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                                <label className="text-xs">Zones</label>
                                <input type="checkbox" checked={zonesOn} onChange={e=> setZonesOn(e.target.checked)} />
                              </div>
                              {(activeResultLayer==='ndvi' && ndviData?.previewPng) && (
                                <img src={`data:image/png;base64,${ndviData.previewPng}`} alt="NDVI" className="w-full h-[400px] object-contain rounded" />
                              )}
                              {(activeResultLayer==='soil' && soilData?.overlayPng) && (
                                <img src={`data:image/png;base64,${soilData.overlayPng}`} alt="Soil Moisture" className="w-full h-[400px] object-contain rounded" />
                              )}
                              {(activeResultLayer==='et' && etData?.overlayPng) && (
                                <img src={`data:image/png;base64,${etData.overlayPng}`} alt="Evapotranspiration" className="w-full h-[400px] object-contain rounded" />
                              )}
                              {zonesOn && (
                                <>
                                  <div className="absolute inset-2 pointer-events-auto" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gridTemplateRows:'repeat(3,1fr)' }}>
                                    {Array.from({ length:9 }).map((_,i)=> (
                                      <div key={i}
                                        onClick={()=> setZoneInfoOpen(true)}
                                        className="relative border border-white/50 hover:bg-red-500/10 cursor-pointer">
                                        <span className="absolute top-1 left-1 text-[10px] bg-black/40 text-white px-1 rounded">Grid {i+1}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {zoneInfoOpen && (
                                    <div className="absolute bottom-3 left-3 right-3 md:right-auto md:w-80 z-20 rounded-lg border bg-background/95 backdrop-blur p-3 shadow">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="font-medium">Zone Details</div>
                                        <button className="text-xs opacity-70 hover:opacity-100" onClick={()=> setZoneInfoOpen(false)}>Close</button>
                                      </div>
                                      <div className="mt-2 text-xs space-y-1">
                                        <div>Health: {(ndviData?.stats?.mean ? Math.round((ndviData.stats.mean+1)*50) : 75)}%</div>
                                        <div>Soil Moisture: {soilData?.stats?.mean?.toFixed?.(2) ?? (0.25).toFixed(2)} m³/m³</div>
                                        <div>ET: {etData?.stats?.mean?.toFixed?.(1) ?? (3.5).toFixed(1)} mm/day</div>
                                        <div className="text-muted-foreground">Sprinkler: Auto mode • Next run: 6:00 AM</div>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            {/* Right: Layer Information + Stats embedded */}
                            <div className="space-y-4">
                              <div>
                                <div className="font-semibold mb-2">Layer Information</div>
                                <div className="grid grid-cols-1 gap-3 text-sm">
                                  <div>
                                    <div className="font-medium mb-1">NDVI</div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-red-500 rounded"/> <span>Stressed (0.0 - 0.2)</span></div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-yellow-500 rounded"/> <span>Moderate (0.2 - 0.4)</span></div>
                                    <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-500 rounded"/> <span>Healthy (0.4 - 0.8)</span></div>
                                  </div>
                                  <div>
                                    <div className="font-medium mb-1">Soil Moisture</div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-amber-800 rounded"/> <span>Dry</span></div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-amber-400 rounded"/> <span>Moderate</span></div>
                                    <div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded"/> <span>Wet</span></div>
                                  </div>
                                  <div>
                                    <div className="font-medium mb-1">Evapotranspiration</div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-red-500 rounded"/> <span>Low (0-2 mm/day)</span></div>
                                    <div className="flex items-center gap-2 mb-1"><div className="w-4 h-4 bg-yellow-500 rounded"/> <span>Moderate (2-4)</span></div>
                                    <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-500 rounded"/> <span>High (4+)</span></div>
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                {ndviData && (
                                  <>
                                    <div className="flex justify-between"><span className="text-muted-foreground">NDVI min:</span><span className="font-medium">{ndviData.stats.min.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">NDVI mean:</span><span className="font-medium">{ndviData.stats.mean.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">NDVI max:</span><span className="font-medium">{ndviData.stats.max.toFixed(3)}</span></div>
                                  </>
                                )}
                                {soilData?.stats && (
                                  <>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Soil min:</span><span className="font-medium">{soilData.stats.min.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Soil mean:</span><span className="font-medium">{soilData.stats.mean.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Soil max:</span><span className="font-medium">{soilData.stats.max.toFixed(3)}</span></div>
                                  </>
                                )}
                                {etData?.stats && (
                                  <>
                                    <div className="flex justify-between"><span className="text-muted-foreground">ET min:</span><span className="font-medium">{etData.stats.min.toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">ET mean:</span><span className="font-medium">{etData.stats.mean.toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">ET max:</span><span className="font-medium">{etData.stats.max.toFixed(2)}</span></div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {ndviData && (
                  <div className="flex gap-2">
                    <Button 
                      onClick={saveAutoIngestPlot} 
                      disabled={saving}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {saving ? 'Saving...' : 'Save Analysis'}
                    </Button>
                    <Button variant="outline" onClick={exportPNG}>
                      <Download className="h-4 w-4 mr-2" />
                      Export PNG
                    </Button>
                    <Button variant="outline" onClick={exportPDF}>
                      <Download className="h-4 w-4 mr-2" />
                      Export PDF
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Alerts Section */}
        {alerts.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                Threshold Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${
                      alert.type === 'critical'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200'
                    }`}
                  >
                    <div className="font-medium">{alert.message}</div>
                    <div className="text-sm opacity-80">{alert.details}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

         {/* Layer Legends moved inside results card */}

         {/* Phase 2 Features */}
         {(state || ndviData) && (
           <div className="mt-8 space-y-8">
             {/* Time Series Analysis (moved above Enhanced) */}
             <Card>
               <CardHeader>
                 <CardTitle className="flex items-center gap-2">
                   <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                   Historical Trends
                 </CardTitle>
                 <CardDescription>
                   NDVI time series analysis and seasonal patterns
                 </CardDescription>
               </CardHeader>
               <CardContent>
                 <div className="space-y-4">
                   <Button 
                     onClick={fetchTimeSeries} 
                     disabled={!bboxStr || timeSeriesLoading}
                     className="w-full"
                   >
                     {timeSeriesLoading ? 'Loading...' : 'Load Time Series Data'}
                   </Button>

                   {timeSeriesData && (
                     <div className="space-y-4">
                       <TimeSeriesChart 
                         data={timeSeriesData.timeSeries}
                         title="NDVI Time Series"
                         showConfidence={true}
                         showCloudCover={true}
                       />
                       {timeSeriesData.summary && (
                         <div className="grid md:grid-cols-3 gap-4">
                           <div className="text-center p-3 bg-muted rounded">
                             <div className="text-lg font-semibold">{timeSeriesData.summary.trend}</div>
                             <div className="text-xs text-muted-foreground">Overall Trend</div>
                           </div>
                           <div className="text-center p-3 bg-muted rounded">
                             <div className="text-lg font-semibold">{timeSeriesData.summary.averageNDVI.toFixed(3)}</div>
                             <div className="text-xs text-muted-foreground">Average NDVI</div>
                           </div>
                           <div className="text-center p-3 bg-muted rounded">
                             <div className="text-lg font-semibold">{timeSeriesData.summary.totalPoints}</div>
                             <div className="text-xs text-muted-foreground">Data Points</div>
                           </div>
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               </CardContent>
             </Card>

             {/* Enhanced Analysis Section */}
             <Card>
               <CardHeader>
                 <CardTitle className="flex items-center gap-2">
                   <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                   Enhanced Analytics (Phase 2)
                 </CardTitle>
                 <CardDescription>
                   Advanced analysis with weather integration and time series data
                 </CardDescription>
               </CardHeader>
               <CardContent>
                 <div className="space-y-4">
                   {/* Analysis Type Selector */}
                   <div className="flex gap-2 flex-wrap">
                     <Button
                       variant={analysisType === 'basic' ? 'default' : 'outline'}
                       onClick={() => setAnalysisType('basic')}
                       size="sm"
                     >
                       Basic Analysis
                     </Button>
                     <Button
                       variant={analysisType === 'weather' ? 'default' : 'outline'}
                       onClick={() => setAnalysisType('weather')}
                       size="sm"
                       disabled={!weatherData}
                     >
                       <Cloud className="h-4 w-4 mr-1" />
                       Weather Analysis
                     </Button>
                     <Button
                       variant={analysisType === 'trend' ? 'default' : 'outline'}
                       onClick={() => setAnalysisType('trend')}
                       size="sm"
                       disabled={!timeSeriesData}
                     >
                       <TrendingUp className="h-4 w-4 mr-1" />
                       Trend Analysis
                     </Button>
                     <Button
                       variant={analysisType === 'comprehensive' ? 'default' : 'outline'}
                       onClick={() => setAnalysisType('comprehensive')}
                       size="sm"
                       disabled={!weatherData || !timeSeriesData}
                     >
                       <Globe className="h-4 w-4 mr-1" />
                       Comprehensive
                     </Button>
                   </div>

                   {/* Enhanced AI Analysis Button */}
                   <Button 
                     onClick={() => {
                       console.log('AI Analysis button clicked');
                       console.log('Current data:', state || ndviData);
                       getEnhancedAIAnalysis();
                     }} 
                     disabled={!state && !ndviData}
                     className="w-full"
                   >
                     <BarChart3 className="h-4 w-4 mr-2" />
                     Run Enhanced AI Analysis
                   </Button>
                   
                   {/* AI Analysis Results (typed) */}
                   {typedAnalysis && (
                     <div className="mt-4 p-4 bg-muted rounded-lg">
                       <h4 className="font-medium mb-2">AI Analysis Results:</h4>
                       <div className="whitespace-pre-wrap text-sm">{typedAnalysis}</div>
                     </div>
                   )}
                 </div>
               </CardContent>
             </Card>

            {/* Interactive 3D Map */}
            <div className="lg:col-span-1">
              <Card>
                 <CardHeader>
                   <CardTitle className="flex items-center gap-2">
                     <Globe className="h-5 w-5 text-green-600 dark:text-green-400" />
                     Interactive 3D Visualization
                   </CardTitle>
                   <CardDescription>
                     Advanced 3D mapping with deck.gl
                   </CardDescription>
                 </CardHeader>
                 <CardContent>
                   <div className="space-y-4">
                     <Button 
                       onClick={() => setShowInteractiveMap(!showInteractiveMap)}
                       className="w-full"
                     >
                       {showInteractiveMap ? 'Hide' : 'Show'} Interactive Map
                     </Button>

                      {showInteractiveMap && (state || ndviData) && (
                       <InteractiveMap
                         ndviData={state || ndviData}
                         bbox={result?.bbox}
                         show3D={true}
                         layerType="scatter"
                          location={selectedLocation}
                       />
                     )}
                   </div>
                 </CardContent>
               </Card>
             </div>
           </div>
         )}

         {/* AI Chatbot */}
         <Chatbot context={{
           location: selectedLocation,
           bbox: result?.bbox,
           ndviStats: ndviData?.stats || state?.stats,
           soilStats: soilData?.stats,
           etStats: etData?.stats,
           weather: weatherData,
           timeSeries: timeSeriesData?.summary
         }} />
       </main>
     </div>
   )
 }

// Mount chatbot with context at app bottom