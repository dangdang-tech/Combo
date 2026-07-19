import type { ResolvedTheme } from '../../theme/ThemeProvider.js';

/** Canvas charts cannot resolve CSS variables, so both product themes live here as concrete palettes. */
export interface ChartPalette {
  seriesPrimary: string;
  seriesFill: string;
  seriesFillBottom: string;
  muted: string;
  fg: string;
  border: string;
  skeleton: string;
  peak: string;
  peakLabel: string;
  calendarGap: string;
  heatmapLevels: readonly [string, string, string, string, string];
  densityBarTop: string;
  densityBarRest: string;
  trendColors: Record<'up' | 'down' | 'flat', string>;
}

export const LIGHT_CHART_PALETTE: ChartPalette = {
  seriesPrimary: '#3d3d3a',
  seriesFill: 'rgba(61, 61, 58, 0.16)',
  seriesFillBottom: 'rgba(61, 61, 58, 0.015)',
  muted: '#6c6a64',
  fg: '#141413',
  border: '#e6dfd8',
  skeleton: '#efe9de',
  peak: '#141413',
  peakLabel: '#fff',
  calendarGap: '#faf9f5',
  heatmapLevels: ['#efe9de', '#d8d0c3', '#b4aa9c', '#726b62', '#141413'],
  densityBarTop: '#141413',
  densityBarRest: '#b4aa9c',
  // Direction is data, not a success/error state: distinguish with shape and copy, not traffic-light color.
  trendColors: { up: '#3d3d3a', down: '#3d3d3a', flat: '#6c6a64' },
};

export const DARK_CHART_PALETTE: ChartPalette = {
  seriesPrimary: '#d8d4cc',
  seriesFill: 'rgba(216, 212, 204, 0.18)',
  seriesFillBottom: 'rgba(216, 212, 204, 0.015)',
  muted: '#a09d96',
  fg: '#faf9f5',
  border: '#383734',
  skeleton: '#2d2b27',
  peak: '#faf9f5',
  peakLabel: '#141413',
  calendarGap: '#141413',
  heatmapLevels: ['#252320', '#3a3835', '#5f5a52', '#a29b91', '#faf9f5'],
  densityBarTop: '#faf9f5',
  densityBarRest: '#5f5a52',
  trendColors: { up: '#d8d4cc', down: '#d8d4cc', flat: '#a09d96' },
};

export function getChartPalette(theme: ResolvedTheme): ChartPalette {
  return theme === 'dark' ? DARK_CHART_PALETTE : LIGHT_CHART_PALETTE;
}

/* Light aliases preserve the public builder API and existing focused tests. */
export const CHART_SERIES_PRIMARY = LIGHT_CHART_PALETTE.seriesPrimary;
export const CHART_SERIES_FILL = LIGHT_CHART_PALETTE.seriesFill;
export const CHART_SERIES_FILL_BOTTOM = LIGHT_CHART_PALETTE.seriesFillBottom;
export const CHART_MUTED = LIGHT_CHART_PALETTE.muted;
export const CHART_FG = LIGHT_CHART_PALETTE.fg;
export const CHART_BORDER = LIGHT_CHART_PALETTE.border;
export const CHART_SKELETON = LIGHT_CHART_PALETTE.skeleton;
export const CHART_PEAK = LIGHT_CHART_PALETTE.peak;
export const HEATMAP_LEVELS = LIGHT_CHART_PALETTE.heatmapLevels;
export const DENSITY_BAR_TOP = LIGHT_CHART_PALETTE.densityBarTop;
export const DENSITY_BAR_REST = LIGHT_CHART_PALETTE.densityBarRest;
export const TREND_COLORS = LIGHT_CHART_PALETTE.trendColors;
