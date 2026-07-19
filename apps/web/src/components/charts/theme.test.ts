import { describe, expect, it } from 'vitest';
import { DARK_CHART_PALETTE, LIGHT_CHART_PALETTE, getChartPalette } from './theme.js';

describe('chart theme palettes', () => {
  it('keeps data neutral while adapting canvas contrast to each product theme', () => {
    expect(getChartPalette('light')).toBe(LIGHT_CHART_PALETTE);
    expect(getChartPalette('dark')).toBe(DARK_CHART_PALETTE);
    expect(DARK_CHART_PALETTE.seriesPrimary).not.toBe(LIGHT_CHART_PALETTE.seriesPrimary);
    expect(DARK_CHART_PALETTE.trendColors.up).toBe(DARK_CHART_PALETTE.trendColors.down);
    expect(LIGHT_CHART_PALETTE.trendColors.up).toBe(LIGHT_CHART_PALETTE.trendColors.down);
  });
});
