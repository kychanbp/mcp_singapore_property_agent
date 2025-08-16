import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import NodeCache from 'node-cache';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsedPlanningZone {
  id: string;
  landUse: string;
  landUseText: string;
  grossPlotRatio: string;
  maxHeight: string;
  minGrossPlotRatio: string;
  incrementalCrc: string;
  lastUpdated: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

interface LandUseMix {
  [landUse: string]: {
    count: number;
    percentage: number;
  };
}

interface PlanningZoneAnalysis {
  propertyZone: ParsedPlanningZone | null;
  nearbyZones: ParsedPlanningZone[];
  landUseMix: LandUseMix;
  totalZones: number;
  radius: number;
}

export class PlanningZoneClient {
  private zones: ParsedPlanningZone[] = [];
  private cache: NodeCache;
  private dataPath: string;
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor() {
    // Cache results for 1 hour (planning zones don't change frequently)
    this.cache = new NodeCache({ stdTTL: 3600 });
    this.dataPath = path.join(__dirname, '../../data/planning-zones/MasterPlan2019LandUselayer.geojson');
  }

  /**
   * Load and parse the GeoJSON data
   */
  private async loadData(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this._loadDataInternal();
    return this.loadingPromise;
  }

  private async _loadDataInternal(): Promise<void> {
    try {
      console.error('Loading Singapore planning zones data...');
      
      if (!fs.existsSync(this.dataPath)) {
        throw new Error(`Planning zones data file not found: ${this.dataPath}`);
      }

      const rawData = fs.readFileSync(this.dataPath, 'utf8');
      const geojson = JSON.parse(rawData) as GeoJSON.FeatureCollection;

      console.error(`Parsing ${geojson.features.length} planning zones...`);

      this.zones = geojson.features.map((feature, index) => {
        const properties = this.parseHtmlProperties(feature.properties?.Description || '');
        const geometry = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        
        return {
          id: `zone_${index}`,
          landUse: properties.LU_DESC || 'UNKNOWN',
          landUseText: properties.LU_TEXT || '',
          grossPlotRatio: properties.GPR || '',
          maxHeight: properties.WHI_Q_MX || '',
          minGrossPlotRatio: properties.GPR_B_MN || '',
          incrementalCrc: properties.INC_CRC || '',
          lastUpdated: properties.FMEL_UPD_D || '',
          geometry,
          bbox: turf.bbox(geometry) as [number, number, number, number]
        };
      });

      this.isLoaded = true;
      console.error(`Successfully loaded ${this.zones.length} planning zones`);
      
      // Log zone statistics
      const landUseStats = this.zones.reduce((acc, zone) => {
        acc[zone.landUse] = (acc[zone.landUse] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.error('Land use distribution:', landUseStats);
      
    } catch (error) {
      console.error('Failed to load planning zones data:', error);
      throw error;
    }
  }

  /**
   * Parse HTML table from feature description to extract properties
   */
  private parseHtmlProperties(description: string): Record<string, string> {
    const properties: Record<string, string> = {};
    
    // Extract table rows using regex
    const rowRegex = /<tr[^>]*>.*?<th[^>]*>([^<]+)<\/th>.*?<td[^>]*>([^<]*)<\/td>.*?<\/tr>/gs;
    let match;
    
    while ((match = rowRegex.exec(description)) !== null) {
      const key = match[1].trim();
      const value = match[2].trim();
      properties[key] = value;
    }
    
    return properties;
  }

  /**
   * Find which planning zone contains the given coordinates
   */
  async findPlanningZone(latitude: number, longitude: number): Promise<ParsedPlanningZone | null> {
    await this.loadData();
    
    const cacheKey = `zone_${latitude}_${longitude}`;
    const cached = this.cache.get<ParsedPlanningZone | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const point = turf.point([longitude, latitude]);
    
    // Find the zone that contains this point
    for (const zone of this.zones) {
      try {
        if (booleanPointInPolygon(point, zone.geometry)) {
          this.cache.set(cacheKey, zone);
          return zone;
        }
      } catch (error) {
        // Skip invalid geometries
        console.error(`Error checking point in zone ${zone.id}:`, error);
      }
    }
    
    this.cache.set(cacheKey, null);
    return null;
  }

  /**
   * Find all planning zones within a specified radius of the given coordinates
   */
  async findNearbyZones(
    latitude: number, 
    longitude: number, 
    radiusMeters: number
  ): Promise<ParsedPlanningZone[]> {
    await this.loadData();
    
    const cacheKey = `nearby_${latitude}_${longitude}_${radiusMeters}`;
    const cached = this.cache.get<ParsedPlanningZone[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const center = turf.point([longitude, latitude]);
    const buffered = turf.buffer(center, radiusMeters / 1000, { units: 'kilometers' });
    if (!buffered) {
      this.cache.set(cacheKey, []);
      return [];
    }
    const bufferBbox = turf.bbox(buffered) as [number, number, number, number];
    
    const nearbyZones: ParsedPlanningZone[] = [];
    
    for (const zone of this.zones) {
      // Quick bounding box check first
      if (this.bboxIntersects(zone.bbox, bufferBbox)) {
        try {
          // Simple check - if point is inside polygon or polygon overlaps with bounding box, include it
          const zoneFeature = turf.feature(zone.geometry);
          
          // Check if point is inside the zone
          const isInside = booleanPointInPolygon(center, zoneFeature);
          if (isInside) {
            nearbyZones.push(zone);
          } else {
            // For nearby zones, use a simple centroid distance check
            const zoneCentroid = turf.centroid(zoneFeature);
            const distance = turf.distance(center, zoneCentroid, { units: 'meters' });
            if (distance <= radiusMeters) {
              nearbyZones.push(zone);
            }
          }
        } catch (error) {
          // Skip zones with geometry issues
          console.error(`Error checking zone ${zone.id}:`, error);
        }
      }
    }
    
    this.cache.set(cacheKey, nearbyZones);
    return nearbyZones;
  }

  /**
   * Analyze land use mix for given zones
   */
  analyzeLandUseMix(zones: ParsedPlanningZone[]): LandUseMix {
    const totalZones = zones.length;
    const landUseCount: Record<string, number> = {};
    
    zones.forEach(zone => {
      landUseCount[zone.landUse] = (landUseCount[zone.landUse] || 0) + 1;
    });
    
    const landUseMix: LandUseMix = {};
    Object.entries(landUseCount).forEach(([landUse, count]) => {
      landUseMix[landUse] = {
        count,
        percentage: totalZones > 0 ? Math.round((count / totalZones) * 100) : 0
      };
    });
    
    return landUseMix;
  }

  /**
   * Get comprehensive planning zone analysis for a location
   */
  async getPlanningZoneAnalysis(
    latitude: number,
    longitude: number,
    radiusMeters: number = 1000
  ): Promise<PlanningZoneAnalysis> {
    await this.loadData();
    
    const [propertyZone, nearbyZones] = await Promise.all([
      this.findPlanningZone(latitude, longitude),
      this.findNearbyZones(latitude, longitude, radiusMeters)
    ]);
    
    const landUseMix = this.analyzeLandUseMix(nearbyZones);
    
    return {
      propertyZone,
      nearbyZones,
      landUseMix,
      totalZones: nearbyZones.length,
      radius: radiusMeters
    };
  }

  /**
   * Check if two bounding boxes intersect
   */
  private bboxIntersects(bbox1: [number, number, number, number], bbox2: [number, number, number, number]): boolean {
    return !(bbox1[2] < bbox2[0] || bbox1[0] > bbox2[2] || bbox1[3] < bbox2[1] || bbox1[1] > bbox2[3]);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { keys: number; hits: number; misses: number } {
    const stats = this.cache.getStats();
    return {
      keys: this.cache.keys().length,
      hits: stats.hits,
      misses: stats.misses
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.flushAll();
    console.error('Cleared planning zone cache');
  }

  /**
   * Get total number of loaded zones
   */
  async getZoneCount(): Promise<number> {
    await this.loadData();
    return this.zones.length;
  }

  /**
   * Get unique land use types
   */
  async getLandUseTypes(): Promise<string[]> {
    await this.loadData();
    const landUses = new Set(this.zones.map(zone => zone.landUse));
    return Array.from(landUses).sort();
  }
}