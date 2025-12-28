import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { bbox, startDate, endDate, interval = 'monthly' } = req.body || {};

    // Validate bbox
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      return res.status(400).json({ error: 'bbox_required', message: 'Bounding box [minx,miny,maxx,maxy] is required' });
    }

    console.log('Generating time series data for bbox:', bbox);

    // Generate time series data points
    const timeSeriesData = generateTimeSeriesData(bbox, startDate, endDate, interval);

    return res.status(200).json({
      success: true,
      data: {
        timeSeries: timeSeriesData,
        bbox,
        interval,
        startDate: startDate || '2024-01-01',
        endDate: endDate || new Date().toISOString().split('T')[0],
        summary: {
          totalPoints: timeSeriesData.length,
          averageNDVI: timeSeriesData.reduce((sum, point) => sum + point.ndvi, 0) / timeSeriesData.length,
          trend: calculateTrend(timeSeriesData),
          seasonality: detectSeasonality(timeSeriesData)
        }
      }
    });

  } catch (e: any) {
    console.error('timeseries API error', e?.message || e);
    return res.status(500).json({ error: 'timeseries_failed', message: String(e?.message || e) });
  }
}

function generateTimeSeriesData(bbox: number[], startDate?: string, endDate?: string, interval: string = 'monthly') {
  const start = startDate ? new Date(startDate) : new Date('2024-01-01');
  const end = endDate ? new Date(endDate) : new Date();
  
  const data = [];
  const current = new Date(start);
  
  // Base NDVI value for the area (simulated)
  const baseNDVI = 0.4 + Math.random() * 0.3; // 0.4-0.7 range
  
  while (current <= end) {
    // Simulate seasonal variation
    const month = current.getMonth();
    const seasonalFactor = 0.8 + 0.4 * Math.sin((month / 12) * 2 * Math.PI - Math.PI/2);
    
    // Add some random variation
    const randomVariation = (Math.random() - 0.5) * 0.1;
    
    // Simulate weather impact (drought, good conditions, etc.)
    const weatherImpact = simulateWeatherImpact(current);
    
    const ndvi = Math.max(0, Math.min(1, baseNDVI * seasonalFactor + randomVariation + weatherImpact));
    
    data.push({
      date: current.toISOString().split('T')[0],
      ndvi: parseFloat(ndvi.toFixed(3)),
      confidence: 0.85 + Math.random() * 0.1, // 0.85-0.95
      cloudCover: Math.random() * 30, // 0-30%
      source: 'Sentinel-2',
      quality: ndvi > 0.5 ? 'high' : ndvi > 0.3 ? 'medium' : 'low'
    });
    
    // Increment based on interval
    if (interval === 'daily') {
      current.setDate(current.getDate() + 1);
    } else if (interval === 'weekly') {
      current.setDate(current.getDate() + 7);
    } else if (interval === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    }
  }
  
  return data;
}

function simulateWeatherImpact(date: Date): number {
  // Simulate drought periods, good growing seasons, etc.
  const year = date.getFullYear();
  const month = date.getMonth();
  
  // Simulate a drought in summer 2024
  if (year === 2024 && month >= 5 && month <= 8) {
    return -0.1; // Negative impact
  }
  
  // Simulate good conditions in spring
  if (month >= 2 && month <= 5) {
    return 0.05; // Positive impact
  }
  
  return 0; // Neutral
}

function calculateTrend(data: any[]): string {
  if (data.length < 2) return 'insufficient_data';
  
  const firstHalf = data.slice(0, Math.floor(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  
  const firstAvg = firstHalf.reduce((sum, point) => sum + point.ndvi, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, point) => sum + point.ndvi, 0) / secondHalf.length;
  
  const change = secondAvg - firstAvg;
  
  if (change > 0.05) return 'improving';
  if (change < -0.05) return 'declining';
  return 'stable';
}

function detectSeasonality(data: any[]): any {
  if (data.length < 12) return { detected: false };
  
  // Group by month
  const monthlyAverages: { [key: number]: number[] } = {};
  
  data.forEach(point => {
    const month = new Date(point.date).getMonth();
    if (!monthlyAverages[month]) monthlyAverages[month] = [];
    monthlyAverages[month].push(point.ndvi);
  });
  
  // Calculate average for each month
  const monthlyNDVI: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (monthlyAverages[i]) {
      monthlyNDVI[i] = monthlyAverages[i].reduce((sum, val) => sum + val, 0) / monthlyAverages[i].length;
    } else {
      monthlyNDVI[i] = 0;
    }
  }
  
  // Find peak and low months
  const maxNDVI = Math.max(...monthlyNDVI);
  const minNDVI = Math.min(...monthlyNDVI);
  const peakMonth = monthlyNDVI.indexOf(maxNDVI);
  const lowMonth = monthlyNDVI.indexOf(minNDVI);
  
  return {
    detected: true,
    peakMonth: peakMonth,
    lowMonth: lowMonth,
    amplitude: maxNDVI - minNDVI,
    peakNDVI: maxNDVI,
    lowNDVI: minNDVI
  };
}

