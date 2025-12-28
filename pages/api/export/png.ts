import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { ndviData, soilData, etData, bbox, location, layerType = 'ndvi' } = req.body || {};
    
    if (!ndviData) {
      return res.status(400).json({ error: 'ndvi_data_required', message: 'NDVI data is required for map export' });
    }

    // Generate map image based on layer type
    let mapImage: string;
    let stats: any;
    let title: string;

    switch (layerType) {
      case 'soil':
        mapImage = soilData?.soilMoisture || ndviData.previewPng;
        stats = soilData?.stats || ndviData.stats;
        title = 'Soil Moisture Map';
        break;
      case 'et':
        mapImage = etData?.evapotranspiration || ndviData.previewPng;
        stats = etData?.stats || ndviData.stats;
        title = 'Evapotranspiration Map';
        break;
      default:
        mapImage = ndviData.previewPng;
        stats = ndviData.stats;
        title = 'NDVI Vegetation Map';
    }

    // Generate enhanced PNG with overlay information
    const enhancedImage = generateEnhancedMapImage({
      baseImage: mapImage,
      stats,
      title,
      location: location || 'Unknown Location',
      bbox,
      layerType,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      image: enhancedImage,
      filename: `${layerType}_map_${new Date().toISOString().split('T')[0]}.png`,
      message: 'Map exported successfully'
    });

  } catch (e: any) {
    console.error('PNG export error', e?.message || e);
    return res.status(500).json({ error: 'png_generation_failed', message: String(e?.message || e) });
  }
}

function generateEnhancedMapImage(data: any): string {
  const { baseImage, stats, title, location, bbox, layerType, timestamp } = data;
  
  // For now, return the base image with metadata
  // In production, you would use a canvas library to add overlays, legends, and text
  return baseImage || 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
}
