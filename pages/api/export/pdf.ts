import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { ndviData, soilData, etData, weatherData, bbox, location } = req.body || {};
    
    if (!ndviData) {
      return res.status(400).json({ error: 'ndvi_data_required', message: 'NDVI data is required for report generation' });
    }

    // Generate comprehensive HTML report
    const reportHtml = generateComprehensiveReport({
      ndviData,
      soilData,
      etData,
      weatherData,
      bbox,
      location: location || 'Unknown Location',
      timestamp: new Date().toISOString()
    });

    // Return HTML that can be opened in new window for printing/saving as PDF
    return res.status(200).json({
      success: true,
      html: reportHtml,
      message: 'Report generated successfully. Open in new window to print/save as PDF.'
    });

  } catch (e: any) {
    console.error('PDF export error', e?.message || e);
    return res.status(500).json({ error: 'pdf_generation_failed', message: String(e?.message || e) });
  }
}

function generateComprehensiveReport(data: any): string {
  const { ndviData, soilData, etData, weatherData, bbox, location, timestamp } = data;
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AgriSense Analysis Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .report-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #16a34a;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #16a34a;
            margin: 0;
            font-size: 2.5em;
        }
        .header p {
            color: #666;
            margin: 10px 0 0 0;
        }
        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e5e5e5;
            border-radius: 8px;
        }
        .section h2 {
            color: #16a34a;
            margin-top: 0;
            border-bottom: 2px solid #e5e5e5;
            padding-bottom: 10px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.5em;
            font-weight: bold;
            color: #16a34a;
        }
        .stat-label {
            color: #666;
            font-size: 0.9em;
        }
        .health-indicator {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            margin: 5px 0;
        }
        .health-good { background: #d1fae5; color: #065f46; }
        .health-moderate { background: #fef3c7; color: #92400e; }
        .health-poor { background: #fee2e2; color: #991b1b; }
        .recommendations {
            background: #f0f9ff;
            border-left: 4px solid #0ea5e9;
            padding: 15px;
            margin: 15px 0;
        }
        .recommendations h3 {
            margin-top: 0;
            color: #0ea5e9;
        }
        .recommendations ul {
            margin: 10px 0;
            padding-left: 20px;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e5e5;
            color: #666;
        }
        @media print {
            body { background: white; }
            .report-container { box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="header">
            <h1>🌱 AgriSense Analysis Report</h1>
            <p>Agricultural Intelligence Platform</p>
            <p><strong>Location:</strong> ${location} | <strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</p>
        </div>

        <div class="section">
            <h2>📊 NDVI Vegetation Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${ndviData.stats?.mean?.toFixed(3) || 'N/A'}</div>
                    <div class="stat-label">Mean NDVI</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${ndviData.stats?.min?.toFixed(3) || 'N/A'}</div>
                    <div class="stat-label">Minimum NDVI</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${ndviData.stats?.max?.toFixed(3) || 'N/A'}</div>
                    <div class="stat-label">Maximum NDVI</div>
                </div>
            </div>
            <div class="health-indicator ${getHealthClass(ndviData.stats?.mean)}">
                ${getHealthStatus(ndviData.stats?.mean)}
            </div>
        </div>

        ${soilData ? `
        <div class="section">
            <h2>💧 Soil Moisture Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${soilData.stats?.mean?.toFixed(3) || 'N/A'} m³/m³</div>
                    <div class="stat-label">Mean Soil Moisture</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${soilData.source || 'N/A'}</div>
                    <div class="stat-label">Data Source</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${soilData.resolution || 'N/A'}</div>
                    <div class="stat-label">Resolution</div>
                </div>
            </div>
            <p><strong>Description:</strong> ${soilData.description || 'Soil moisture content analysis'}</p>
        </div>
        ` : ''}

        ${etData ? `
        <div class="section">
            <h2>🌡️ Evapotranspiration Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${etData.stats?.mean?.toFixed(2) || 'N/A'} mm/day</div>
                    <div class="stat-label">Mean ET</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${etData.source || 'N/A'}</div>
                    <div class="stat-label">Data Source</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${etData.resolution || 'N/A'}</div>
                    <div class="stat-label">Resolution</div>
                </div>
            </div>
            <p><strong>Description:</strong> ${etData.description || 'Daily evapotranspiration analysis'}</p>
        </div>
        ` : ''}

        ${weatherData ? `
        <div class="section">
            <h2>🌤️ Weather Conditions</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${weatherData.current?.temperature || 'N/A'}°C</div>
                    <div class="stat-label">Temperature</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${weatherData.current?.humidity || 'N/A'}%</div>
                    <div class="stat-label">Humidity</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${weatherData.current?.condition || 'N/A'}</div>
                    <div class="stat-label">Conditions</div>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="section">
            <h2>🎯 Recommendations</h2>
            <div class="recommendations">
                <h3>Based on Current Analysis:</h3>
                <ul>
                    ${generateRecommendations(ndviData, soilData, etData, weatherData)}
                </ul>
            </div>
        </div>

        <div class="section">
            <h2>📍 Location Details</h2>
            <p><strong>Bounding Box:</strong> [${bbox?.join(', ') || 'N/A'}]</p>
            <p><strong>Analysis Area:</strong> ${calculateArea(bbox)} km²</p>
        </div>

        <div class="footer">
            <p>Report generated by AgriSense Agricultural Intelligence Platform</p>
            <p>For more information, visit: https://brightbite-81e92.web.app</p>
        </div>
    </div>
</body>
</html>
  `;
}

function getHealthClass(mean: number): string {
  if (mean > 0.4) return 'health-good';
  if (mean > 0.2) return 'health-moderate';
  return 'health-poor';
}

function getHealthStatus(mean: number): string {
  if (mean > 0.4) return '✅ Healthy Vegetation';
  if (mean > 0.2) return '⚠️ Moderate Vegetation';
  return '❌ Stressed Vegetation';
}

function generateRecommendations(ndviData: any, soilData: any, etData: any, weatherData: any): string {
  const recommendations = [];
  
  if (ndviData?.stats?.mean < 0.3) {
    recommendations.push('Consider irrigation to improve vegetation health');
    recommendations.push('Check for pest or disease issues');
  }
  
  if (soilData?.stats?.mean < 0.2) {
    recommendations.push('Soil moisture is low - irrigation recommended');
  }
  
  if (etData?.stats?.mean > 6) {
    recommendations.push('High evapotranspiration - monitor water usage closely');
  }
  
  if (weatherData?.current?.temperature > 30) {
    recommendations.push('High temperatures detected - increase irrigation frequency');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Continue current management practices');
    recommendations.push('Monitor conditions regularly');
  }
  
  return recommendations.map(rec => `<li>${rec}</li>`).join('');
}

function calculateArea(bbox: number[]): string {
  if (!bbox || bbox.length !== 4) return 'N/A';
  
  const [minx, miny, maxx, maxy] = bbox;
  const width = maxx - minx;
  const height = maxy - miny;
  
  // Rough calculation (not accounting for Earth's curvature)
  const area = Math.abs(width * height) * 111 * 111; // Convert degrees to km²
  
  return area.toFixed(2);
}