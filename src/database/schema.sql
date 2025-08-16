-- Property database schema for Singapore property transactions and rentals
-- Uses SVY21 coordinate system (Singapore's national projection)

-- Properties table: Core property information
CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,                    -- Project name (e.g., "THE PINNACLE@DUXTON")
    street TEXT NOT NULL,                     -- Street name
    x REAL NOT NULL,                          -- SVY21 X coordinate
    y REAL NOT NULL,                          -- SVY21 Y coordinate  
    market_segment TEXT,                      -- CCR/RCR/OCR (Core/Rest of Core/Outside Core)
    district TEXT,                            -- Singapore district code
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique properties per project/street combination
    UNIQUE(project, street)
);

-- Property transactions table: Individual sale transactions
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    price INTEGER NOT NULL,                   -- Transaction price in SGD
    area REAL NOT NULL,                       -- Floor area in sqm or land area
    contract_date TEXT NOT NULL,              -- Contract date in MMYY format (e.g., "0924" = Sep 2024)
    property_type TEXT NOT NULL,              -- Apartment, Condominium, Terrace, etc.
    floor_range TEXT,                         -- Floor range (e.g., "21-25", "-" for landed)
    no_of_units TEXT,                         -- Number of units in transaction
    tenure TEXT,                              -- Freehold, 99 years lease, etc.
    type_of_sale TEXT,                        -- Sale type code
    type_of_area TEXT,                        -- Strata, Land, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

-- Property rentals table: Rental contract data
CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    rent INTEGER NOT NULL,                    -- Monthly rent in SGD
    bedrooms INTEGER,                         -- Number of bedrooms (NULL if not specified)
    lease_date TEXT NOT NULL,                 -- Lease date in MMYY format
    area_sqm TEXT,                            -- Area range in sqm (e.g., "160-170")
    area_sqft TEXT,                           -- Area range in sqft (e.g., "1700-1800")
    property_type TEXT,                       -- Non-landed Properties, etc.
    district TEXT,                            -- District code
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

-- Indexes for spatial queries (location-based searches)
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(x, y);
CREATE INDEX IF NOT EXISTS idx_properties_district ON properties(district);
CREATE INDEX IF NOT EXISTS idx_properties_market_segment ON properties(market_segment);

-- Indexes for time-based queries
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(contract_date);
CREATE INDEX IF NOT EXISTS idx_transactions_property ON transactions(property_id);
CREATE INDEX IF NOT EXISTS idx_transactions_price ON transactions(price);
CREATE INDEX IF NOT EXISTS idx_transactions_area ON transactions(area);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(property_type);

CREATE INDEX IF NOT EXISTS idx_rentals_date ON rentals(lease_date);
CREATE INDEX IF NOT EXISTS idx_rentals_property ON rentals(property_id);
CREATE INDEX IF NOT EXISTS idx_rentals_rent ON rentals(rent);
CREATE INDEX IF NOT EXISTS idx_rentals_bedrooms ON rentals(bedrooms);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_properties_location_segment ON properties(x, y, market_segment);
CREATE INDEX IF NOT EXISTS idx_transactions_property_date ON transactions(property_id, contract_date);
CREATE INDEX IF NOT EXISTS idx_rentals_property_date ON rentals(property_id, lease_date);

-- Views for common queries

-- Property summary with latest transaction
CREATE VIEW IF NOT EXISTS property_summary AS
SELECT 
    p.id,
    p.project,
    p.street,
    p.x,
    p.y,
    p.market_segment,
    p.district,
    COUNT(t.id) as transaction_count,
    COUNT(r.id) as rental_count,
    MAX(t.price) as max_price,
    MIN(t.price) as min_price,
    AVG(t.price) as avg_price,
    MAX(r.rent) as max_rent,
    MIN(r.rent) as min_rent,
    AVG(r.rent) as avg_rent,
    MAX(t.contract_date) as latest_sale_date,
    MAX(r.lease_date) as latest_rental_date
FROM properties p
LEFT JOIN transactions t ON p.id = t.property_id
LEFT JOIN rentals r ON p.id = r.property_id
GROUP BY p.id, p.project, p.street, p.x, p.y, p.market_segment, p.district;

-- Recent transactions (last 2 years)
CREATE VIEW IF NOT EXISTS recent_transactions AS
SELECT 
    p.project,
    p.street,
    p.x,
    p.y,
    p.market_segment,
    p.district,
    t.price,
    t.area,
    t.contract_date,
    t.property_type,
    t.tenure,
    -- Calculate price per sqm
    ROUND(t.price / t.area, 0) as price_per_sqm
FROM properties p
JOIN transactions t ON p.id = t.property_id
WHERE 
    -- Filter for last 2 years (approximate)
    CAST(SUBSTR(t.contract_date, 3, 2) || SUBSTR(t.contract_date, 1, 2) AS INTEGER) >= 
    CAST(printf('%02d%02d', (strftime('%Y', 'now') - 2) % 100, strftime('%m', 'now')) AS INTEGER)
ORDER BY t.contract_date DESC;

-- Recent rentals (last 1 year)
CREATE VIEW IF NOT EXISTS recent_rentals AS
SELECT 
    p.project,
    p.street,
    p.x,
    p.y,
    p.market_segment,
    p.district,
    r.rent,
    r.bedrooms,
    r.lease_date,
    r.area_sqm,
    r.area_sqft
FROM properties p
JOIN rentals r ON p.id = r.property_id
WHERE 
    -- Filter for last 1 year (approximate)
    CAST(SUBSTR(r.lease_date, 3, 2) || SUBSTR(r.lease_date, 1, 2) AS INTEGER) >= 
    CAST(printf('%02d%02d', strftime('%Y', 'now') % 100, strftime('%m', 'now')) AS INTEGER) - 100
ORDER BY r.lease_date DESC;

-- Data freshness tracking
CREATE TABLE IF NOT EXISTS data_refresh_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_type TEXT NOT NULL,                  -- 'transactions' or 'rentals'
    batch_or_period TEXT,                     -- batch number or rental period
    record_count INTEGER NOT NULL,
    refresh_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL                      -- 'success' or 'error'
);