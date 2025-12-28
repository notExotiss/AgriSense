
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from './ui/carousel';
import { Cloud, Sun, CloudRain, Wind, Droplets, Eye, Thermometer } from 'lucide-react';

interface WeatherData {
  location: {
    lat: number;
    lon: number;
    name: string;
    country: string;
    state?: string;
  };
  current: {
    temperature: number;
    humidity: number;
    windSpeed: number;
    condition: string;
    description: string;
    precipitation: number;
    uvIndex: number;
    feelsLike: number;
    pressure: number;
    visibility: number;
    icon: string;
  };
  forecast: Array<{
    date: string;
    temp_max: number;
    temp_min: number;
    condition: string;
    description: string;
    precipitation: number;
    humidity: number;
    windSpeed: number;
    icon: string;
  }>;
}

interface WeatherWidgetProps {
  bbox?: [number, number, number, number];
  date?: string;
  searchLocation?: { lat: number; lon: number; name?: string };
}

const getWeatherIcon = (condition: string, icon: string) => {
  const iconMap: { [key: string]: React.ReactNode } = {
    'Clear': <Sun className="h-6 w-6 text-yellow-500" />,
    'Clouds': <Cloud className="h-6 w-6 text-gray-500" />,
    'Rain': <CloudRain className="h-6 w-6 text-blue-500" />,
    'Snow': <CloudRain className="h-6 w-6 text-blue-200" />,
    'Thunderstorm': <CloudRain className="h-6 w-6 text-purple-500" />,
    'Drizzle': <CloudRain className="h-6 w-6 text-blue-400" />,
    'Mist': <Cloud className="h-6 w-6 text-gray-400" />,
    'Fog': <Cloud className="h-6 w-6 text-gray-300" />
  };
  
  return iconMap[condition] || <Sun className="h-6 w-6 text-yellow-500" />;
};

const getConditionColor = (condition: string) => {
  const colorMap: { [key: string]: string } = {
    'Clear': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'Clouds': 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    'Rain': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'Snow': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'Thunderstorm': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    'Drizzle': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'Mist': 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    'Fog': 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
  };
  
  return colorMap[condition] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
};

export default function WeatherWidget({ bbox, date, searchLocation }: WeatherWidgetProps) {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchBbox, setLastFetchBbox] = useState<string | null>(null);

  useEffect(() => {
    // Use searchLocation if provided, otherwise use bbox
    const shouldFetch = searchLocation ? (searchLocation.lat && searchLocation.lon) : (bbox && bbox.length === 4);
    if (!shouldFetch) return;
    
    const fetchKey = searchLocation ? `${searchLocation.lat},${searchLocation.lon}` : bbox?.join(',');
    if (fetchKey === lastFetchBbox) return; // Prevent duplicate requests
    
    setLastFetchBbox(fetchKey);
    setLoading(true);
    setError(null);

    const fetchWeather = async () => {
      try {
        console.log('Fetching weather for:', searchLocation ? `location ${searchLocation.lat},${searchLocation.lon}` : `bbox ${bbox}`);
        const response = await fetch('/api/weather', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox, date, location: searchLocation })
        });

        if (!response.ok) {
          throw new Error(`Weather API error: ${response.status}`);
        }

        const result = await response.json();
        console.log('Weather data received:', result);
        
        if (result.data) {
          setWeatherData(result.data);
        } else {
          throw new Error('No weather data received');
        }
      } catch (err: any) {
        console.error('Weather fetch error:', err);
        setError(err.message || 'Failed to fetch weather data');
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, [bbox, date, searchLocation, lastFetchBbox]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Weather Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2 text-sm text-muted-foreground">Loading weather...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Weather Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!weatherData) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Weather Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">No weather data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { location, current, forecast } = weatherData;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          Weather Data
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {location.name}{location.state ? `, ${location.state}` : ''}{location.country ? `, ${location.country}` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Weather */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            {getWeatherIcon(current.condition, current.icon)}
            <div>
              <div className="text-2xl font-bold">{current.temperature}°F</div>
              <div className="text-sm text-muted-foreground capitalize">{current.description}</div>
            </div>
          </div>
          <Badge className={getConditionColor(current.condition)}>
            {current.condition}
          </Badge>
        </div>

        {/* Weather Details Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
            <Thermometer className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <div className="font-medium">Feels like</div>
              <div className="text-muted-foreground">{current.feelsLike}°F</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
            <Droplets className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <div className="font-medium">Humidity</div>
              <div className="text-muted-foreground">{current.humidity}%</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
            <Wind className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <div className="font-medium">Wind</div>
              <div className="text-muted-foreground">{current.windSpeed} mph</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <div className="font-medium">Visibility</div>
              <div className="text-muted-foreground">{current.visibility} mi</div>
            </div>
          </div>
        </div>

        {/* 7-Day Forecast Carousel */}
        <div>
          <h4 className="text-sm font-medium mb-3">7-Day Forecast</h4>
          <Carousel className="w-full">
            <CarouselContent className="-ml-2 md:-ml-4">
              {forecast.map((day, index) => (
                <CarouselItem key={day.date} className="pl-2 md:pl-4 basis-1/3 md:basis-1/4">
                  <div className="p-3 rounded-lg border bg-card text-center">
                    <div className="text-xs text-muted-foreground mb-1">
                      {index === 0 ? 'Today' : new Date(day.date).toLocaleDateString('en', { weekday: 'short' })}
                    </div>
                    <div className="mb-2">
                      {getWeatherIcon(day.condition, day.icon)}
                    </div>
                    <div className="text-sm font-medium">{day.temp_max}°F</div>
                    <div className="text-xs text-muted-foreground">{day.temp_min}°F</div>
                    <div className="text-xs mt-1">
                      {day.precipitation > 0 && (
                        <span className="text-blue-500">{day.precipitation}mm</span>
                      )}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </div>
      </CardContent>
    </Card>
  );
}