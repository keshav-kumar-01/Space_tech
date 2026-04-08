/**
 * orbitPropagator.js — SGP4 Orbit Propagation using satellite.js
 * 
 * Converts CelesTrak OMM JSON data to real-time ECI/geodetic positions.
 */
import * as satellite from 'satellite.js';

const EARTH_RADIUS_KM = 6371;  // km

class OrbitPropagator {
  constructor() {
    this.satrecords = new Map(); // NORAD_ID -> satrec object
  }

  /**
   * Initialize satellite records from OMM JSON data.
   * Converts JSON OMM fields to TLE format for sgp4 processing.
   */
  initFromOMM(satellites) {
    this.satrecords.clear();

    for (const sat of satellites) {
      try {
        const satrec = this._ommToSatrec(sat);
        if (satrec && satrec.error === 0) {
          this.satrecords.set(sat.NORAD_CAT_ID, {
            satrec,
            meta: sat
          });
        }
      } catch (e) {
        // Skip satellites that can't be parsed
      }
    }

    return this.satrecords.size;
  }

  /**
   * Convert OMM JSON format to satrec via TLE lines
   */
  _ommToSatrec(omm) {
    // Build TLE lines from OMM JSON format
    // We use satellite.js twoline2satrec which expects TLE strings
    // However, satellite.js also supports direct initialization

    // Parse epoch 
    const epoch = new Date(omm.EPOCH);
    const year = epoch.getUTCFullYear();
    const yearShort = year % 100;
    
    // Day of year with fractional
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = (epoch - startOfYear) / 86400000 + 1;

    // Format NORAD ID
    const noradId = String(omm.NORAD_CAT_ID).padStart(5, '0');
    
    // Classification
    const classification = omm.CLASSIFICATION_TYPE || 'U';
    
    // International designator
    const intlDes = omm.OBJECT_ID || '00000A';
    const intlDesFormatted = this._formatIntlDes(intlDes);

    // Mean motion derivatives
    const meanMotionDot = omm.MEAN_MOTION_DOT || 0;
    const meanMotionDDot = omm.MEAN_MOTION_DDOT || 0;
    
    // BSTAR
    const bstar = omm.BSTAR || 0;
    
    // Element set number
    const elemSetNo = omm.ELEMENT_SET_NO || 999;
    
    // Orbital elements
    const inclination = omm.INCLINATION || 0;
    const raan = omm.RA_OF_ASC_NODE || 0;
    const eccentricity = omm.ECCENTRICITY || 0;
    const argPerigee = omm.ARG_OF_PERICENTER || 0;
    const meanAnomaly = omm.MEAN_ANOMALY || 0;
    const meanMotion = omm.MEAN_MOTION || 0;
    const revNum = omm.REV_AT_EPOCH || 0;

    // Build TLE line 1
    const epochStr = `${String(yearShort).padStart(2, '0')}${dayOfYear.toFixed(8).padStart(12, ' ')}`;
    const mmDotStr = this._formatMmDot(meanMotionDot);
    const mmDDotStr = this._formatExpNotation(meanMotionDDot);
    const bstarStr = this._formatExpNotation(bstar);

    let line1 = `1 ${noradId}${classification} ${intlDesFormatted} ${epochStr} ${mmDotStr} ${mmDDotStr} ${bstarStr} 0 ${String(elemSetNo).padStart(4, ' ')}`;
    
    // Pad/trim to 68 characters, add checksum
    line1 = line1.substring(0, 68).padEnd(68, ' ');
    line1 += this._checksum(line1);

    // Build TLE line 2
    const incStr = inclination.toFixed(4).padStart(8, ' ');
    const raanStr = raan.toFixed(4).padStart(8, ' ');
    const eccStr = eccentricity.toFixed(7).substring(2); // Remove "0."
    const argPStr = argPerigee.toFixed(4).padStart(8, ' ');
    const maStr = meanAnomaly.toFixed(4).padStart(8, ' ');
    const mmStr = meanMotion.toFixed(8).padStart(11, ' ');
    const revStr = String(revNum).padStart(5, ' ');

    let line2 = `2 ${noradId} ${incStr} ${raanStr} ${eccStr} ${argPStr} ${maStr} ${mmStr}${revStr}`;
    line2 = line2.substring(0, 68).padEnd(68, ' ');
    line2 += this._checksum(line2);

    try {
      return satellite.twoline2satrec(line1, line2);
    } catch (e) {
      return null;
    }
  }

  _formatIntlDes(intlDes) {
    // "1998-067A" => "98067A  "
    const parts = intlDes.split('-');
    if (parts.length < 2) return '00000A  ';
    const yr = parts[0].substring(2);
    const rest = parts[1];
    return `${yr}${rest}`.padEnd(8, ' ');
  }

  _formatMmDot(val) {
    // Format first derivative of mean motion
    if (val >= 0) {
      return ` .${Math.abs(val).toFixed(8).substring(2)}`;
    } else {
      return `-.${Math.abs(val).toFixed(8).substring(2)}`;
    }
  }

  _formatExpNotation(val) {
    // Format as TLE exponential notation: " 12345-6"
    if (val === 0) return ' 00000-0';
    const sign = val < 0 ? '-' : ' ';
    const abs = Math.abs(val);
    const exp = Math.floor(Math.log10(abs));
    const mantissa = abs / Math.pow(10, exp);
    const mantStr = Math.round(mantissa * 100000).toString().padStart(5, '0');
    const expSign = exp >= 0 ? '+' : '-';
    return `${sign}${mantStr}${expSign}${Math.abs(exp)}`;
  }

  _checksum(line) {
    let sum = 0;
    for (let i = 0; i < 68; i++) {
      const c = line[i];
      if (c >= '0' && c <= '9') sum += parseInt(c);
      else if (c === '-') sum += 1;
    }
    return (sum % 10).toString();
  }

  /**
   * Propagate ALL satellites to a given date, returning positions
   * Returns Map<noradId, {position: {x,y,z}, velocity: {vx,vy,vz}, geodetic: {lat,lon,alt}}>
   */
  propagateAll(date) {
    const results = new Map();
    const gmst = satellite.gstime(date);

    for (const [noradId, { satrec, meta }] of this.satrecords) {
      try {
        const positionAndVelocity = satellite.propagate(satrec, date);
        const posEci = positionAndVelocity.position;
        const velEci = positionAndVelocity.velocity;

        if (!posEci || typeof posEci.x !== 'number' || isNaN(posEci.x)) continue;

        // Convert to geodetic
        const posGd = satellite.eciToGeodetic(posEci, gmst);
        const lat = satellite.degreesLat(posGd.latitude);
        const lon = satellite.degreesLong(posGd.longitude);
        const alt = posGd.height; // km

        // Also calculate velocity magnitude
        const speed = Math.sqrt(velEci.x ** 2 + velEci.y ** 2 + velEci.z ** 2);

        results.set(noradId, {
          position: posEci,    // ECI km
          velocity: velEci,    // ECI km/s
          geodetic: { lat, lon, alt },
          speed,               // km/s
          meta
        });
      } catch (e) {
        // Skip failed propagations
      }
    }

    return results;
  }

  /**
   * Propagate a single satellite — used for orbit path computation
   */
  propagateOne(noradId, date) {
    const record = this.satrecords.get(noradId);
    if (!record) return null;

    try {
      const gmst = satellite.gstime(date);
      const pv = satellite.propagate(record.satrec, date);
      if (!pv.position || typeof pv.position.x !== 'number') return null;

      const posGd = satellite.eciToGeodetic(pv.position, gmst);

      return {
        position: pv.position,
        velocity: pv.velocity,
        geodetic: {
          lat: satellite.degreesLat(posGd.latitude),
          lon: satellite.degreesLong(posGd.longitude),
          alt: posGd.height
        },
        speed: Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2)
      };
    } catch {
      return null;
    }
  }

  /**
   * Compute orbit path for a satellite (array of ECI positions)
   * Used to draw the orbit line
   */
  computeOrbitPath(noradId, date, numPoints = 120) {
    const record = this.satrecords.get(noradId);
    if (!record) return [];

    const meanMotion = record.meta.MEAN_MOTION || 15;
    const periodMinutes = 1440 / meanMotion;
    const stepMs = (periodMinutes * 60 * 1000) / numPoints;

    const points = [];
    const startTime = date.getTime();

    for (let i = 0; i < numPoints; i++) {
      const t = new Date(startTime + i * stepMs);
      try {
        const pv = satellite.propagate(record.satrec, t);
        if (pv.position && typeof pv.position.x === 'number' && !isNaN(pv.position.x)) {
          points.push(pv.position);
        }
      } catch {
        // skip
      }
    }

    return points;
  }

  /**
   * Convert ECI position (km) to Three.js scene coordinates
   * Scale: 1 unit = EARTH_RADIUS_KM
   */
  static eciToScenePosition(eciPos) {
    const scale = 1 / EARTH_RADIUS_KM;
    return {
      x: eciPos.x * scale,
      y: eciPos.z * scale,    // Three.js Y is up, ECI Z is up
      z: -eciPos.y * scale    // Flip to match Three.js coordinate system
    };
  }

  /**
   * Get the number of successfully initialized satellites
   */
  get count() {
    return this.satrecords.size;
  }
}

export { OrbitPropagator, EARTH_RADIUS_KM };
export default OrbitPropagator;
