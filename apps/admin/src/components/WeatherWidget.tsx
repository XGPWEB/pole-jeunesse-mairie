'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

const WMO_ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌦️', 82: '⛈️',
  85: '❄️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const WMO_LABELS: Record<number, string> = {
  0: 'Ensoleillé', 1: 'Peu nuageux', 2: 'Nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine forte',
  61: 'Pluie légère', 63: 'Pluie', 65: 'Forte pluie',
  71: 'Neige légère', 73: 'Neige', 75: 'Forte neige', 77: 'Grésil',
  80: 'Averses', 81: 'Averses mod.', 82: 'Fortes averses',
  85: 'Neige', 86: 'Forte neige',
  95: 'Orage', 96: 'Orage grêle', 99: 'Fort orage',
};

function getIcon(code: number): string {
  if (WMO_ICONS[code] !== undefined) return WMO_ICONS[code];
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

function getLabel(code: number): string {
  return WMO_LABELS[code] ?? 'Météo';
}

type Status = 'loading' | 'ok' | 'error';

interface WeatherData {
  temp: number;
  code: number;
  wind: number;
}

const API_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=48.8391&longitude=2.4802' +
  '&current=temperature_2m,weather_code,wind_speed_10m' +
  '&timezone=Europe%2FParis';

// Cache global persistant entre remontages
let _wCache: { data: WeatherData; at: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export default function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(_wCache?.data ?? null);
  const [status, setStatus] = useState<Status>(_wCache ? 'ok' : 'loading');
  const isFetchingRef = useRef(false);
  const retryRef = useRef(0);

  const fetchWeather = useCallback(() => {
    if (isFetchingRef.current) return () => {};

    // Cache encore frais → utiliser directement
    if (_wCache && (Date.now() - _wCache.at) < CACHE_TTL) {
      setWeather(_wCache.data);
      setStatus('ok');
      return () => {};
    }

    if (!weather) setStatus('loading');
    isFetchingRef.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch(API_URL, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        clearTimeout(timer);
        isFetchingRef.current = false;
        retryRef.current = 0;
        const c = data?.current ?? data?.current_weather;
        if (!c) throw new Error('no current');
        const temp = c.temperature_2m ?? c.temperature;
        const code = c.weather_code ?? c.weathercode;
        const wind = c.wind_speed_10m ?? c.windspeed;
        if (temp === undefined || code === undefined) throw new Error('missing fields');
        const wd = { temp: Math.round(temp), code, wind: Math.round(wind ?? 0) };
        _wCache = { data: wd, at: Date.now() };
        setWeather(wd);
        setStatus('ok');
      })
      .catch(() => {
        clearTimeout(timer);
        isFetchingRef.current = false;
        if (_wCache) {
          setWeather(_wCache.data);
          setStatus('ok');
        } else {
          setStatus('error');
        }
        if (retryRef.current < 3) {
          retryRef.current++;
          setTimeout(() => fetchWeather(), retryRef.current * 5000);
        }
      });

    return () => { clearTimeout(timer); controller.abort(); isFetchingRef.current = false; };
  }, []);

  useEffect(() => {
    const cleanup = fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => { cleanup?.(); clearInterval(interval); };
  }, [fetchWeather]);

  if (status === 'error') {
    return (
      <button
        onClick={fetchWeather}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        title="Cliquer pour réessayer"
      >
        <span>🌡️</span>
        <span>Météo indisponible</span>
      </button>
    );
  }

  if (status === 'loading' || !weather) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 animate-pulse">
        <span>🌡️</span>
        <span>Nogent…</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 text-sm cursor-default"
      title={`Nogent-sur-Marne — ${getLabel(weather.code)} · Vent ${weather.wind} km/h`}
    >
      <span className="text-base leading-none">{getIcon(weather.code)}</span>
      <div className="flex flex-col leading-tight">
        <span className="font-bold text-gray-700">{weather.temp}°C</span>
        <span className="text-[10px] text-gray-400 font-medium">{getLabel(weather.code)}</span>
      </div>
      <span className="text-[10px] text-gray-300 font-medium hidden sm:block border-l border-gray-200 pl-2">
        Nogent-sur-Marne
      </span>
    </div>
  );
}
