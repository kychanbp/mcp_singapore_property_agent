import { MRTStation } from '../types/index.js';

export interface StationGroup {
  baseName: string;
  stations: (MRTStation & { distance: number })[];
  bestRepresentative: MRTStation & { distance: number };
}

/**
 * Extracts the base station name from a full station name
 * Examples:
 * "KENT RIDGE MRT STATION EXIT A" -> "KENT RIDGE"
 * "BUONA VISTA MRT STATION (CC22)" -> "BUONA VISTA" 
 * "ONE-NORTH MRT STATION" -> "ONE-NORTH"
 */
export function extractBaseName(stationName: string): string {
  return stationName
    .replace(/\s+MRT\s+STATION.*$/i, '')
    .replace(/\s+EXIT\s+[A-Z]$/i, '')
    .replace(/\s+\([A-Z]{2}\d+\)$/i, '')
    .trim();
}

/**
 * Determines the priority of a station for deduplication
 * Lower number = higher priority
 */
export function getStationPriority(stationName: string): number {
  const upperName = stationName.toUpperCase();
  
  // Main station (no suffix) - highest priority
  if (/^[A-Z\s-]+MRT\s+STATION$/.test(upperName)) {
    return 1;
  }
  
  // Station with line code (CC22, EW21, etc.) - second priority
  if (/\([A-Z]{2}\d+\)$/.test(upperName)) {
    return 2;
  }
  
  // EXIT A - third priority (usually main entrance)
  if (/EXIT\s+A$/.test(upperName)) {
    return 3;
  }
  
  // Other exits - lower priority
  if (/EXIT\s+[B-Z]$/.test(upperName)) {
    return 4;
  }
  
  // Any other format - lowest priority
  return 5;
}

/**
 * Groups stations by base name and selects the best representative for each group
 */
export function deduplicateStations(
  stations: (MRTStation & { distance: number })[]
): (MRTStation & { distance: number })[] {
  // Group stations by base name
  const groups = new Map<string, StationGroup>();
  
  for (const station of stations) {
    const baseName = extractBaseName(station.name);
    
    if (!groups.has(baseName)) {
      groups.set(baseName, {
        baseName,
        stations: [station],
        bestRepresentative: station
      });
    } else {
      const group = groups.get(baseName)!;
      group.stations.push(station);
      
      // Update best representative if this station has higher priority
      const currentPriority = getStationPriority(group.bestRepresentative.name);
      const newPriority = getStationPriority(station.name);
      
      if (newPriority < currentPriority) {
        group.bestRepresentative = station;
      } else if (newPriority === currentPriority) {
        // If same priority, prefer closer station
        if (station.distance < group.bestRepresentative.distance) {
          group.bestRepresentative = station;
        }
      }
    }
  }
  
  // Return the best representative from each group, sorted by distance
  return Array.from(groups.values())
    .map(group => group.bestRepresentative)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * For debugging: shows which stations were grouped together
 */
export function debugDeduplication(
  stations: (MRTStation & { distance: number })[]
): void {
  const groups = new Map<string, (MRTStation & { distance: number })[]>();
  
  for (const station of stations) {
    const baseName = extractBaseName(station.name);
    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName)!.push(station);
  }
  
  // Only show groups with multiple stations
  const duplicateGroups = Array.from(groups.entries())
    .filter(([_, stationList]) => stationList.length > 1);
  
  if (duplicateGroups.length > 0) {
    console.error(`Found ${duplicateGroups.length} groups with duplicates:`);
    for (const [baseName, stationList] of duplicateGroups) {
      console.error(`  ${baseName}:`);
      for (const station of stationList) {
        const priority = getStationPriority(station.name);
        console.error(`    - ${station.name} (priority: ${priority}, distance: ${station.distance.toFixed(1)}km)`);
      }
    }
  }
}