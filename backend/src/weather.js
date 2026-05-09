'use strict';
const fetch = require('node-fetch');

// Cache: { key: { data, timestamp } }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// WMO weather codes considered adverse
const ADVERSE_CODES = new Set([
  51,53,55,61,63,65,71,73,75,77,
  80,81,82,85,86,95,96,99
]);

async function fetchWeather(lat, lng) {
  const key = `${Math.round(lat * 4) / 4}_${Math.round(lng * 4) / 4}`; // ~25km bucket
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=weather_code,wind_speed_10m,wave_height` +
      `&hourly=weather_code,wind_speed_10m` +
      `&forecast_days=1`;
    const res = await fetch(url, { timeout: 5000 });
    const json = await res.json();
    const cur = json.current || {};
    const data = {
      weatherCode: cur.weather_code ?? 0,
      windSpeed: cur.wind_speed_10m ?? 0,   // km/h
      waveHeight: cur.wave_height ?? 0,
      isAdverse: ADVERSE_CODES.has(cur.weather_code) || (cur.wind_speed_10m ?? 0) > 45,
      description: weatherDescription(cur.weather_code ?? 0, cur.wind_speed_10m ?? 0),
    };
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  } catch {
    // Network error – return benign default
    return { weatherCode: 0, windSpeed: 0, waveHeight: 0, isAdverse: false, description: 'Clear' };
  }
}

function weatherDescription(code, wind) {
  if (code === 0) return wind > 45 ? 'Strong winds' : 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow / Sleet';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

// Pre-fetch weather for all ship positions (called once at boot and every 5 min)
async function prefetchFleet(ships) {
  await Promise.allSettled(ships.map(s => fetchWeather(s.lat, s.lng)));
}

module.exports = { fetchWeather, prefetchFleet };
