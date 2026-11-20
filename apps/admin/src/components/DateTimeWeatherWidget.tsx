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
// Icônes et labels spécifiques à la nuit (ciel dégagé ou peu nuageux)
const WMO_ICONS_NIGHT: Record<number, string> = { 0: '🌙', 1: '🌙', 2: '☁️' };
const WMO_LABELS_NIGHT: Record<number, string> = { 0: 'Nuit claire', 1: 'Nuit peu nuageuse', 2: 'Nuageux' };

function getIcon(code: number, isDay = true) {
  if (!isDay && code in WMO_ICONS_NIGHT) return WMO_ICONS_NIGHT[code];
  return WMO_ICONS[code] ?? (code >= 95 ? '⛈️' : code >= 80 ? '🌦️' : code >= 71 ? '❄️' : code >= 51 ? '🌧️' : code >= 45 ? '🌫️' : '🌡️');
}
function getLabel(code: number, isDay = true) {
  if (!isDay && code in WMO_LABELS_NIGHT) return WMO_LABELS_NIGHT[code];
  return WMO_LABELS[code] ?? 'Météo';
}

const API_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=48.8391&longitude=2.4802' +
  '&current=temperature_2m,weather_code,wind_speed_10m,is_day' +
  '&timezone=Europe%2FParis';

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS  = ['jan.', 'fév.', 'mar.', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sep.', 'oct.', 'nov.', 'déc.'];

interface WeatherData { temp: number; code: number; wind: number; isDay: boolean; }

// ── Cache global persistant entre remontages du composant ──
// Empêche la perte de données météo lors des router.refresh() de AutoRefresh
let _weatherCache: { data: WeatherData; fetchedAt: number } | null = null;
const CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

export default function DateTimeWeatherWidget({ theme = 'light' }: { theme?: 'light' | 'dark' }) {
  const [time, setTime]       = useState('');
  const [dateStr, setDateStr] = useState('');
  const [weather, setWeather] = useState<WeatherData | null>(_weatherCache?.data ?? null);
  const [wError, setWError]   = useState(false);
  const isFetchingRef         = useRef(false);
  const retryCountRef         = useRef(0);

  // Horloge — mise à jour chaque seconde
  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      setTime(`${h}:${m}:${s}`);
      setDateStr(`${JOURS[now.getDay()]} ${now.getDate()} ${MOIS[now.getMonth()]} ${now.getFullYear()}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Météo — mise à jour toutes les 10 min avec cache global + retry
  const fetchWeather = useCallback(() => {
    // Ne pas relancer si un fetch est déjà en cours
    if (isFetchingRef.current) return () => {};

    // Si le cache est encore frais, l'utiliser directement
    if (_weatherCache && (Date.now() - _weatherCache.fetchedAt) < CACHE_MAX_AGE) {
      setWeather(_weatherCache.data);
      setWError(false);
      return () => {};
    }

    isFetchingRef.current = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    fetch(API_URL, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: any) => {
        clearTimeout(timer);
        isFetchingRef.current = false;
        retryCountRef.current = 0;
        const c = d?.current ?? d?.current_weather;
        if (!c) throw new Error('No current data');
        const wd: WeatherData = {
          temp:  Math.round(c.temperature_2m ?? c.temperature ?? 0),
          code:  c.weather_code ?? c.weathercode ?? 0,
          wind:  Math.round(c.wind_speed_10m ?? c.windspeed ?? 0),
          isDay: (c.is_day ?? 1) === 1,
        };
        // Mettre en cache global
        _weatherCache = { data: wd, fetchedAt: Date.now() };
        setWeather(wd);
        setWError(false);
      })
      .catch(() => {
        clearTimeout(timer);
        isFetchingRef.current = false;
        // Si on a un cache ancien, l'utiliser plutôt qu'afficher une erreur
        if (_weatherCache) {
          setWeather(_weatherCache.data);
          setWError(false);
        } else {
          setWError(true);
        }
        // Retry automatique (max 3 fois, espacement croissant)
        if (retryCountRef.current < 3) {
          retryCountRef.current++;
          setTimeout(() => fetchWeather(), retryCountRef.current * 5000);
        }
      });
    return () => { clearTimeout(timer); ctrl.abort(); isFetchingRef.current = false; };
  }, []);

  useEffect(() => {
    const cleanup = fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => { cleanup?.(); clearInterval(id); };
  }, [fetchWeather]);

  const isDark = theme === 'dark';
  const textPrimary   = isDark ? 'text-white'      : 'text-gray-800';
  const textSecondary = isDark ? 'text-white/60'   : 'text-gray-400';
  const divider       = isDark ? 'border-white/15' : 'border-gray-200';
  const bg            = isDark ? 'bg-white/10'     : 'bg-gray-50';

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-xl ${bg} border ${divider}`}>
      {/* Date + Heure */}
      <div className="flex flex-col items-end leading-tight">
        <span className={`text-[11px] font-medium ${textSecondary}`}>{dateStr}</span>
        <span className={`text-base font-bold tracking-tight font-mono ${textPrimary}`}>{time}</span>
      </div>

      {/* Séparateur */}
      <div className={`w-px h-8 ${isDark ? 'bg-white/15' : 'bg-gray-200'}`} />

      {/* Météo */}
      {wError ? (
        <button onClick={fetchWeather} className={`text-xs ${textSecondary} hover:opacity-80`} title="Réessayer">
          🌡️ —
        </button>
      ) : weather ? (
        <div className="flex items-center gap-1.5" title={`Nogent-sur-Marne — ${getLabel(weather.code, weather.isDay)} · Vent ${weather.wind} km/h`}>
          <span className="text-xl leading-none">{getIcon(weather.code, weather.isDay)}</span>
          <div className="flex flex-col leading-tight">
            <span className={`text-sm font-bold ${textPrimary}`}>{weather.temp}°C</span>
            <span className={`text-[10px] font-medium ${textSecondary}`}>{getLabel(weather.code, weather.isDay)}</span>
          </div>
        </div>
      ) : (
        <div className={`flex items-center gap-1 text-xs ${textSecondary} animate-pulse`}>
          <span>🌡️</span><span>Nogent…</span>
        </div>
      )}
    </div>
  );
}
