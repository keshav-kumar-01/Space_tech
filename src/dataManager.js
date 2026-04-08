/**
 * dataManager.js — CelesTrak Data Fetching & Caching
 * 
 * Respects rate limits: fetch once, cache for 2 hours.
 * Fetches all satellite groups and merges them.
 */

const API_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const CACHE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// Group definitions — fetch each specific group separately for reliability
// The "active" group is huge (~10K+) and may fail, so we build the master
// list by merging all successfully-fetched groups.
const GROUPS = {
  starlink: { param: 'starlink', label: 'Starlink',        icon: '⭐' },
  stations: { param: 'stations', label: 'Space Stations',  icon: '🏠' },
  'gps-ops':{ param: 'gps-ops',  label: 'GPS',             icon: '📍' },
  geo:      { param: 'geo',      label: 'Geostationary',   icon: '🔴' },
  weather:  { param: 'weather',  label: 'Weather',         icon: '🌦️' },
  amateur:  { param: 'amateur',  label: 'Amateur Radio',   icon: '📻' },
  oneweb:   { param: 'oneweb',   label: 'OneWeb',          icon: '🌐' },
};

// Additional groups to fetch for more complete coverage
const EXTRA_GROUPS = [
  { param: 'resource',      label: 'Earth Resources' },
  { param: 'sarsat',        label: 'Search & Rescue' },
  { param: 'dmc',           label: 'DMC Constellation' },
  { param: 'tdrss',         label: 'TDRSS' },
  { param: 'argos',         label: 'ARGOS' },
  { param: 'planet',        label: 'Planet Labs' },
  { param: 'spire',         label: 'Spire' },
  { param: 'ses',           label: 'SES' },
  { param: 'iridium',       label: 'Iridium' },
  { param: 'iridium-NEXT',  label: 'Iridium NEXT' },
  { param: 'orbcomm',       label: 'ORBCOMM' },
  { param: 'globalstar',    label: 'Globalstar' },
  { param: 'intelsat',      label: 'Intelsat' },
  { param: 'swarm',         label: 'Swarm' },
  { param: 'geodetic',      label: 'Geodetic' },
  { param: 'engineering',   label: 'Engineering' },
  { param: 'education',     label: 'Education' },
  { param: 'military',      label: 'Military' },
  { param: 'radar',         label: 'Radar Cal.' },
  { param: 'cubesat',       label: 'CubeSat' },
  { param: 'science',       label: 'Science' },
  { param: 'nnss',          label: 'NNSS' },
  { param: 'musson',        label: 'Musson' },
  { param: 'gnss',          label: 'GNSS' },
  { param: 'beidou',        label: 'Beidou' },
  { param: 'galileo',       label: 'Galileo' },
  { param: 'glonass-operational', label: 'GLONASS' },
  { param: 'supplemental/sup-gp', label: 'Supplemental', isSpecial: true },
  { param: 'x-comm',        label: 'Experimental' },
  { param: 'other-comm',    label: 'Other Comm' },
  { param: 'satnogs',       label: 'SatNOGS' },
  { param: 'cosmic',        label: 'COSMIC' },
  { param: 'celestis',      label: 'Celestis' },
  { param: 'last-30-days',  label: 'New Launches (30d)' },
];

class DataManager {
  constructor() {
    this.cache = {};          // { groupKey: { data: [], timestamp: Date } }
    this.allSatellites = [];  // merged, de-duplicated satellites
    this.groupData = {};      // { groupKey: [] }
    this.onProgress = null;   // progress callback
    this.fetchTimestamp = null;
  }

  /**
   * Fetch a single group from CelesTrak (JSON OMM format)
   */
  async fetchGroup(groupKey, param) {
    // Check cache
    const cached = this.cache[groupKey];
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MS)) {
      return cached.data;
    }

    const url = `${API_BASE}?GROUP=${param}&FORMAT=JSON`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      // Read as text first, then parse — more resilient for large responses
      const text = await response.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        // Try to salvage truncated JSON by finding the last complete object
        console.warn(`JSON parse failed for ${groupKey}, attempting salvage...`);
        data = this._salvageJSON(text);
      }
      
      if (!Array.isArray(data)) {
        console.warn(`Non-array response for ${groupKey}`);
        return [];
      }

      // Cache it
      this.cache[groupKey] = { data, timestamp: Date.now() };
      
      // Try localStorage for smaller datasets
      if (data.length < 2000) {
        try {
          localStorage.setItem(`orbitview_${groupKey}`, JSON.stringify({
            data,
            timestamp: Date.now()
          }));
        } catch (e) {
          // localStorage might be full — that's ok
        }
      }
      
      return data;
    } catch (err) {
      // Try loading from localStorage cache
      try {
        const stored = localStorage.getItem(`orbitview_${groupKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          this.cache[groupKey] = parsed;
          return parsed.data;
        }
      } catch (e) { /* ignore */ }
      
      console.warn(`Failed to fetch group ${groupKey}:`, err.message);
      return [];
    }
  }

  /**
   * Attempt to salvage a truncated JSON array
   */
  _salvageJSON(text) {
    // Find the last complete JSON object in the array
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace === -1) return [];
    
    const salvaged = text.substring(0, lastBrace + 1) + ']';
    try {
      const data = JSON.parse(salvaged);
      if (Array.isArray(data)) {
        console.log(`Salvaged ${data.length} satellites from truncated response`);
        return data;
      }
    } catch (e) {
      // Try one more level
      const secondLastBrace = text.lastIndexOf('}', lastBrace - 1);
      if (secondLastBrace === -1) return [];
      try {
        const data2 = JSON.parse(text.substring(0, secondLastBrace + 1) + ']');
        if (Array.isArray(data2)) return data2;
      } catch { /* give up */ }
    }
    
    return [];
  }

  /**
   * Fetch all groups and merge into a master list.
   * Instead of relying on the single huge "active" group,
   * we fetch each specific group separately and merge/de-duplicate.
   */
  async fetchAllGroups(progressCallback) {
    this.onProgress = progressCallback;
    
    // Phase 1: Fetch main visible groups
    const mainGroupKeys = Object.keys(GROUPS);
    const allFetchable = [
      ...mainGroupKeys.map(k => ({ key: k, param: GROUPS[k].param, label: GROUPS[k].label })),
      ...EXTRA_GROUPS.map(g => ({ key: g.param, param: g.param, label: g.label })),
    ];
    
    const total = allFetchable.length;
    let completed = 0;

    for (const { key, param, label } of allFetchable) {
      if (this.onProgress) {
        this.onProgress({
          phase: 'fetch',
          group: label,
          progress: completed / total
        });
      }

      const data = await this.fetchGroup(key, param);
      this.groupData[key] = data;
      completed++;
    }

    // Phase 2: Merge all fetched satellites, de-duplicate by NORAD_CAT_ID
    const seenIds = new Set();
    this.allSatellites = [];

    for (const key of Object.keys(this.groupData)) {
      for (const sat of (this.groupData[key] || [])) {
        const id = sat.NORAD_CAT_ID;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          this.allSatellites.push(sat);
        }
      }
    }

    // Also set up the "all" virtual group pointing to the master list
    this.groupData.all = this.allSatellites;

    // Build a quick lookup of NORAD IDs per main group for fast filtering
    this.groupIndex = {};
    for (const key of mainGroupKeys) {
      this.groupIndex[key] = new Set(
        (this.groupData[key] || []).map(s => s.NORAD_CAT_ID)
      );
    }

    this.fetchTimestamp = Date.now();

    if (this.onProgress) {
      this.onProgress({ phase: 'done', progress: 1 });
    }

    console.log(`Total unique satellites: ${this.allSatellites.length}`);
    return this.allSatellites;
  }

  /**
   * Get satellites for a specific group
   */
  getSatellitesForGroup(groupKey) {
    if (groupKey === 'all') return this.allSatellites;
    return this.groupData[groupKey] || [];
  }

  /**
   * Get the group a satellite belongs to (for coloring)
   */
  getSatelliteGroup(noradId) {
    for (const [key, idSet] of Object.entries(this.groupIndex || {})) {
      if (idSet.has(noradId)) return key;
    }
    return 'other';
  }

  /**
   * Search satellites by name or NORAD ID
   */
  searchSatellites(query, limit = 20) {
    if (!query || query.length < 2) return [];
    const q = query.toUpperCase();
    const results = [];
    
    for (const sat of this.allSatellites) {
      if (results.length >= limit) break;
      const name = (sat.OBJECT_NAME || '').toUpperCase();
      const id = String(sat.NORAD_CAT_ID || '');
      if (name.includes(q) || id.includes(q)) {
        results.push(sat);
      }
    }
    
    return results;
  }

  /**
   * Get group counts for UI display
   */
  getGroupCounts() {
    const counts = {};
    const mainGroupKeys = Object.keys(GROUPS);
    for (const key of mainGroupKeys) {
      counts[key] = (this.groupData[key] || []).length;
    }
    counts.all = this.allSatellites.length;
    return counts;
  }

  /**
   * Get orbit type classification based on mean motion / altitude
   */
  static classifyOrbit(sat) {
    const mm = sat.MEAN_MOTION || 0;
    const period = mm > 0 ? 1440 / mm : 0; // minutes

    if (period < 130) return 'LEO';       // Low Earth Orbit
    if (period < 700) return 'MEO';       // Medium Earth Orbit
    if (period > 1400 && period < 1500) return 'GEO'; // Geostationary
    if (period >= 700) return 'HEO';      // Highly Elliptical
    return 'Unknown';
  }

  /**
   * Count satellites by orbit type
   */
  getOrbitCounts() {
    const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, Unknown: 0 };
    for (const sat of this.allSatellites) {
      const type = DataManager.classifyOrbit(sat);
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get data age for UI display
   */
  getDataAge() {
    if (!this.fetchTimestamp) return 'No data';
    const ageMs = Date.now() - this.fetchTimestamp;
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  }
}

export { DataManager, GROUPS };
export default DataManager;
