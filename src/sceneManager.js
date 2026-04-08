/**
 * sceneManager.js — Three.js 3D Scene
 * 
 * Earth globe + satellite points + orbit paths + interactions
 * ALL satellites are interactive: hover for tooltip, click for full info
 * Orbit paths drawn for selected + hovered satellites
 * Satellite positions update relative to time speed
 */
import * as THREE from 'three';
import { OrbitPropagator, EARTH_RADIUS_KM } from './orbitPropagator.js';

// Group colors — distinct per constellation
const GROUP_COLORS = {
  starlink:  new THREE.Color(0x00d4ff),
  stations:  new THREE.Color(0xff4466),
  'gps-ops': new THREE.Color(0xf5a623),
  geo:       new THREE.Color(0xff6b9d),
  weather:   new THREE.Color(0x00e676),
  amateur:   new THREE.Color(0xc850c0),
  oneweb:    new THREE.Color(0x7b61ff),
  other:     new THREE.Color(0x4d8eff),
};

class SceneManager {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // State
    this.satellites = [];
    this.propagator = new OrbitPropagator();
    this.dataManager = null;
    this.currentGroup = 'all';
    this.showOrbits = true;
    this.showLabels = false;
    this.showAtmosphere = true;
    this.timeSpeed = 1;
    this.selectedSatId = null;
    this.hoveredSatId = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.mouseNDC = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;

    // Simulation time — accumulates based on timeSpeed
    this.simTime = Date.now();
    this.lastRealTime = Date.now();

    // Callbacks
    this.onSatelliteClick = null;
    this.onSatelliteHover = null;
    this.onFpsUpdate = null;
    this.onSimTimeUpdate = null;

    this._init();
  }

  _init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.01, 1000);
    this.camera.position.set(0, 1.8, 4.5);
    this.camera.lookAt(0, 0, 0);

    // Orbit controls
    this._initControls();

    // Build scene
    this._createStarField();
    this._createEarth();
    this._createAtmosphere();
    this._createLighting();

    // Satellite point cloud
    this._createSatelliteCloud();

    // Create TWO orbit lines: selected (bright) + hovered (dim)
    this._createOrbitLines();

    // Selection ring
    this._createSelectionRing();

    // Events
    window.addEventListener('resize', () => this._onResize());
    this.container.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.container.addEventListener('click', (e) => this._onClick(e));

    // Start render loop
    this._animate();
  }

  /* ====== CONTROLS (Orbit Camera) ====== */
  _initControls() {
    this.isDragging = false;
    this.dragDist = 0; // Track movement to differentiate drag vs click
    this.prevMouse = { x: 0, y: 0 };
    this.spherical = { theta: 0, phi: Math.PI / 3, radius: 4.5 };
    this.targetSpherical = { ...this.spherical };
    this.autoRotateSpeed = 0.0003;

    this.container.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.dragDist = 0;
      this.prevMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.prevMouse.x;
      const dy = e.clientY - this.prevMouse.y;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      this.prevMouse = { x: e.clientX, y: e.clientY };

      this.targetSpherical.theta -= dx * 0.005;
      this.targetSpherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2,
        this.targetSpherical.phi - dy * 0.005
      ));
    });

    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetSpherical.radius = Math.max(1.5, Math.min(20,
        this.targetSpherical.radius + e.deltaY * 0.003
      ));
    }, { passive: false });

    // Touch support
    let touchStartDist = 0;
    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });

    this.container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.prevMouse.x;
        const dy = e.touches[0].clientY - this.prevMouse.y;
        this.prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this.targetSpherical.theta -= dx * 0.005;
        this.targetSpherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2,
          this.targetSpherical.phi - dy * 0.005
        ));
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = touchStartDist - dist;
        this.targetSpherical.radius = Math.max(1.5, Math.min(20,
          this.targetSpherical.radius + delta * 0.01
        ));
        touchStartDist = dist;
      }
    }, { passive: false });

    this.container.addEventListener('touchend', () => {
      this.isDragging = false;
    });
  }

  _updateCamera() {
    const lerp = 0.08;
    this.spherical.theta += (this.targetSpherical.theta - this.spherical.theta) * lerp;
    this.spherical.phi += (this.targetSpherical.phi - this.spherical.phi) * lerp;
    this.spherical.radius += (this.targetSpherical.radius - this.spherical.radius) * lerp;

    if (!this.isDragging) {
      this.targetSpherical.theta += this.autoRotateSpeed;
    }

    const r = this.spherical.radius;
    const theta = this.spherical.theta;
    const phi = this.spherical.phi;

    this.camera.position.set(
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(0, 0, 0);
  }

  /* ====== STAR FIELD ====== */
  _createStarField() {
    const count = 8000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const r = 80 + Math.random() * 120;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = 0.3 + Math.random() * 1.5;

      const temp = Math.random();
      if (temp < 0.05) {
        colors[i * 3] = 0.6; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 1.0;
      } else if (temp < 0.1) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.5;
      } else {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.4,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.starField = new THREE.Points(geometry, material);
    this.scene.add(this.starField);
  }

  /* ====== EARTH ====== */
  _createEarth() {
    const earthGeo = new THREE.SphereGeometry(1, 128, 64);

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(-vPosition);
          float diffuse = max(dot(normal, uSunDir), 0.0);
          float ambient = 0.06;
          vec2 uv = vUv;
          float continent = fbm(uv * vec2(8.0, 4.0) + vec2(0.5, 0.0));
          float detail = fbm(uv * vec2(32.0, 16.0));
          float landMask = smoothstep(0.42, 0.52, continent + detail * 0.15);
          vec3 oceanDeep = vec3(0.02, 0.04, 0.12);
          vec3 oceanShallow = vec3(0.04, 0.08, 0.18);
          vec3 oceanColor = mix(oceanDeep, oceanShallow, detail * 0.5);
          vec3 landGreen = vec3(0.06, 0.12, 0.04);
          vec3 landBrown = vec3(0.12, 0.08, 0.03);
          vec3 landDesert = vec3(0.18, 0.15, 0.08);
          float biome = fbm(uv * vec2(16.0, 8.0) + vec2(2.0, 1.0));
          vec3 landColor = mix(landGreen, landBrown, smoothstep(0.3, 0.6, biome));
          landColor = mix(landColor, landDesert, smoothstep(0.6, 0.8, biome) * 0.6);
          float polar = abs(uv.y - 0.5) * 2.0;
          float iceMask = smoothstep(0.82, 0.92, polar + detail * 0.1);
          vec3 iceColor = vec3(0.6, 0.65, 0.7);
          vec3 surfaceColor = mix(oceanColor, landColor, landMask);
          surfaceColor = mix(surfaceColor, iceColor, iceMask);
          float nightFactor = 1.0 - smoothstep(0.0, 0.15, diffuse);
          float cityNoise = fbm(uv * vec2(64.0, 32.0) + vec2(3.0, 5.0));
          float cityMask = smoothstep(0.55, 0.7, cityNoise) * landMask * (1.0 - iceMask);
          vec3 cityLight = vec3(1.0, 0.85, 0.4) * cityMask * nightFactor * 0.6;
          vec3 lit = surfaceColor * (ambient + diffuse * 0.9);
          lit += cityLight;
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
          lit += vec3(0.1, 0.2, 0.4) * fresnel * 0.3;
          float clouds = fbm(uv * vec2(12.0, 6.0) + vec2(uTime * 0.001, 0.0));
          float cloudMask = smoothstep(0.5, 0.7, clouds) * 0.15 * diffuse;
          lit += vec3(0.7, 0.75, 0.8) * cloudMask;
          gl_FragColor = vec4(lit, 1.0);
        }
      `,
    });

    this.earth = new THREE.Mesh(earthGeo, earthMat);
    this.scene.add(this.earth);
    this.earth.rotation.z = THREE.MathUtils.degToRad(23.5);
  }

  /* ====== ATMOSPHERE ====== */
  _createAtmosphere() {
    const atmosGeo = new THREE.SphereGeometry(1.015, 64, 32);
    const atmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(-vPosition);
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.5);
          float sunFactor = max(dot(normal, uSunDir), 0.0) * 0.5 + 0.5;
          vec3 atmosColor = mix(
            vec3(0.15, 0.35, 0.8),
            vec3(0.3, 0.6, 1.0),
            fresnel
          );
          float alpha = fresnel * 0.55 * sunFactor;
          gl_FragColor = vec4(atmosColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    this.scene.add(this.atmosphere);
  }

  /* ====== LIGHTING ====== */
  _createLighting() {
    const ambient = new THREE.AmbientLight(0x112244, 0.4);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(5, 2, 3);
    this.scene.add(sun);
    const fillLight = new THREE.DirectionalLight(0x4466aa, 0.3);
    fillLight.position.set(-3, -1, -2);
    this.scene.add(fillLight);
  }

  /* ====== SATELLITE POINT CLOUD ====== */
  _createSatelliteCloud() {
    this.maxSatellites = 15000;

    const positions = new Float32Array(this.maxSatellites * 3);
    const colors = new Float32Array(this.maxSatellites * 3);
    const sizes = new Float32Array(this.maxSatellites);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Satellite shader with larger points for better interactivity
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (250.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.5, 16.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          float glow = exp(-dist * 5.0) * 0.6;
          
          vec3 finalColor = vColor + vColor * glow;
          gl_FragColor = vec4(finalColor, alpha * 0.95);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.satCloud = new THREE.Points(geometry, material);
    this.satCloud.frustumCulled = false;
    this.scene.add(this.satCloud);

    // ID maps for raycasting
    this.satIndexToNoradId = new Map();
    this.noradIdToIndex = new Map();
  }

  /* ====== ORBIT LINES (Selected + Hovered) ====== */
  _createOrbitLines() {
    const maxPoints = 250;

    // Selected orbit line — bright, solid
    {
      const positions = new Float32Array(maxPoints * 3);
      const vertColors = new Float32Array(maxPoints * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(vertColors, 3));

      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        linewidth: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      this.orbitLineSelected = new THREE.Line(geometry, material);
      this.orbitLineSelected.visible = false;
      this.orbitLineSelected.frustumCulled = false;
      this.scene.add(this.orbitLineSelected);
    }

    // Hovered orbit line — dimmer, dashed feel via vertex color fade
    {
      const positions = new Float32Array(maxPoints * 3);
      const vertColors = new Float32Array(maxPoints * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(vertColors, 3));

      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        linewidth: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      this.orbitLineHover = new THREE.Line(geometry, material);
      this.orbitLineHover.visible = false;
      this.orbitLineHover.frustumCulled = false;
      this.scene.add(this.orbitLineHover);
    }

    // Keep backward compat reference
    this.orbitLine = this.orbitLineSelected;
  }

  /* ====== SELECTION RING ====== */
  _createSelectionRing() {
    const ringGeo = new THREE.RingGeometry(0.014, 0.022, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  /* ====== SET DATA ====== */
  setSatelliteData(satellites, dataManager) {
    this.satellites = satellites;
    this.dataManager = dataManager;
    const count = this.propagator.initFromOMM(satellites);
    console.log(`Propagator initialized: ${count} satellites`);
    return count;
  }

  /* ====== GET SIMULATION DATE ====== */
  getSimDate() {
    return new Date(this.simTime);
  }

  /* ====== ADVANCE SIMULATION TIME ====== */
  advanceSimTime(realDeltaMs) {
    // Simulation time advances at timeSpeed × real time
    this.simTime += realDeltaMs * this.timeSpeed;
  }

  /* ====== UPDATE SATELLITE POSITIONS ====== */
  updatePositions(date) {
    if (!this.propagator.count) return null;

    const results = this.propagator.propagateAll(date);
    const posAttr = this.satCloud.geometry.getAttribute('position');
    const colorAttr = this.satCloud.geometry.getAttribute('color');
    const sizeAttr = this.satCloud.geometry.getAttribute('size');

    this.satIndexToNoradId.clear();
    this.noradIdToIndex.clear();

    let idx = 0;
    const filteredSats = this._getFilteredIds();

    for (const [noradId, data] of results) {
      if (idx >= this.maxSatellites) break;

      // Apply group filter
      if (filteredSats && !filteredSats.has(noradId)) continue;

      const scenePos = OrbitPropagator.eciToScenePosition(data.position);
      posAttr.setXYZ(idx, scenePos.x, scenePos.y, scenePos.z);

      // Color by group
      const group = this.dataManager ? this.dataManager.getSatelliteGroup(noradId) : 'other';
      const color = GROUP_COLORS[group] || GROUP_COLORS.other;

      // Brighten selected/hovered satellites
      if (this.selectedSatId === noradId) {
        colorAttr.setXYZ(idx, 1.0, 1.0, 1.0); // white for selected
      } else if (this.hoveredSatId === noradId) {
        colorAttr.setXYZ(idx,
          Math.min(color.r * 1.5, 1),
          Math.min(color.g * 1.5, 1),
          Math.min(color.b * 1.5, 1)
        );
      } else {
        colorAttr.setXYZ(idx, color.r, color.g, color.b);
      }

      // Size — bigger for selected/hovered for visibility
      let size = 2.5;
      if (this.selectedSatId === noradId) size = 7.0;
      else if (this.hoveredSatId === noradId) size = 5.5;
      sizeAttr.setX(idx, size);

      this.satIndexToNoradId.set(idx, noradId);
      this.noradIdToIndex.set(noradId, idx);

      idx++;
    }

    // Zero out remaining
    for (let i = idx; i < this.maxSatellites; i++) {
      posAttr.setXYZ(i, 0, 0, 0);
      sizeAttr.setX(i, 0);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.satCloud.geometry.setDrawRange(0, idx);
    this.satCloud.geometry.computeBoundingSphere(); // Important for accurate raycasting as points move

    // Update orbit lines for selected satellite
    if (this.selectedSatId) {
      this._updateOrbitLineForSat(this.orbitLineSelected, this.selectedSatId, date, 0.85, true);
      this._updateSelectionRing(this.selectedSatId, results);
    } else {
      this.orbitLineSelected.visible = false;
      this.selectionRing.visible = false;
    }

    // Update orbit line for hovered satellite (if different from selected)
    if (this.hoveredSatId && this.hoveredSatId !== this.selectedSatId) {
      this._updateOrbitLineForSat(this.orbitLineHover, this.hoveredSatId, date, 0.4, false);
    } else {
      this.orbitLineHover.visible = false;
    }

    return results;
  }

  _getFilteredIds() {
    if (this.currentGroup === 'all' || !this.dataManager) return null;
    const groupSats = this.dataManager.getSatellitesForGroup(this.currentGroup);
    return new Set(groupSats.map(s => s.NORAD_CAT_ID));
  }

  /* ====== ORBIT PATH RENDERING ====== */
  _updateOrbitLineForSat(lineObj, noradId, date, baseOpacity, isSelected) {
    if (!this.showOrbits) {
      lineObj.visible = false;
      return;
    }

    const points = this.propagator.computeOrbitPath(noradId, date, 220);
    if (points.length < 2) {
      lineObj.visible = false;
      return;
    }

    const posAttr = lineObj.geometry.getAttribute('position');
    const colorAttr = lineObj.geometry.getAttribute('color');
    const count = Math.min(points.length, 250);

    // Determine color from satellite group
    const group = this.dataManager ? this.dataManager.getSatelliteGroup(noradId) : 'other';
    const baseColor = isSelected ? new THREE.Color(0x00d4ff) : (GROUP_COLORS[group] || GROUP_COLORS.other);

    for (let i = 0; i < count; i++) {
      const sp = OrbitPropagator.eciToScenePosition(points[i]);
      posAttr.setXYZ(i, sp.x, sp.y, sp.z);

      // Gradient: bright at satellite position, fades along orbit
      const t = i / count;
      const fade = isSelected
        ? (0.3 + 0.7 * (1 - Math.abs(2 * t - 1))) // bright in middle
        : (1 - t * 0.7); // fades towards end

      colorAttr.setXYZ(i, baseColor.r * fade, baseColor.g * fade, baseColor.b * fade);
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    lineObj.geometry.setDrawRange(0, count);
    lineObj.material.opacity = baseOpacity;
    lineObj.visible = true;
  }

  /* ====== SELECTION RING ====== */
  _updateSelectionRing(noradId, results) {
    const data = results?.get(noradId);
    if (!data) {
      this.selectionRing.visible = false;
      return;
    }

    const sp = OrbitPropagator.eciToScenePosition(data.position);
    this.selectionRing.position.set(sp.x, sp.y, sp.z);
    this.selectionRing.lookAt(this.camera.position);
    this.selectionRing.visible = true;

    // Pulse
    const t = Date.now() * 0.003;
    const scale = 1 + Math.sin(t) * 0.3;
    this.selectionRing.scale.setScalar(scale);
  }

  /* ====== RAYCASTING ====== */
  _onMouseMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouseNDC.x = (e.clientX / this.width) * 2 - 1;
    this.mouseNDC.y = -(e.clientY / this.height) * 2 + 1;
  }

  _onClick(e) {
    if (e.target !== this.renderer.domElement) return;

    // Reject clicks if the user was actively panning the camera
    if (this.dragDist > 10) return;

    // Update coordinates immediately in case it's a touch tap
    this.mouseNDC.x = (e.clientX / this.width) * 2 - 1;
    this.mouseNDC.y = -(e.clientY / this.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    // Give a larger, more forgiving threshold so it's easier to hit
    const zoomFactor = this.spherical.radius / 4.5;
    this.raycaster.params.Points.threshold = 0.08 * zoomFactor;

    const intersects = this.raycaster.intersectObject(this.satCloud);
    if (intersects.length > 0) {
      // Find the nearest satellite
      let nearestDist = Infinity;
      let nearestId = null;
      for (const hit of intersects) {
        if (hit.distanceToRay < nearestDist) {
          nearestDist = hit.distanceToRay;
          const nid = this.satIndexToNoradId.get(hit.index);
          if (nid != null) {
            nearestId = nid;
            nearestDist = hit.distanceToRay;
          }
        }
      }
      if (nearestId != null) {
        this.selectedSatId = nearestId;
        if (this.onSatelliteClick) this.onSatelliteClick(nearestId);
      }
    } else {
      this.selectedSatId = null;
      this.orbitLineSelected.visible = false;
      this.selectionRing.visible = false;
      if (this.onSatelliteClick) this.onSatelliteClick(null);
    }
  }

  _checkHover() {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const zoomFactor = this.spherical.radius / 4.5;
    this.raycaster.params.Points.threshold = 0.08 * zoomFactor;

    const intersects = this.raycaster.intersectObject(this.satCloud);
    if (intersects.length > 0) {
      // Pick nearest
      let nearestDist = Infinity;
      let nearestId = null;
      for (const hit of intersects) {
        if (hit.distanceToRay < nearestDist) {
          const nid = this.satIndexToNoradId.get(hit.index);
          if (nid != null) {
            nearestId = nid;
            nearestDist = hit.distanceToRay;
          }
        }
      }
      if (nearestId !== this.hoveredSatId) {
        this.hoveredSatId = nearestId;
        if (this.onSatelliteHover) {
          this.onSatelliteHover(nearestId, this.mouse.x, this.mouse.y);
        }
      } else if (nearestId === this.hoveredSatId) {
        // Update tooltip position even if same satellite
        if (this.onSatelliteHover) {
          this.onSatelliteHover(nearestId, this.mouse.x, this.mouse.y);
        }
      }
      this.container.style.cursor = 'pointer';
    } else {
      if (this.hoveredSatId !== null) {
        this.hoveredSatId = null;
        this.orbitLineHover.visible = false;
        if (this.onSatelliteHover) this.onSatelliteHover(null, 0, 0);
      }
      this.container.style.cursor = this.isDragging ? 'grabbing' : 'grab';
    }
  }

  /* ====== SETTINGS ====== */
  setGroup(groupKey) {
    this.currentGroup = groupKey;
  }

  toggleOrbits(show) {
    this.showOrbits = show;
    if (!show) {
      this.orbitLineSelected.visible = false;
      this.orbitLineHover.visible = false;
    }
  }

  toggleAtmosphere(show) {
    this.showAtmosphere = show;
    if (this.atmosphere) this.atmosphere.visible = show;
  }

  setTimeSpeed(speed) {
    this.timeSpeed = speed;
  }

  selectSatellite(noradId) {
    this.selectedSatId = noradId;
  }

  /* ====== RESIZE ====== */
  _onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  /* ====== ANIMATION LOOP ====== */
  _animate() {
    requestAnimationFrame(() => this._animate());

    const delta = this.clock.getDelta();
    const now = Date.now();
    const realDeltaMs = now - this.lastRealTime;
    this.lastRealTime = now;

    // Advance simulation time based on speed
    this.advanceSimTime(realDeltaMs);

    // FPS counter
    this.fpsFrames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 1.0) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.onFpsUpdate) this.onFpsUpdate(this.fps);
    }

    // Update camera
    this._updateCamera();

    // Rotate earth at speed proportional to timeSpeed
    // Earth rotates once per 24h = 2π / (24*3600*1000) rad/ms
    if (this.earth) {
      const earthRotRate = (2 * Math.PI) / (24 * 3600 * 1000); // rad per ms (real time)
      this.earth.rotation.y += earthRotRate * realDeltaMs * this.timeSpeed;
      this.earth.material.uniforms.uTime.value += delta * this.timeSpeed;
    }

    // Star field subtle rotation
    if (this.starField) {
      this.starField.rotation.y += 0.00002;
    }

    // Hover check
    this._checkHover();

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

export { SceneManager, GROUP_COLORS };
export default SceneManager;
