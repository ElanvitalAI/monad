// ── PFC-S5 P6: intelligence-map ToolRuntime wrappers ──

import {
  buildIntelligenceMapTool,
  dispatchIntelligenceMap,
  type IntelligenceMapResult,
} from '../intelligence-map/tools/intelligence-map.js';
import {
  buildRouteToModelTool,
  dispatchRouteToModel,
  type RouteToModelInput,
} from '../intelligence-map/tools/route-to-model.js';
import type { ModelRecommendation } from '../intelligence-map/recommend-model.js';
import type { ToolRuntime } from './types.js';

export const intelligenceMapRuntime: ToolRuntime<Record<string, unknown>, IntelligenceMapResult> = {
  id: 'intelligence_map',
  spec: buildIntelligenceMapTool(),
  async run() {
    return dispatchIntelligenceMap();
  },
};

export const routeToModelRuntime: ToolRuntime<RouteToModelInput, ModelRecommendation> = {
  id: 'route_to_model',
  spec: buildRouteToModelTool(),
  async run(req) {
    return dispatchRouteToModel(req);
  },
};

export const ALL_INTELLIGENCE_MAP_RUNTIMES = [
  intelligenceMapRuntime,
  routeToModelRuntime,
] as const;
