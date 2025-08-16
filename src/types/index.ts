export interface OneMapSearchResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  X: string;
  Y: string;
  LATITUDE: string;
  LONGITUDE: string;
}

export interface OneMapSearchResponse {
  found: number;
  totalNumPages: number;
  pageNum: number;
  results: OneMapSearchResult[];
}

export interface RouteItinerary {
  duration: number;
  startTime: number;
  endTime: number;
  walkTime: number;
  transitTime: number;
  waitingTime: number;
  walkDistance: number;
  walkLimitExceeded: boolean;
  generalizedCost: number;
  elevationLost: number;
  elevationGained: number;
  transfers: number;
}

export interface RoutePlan {
  date: number;
  from: {
    name: string;
    lon: number;
    lat: number;
    vertexType: string;
  };
  to: {
    name: string;
    lon: number;
    lat: number;
    vertexType: string;
  };
  itineraries: RouteItinerary[];
}

export interface OneMapRouteResponse {
  requestParameters?: any;
  plan?: RoutePlan;
  route_summary?: {
    total_distance: number;
    total_time: number;
  };
  route_instructions?: any[];
  message?: string;
  error?: string;
}

export interface MRTStation {
  name: string;
  building: string;
  address: string;
  postal: string;
  x: number; // SVY21 X coordinate for distance calculations
  y: number; // SVY21 Y coordinate for distance calculations
  latitude: number; // WGS84 latitude for routing API
  longitude: number; // WGS84 longitude for routing API
  line?: string;
  stationCode?: string;
}

export interface RouteResult {
  station: MRTStation;
  totalTime: number;
  distance: number;
  walkTime?: number;
  transitTime?: number;
  transfers?: number;
  mode: TransportMode;
  withinTimeLimit: boolean;
}

export interface ComparisonResult {
  station: MRTStation;
  modes: {
    walk?: RouteResult;
    cycle?: RouteResult;
    drive?: RouteResult;
    pt?: RouteResult;
  };
  recommendation: TransportMode;
}

export type TransportMode = 'walk' | 'cycle' | 'drive' | 'pt';

export interface Location {
  x: number; // SVY21 X coordinate for distance calculations
  y: number; // SVY21 Y coordinate for distance calculations
  latitude: number; // WGS84 latitude for routing API
  longitude: number; // WGS84 longitude for routing API
  address?: string;
}

// Legacy interface for backward compatibility
export interface LegacyLocation {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface RouteOptions {
  date?: string;
  time?: string;
  maxWalkDistance?: number;
  mode?: 'TRANSIT' | 'BUS' | 'RAIL';
}

// URA API Types
export interface URATokenResponse {
  Status: string;
  Message: string;
  Result: string;
}

export interface URATransaction {
  area: string;
  floorRange: string;
  noOfUnits: string;
  contractDate: string; // MMYY format
  typeOfSale: string;
  price: string;
  propertyType: string;
  district: string;
  typeOfArea: string;
  tenure: string;
}

export interface URAProperty {
  street: string;
  project: string;
  x?: string; // SVY21 X coordinate
  y?: string; // SVY21 Y coordinate
  transaction: URATransaction[];
  marketSegment: string; // CCR/RCR/OCR
}

export interface URATransactionResponse {
  Status: string;
  Result: URAProperty[];
}

export interface URARental {
  areaSqm: string; // Range format like "160-170"
  leaseDate: string; // MMYY format
  propertyType: string;
  district: string;
  areaSqft: string;
  noOfBedRoom: string;
  rent: number;
}

export interface URARentalProperty {
  street: string;
  x: string; // SVY21 X coordinate
  y: string; // SVY21 Y coordinate
  project: string;
  rental: URARental[];
}

export interface URARentalResponse {
  Status: string;
  Result: URARentalProperty[];
}

// Database Models
export interface PropertyRecord {
  id?: number;
  project: string;
  street: string;
  x: number;
  y: number;
  market_segment?: string;
  district?: string;
}

export interface TransactionRecord {
  id?: number;
  property_id: number;
  price: number;
  area: number;
  contract_date: string;
  property_type: string;
  tenure?: string;
  type_of_sale?: string;
}

export interface RentalRecord {
  id?: number;
  property_id: number;
  rent: number;
  bedrooms?: number;
  lease_date: string;
  area_sqm?: string;
  area_sqft?: string;
}