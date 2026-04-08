# 🛰️ OrbitView

**OrbitView** is a stunning, highly optimized 3D satellite orbit visualization tool built with **Three.js** and **satellite.js**. It fetches live OMM (Orbital Mean Elements) dataset feeds directly from **CelesTrak** and renders over 13,000 active satellites propagating their physical orbits in real time. 

Built around a premium, glassmorphism-styled UI, the application lets you track mega-constellations like Starlink and OneWeb, pinpoint the International Space Station, and visually categorize orbits by LEO, MEO, and GEO distributions.

![OrbitView Preview Image](https://raw.githubusercontent.com/threejs/three.js/master/examples/screenshots/webgl_geometry_earth.jpg) <!-- Note: Replace with actual screenshot later -->

## ✨ Key Features

- **Massive Real-Time Tracking**: Renders dynamic point clouds capable of handling up to 15,000 satellites at 60 FPS.
- **Accurate Physics**: Uses `satellite.js` to execute real-time SGP4 orbit propagation from native TLE/OMM elements to 3D Cartesian coordinates.
- **Interactive Global Scene**: 
  - Freely zoom, pan, and rotate a procedural 3D Earth (featuring atmospheric shaders, daylight/nighttime city lights, and starfields).
  - Hover or click on any satellite worldwide to immediately snap to its live position, altitude, velocity, and computed orbital paths.
- **Time Warp Capable**: Adjust time flow speeds from `1x` to `500x` — simulating thousands of hours of orbital pathways in seconds.
- **Group Filtering**: View specific constellations (Starlink, GPS, Space Stations, Global Weather systems, etc).

## 🛠️ Tech Stack

- **[Three.js](https://threejs.org/)** — Core WebGL 3D rendering engine, shaders, and spatial transformations.
- **[satellite.js](https://github.com/shashwatak/satellite-js)** — Library specifically used for SGP4/SDP4 calculation and coordinate abstractions (ECI, Geocentric, etc).
- **[Vite](https://vitejs.dev/)** — Blazing fast build tooling and hot-module dev server.
- **HTML + Vanilla CSS** — Lightweight, no complex frameworks needed.

## 🚀 Quick Setup 

To get this app running on your local machine:

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/OrbitView.git
cd OrbitView
```

### 2. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed, then run:
```bash
npm install
```

### 3. Run the Development Server
```bash
npm run dev
```

Open `http://localhost:3000` (or the port specified by Vite) in your browser. 
*(Note: Initial data aggregation heavily polls the CelesTrak API to collect all records, which takes roughly 15-30 seconds to securely download and build.)*

## 📁 Project Structure

```text
/
├── index.html              // Main layout, UI structure, and Canvas hooks
├── vite.config.js          // Vite configuration (supports ES modules and top-level await)
├── src/
│   ├── style.css           // Master stylesheet (UI layouts, Animations, glassmorphism themes)
│   ├── main.js             // Application Entry Point - manages UI bindings & Event listeners
│   ├── dataManager.js      // Asynchronous API Engine handling CelesTrak polling & de-duping
│   ├── orbitPropagator.js  // Math backbone converting OMM to accurate geospatial matrices
│   └── sceneManager.js     // Three.js Logic - Lighting, Shaders, Raycasting, and Render Loop
└── package.json            // NPM dependencies
```

## ⚖️ License
This project is open-source and free to adapt. Orbital parameters generously supplied by [CelesTrak](https://celestrak.com/).
