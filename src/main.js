/**
 * main.js — OrbitView Application Entry Point
 * 
 * 🛰️ Real-Time 3D Satellite Orbit Visualization
 * Data source: CelesTrak (celestrak.org)
 * Rendering: Three.js + satellite.js
 * 
 * ALL satellites are interactive — hover for tooltip, click for full details.
 * Orbit paths are shown for hovered + selected satellites.
 * Time speed slider changes Earth rotation AND satellite positions in sync.
 */

import { DataManager, GROUPS } from './dataManager.js';
import { SceneManager } from './sceneManager.js';
import { OrbitPropagator, EARTH_RADIUS_KM } from './orbitPropagator.js';

// ============================================================
// STATE
// ============================================================
const state = {
  dataManager: new DataManager(),
  sceneManager: null,
  currentResults: null,        // Latest propagation results
  propagationTimer: null,      // setInterval ID
  infoPanelTimer: null,        // Periodic info panel refresh
  basePropagationMs: 3000,     // Propagation interval at 1x speed
};

// ============================================================
// LOADING SEQUENCE
// ============================================================
async function boot() {
  const loaderBar = document.getElementById('loader-bar');
  const loaderStatus = document.getElementById('loader-status');

  try {
    // Phase 1: Fetch all satellite data
    loaderStatus.textContent = 'Fetching satellite data from CelesTrak...';
    loaderBar.style.width = '10%';

    const satellites = await state.dataManager.fetchAllGroups((progress) => {
      const pct = 10 + progress.progress * 60;
      loaderBar.style.width = `${pct}%`;
      if (progress.phase === 'fetch') {
        loaderStatus.textContent = `Loading ${progress.group}...`;
      }
    });

    console.log(`Loaded ${satellites.length} satellites from CelesTrak`);

    // Phase 2: Initialize 3D scene
    loaderStatus.textContent = 'Building 3D scene...';
    loaderBar.style.width = '75%';

    const container = document.getElementById('canvas-container');
    state.sceneManager = new SceneManager(container);

    // Phase 3: Feed data into scene
    loaderStatus.textContent = 'Initializing orbit propagation...';
    loaderBar.style.width = '85%';

    const initCount = state.sceneManager.setSatelliteData(satellites, state.dataManager);

    // Phase 4: First propagation
    loaderStatus.textContent = `Propagating ${initCount.toLocaleString()} satellite orbits...`;
    loaderBar.style.width = '92%';

    propagateNow();

    // Phase 5: Wire up UI
    loaderStatus.textContent = 'Launching OrbitView...';
    loaderBar.style.width = '100%';

    initUI();
    updateStats();
    updateGroupCounts();

    // Start loops
    startPropagationLoop();
    startClockUpdate();

    // Show app
    await sleep(500);
    document.getElementById('loading-screen').classList.add('fade-out');
    document.getElementById('app').style.display = '';

    setTimeout(() => {
      document.getElementById('loading-screen').style.display = 'none';
    }, 1000);

  } catch (err) {
    console.error('Boot failed:', err);
    loaderStatus.textContent = `Error: ${err.message}. Retrying...`;
    setTimeout(boot, 3000);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// PROPAGATION
// ============================================================

/** Run one propagation cycle using the scene's simulation time */
function propagateNow() {
  if (!state.sceneManager) return;
  const simDate = state.sceneManager.getSimDate();
  state.currentResults = state.sceneManager.updatePositions(simDate);
}

/**
 * Start the propagation loop.
 * At higher speeds, we propagate more frequently for smoother motion.
 */
function startPropagationLoop() {
  // Clear existing
  if (state.propagationTimer) clearInterval(state.propagationTimer);

  const speed = state.sceneManager?.timeSpeed || 1;
  // At 1x: update every 3s. At 10x: every 1s. At 100x: every 300ms.
  const interval = Math.max(200, Math.min(3000, state.basePropagationMs / Math.sqrt(speed)));

  state.propagationTimer = setInterval(propagateNow, interval);
}

function startClockUpdate() {
  const utcTimeEl = document.getElementById('utc-time');
  const dataAgeEl = document.getElementById('data-age');
  const simTimeEl = document.getElementById('sim-time');

  const update = () => {
    // Show real UTC
    const now = new Date();
    utcTimeEl.textContent = now.toISOString().substring(11, 19);
    dataAgeEl.textContent = `Data age: ${state.dataManager.getDataAge()}`;

    // Show simulation time if different from real
    if (state.sceneManager && simTimeEl) {
      const simDate = state.sceneManager.getSimDate();
      const diff = Math.abs(simDate.getTime() - now.getTime());
      if (diff > 60000) { // More than 1 minute off
        simTimeEl.textContent = simDate.toISOString().substring(0, 19).replace('T', ' ') + ' UTC';
        simTimeEl.style.display = '';
      } else {
        simTimeEl.style.display = 'none';
      }
    }

    // Update selected satellite info periodically
    if (state.sceneManager?.selectedSatId && state.currentResults) {
      updateSelectedSatInfo(state.sceneManager.selectedSatId);
    }
  };

  update();
  setInterval(update, 1000);
}

// ============================================================
// UI INITIALIZATION
// ============================================================
function initUI() {
  // 3D scene callbacks — ALL satellites trigger these
  state.sceneManager.onSatelliteClick = handleSatelliteClick;
  state.sceneManager.onSatelliteHover = handleSatelliteHover;
  state.sceneManager.onFpsUpdate = (fps) => {
    document.getElementById('fps-counter').textContent = `${fps} FPS`;
  };

  // Group filter buttons
  document.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      document.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sceneManager.setGroup(group);
      propagateNow(); // Immediate re-render with new filter
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    const results = state.dataManager.searchSatellites(q, 15);

    if (results.length === 0) {
      searchResults.classList.remove('visible');
      return;
    }

    searchResults.innerHTML = results.map(sat =>
      `<div class="search-result-item" data-norad="${sat.NORAD_CAT_ID}">
        <strong>${sat.OBJECT_NAME}</strong>
        <span style="color: var(--text-muted); font-size: 0.7rem; margin-left:6px;">#${sat.NORAD_CAT_ID}</span>
      </div>`
    ).join('');

    searchResults.classList.add('visible');

    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const noradId = parseInt(item.dataset.norad);
        state.sceneManager.selectSatellite(noradId);
        handleSatelliteClick(noradId);
        searchResults.classList.remove('visible');
        searchInput.value = '';
        propagateNow();
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('visible');
    }
  });

  // Toggle checkboxes
  document.getElementById('toggle-orbits').addEventListener('change', (e) => {
    state.sceneManager.toggleOrbits(e.target.checked);
    propagateNow();
  });

  document.getElementById('toggle-labels').addEventListener('change', (e) => {
    state.sceneManager.showLabels = e.target.checked;
  });

  document.getElementById('toggle-atmosphere').addEventListener('change', (e) => {
    state.sceneManager.toggleAtmosphere(e.target.checked);
  });

  // Speed slider — changing speed changes satellite positions + Earth rotation
  document.getElementById('speed-slider').addEventListener('input', (e) => {
    const speed = parseInt(e.target.value);
    state.sceneManager.setTimeSpeed(speed);
    document.getElementById('speed-label').textContent = `${speed}x`;

    // Show/hide speed indicator in top bar
    const speedIndicator = document.getElementById('speed-indicator');
    const speedDisplay = document.getElementById('speed-display');
    if (speed > 1) {
      speedIndicator.style.display = '';
      speedDisplay.textContent = `${speed}x`;
    } else {
      speedIndicator.style.display = 'none';
    }

    // Restart propagation loop with adaptive interval for smooth motion
    startPropagationLoop();

    // Immediate propagation so the change feels responsive
    propagateNow();
  });

  // Close right panel
  document.getElementById('close-right-panel').addEventListener('click', () => {
    document.getElementById('right-panel').classList.add('hidden');
    state.sceneManager.selectSatellite(null);
    state.sceneManager.orbitLineSelected.visible = false;
    state.sceneManager.selectionRing.visible = false;
    propagateNow();
  });
}

// ============================================================
// SATELLITE INTERACTION — ALL satellites interactive
// ============================================================
function handleSatelliteClick(noradId) {
  const rightPanel = document.getElementById('right-panel');

  if (noradId === null) {
    rightPanel.classList.add('hidden');
    return;
  }

  // Find satellite metadata
  const sat = state.dataManager.allSatellites.find(s => s.NORAD_CAT_ID === noradId);
  if (!sat) return;

  // Populate the info panel
  populateSatPanel(sat, noradId);

  rightPanel.classList.remove('hidden');
}

function populateSatPanel(sat, noradId) {
  document.getElementById('sat-name').textContent = sat.OBJECT_NAME || 'Unknown';
  document.getElementById('sat-norad-id').textContent = `NORAD: ${sat.NORAD_CAT_ID}`;
  document.getElementById('sat-inclination').textContent = (sat.INCLINATION || 0).toFixed(2);
  document.getElementById('sat-eccentricity').textContent = (sat.ECCENTRICITY || 0).toFixed(6);
  document.getElementById('sat-mean-motion').textContent = (sat.MEAN_MOTION || 0).toFixed(4);
  document.getElementById('sat-object-id').textContent = sat.OBJECT_ID || '—';
  document.getElementById('sat-epoch').textContent = sat.EPOCH
    ? new Date(sat.EPOCH).toLocaleDateString()
    : '—';
  document.getElementById('sat-bstar').textContent = sat.BSTAR
    ? sat.BSTAR.toExponential(4)
    : '—';

  const mm = sat.MEAN_MOTION || 0;
  const period = mm > 0 ? (1440 / mm).toFixed(1) : '—';
  document.getElementById('sat-period').textContent = period;
  document.getElementById('sat-orbit-type').textContent = DataManager.classifyOrbit(sat);

  // Live position data
  updateSelectedSatInfo(noradId);
}

/** Update the live position fields for the currently selected satellite */
function updateSelectedSatInfo(noradId) {
  const posData = state.currentResults?.get(noradId);
  if (posData) {
    document.getElementById('sat-altitude').textContent = posData.geodetic.alt.toFixed(1);
    document.getElementById('sat-velocity').textContent = posData.speed.toFixed(2);
    document.getElementById('sat-lat').textContent = posData.geodetic.lat.toFixed(3);
    document.getElementById('sat-lon').textContent = posData.geodetic.lon.toFixed(3);
  }
}

function handleSatelliteHover(noradId, mouseX, mouseY) {
  const tooltip = document.getElementById('hover-tooltip');

  if (noradId === null) {
    tooltip.classList.add('hidden');
    return;
  }

  const sat = state.dataManager.allSatellites.find(s => s.NORAD_CAT_ID === noradId);
  if (!sat) return;

  const posData = state.currentResults?.get(noradId);

  document.getElementById('tooltip-name').textContent = sat.OBJECT_NAME || `SAT-${noradId}`;

  if (posData) {
    document.getElementById('tooltip-alt').textContent =
      `Alt: ${posData.geodetic.alt.toFixed(0)} km | ${posData.speed.toFixed(1)} km/s`;
  } else {
    document.getElementById('tooltip-alt').textContent = `NORAD #${noradId}`;
  }

  // Position tooltip near mouse, clamped to viewport
  const tx = Math.min(mouseX + 16, window.innerWidth - 220);
  const ty = Math.max(mouseY - 10, 10);
  tooltip.style.left = `${tx}px`;
  tooltip.style.top = `${ty}px`;
  tooltip.classList.remove('hidden');
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
  const counts = state.dataManager.getOrbitCounts();
  const total = state.dataManager.allSatellites.length;

  document.getElementById('total-count').textContent = total.toLocaleString();
  document.getElementById('leo-count').textContent = (counts.LEO || 0).toLocaleString();
  document.getElementById('meo-count').textContent = (counts.MEO || 0).toLocaleString();
  document.getElementById('geo-count').textContent = (counts.GEO || 0).toLocaleString();
}

function updateGroupCounts() {
  const counts = state.dataManager.getGroupCounts();

  for (const [key, count] of Object.entries(counts)) {
    const el = document.getElementById(`grp-${key}-count`);
    if (el) el.textContent = count.toLocaleString();
  }

  // Map gps-ops
  const gpsEl = document.getElementById('grp-gps-count');
  if (gpsEl && counts['gps-ops'] !== undefined) {
    gpsEl.textContent = counts['gps-ops'].toLocaleString();
  }
}

// ============================================================
// LAUNCH
// ============================================================
document.addEventListener('DOMContentLoaded', boot);
