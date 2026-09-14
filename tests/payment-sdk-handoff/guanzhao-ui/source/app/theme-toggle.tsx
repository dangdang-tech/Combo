'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

type ColorMode = 'light' | 'dark';
declare global {
  interface Window {
    guanzhaoTheme?: { setMode: (mode: ColorMode) => void };
  }
}

function subscribe(notify: () => void) {
  window.addEventListener('guanzhao-theme-change', notify);
  return () => window.removeEventListener('guanzhao-theme-change', notify);
}
function currentMode(): ColorMode {
  return document.documentElement.dataset.guanzhaoTheme === 'dark' ? 'dark' : 'light';
}
function setMode(mode: ColorMode) {
  if (window.guanzhaoTheme) return window.guanzhaoTheme.setMode(mode);
  // The switch remains usable if the early bootstrap asset could not load.
  document.documentElement.dataset.guanzhaoTheme = mode;
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.style.colorScheme = mode;
  try {
    window.localStorage.setItem('guanzhao:color-mode', mode);
  } catch {
    // Appearance is still applied for this page when storage is unavailable.
  }
  window.dispatchEvent(new Event('guanzhao-theme-change'));
}

export default function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, currentMode, () => 'light');
  const next = mode === 'dark' ? 'light' : 'dark';
  const label = `切换为${next === 'dark' ? '深' : '浅'}色模式`;
  return (
    <button
      className="guanzhao-theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setMode(next)}
    >
      {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      <span>{mode === 'dark' ? '浅色' : '深色'}</span>
    </button>
  );
}
