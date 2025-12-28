import React, { useState, useEffect } from 'react';
import { fromUrl } from 'geotiff';
import { PNG } from 'pngjs';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

interface NDVIProcessorProps {
  assets: { b04: string; b08: string };
  onNDVIReady: (data: { ndvi: Float32Array; width: number; height: number; stats: { min: number; max: number; mean: number }; previewPng: string }) => void;
}

const NDVIProcessor: React.FC<NDVIProcessorProps> = ({ assets, onNDVIReady }) => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const processNDVI = async () => {
    setProcessing(true);
    setProgress(0);
    setError(null);
    let running = true;
    let gate = 0;
    const tick = () => setProgress(p => (p < gate ? p + 1 : p));
    const interval = window.setInterval(tick, 50);
    
    try {
      // 1. Fetch and load GeoTIFFs
      gate = 10;
      const tB04 = await fromUrl(assets.b04);
      const iB04 = await tB04.getImage();
      const tB08 = await fromUrl(assets.b08);
      const iB08 = await tB08.getImage();
      gate = 30;

      const width = iB04.getWidth();
      const height = iB04.getHeight();

      // For client-side, balance quality and performance
      const targetSize = 512; 
      const maxSide = Math.max(width, height);
      const scale = maxSide > targetSize ? targetSize / maxSide : 1;
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));

      gate = 40;
      const rB04 = await iB04.readRasters({ samples: [0], width: outW, height: outH, resampleMethod: 'bilinear' });
      const rB08 = await iB08.readRasters({ samples: [0], width: outW, height: outH, resampleMethod: 'bilinear' });
      gate = 50;

      const redArr = Array.isArray(rB04) ? rB04[0] : rB04;
      const nirArr = Array.isArray(rB08) ? rB08[0] : rB08;

      if (!redArr || !nirArr || redArr.length !== nirArr.length) {
        throw new Error('Invalid band data');
      }

      // Detect and scale values
      const detectAndScale = (array: ArrayLike<number>) => {
        let max = -Infinity;
        for (let i = 0; i < array.length; i++) {
          const v = Number((array as any)[i]);
          if (!Number.isFinite(v)) continue;
          if (v > max) max = v;
        }
        if (max > 1000) {
          const scaled = new Float32Array(array.length);
          for (let i = 0; i < array.length; i++) scaled[i] = Number((array as any)[i]) / 10000;
          return { arr: scaled, scaled: true };
        }
        if (array instanceof Float32Array) return { arr: array, scaled: false };
        const copy = new Float32Array(array.length);
        for (let i = 0; i < array.length; i++) copy[i] = Number((array as any)[i]);
        return { arr: copy, scaled: false };
      }

      const redScaled = detectAndScale(redArr).arr;
      const nirScaled = detectAndScale(nirArr).arr;

      gate = 60;

      // 2. Calculate NDVI
      const len = redScaled.length;
      let min = Infinity, max = -Infinity, sum = 0, count = 0;
      const ndviValues = new Float32Array(len);

      for (let i = 0; i < len; i++) {
        const r = redScaled[i];
        const n = nirScaled[i];
        if (!Number.isFinite(r) || !Number.isFinite(n)) continue;
        const denom = n + r;
        if (denom === 0) continue;
        const v = (n - r) / denom;
        ndviValues[i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        count++;
      }
      const mean = count > 0 ? sum / count : 0;
      const clampedMin = Number.isFinite(min) ? Math.max(-1, Math.min(1, min)) : 0;
      const clampedMax = Number.isFinite(max) ? Math.max(-1, Math.min(1, max)) : 0;
      gate = 80;

      // 3. Generate colored NDVI heatmap PNG
      const png = new PNG({ width: outW, height: outH });
      
      // NDVI color mapping function
      const getNDVIColor = (ndvi: number) => {
        // Clamp NDVI to valid range
        const clamped = Math.max(-1, Math.min(1, ndvi));
        
        if (clamped < -0.2) {
          // Water/Bare soil - Dark red
          return [128, 0, 38, 255];
        } else if (clamped < 0.0) {
          // Bare soil - Red
          return [189, 0, 38, 255];
        } else if (clamped < 0.2) {
          // Low vegetation - Yellow
          return [255, 255, 178, 255];
        } else if (clamped < 0.4) {
          // Moderate vegetation - Light green
          return [127, 201, 127, 255];
        } else {
          // High vegetation - Dark green
          return [27, 120, 55, 255];
        }
      };
      
      for (let i = 0; i < len; i++) {
        const v = ndviValues[i];
        const color = getNDVIColor(v);
        const idx = i * 4;
        png.data[idx] = color[0];     // R
        png.data[idx + 1] = color[1]; // G
        png.data[idx + 2] = color[2]; // B
        png.data[idx + 3] = color[3]; // A
      }
      const pngBuffer = PNG.sync.write(png);
      const previewPng = pngBuffer.toString("base64");
      gate = 100;

      onNDVIReady({
        ndvi: ndviValues,
        width: outW,
        height: outH,
        stats: { min: clampedMin, max: clampedMax, mean },
        previewPng,
      });

    } catch (e: any) {
      console.error('Client-side NDVI processing error:', e);
      setError(e?.message || 'Failed to process NDVI');
    } finally {
      setProcessing(false);
      running = false;
      window.clearInterval(interval);
      setProgress(100);
    }
  };

  return (
    <div className="space-y-4">
      <Button onClick={processNDVI} disabled={processing} className="w-full">
        {processing ? `Processing... ${progress}%` : 'Process Location'}
      </Button>
      {processing && <Progress value={progress} className="mt-3" />}
      {error && <div className="text-red-500 text-sm mt-3">Error: {error}</div>}
    </div>
  );
};

export default NDVIProcessor;

