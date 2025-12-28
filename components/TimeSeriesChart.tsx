import React, { useRef, useEffect } from 'react';

interface TimeSeriesChartProps {
  data: Array<{
    date: string;
    ndvi: number;
    confidence?: number;
    cloudCover?: number;
    quality?: string;
  }>;
  title?: string;
  height?: number;
  showConfidence?: boolean;
  showCloudCover?: boolean;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  title = 'NDVI Time Series',
  height = 300,
  showConfidence = false,
  showCloudCover = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.offsetWidth, height);

    // Chart dimensions
    const margin = { top: 20, right: 40, bottom: 40, left: 60 };
    const chartWidth = canvas.offsetWidth - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Find data bounds
    const dates = data.map(d => new Date(d.date));
    const ndviValues = data.map(d => d.ndvi);
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    const minNDVI = Math.min(...ndviValues);
    const maxNDVI = Math.max(...ndviValues);

    // Add some padding to the NDVI range
    const ndviRange = maxNDVI - minNDVI;
    const paddedMinNDVI = minNDVI - ndviRange * 0.1;
    const paddedMaxNDVI = maxNDVI + ndviRange * 0.1;

    // Scale functions
    const xScale = (date: Date) => 
      margin.left + ((date.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * chartWidth;
    
    const yScale = (ndvi: number) => 
      margin.top + chartHeight - ((ndvi - paddedMinNDVI) / (paddedMaxNDVI - paddedMinNDVI)) * chartHeight;

    // Draw grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const y = margin.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartWidth, y);
      ctx.stroke();
    }

    // Vertical grid lines
    for (let i = 0; i <= 5; i++) {
      const x = margin.left + (chartWidth / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + chartHeight);
      ctx.stroke();
    }

    // Draw confidence bands if enabled
    if (showConfidence && data.some(d => d.confidence)) {
      ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
      ctx.beginPath();
      
      // Upper confidence band
      data.forEach((d, i) => {
        const x = xScale(new Date(d.date));
        const confidence = d.confidence || 0.9;
        const upperBound = d.ndvi + (1 - confidence) * 0.1; // Simplified confidence calculation
        const y = yScale(upperBound);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      // Lower confidence band
      for (let i = data.length - 1; i >= 0; i--) {
        const d = data[i];
        const x = xScale(new Date(d.date));
        const confidence = d.confidence || 0.9;
        const lowerBound = d.ndvi - (1 - confidence) * 0.1;
        const y = yScale(lowerBound);
        ctx.lineTo(x, y);
      }
      
      ctx.closePath();
      ctx.fill();
    }

    // Draw NDVI line
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((d, i) => {
      const x = xScale(new Date(d.date));
      const y = yScale(d.ndvi);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();

    // Draw data points
    ctx.fillStyle = '#007bff';
    data.forEach(d => {
      const x = xScale(new Date(d.date));
      const y = yScale(d.ndvi);
      
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    
    // X-axis
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top + chartHeight);
    ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
    ctx.stroke();
    
    // Y-axis
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + chartHeight);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#333';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    
    // X-axis labels (dates)
    for (let i = 0; i <= 5; i++) {
      const date = new Date(minDate.getTime() + (maxDate.getTime() - minDate.getTime()) * (i / 5));
      const x = margin.left + (chartWidth / 5) * i;
      ctx.fillText(date.toLocaleDateString(), x, margin.top + chartHeight + 20);
    }
    
    // Y-axis labels (NDVI values)
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const ndvi = paddedMinNDVI + (paddedMaxNDVI - paddedMinNDVI) * (i / 5);
      const y = margin.top + chartHeight - (chartHeight / 5) * i;
      ctx.fillText(ndvi.toFixed(2), margin.left - 10, y + 4);
    }

    // Draw title
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(title, canvas.offsetWidth / 2, 20);

    // Draw legend
    if (showCloudCover) {
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('Cloud Cover:', margin.left + chartWidth + 10, margin.top + 20);
      
      data.forEach((d, i) => {
        if (d.cloudCover !== undefined) {
          const x = xScale(new Date(d.date));
          const y = yScale(d.ndvi);
          const opacity = 1 - (d.cloudCover / 100);
          
          ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, 2 * Math.PI);
          ctx.fill();
        }
      });
    }

  }, [data, height, showConfidence, showCloudCover, title]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px` }}
        className="border rounded"
      />
    </div>
  );
};

export default TimeSeriesChart;