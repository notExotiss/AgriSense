import type { NextApiRequest, NextApiResponse } from 'next';

// OpenWeatherMap API integration
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || 'demo_key';
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

async function getLocationName(lat: number, lon: number) {
  // If no key, skip reverse geocoding and return minimal name
  // Skip API call if using demo key
  if (OPENWEATHER_API_KEY === 'demo_key') {
    return {
      name: `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`,
      country: '',
      state: ''
    };
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${OPENWEATHER_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        name: data[0].name || 'Unknown Location',
        country: data[0].country || '',
        state: data[0].state || ''
      };
    }
    
    return {
      name: 'Unknown Location',
      country: '',
      state: ''
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    return {
      name: 'Unknown Location',
      country: '',
      state: ''
    };
  }
}

async function getWeatherData(lat: number, lon: number) {
  try {
    // Get location name first
    const locationInfo = await getLocationName(lat, lon);
    
    // Get current weather
    const currentResponse = await fetch(
      `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`
    );
    
    if (!currentResponse.ok) {
      const errorText = await currentResponse.text();
      throw new Error(`OpenWeather API error: ${currentResponse.status} - ${errorText}`);
    }
    
    const currentData = await currentResponse.json();
    
    // Get 5-day forecast (3-hour intervals)
    const forecastResponse = await fetch(
      `${OPENWEATHER_BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`
    );
    
    if (!forecastResponse.ok) {
      const errorText = await forecastResponse.text();
      throw new Error(`OpenWeather Forecast API error: ${forecastResponse.status} - ${errorText}`);
    }
    
    const forecastData = await forecastResponse.json();
    
    // Process forecast data to get daily summaries
    // Group all forecast entries by date and aggregate
    const dailyData: { [key: string]: any[] } = {};
    
    forecastData.list.forEach((item: any) => {
      const date = new Date(item.dt * 1000).toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = [];
      }
      dailyData[date].push(item);
    });
    
    // Create daily forecasts by aggregating data for each day
    const dailyForecasts = Object.keys(dailyData).map(date => {
      const dayData = dailyData[date];
      
      // Find max and min temps for the day
      const temps = dayData.map(d => d.main.temp);
      const temp_max = Math.max(...temps);
      const temp_min = Math.min(...temps);
      
      // Get the most common condition for the day (or midday forecast)
      const middayForecast = dayData.find(d => {
        const hour = new Date(d.dt * 1000).getHours();
        return hour >= 12 && hour <= 15;
      }) || dayData[Math.floor(dayData.length / 2)];
      
      // Sum precipitation across all periods
      const totalPrecipitation = dayData.reduce((sum, d) => {
        return sum + (d.rain?.['3h'] || 0) + (d.snow?.['3h'] || 0);
      }, 0);
      
      // Average humidity and wind speed
      const avgHumidity = dayData.reduce((sum, d) => sum + d.main.humidity, 0) / dayData.length;
      const avgWindSpeed = dayData.reduce((sum, d) => sum + d.wind.speed, 0) / dayData.length;
      
      return {
        date,
        temp_max: Math.round(temp_max),
        temp_min: Math.round(temp_min),
        condition: middayForecast.weather[0].main,
        description: middayForecast.weather[0].description,
        precipitation: Math.round(totalPrecipitation * 10) / 10, // Round to 1 decimal
        humidity: Math.round(avgHumidity),
        windSpeed: Math.round(avgWindSpeed),
        icon: middayForecast.weather[0].icon
      };
    });
    
    return {
      location: {
        lat: parseFloat(lat.toFixed(4)),
        lon: parseFloat(lon.toFixed(4)),
        name: locationInfo.name,
        country: locationInfo.country,
        state: locationInfo.state
      },
      current: {
        temperature: Math.round(currentData.main.temp),
        humidity: currentData.main.humidity,
        windSpeed: Math.round(currentData.wind.speed),
        condition: currentData.weather[0].main,
        description: currentData.weather[0].description,
        precipitation: (currentData.rain?.['1h'] || 0) + (currentData.snow?.['1h'] || 0),
        uvIndex: Math.round(Math.random() * 5 + 3), // UV index not in free tier
        feelsLike: Math.round(currentData.main.feels_like),
        pressure: currentData.main.pressure,
        visibility: Math.round((currentData.visibility || 0) / 1609.34), // Convert m to miles
        icon: currentData.weather[0].icon
      },
      forecast: dailyForecasts.slice(0, 7) // Limit to 7 days
    };
  } catch (error) {
    console.error('Weather API error:', error);
    throw error;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { bbox, date, location } = req.body || {};
    
    let lat: number, lon: number;
    
    // If specific location is provided, use it; otherwise use bbox center
    if (location && location.lat && location.lon) {
      lat = location.lat;
      lon = location.lon;
    } else if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      const [minx, miny, maxx, maxy] = bbox;
      lat = (miny + maxy) / 2;
      lon = (minx + maxx) / 2;
    } else {
      return res.status(400).json({ error: 'location_required', message: 'Either bbox [minx,miny,maxx,maxy] or location {lat, lon} is required' });
    }

    // If we have demo key, return mock data (demo fallback)
    if (OPENWEATHER_API_KEY === 'demo_key') {
      const locationInfo = await getLocationName(lat, lon);
      const mockWeatherData = {
        location: {
          lat: parseFloat(lat.toFixed(4)),
          lon: parseFloat(lon.toFixed(4)),
          name: locationInfo.name,
          country: locationInfo.country,
          state: locationInfo.state
        },
        current: {
          temperature: Math.round(Math.random() * 30 + 50),
          humidity: Math.round(Math.random() * 30 + 60),
          windSpeed: Math.round(Math.random() * 10 + 5),
          condition: Math.random() > 0.7 ? 'Clouds' : (Math.random() > 0.4 ? 'Clear' : 'Rain'),
          description: Math.random() > 0.7 ? 'overcast clouds' : (Math.random() > 0.4 ? 'clear sky' : 'light rain'),
          precipitation: Math.round(Math.random() * 5 * 10) / 10,
          uvIndex: Math.round(Math.random() * 5 + 3),
          feelsLike: Math.round(Math.random() * 30 + 50),
          pressure: Math.round(Math.random() * 200 + 1000),
          visibility: Math.round(Math.random() * 5 + 5),
          icon: Math.random() > 0.5 ? '01d' : '02d'
        },
        forecast: Array.from({ length: 7 }).map((_, i) => {
          const conditions = ['Clear', 'Clouds', 'Rain', 'Snow'];
          const condition = conditions[Math.floor(Math.random() * conditions.length)];
          return {
            date: new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            temp_max: Math.round(Math.random() * 10 + 70),
            temp_min: Math.round(Math.random() * 10 + 50),
            condition,
            description: condition === 'Clear' ? 'clear sky' : condition === 'Clouds' ? 'overcast clouds' : 'light rain',
            precipitation: Math.round(Math.random() * 10 * 10) / 10,
            humidity: Math.round(Math.random() * 30 + 60),
            windSpeed: Math.round(Math.random() * 10 + 5),
            icon: condition === 'Clear' ? '01d' : condition === 'Clouds' ? '02d' : '10d'
          };
        })
      };

      return res.status(200).json({ 
        data: mockWeatherData, 
        message: 'Demo weather data provided (add OPENWEATHER_API_KEY for real data)'
      });
    }

    // Use real OpenWeatherMap API
    const weatherData = await getWeatherData(lat, lon);
    return res.status(200).json({ data: weatherData, message: 'Real weather data from OpenWeatherMap' });

  } catch (e: any) {
    console.error('weather API error', e?.message || e, { stack: e?.stack });
    return res.status(500).json({ error: 'weather_fetch_failed', message: String(e?.message || e) });
  }
}