import { RouteResult, ComparisonResult, TransportMode } from '../types/index.js';

export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes} minutes`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatRouteResults(results: RouteResult[]): string {
  if (results.length === 0) {
    return 'No MRT stations found within the specified criteria.';
  }

  let output = `Found ${results.length} MRT station(s):\n\n`;
  
  results.forEach((result, index) => {
    const timeStr = formatTime(result.totalTime * 60); // Convert minutes to seconds for formatting
    const distanceStr = formatDistance(result.distance * 1000); // Convert km to meters
    
    output += `${index + 1}. **${result.station.name}**\n`;
    output += `   - Total time: ${result.totalTime} minutes\n`;
    output += `   - Distance: ${distanceStr}\n`;
    output += `   - Transport mode: ${result.mode.toUpperCase()}\n`;
    
    if (result.mode === 'pt' && result.walkTime !== undefined && result.transitTime !== undefined) {
      output += `   - Walk time: ${result.walkTime} minutes\n`;
      output += `   - Transit time: ${result.transitTime} minutes\n`;
      output += `   - Transfers: ${result.transfers || 0}\n`;
    }
    
    output += `   - Address: ${result.station.address}\n`;
    if (result.station.stationCode) {
      output += `   - Station code: ${result.station.stationCode}\n`;
    }
    output += '\n';
  });
  
  return output;
}

export function formatComparisonResult(comparison: ComparisonResult): string {
  let output = `**Transport options to ${comparison.station.name}:**\n\n`;
  
  const modes: (keyof typeof comparison.modes)[] = ['walk', 'cycle', 'drive', 'pt'];
  
  modes.forEach(mode => {
    const result = comparison.modes[mode];
    if (result) {
      const icon = result.withinTimeLimit ? '✅' : '❌';
      output += `${icon} **${mode.toUpperCase()}**: ${result.totalTime} minutes (${formatDistance(result.distance * 1000)})\n`;
      
      if (mode === 'pt' && result.walkTime !== undefined && result.transitTime !== undefined) {
        output += `   - Walk: ${result.walkTime}min, Transit: ${result.transitTime}min, Transfers: ${result.transfers || 0}\n`;
      }
    }
  });
  
  output += `\n**Recommended mode**: ${comparison.recommendation.toUpperCase()}\n`;
  
  return output;
}

export function parseLocation(locationStr: string): { x: number; y: number; latitude: number; longitude: number } | null {
  // Try to parse as coordinates - could be either lat,lng or x,y
  const coordMatch = locationStr.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const first = parseFloat(coordMatch[1]);
    const second = parseFloat(coordMatch[2]);
    
    // Heuristic: If first value < 10 and second value > 100, it's likely lat,lng
    // Singapore lat is around 1.2-1.4, lng is around 103-104
    if (first < 10 && second > 100) {
      // Treat as lat,lng - we'll need to convert or handle differently
      // For now, return null to force using OneMap search
      return null;
    } else {
      // Treat as SVY21 x,y - we'll need to look up the lat/lng
      // For now, return null to force using OneMap search
      return null;
    }
  }
  
  return null;
}

export function getTransportModeDisplay(mode: TransportMode): string {
  const displays = {
    walk: 'Walking',
    cycle: 'Cycling',
    drive: 'Driving',
    pt: 'Public Transport'
  };
  return displays[mode];
}