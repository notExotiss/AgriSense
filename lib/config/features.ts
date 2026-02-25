function envEnabled(name: string, defaultValue: boolean) {
  const value = process.env[name]
  if (value == null) return defaultValue
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

export const FEATURE_FLAGS = {
  ML_ENGINE_V1: envEnabled('FEATURE_ML_ENGINE_V1', true),
  REAL_TIMESERIES: envEnabled('FEATURE_REAL_TIMESERIES', true),
  NEW_UI: envEnabled('FEATURE_NEW_UI', true),
  PLOT_GEOMETRY_V2: envEnabled('FEATURE_PLOT_GEOMETRY_V2', true),
  GRID_3X3: envEnabled('FEATURE_GRID_3X3', true),
  TERRAIN_3D: envEnabled('FEATURE_TERRAIN_3D', true),
  AI_SIMULATOR: envEnabled('FEATURE_AI_SIMULATOR', true),
  DASHBOARD_UNIFIED: envEnabled('FEATURE_DASHBOARD_UNIFIED', true),
}
