export interface Coordinates {
  x: number; // SVY21 X coordinate
  y: number; // SVY21 Y coordinate
}

// Legacy interface for backward compatibility
export interface LatLngCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Calculate the straight-line distance between two points using SVY21 coordinates
 * Returns distance in kilometers
 */
export function calculateDistance(point1: Coordinates, point2: Coordinates): number {
  const deltaX = point2.x - point1.x;
  const deltaY = point2.y - point1.y;
  const distanceInMeters = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  return distanceInMeters / 1000; // Convert to kilometers
}

/**
 * Calculate distance in meters (useful for precise calculations)
 */
export function calculateDistanceMeters(point1: Coordinates, point2: Coordinates): number {
  const deltaX = point2.x - point1.x;
  const deltaY = point2.y - point1.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

/**
 * Filter locations within a certain radius (using SVY21 coordinates)
 */
export function filterByDistance<T extends Coordinates>(
  origin: Coordinates,
  locations: T[],
  maxDistanceKm: number
): T[] {
  return locations.filter(location => 
    calculateDistance(origin, location) <= maxDistanceKm
  );
}

/**
 * Filter locations within a certain radius in meters (more precise)
 */
export function filterByDistanceMeters<T extends Coordinates>(
  origin: Coordinates,
  locations: T[],
  maxDistanceMeters: number
): T[] {
  return locations.filter(location => 
    calculateDistanceMeters(origin, location) <= maxDistanceMeters
  );
}

/**
 * Sort locations by distance from origin (using SVY21 coordinates)
 */
export function sortByDistance<T extends Coordinates>(
  origin: Coordinates,
  locations: T[]
): Array<T & { distance: number }> {
  return locations
    .map(location => ({
      ...location,
      distance: calculateDistance(origin, location)
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Create a rectangular search area around a point (for database queries)
 * Returns SVY21 coordinate bounds for efficient spatial queries
 */
export function createSearchBounds(
  center: Coordinates, 
  radiusMeters: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: center.x - radiusMeters,
    maxX: center.x + radiusMeters,
    minY: center.y - radiusMeters,
    maxY: center.y + radiusMeters
  };
}